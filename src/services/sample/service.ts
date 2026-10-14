/**
 * The sample service (design section 3.7): ranks the sample records of a product for a
 * task, optionally narrows them to a platform and to samples that use a given API, and
 * loads each hit's metadata (relevant APIs, files) lazily for at most the top ten.
 */
import { bindSource } from '../../core/adapter-helpers.js';
import { budgetExhausted } from '../../core/async.js';
import { formatCall } from '../../core/budget.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  AdapterRegistry,
  CallOptions,
  Ctx,
  SampleHit,
  SampleService,
  SamplesRequest,
  SamplesResponse,
} from '../../core/ports.js';
import type { CatalogRecord, DocPage, Product, VersionLine } from '../../core/types.js';
import type { IndexInternals } from '../index/types.js';
import { indexNotes } from '../notes.js';
import { projectLine, resolveScope } from '../scope.js';
import { plainText } from '../search/excerpt.js';
import { SYNONYMS } from '../search/synonyms.js';
import {
  confirmsApi,
  fitCode,
  fitListing,
  isGithubSample,
  matchesPlatform,
  mentionsApi,
  mergeSampleTwins,
  parseApi,
  type ApiName,
} from './rank.js';

/** Samples whose metadata is fetched per call: each costs one upstream request when not cached. */
export const MAX_METADATA_FETCHES = 10;

/** Text-ranked candidates considered before narrowing. */
const CANDIDATE_DEPTH = 100;

/** Sources searched for sample records when a product has no sample source of its own. */
const MAX_FALLBACK_SOURCES = 4;

/** Smallest budget given to the code of the top hit. */
const MIN_CODE_TOKENS = 200;

/** Share of the budget kept for the code when it was asked for; the listing gets the rest. */
const CODE_SHARE = 0.5;

/** A block that is not a sentence about the sample: heading, aside, code, table, list or image. */
const NOT_PROSE = /^ {0,3}(?:#{1,6}[ \t]|>|`{3,}|~{3,}|\||[-*+][ \t]|\d+\.[ \t]|!\[)/;

/**
 * The first sentence of the first paragraph of a sample's description, as plain text. Many
 * sample pages open with a notice (a deprecation warning in a block quote); that is said
 * of the sample, not what it shows.
 */
function firstSentence(page: DocPage | undefined): string | undefined {
  const blocks = page?.sections[0]?.markdown.split(/\n\s*\n/) ?? [];
  const prose = blocks.find((block) => block.trim() !== '' && !NOT_PROSE.test(block));
  if (prose === undefined) return undefined;
  const paragraph = plainText(prose).replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(paragraph)?.[0] ?? paragraph;
  return sentence === '' ? undefined : sentence.slice(0, 240);
}

/**
 * Languages a sample file can be written in that name the sample's language unambiguously,
 * by the spellings files are labelled with. Markup and web files (`index.html`, `main.js`
 * next to a TypeScript project) say how a sample is laid out, not what it is written in.
 */
const SAMPLE_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['csharp', 'csharp'],
  ['cs', 'csharp'],
  ['c#', 'csharp'],
  ['vb', 'vb'],
  ['java', 'java'],
  ['kotlin', 'kotlin'],
  ['kt', 'kotlin'],
  ['swift', 'swift'],
  ['dart', 'dart'],
  ['cpp', 'cpp'],
  ['c++', 'cpp'],
  ['qml', 'qml'],
  ['python', 'python'],
  ['py', 'python'],
]);

/**
 * The record of a hit, labelled with the language its source files are written in. A
 * repository that holds samples in several languages is indexed with one language for all
 * of them: the C# samples of the Enterprise SDK under `dot net/` were listed as java.
 */
