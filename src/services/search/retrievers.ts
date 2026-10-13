/**
 * The candidate lists of the search pipeline that are not the catalogue index itself: exact
 * symbol matches, site search with its soft deadline, and the product cards that answer
 * when nothing can be searched (the last rung of the search ladder, design section 6.6).
 */
import { DeadlineExceededError, withDeadline } from '../../core/async.js';
import type { CallOptions, Ctx, SearchProvider, SearchRequest } from '../../core/ports.js';
import type { DocKind, Product, SearchHit, VersionLine } from '../../core/types.js';
import { hitFromRecord, kindMatches } from '../index/query.js';
import type { IndexInternals } from '../index/types.js';

/** Symbol, body-index and site-search candidates per query. */
export const SECONDARY_DEPTH = 20;

/** How long a search waits for site search before answering without it. */
export const SITE_SOFT_DEADLINE_MS = 2500;

/** Late site-search answers kept for the next identical call. */
const MAX_LATE_RESULTS = 50;

/** One product of a search scope with the line being searched. */
export interface SearchTarget {
  product: Product;
  line: VersionLine;
  /** Present when the caller narrowed the search with `product/source`. */
  sources?: string[];
}

/**
 * Exact symbol matches for the first of `names` that has any, in source order. They head
 * the fused list, so a query that is an API name finds that API before pages mentioning it.
 */
export function symbolHits(
  index: IndexInternals,
  names: readonly string[],
  targets: readonly SearchTarget[],
  kind: DocKind | undefined,
): SearchHit[] {
  for (const name of names) {
    const records = targets
      .flatMap((target) => index.symbols(target.product.id, target.line.id).exact(name))
      .filter((record) => kindMatches(record, kind));
    if (records.length > 0) {
      return records
        .slice(0, SECONDARY_DEPTH)
        .map((record, position) => hitFromRecord(record, 'symbol', 1 / (position + 1)));
    }
  }
  return [];
}

/** The homepage and start-here links of each product, as hits. */
export function productCards(targets: readonly SearchTarget[]): SearchHit[] {
  return targets.flatMap(({ product, line }) =>
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
}

/** Asks the site-search provider without letting it hold up a search. */
export interface SiteRetriever {
  /**
   * Site-search hits that arrive within the soft deadline. A slower answer is kept under
   * `key` and returned by the next call with the same key; `notes` is told about the wait.
   * Never rejects.
   */
  hits(
    key: string,
    req: SearchRequest,
    targets: readonly SearchTarget[],
    call: CallOptions,
    notes: string[],
  ): Promise<SearchHit[]>;
}

/** Creates the site retriever around a provider. */
export function createSiteRetriever(
  ctx: Ctx,
  provider: SearchProvider,
  softDeadlineMs: number = SITE_SOFT_DEADLINE_MS,
): SiteRetriever {
  /** Answers that arrived after the soft deadline, by query key, oldest first. */
  const late = new Map<string, SearchHit[]>();

  const remember = (key: string, hits: SearchHit[]): void => {
    late.set(key, hits);
    const oldest = late.keys().next();
    if (late.size > MAX_LATE_RESULTS && oldest.done !== true) late.delete(oldest.value);
  };

  return {
    async hits(key, req, targets, call, notes) {
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
        return await withDeadline(pending, softDeadlineMs);
      } catch (error) {
        if (!(error instanceof DeadlineExceededError)) throw error;
        void pending.then((hits) => {
          remember(key, hits);
        });
        notes.push(
          'Site search did not answer in time; its results are included when this call is repeated.',
        );
        return [];
      }
    },
  };
}
