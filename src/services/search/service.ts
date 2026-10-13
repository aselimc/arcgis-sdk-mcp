/**
 * The search pipeline (design section 6.4): resolve the scope, make sure its indexes are
 * loaded, collect candidates from the symbol sidecar, the catalogue index, the body index
 * and (when enabled) site search, fuse them by rank, apply the multipliers, de-duplicate
 * and page. Zero hits is a normal result that explains itself.
 */
import { DeadlineExceededError, withDeadline } from '../../core/async.js';
import { formatCall } from '../../core/budget.js';
import { decodeCursor, encodeCursor } from '../../core/cursor.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { shortHash } from '../../core/hash.js';
import { TOOLS } from '../../core/names.js';
import type {
  CallOptions,
  Ctx,
  IndexState,
  SearchProvider,
  SearchRequest,
  SearchResponse,
  SearchService,
  VersionService,
} from '../../core/ports.js';
import { rrf } from '../../core/rrf.js';
import type { Product, SearchHit, VersionLine } from '../../core/types.js';
import { hitFromRecord, kindMatches } from '../index/query.js';
import type { IndexInternals } from '../index/types.js';
import { anySearchable, indexNotes, scopeNote } from '../notes.js';
import { resolveScope } from '../scope.js';
import { classifyQuery } from './classify.js';
import { coveredBySiteSearch } from './esearch/provider.js';
import { excerptOf } from './excerpt.js';
import { dedupe, rerank } from './rank.js';
import { SYNONYMS } from './synonyms.js';
import { zeroHitNotes } from './zero-hits.js';

/** Most products a search without a `product` argument covers. */
const MAX_ROUTED_PRODUCTS = 3;

/** Candidates taken from each retriever before fusion. */
const CANDIDATE_DEPTH = 100;

/** Body-index and site-search candidates per query. */
const SECONDARY_DEPTH = 20;

/** How long a search waits for site search before answering without it. */
export const SITE_SOFT_DEADLINE_MS = 2500;

/** Late site-search answers kept for the next identical call. */
const MAX_LATE_RESULTS = 50;

/** One product of the scope with the line being searched. */
interface Target {
  product: Product;
  line: VersionLine;
  sources?: string[];
}

/** Collaborators of the search service. */
export interface SearchDeps {
  ctx: Ctx;
  index: IndexInternals;
  versions: VersionService;
  provider: SearchProvider;
  /** Overrides {@link SITE_SOFT_DEADLINE_MS}; tests use a few milliseconds. */
  siteSoftDeadlineMs?: number;
}