function withFileLanguage(record: CatalogRecord, page: DocPage | undefined): CatalogRecord {
  const written = page?.files
    ?.map((file) => SAMPLE_LANGUAGES.get(file.language.toLowerCase()))
    .find((language) => language !== undefined);
  if (written === undefined) return record;
  const labelled = SAMPLE_LANGUAGES.get(record.language?.toLowerCase() ?? '');
  // A Qt sample is C++ and QML: either label holds, whichever file comes first.
  const qt = (language: string | undefined): boolean => language === 'cpp' || language === 'qml';
  if (labelled === written || (qt(labelled) && qt(written))) return record;
  return { ...record, language: written };
}

function originOf(record: CatalogRecord): SampleHit['origin'] {
  return isGithubSample(record) ? 'github' : 'esri-site';
}

/** Creates the sample service. */
export function createSampleService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): SampleService {
  /** The sample bundle of a record, or `undefined` when it cannot be had within the budget. */
  const metadata = async (
    product: Product,
    line: VersionLine,
    record: CatalogRecord,
    call: CallOptions,
    failures: string[],
  ): Promise<DocPage | undefined> => {
    const source = product.sources.find((candidate) => candidate.id === record.source);
    if (source === undefined || budgetExhausted(call.budget, ctx.clock)) return undefined;
    if (source.capability !== undefined && !ctx.policy.enabled(source.capability)) return undefined;
    try {
      const adapter = adapters.get(source.adapter);
      if (adapter.sample === undefined) return undefined;
      return await adapter.sample(
        ctx,
        bindSource(product, source, line, undefined, call.budget),
        record,
      );
    } catch (error) {
      if (!isMcpDocError(error))
        ctx.logger.error('sample read failed unexpectedly', { ref: record.ref, error });
      failures.push(isMcpDocError(error) ? `${error.code}: ${error.message}` : 'internal error');
      return undefined;
    }
  };

  const toHit = (
    record: CatalogRecord,
    page: DocPage | undefined,
    api: ApiName | undefined,
    confirmed: boolean,
  ): SampleHit => {
    const apis = page?.relevantApis;
    const files = page?.files?.map((file) => ({
      name: file.name,
      ref: file.ref,
      bytes: file.bytes,
    }));
    return {
      record: withFileLanguage(record, page),
      summary: record.description ?? firstSentence(page) ?? record.title,
      ...(apis === undefined || apis.length === 0 ? {} : { relevantApis: apis }),
      ...(files === undefined || files.length === 0 ? {} : { files }),
      origin: originOf(record),
      ...(api === undefined ? {} : { apiConfirmed: confirmed }),
      ...(record.deprecated === true ? { legacyPattern: true } : {}),
    };
  };

  return {
    async find(req: SamplesRequest, call: CallOptions): Promise<SamplesResponse> {
      // A sample search takes one product: of those the query or the project suggests, the
      // first that has samples at all.
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.query,
        max: 1,
        eligible: (candidate) => candidate.sources.some((source) => source.kinds.includes('sample')),
      });
      const [resolution] = scope.resolutions;
      if (resolution === undefined) {
        throw new McpDocError(
          'UNKNOWN_PRODUCT',
          'No product could be determined for this sample search',
          {
            why: 'No "product" was given, no Esri SDK was detected in the project and the query names none',
            next: formatCall(TOOLS.listProducts, { query: req.query }),
          },
        );
      }
      const { product } = resolution;
      const notes: string[] = [];

      const dedicated = (
        resolution.source === undefined
          ? product.sources.filter((source) => source.kinds.includes('sample'))
          : [resolution.source]
      ).map((source) => source.id);
      // A product without a sample source may still publish samples among its guide pages
      // (Esri Leaflet): its first sources are then searched for records of kind sample.
      const sourceIds =
        dedicated.length > 0
          ? dedicated
          : product.sources.slice(0, MAX_FALLBACK_SOURCES).map((source) => source.id);

      // The project's version line when it has samples of its own; a caller on 200.x is not
      // served the samples of 300.x without being told.
      const own = projectLine(ctx, product, scope.workspace);
      const current = ctx.registry.line(product);
      const onLine = (candidate: VersionLine): boolean =>
        product.sources.some(
          (source) =>
            sourceIds.includes(source.id) &&
            (source.lines === undefined || source.lines.includes(candidate.id)),
        );
      const pinned = own.pinned && onLine(own.line);
      const line = pinned ? own.line : current;
      if (pinned) {
        notes.push(
          `The project uses ${product.id} ${own.version ?? ''}: samples of the ${line.label} line are listed.`,
        );
      } else if (own.version !== undefined && (own.pinned || own.unreadable)) {
        notes.push(
          `The project uses ${product.id} ${own.version}, but these samples are for the current release (${current.label}); APIs they use may not exist in ${own.version}.`,
        );
      }
      const platform = req.platform?.trim() === '' ? undefined : req.platform?.trim();
      const responseScope: SamplesResponse['scope'] = {
        product: product.id,
        line: line.id,
        ...(platform === undefined ? {} : { platform }),
      };

      const states = await index.ensure(product, sourceIds, line, call);
      let samples = index
        .samples(product.id, line.id)
        .filter((record) => sourceIds.includes(record.source));
      if (dedicated.length === 0 && samples.length === 0) {
        notes.push(
          `${product.id} has no sample source. Tutorials and guides are found with ${formatCall(TOOLS.search, { query: req.query, product: product.id })}.`,
        );
        return { scope: responseScope, total: 0, hits: [], notes };
      }
      notes.push(...indexNotes(states, (p, s) => index.reason(p, s)));

      if (platform !== undefined) {
        const fitting = samples.filter((record) => matchesPlatform(record, platform));
        if (fitting.length === 0 && samples.length > 0) {
          const known = [
            ...new Set(samples.map((record) => record.platform).filter((p) => p !== undefined)),
          ];
          notes.push(
            `No sample of ${product.id} is marked for platform "${platform}"${known.length > 0 ? `; known platforms: ${known.slice(0, 8).join(', ')}` : ''}.`,
          );
        }
        samples = fitting;
      }
      const byRef = new Map(samples.map((record) => [record.ref, record]));

      const api = parseApi(req.usesApi);
      // The task alone ranks. The API is a filter that is checked against each sample's
      // metadata and code below: adding its name to the query ranked samples by whether
      // their title mentions it, which a sample that simply uses the class never does.
      const ranked = index
        .query({
          text: req.query,
          products: [product.id],
          sources: sourceIds,
          line: line.id,
          kind: 'sample',
          limit: CANDIDATE_DEPTH,
          offset: 0,
          synonyms: SYNONYMS,
        })
        .hits.map((hit) => byRef.get(hit.ref))
        .filter((record) => record !== undefined);

      let candidates = ranked;
      if (api !== undefined) {
        // Samples that name the API without matching the task are still worth checking,
        // after the ones the query found.
        const rankedRefs = new Set(ranked.map((record) => record.ref));
        candidates = [
          ...ranked,
          ...samples.filter((record) => mentionsApi(record, api) && !rankedRefs.has(record.ref)),
        ];
      }

      // A sample published on the site and in the repository is one sample, listed once.
      candidates = mergeSampleTwins(candidates, samples);

      const failures: string[] = [];
      const pages = new Map<string, DocPage>();
      const inspect =
        api === undefined ? Math.min(req.limit, MAX_METADATA_FETCHES) : MAX_METADATA_FETCHES;
      for (const record of candidates.slice(0, inspect)) {
        const page = await metadata(product, line, record, call, failures);
        if (page !== undefined) pages.set(record.ref, page);
      }
      if (failures.length > 0) {
        notes.push(
          `degraded: metadata of ${failures.length} sample(s) could not be read (${failures[0] ?? ''}); those hits come from the index alone.`,
        );
      }

      let hits: SampleHit[];
      if (api === undefined) {
        hits = candidates.map((record) => toHit(record, pages.get(record.ref), undefined, false));
      } else {
        /** What the metadata and main file of a sample say about the API. */
        const verdict = (record: CatalogRecord): 'confirmed' | 'refuted' | 'unknown' => {
          const page = pages.get(record.ref);
          if (page === undefined) return 'unknown';
          if (confirmsApi(page, api)) return 'confirmed';
          const evidence = (page.relevantApis?.length ?? 0) > 0 || page.files?.[0] !== undefined;
          return evidence ? 'refuted' : 'unknown';
        };
        const confirmed = candidates.filter((record) => verdict(record) === 'confirmed');
        // A sample that was not checked (beyond the first ten, or unreadable) is kept and
        // marked as unverified: leaving it out dropped the best match for the task whenever
        // ten samples that merely name the API in their title came before it. One whose
        // metadata and code were read and do not name the API is left out.
        const open = candidates.filter((record) => verdict(record) === 'unknown');
        // Among those not confirmed, the ones whose own text names the API go first.
        const unconfirmed = [
          ...open.filter((record) => mentionsApi(record, api)),
          ...open.filter((record) => !mentionsApi(record, api)),
        ];
        hits = [
          ...confirmed.map((record) => toHit(record, pages.get(record.ref), api, true)),
          ...unconfirmed.map((record) => toHit(record, pages.get(record.ref), api, false)),
        ];
        if (hits.length === 0) {
          // A sample can use an API without naming it (`featureReduction: { type: "cluster" }`
          // for FeatureReductionCluster), so the way back to the unfiltered list is given.
          const unfiltered = formatCall(TOOLS.findSamples, {
            query: req.query,
            product: product.id,
            platform,
          });
          notes.push(
            `No sample of ${product.id} was found that uses ${api.full}: the metadata and main file of the top ${inspect} matches do not name it. A sample may still use it indirectly; the same search without "uses_api" is ${unfiltered}.`,
          );
        } else if (confirmed.length === 0) {
          notes.push(
            `No sample was confirmed to use ${api.full}: the hits match the query or mention the API, and their use of it is not verified.`,
          );
        } else if (unconfirmed.length > 0) {
          notes.push(
            `${confirmed.length} sample(s) are confirmed to use ${api.full} and listed first; the others were not checked (only the top ${inspect} candidates are).`,
          );
        }
      }

      const total = hits.length;
      // With `with_code` the caller wants code first: file lists give way before the code does.
      const reserved = req.withCode ? Math.floor(req.maxTokens * CODE_SHARE) : 0;
      const listing = fitListing(hits.slice(0, req.limit), req.maxTokens - reserved);
      hits = listing.hits;
      if (listing.trimmed > 0) {
        notes.push(
          `The file lists of ${listing.trimmed} lower-ranked hit(s) were left out to fit max_tokens; reading a hit lists its files.`,
        );
      }
      if (total === 0 && api === undefined) {
        notes.push(
          `No sample matched. Guides and tutorials are found with ${formatCall(TOOLS.search, { query: req.query, product: product.id })}.`,
        );
      }

      const top = hits[0];
      const topPage = top === undefined ? undefined : pages.get(top.record.ref);
      if (top?.origin === 'github' && topPage?.version !== undefined)
        responseScope.pinnedTo = topPage.version;

      const response: SamplesResponse = { scope: responseScope, total, hits, notes };
      const main = topPage?.files?.[0];
      if (req.withCode && top !== undefined) {
        if (main === undefined) {
          notes.push(
            `The source of the top hit is not available here; read it with ${formatCall(TOOLS.read, { ref: top.record.ref, section: 'source' })}.`,
          );
        } else {
          // The listing is paid for first; the code gets what is left of the budget.
          const budget = Math.max(MIN_CODE_TOKENS, req.maxTokens - listing.tokens);
          response.code = {
            ref: main.ref,
            file: main.name,
            language: main.language,
            ...fitCode(main.text, budget),
          };
        }
      }
      return response;
    },
  };
}
