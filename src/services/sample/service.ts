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
import { resolveScope } from '../scope.js';
import { SYNONYMS } from '../search/synonyms.js';
import {
  confirmsApi,
  fitCode,
  matchesPlatform,
  mentionsApi,
  parseApi,
  type ApiName,
} from './rank.js';

/** Samples whose metadata is fetched per call: each costs one upstream request when not cached. */
export const MAX_METADATA_FETCHES = 10;

/** Text-ranked candidates considered before narrowing. */
const CANDIDATE_DEPTH = 100;

/** Tokens reserved per listed hit when the main source file is also returned. */
const TOKENS_PER_HIT = 150;

/** Smallest budget given to the code of the top hit. */
const MIN_CODE_TOKENS = 200;

function firstSentence(page: DocPage | undefined): string | undefined {
  const lead = page?.sections[0]?.markdown.replace(/^ {0,3}#{1,6}[ \t]+.*$/m, '').trim();
  if (lead === undefined || lead === '') return undefined;
  const paragraph =
    lead
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  const sentence = /^.*?[.!?](?=\s|$)/.exec(paragraph)?.[0] ?? paragraph;
  return sentence === '' ? undefined : sentence.slice(0, 240);
}

function originOf(record: CatalogRecord): SampleHit['origin'] {
  return /^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\//.test(record.ref)
    ? 'github'
    : 'esri-site';
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
      record,
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
      const scope = await resolveScope(ctx, { product: req.product, query: req.query, max: 1 });
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
      const line = ctx.registry.line(product);
      const platform = req.platform?.trim() === '' ? undefined : req.platform?.trim();
      const responseScope: SamplesResponse['scope'] = {
        product: product.id,
        line: line.id,
        ...(platform === undefined ? {} : { platform }),
      };
      const notes: string[] = [];

      const sourceIds = (
        resolution.source === undefined
          ? product.sources.filter((source) => source.kinds.includes('sample'))
          : [resolution.source]
      ).map((source) => source.id);
      if (sourceIds.length === 0) {
        notes.push(
          `${product.id} has no sample source. Tutorials and guides are found with ${formatCall(TOOLS.search, { query: req.query, product: product.id })}.`,
        );
        return { scope: responseScope, total: 0, hits: [], notes };
      }

      const states = await index.ensure(product, sourceIds, line, call);
      notes.push(...indexNotes(states, (p, s) => index.reason(p, s)));

      let samples = index
        .samples(product.id, line.id)
        .filter((record) => sourceIds.includes(record.source));
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
      const ranked = index
        .query({
          text: api === undefined ? req.query : `${req.query} ${api.full}`,
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
        // Samples that name the API come first, then the rest of the text matches; samples
        // that name it without matching the task are still worth confirming.
        const naming = samples.filter((record) => mentionsApi(record, api));
        const namingRefs = new Set(naming.map((record) => record.ref));
        const rankedRefs = new Set(ranked.map((record) => record.ref));
        candidates = [
          ...ranked.filter((record) => namingRefs.has(record.ref)),
          ...naming.filter((record) => !rankedRefs.has(record.ref)),
          ...ranked.filter((record) => !namingRefs.has(record.ref)),
        ];
      }

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
        const confirmed = candidates.filter((record) => {
          const page = pages.get(record.ref);
          return page !== undefined && confirmsApi(page, api);
        });
        const confirmedRefs = new Set(confirmed.map((record) => record.ref));
        const unconfirmed = candidates.filter(
          (record) => !confirmedRefs.has(record.ref) && mentionsApi(record, api),
        );
        hits = [
          ...confirmed.map((record) => toHit(record, pages.get(record.ref), api, true)),
          ...unconfirmed.map((record) => toHit(record, pages.get(record.ref), api, false)),
        ];
        if (hits.length === 0) {
          notes.push(
            `No sample of ${product.id} was found that uses ${api.full}; not verified beyond the top ${inspect} candidates.`,
          );
        } else if (confirmed.length === 0) {
          notes.push(`No sample was confirmed to use ${api.full}; the hits only mention it.`);
        }
      }

      const total = hits.length;
      hits = hits.slice(0, req.limit);
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
          const budget = Math.max(MIN_CODE_TOKENS, req.maxTokens - TOKENS_PER_HIT * hits.length);
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