/** Creates the search service. */
export function createSearchService(deps: SearchDeps): SearchService {
  const { ctx, index, versions, provider } = deps;
  const softDeadline = deps.siteSoftDeadlineMs ?? SITE_SOFT_DEADLINE_MS;
  /** Site-search answers that arrived after the soft deadline, by query key. */
  const late = new Map<string, SearchHit[]>();

  const remember = (key: string, hits: SearchHit[]): void => {
    late.set(key, hits);
    const oldest = late.keys().next();
    if (late.size > MAX_LATE_RESULTS && oldest.done !== true) late.delete(oldest.value);
  };

  /** Site-search hits within the soft deadline; a slower answer is kept for the next call. */
  const siteHits = async (
    key: string,
    req: SearchRequest,
    targets: Target[],
    call: CallOptions,
    notes: string[],
  ): Promise<SearchHit[]> => {
    const cached = late.get(key);
    if (cached !== undefined) return cached;
    const pending = provider
      .search(
        {
          text: req.query,
          products: targets.map((target) => target.product),
          line: req.version ?? targets[0]?.line.id ?? '',
          limit: SECONDARY_DEPTH,
        },
        call,
      )
      .catch((error: unknown) => {
        ctx.logger.warn('site search failed', { error });
        return [] as SearchHit[];
      });
    try {
      return await withDeadline(pending, softDeadline);
    } catch (error) {
      if (!(error instanceof DeadlineExceededError)) throw error;
      void pending.then((hits) => {
        remember(key, hits);
      });
      notes.push('Site search did not answer in time; its results are included when this call is repeated.');
      return [];
    }
  };

  const symbolHits = (names: readonly string[], targets: Target[], req: SearchRequest): SearchHit[] => {
    for (const name of names) {
      const records = targets
        .flatMap((target) => index.symbols(target.product.id, target.line.id).exact(name))
        .filter((record) => kindMatches(record, req.kind));
      if (records.length > 0) {
        return records
          .slice(0, SECONDARY_DEPTH)
          .map((record, position) => hitFromRecord(record, 'symbol', 1 / (position + 1)));
      }
    }
    return [];
  };

  /** Entry links of the products: the last rung of the search ladder. */
  const productCards = (targets: Target[]): SearchHit[] =>
    targets.flatMap(({ product, line }) =>
      [{ title: product.name, ref: product.homepage }, ...product.startHere].map(
        (entry, position): SearchHit => ({
          ref: entry.ref,
          title: entry.title,
          product: product.id,
          source: product.sources.find((source) => source.floor === true)?.id ?? '',
          line: line.id,
          kind: product.tier === 'help' ? 'help' : 'guide',
          excerpt: product.summary,
          match: 'title',
          score: 1 / (position + 1),
          license: product.licenseTier,
        }),
      ),
    );

  const labelled = async (hits: SearchHit[], targets: Target[]): Promise<SearchHit[]> => {
    const labels = new Map<string, string | undefined>();
    for (const { product, line } of targets) {
      try {
        labels.set(`${product.id}/${line.id}`, await versions.label(product, line));
      } catch (error) {
        ctx.logger.debug('version label unavailable', { product: product.id, error });
      }
    }
    return hits.map((hit) => {
      const version = hit.version ?? labels.get(`${hit.product}/${hit.line}`);
      const excerpt = excerptOf(hit.excerpt);
      const { excerpt: _dropped, ...rest } = hit;
      return {
        ...rest,
        ...(version === undefined ? {} : { version }),
        ...(excerpt === undefined ? {} : { excerpt }),
      };
    });
  };

  return {
    async search(req, call): Promise<SearchResponse> {
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.query,
        max: MAX_ROUTED_PRODUCTS,
      });
      const notes: string[] = [];
      const versionGiven = req.version !== undefined;

      const targets: Target[] = [];
      let lineError: unknown;
      for (const resolution of scope.resolutions) {
        try {
          const line = ctx.registry.line(resolution.product, req.version);
          const sources = resolution.source === undefined ? undefined : [resolution.source.id];
          targets.push({ product: resolution.product, line, ...(sources === undefined ? {} : { sources }) });
        } catch (error) {
          // A routed product without the requested line is left out; a named one is an error.
          if (scope.origin === 'argument' || !isMcpDocError(error)) throw error;
          lineError ??= error;
        }
      }
      if (targets.length === 0 && lineError !== undefined) throw lineError;

      const products = targets.map((target) => target.product.id);
      const sources = targets.length === 1 ? targets[0]?.sources : undefined;
      const lineIds = [...new Set(targets.map((target) => target.line.id))];
      const responseScope: SearchResponse['scope'] = {
        products,
        ...(sources === undefined ? {} : { sources }),
        ...(scope.origin === 'argument' ? { resolvedFrom: req.product ?? '' } : { resolvedFrom: scope.origin }),
        ...(req.kind === undefined ? {} : { kind: req.kind }),
        line: lineIds.length === 1 ? (lineIds[0] ?? '') : targets.map((t) => `${t.product.id}:${t.line.id}`).join(', '),
      };
      const siteEnabled = targets.some((target) => coveredBySiteSearch(ctx, target.product, target.line));
      const mode = siteEnabled ? 'local+site' : 'local';

      if (targets.length === 0) {
        notes.push(...zeroHitNotes(ctx, index, req, products, siteEnabled));
        return { query: req.query, scope: responseScope, mode, total: 0, hits: [], notes };
      }

      const states: IndexState[] = [];
      for (const target of targets) {
        states.push(...(await index.ensure(target.product, target.sources, target.line, call)));
      }

      const restart = formatCall(TOOLS.search, {
        query: req.query,
        product: req.product,
        kind: req.kind,
        version: req.version,
      });
      const key = shortHash(JSON.stringify([req.query, products, sources, req.kind, req.version]));
      const validator = index.validator({ products, sources });
      let offset = 0;
      if (req.cursor !== undefined) {
        try {
          offset = decodeCursor(req.cursor, TOOLS.search, { k: key, e: validator }).o;
        } catch (error) {
          if (!isMcpDocError(error)) throw error;
          throw new McpDocError(error.code, error.message, { ...error.details, next: restart });
        }
      }

      const query = classifyQuery(req.query);
      const lineOf = new Map(targets.map((target) => [target.product.id, target.line.id]));
      const inScope = (hit: SearchHit): boolean =>
        (req.kind === undefined ||
          hit.kind === req.kind ||
          // Named spec objects count as API reference, as in the catalogue query.
          (req.kind === 'api' && hit.kind === 'spec' && hit.symbolKind !== undefined)) &&
        (!versionGiven || hit.line === '' || hit.line === lineOf.get(hit.product));

      const catalogue = index.query({
        text: req.query,
        products,
        ...(sources === undefined ? {} : { sources }),
        ...(versionGiven && lineIds.length === 1 ? { line: lineIds[0] as string } : {}),
        ...(req.kind === undefined ? {} : { kind: req.kind }),
        limit: CANDIDATE_DEPTH,
        offset: 0,
        synonyms: SYNONYMS,
      });
      const lists: SearchHit[][] = [
        query.shape === 'symbol' ? symbolHits(query.names, targets, req) : [],
        catalogue.hits.filter(inScope),
        index
          .queryBodies({
            text: req.query,
            products,
            ...(req.kind === undefined ? {} : { kind: req.kind }),
            limit: SECONDARY_DEPTH,
          })
          .filter(inScope),
        siteEnabled ? (await siteHits(key, req, targets, call, notes)).filter(inScope) : [],
      ];

      const workspace = new Set(scope.workspace.map((sdk) => sdk.product));
      let ranked = dedupe(
        rerank(rrf(lists), {
          query: req.query,
          versionGiven,
          lines: lineOf,
          products: new Map(targets.map((target) => [target.product.id, target.product])),
          workspace,
        }),
      );

      const note = scopeNote(scope.origin, products);
      if (note !== undefined) notes.push(note);
      notes.push(...indexNotes(states, (product, source) => index.reason(product, source)));

      let total = Math.max(ranked.length, catalogue.total);
      if (ranked.length === 0) {
        if (!anySearchable(states)) {
          // Nothing could be searched: answer with the products' entry links and say so.
          ranked = productCards(targets);
          total = ranked.length;
          notes.push('degraded: no search index is available for this scope; showing the entry links of the products instead.');
        }
        notes.push(...zeroHitNotes(ctx, index, req, products, siteEnabled));
      }

      const page = ranked.slice(offset, offset + req.limit);
      const more = offset + req.limit < ranked.length;
      return {
        query: req.query,
        scope: responseScope,
        mode,
        total,
        hits: await labelled(page, targets),
        ...(more
          ? { nextCursor: encodeCursor({ v: 1, t: TOOLS.search, k: key, e: validator, o: offset + req.limit }) }
          : {}),
        notes,
      };
    },
  };
}
