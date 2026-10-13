/**
 * TTL classes of cached HTTP entries (design section 6.2): how long each class is fresh and
 * how long a copy may still be served when the upstream fails. Which class a request gets
 * when the caller names none is decided where the host table is known
 * (`src/net/freshness.ts`).
 */
import type { TtlClass } from '../core/types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long an entry of each class is served without contacting the upstream. */
export const TTL_MS: Readonly<Record<TtlClass, number>> = {
  /** A file at a pinned version, tag or commit never changes. */
  immutable: 365 * DAY,
  page: DAY,
  index: DAY,
  /** Version oracles, banners, GitHub content at a branch. */
  volatile: 6 * HOUR,
  'github-meta': 7 * DAY,
  /** OpenAPI documents. */
  spec: 7 * DAY,
  'remote-search': DAY,
  /** 404, 410 and soft 404. */
  negative: HOUR,
};

/** A remote search that found nothing is asked again sooner than one that found something. */
export const REMOTE_SEARCH_EMPTY_TTL_MS = HOUR;

/** How long after the fetch a copy may be served, labelled stale, when the upstream fails. */
export const STALE_IF_ERROR_MS = 30 * DAY;

/** Every TTL class, for tests and tables. */
export const TTL_CLASSES = Object.keys(TTL_MS) as TtlClass[];

/**
 * The stale-if-error window of a class. Remote search results are never served stale (an
 * outdated hit list is worse than falling back to the local index), and neither is a
 * remembered miss: "it was not there an hour ago" is no answer for a host that is down now.
 */
export function staleIfErrorMs(ttl: TtlClass): number {
  return ttl === 'remote-search' || ttl === 'negative' ? 0 : STALE_IF_ERROR_MS;
}

/** Options of {@link freshness}. */
export interface FreshnessOptions {
  /** `remote-search` only: the search returned no hit. */
  empty?: boolean;
}

/**
 * The freshness window of an entry fetched or revalidated at `now` (epoch milliseconds). The
 * `Cache` port stores the instants it is given, so the gateway computes them here.
 *
 * `staleUntil` is never earlier than `freshUntil`; for an immutable entry they coincide,
 * because its year of freshness already exceeds the stale-if-error window.
 */
export function freshness(
  ttl: TtlClass,
  now: number,
  options: FreshnessOptions = {},
): { freshUntil: number; staleUntil: number } {
  const fresh =
    ttl === 'remote-search' && options.empty === true ? REMOTE_SEARCH_EMPTY_TTL_MS : TTL_MS[ttl];
  const freshUntil = now + fresh;
  return { freshUntil, staleUntil: Math.max(freshUntil, now + staleIfErrorMs(ttl)) };
}

/** How a cached entry may be used at `now`. */
export type Freshness = 'fresh' | 'stale' | 'expired';

/**
 * Classifies an entry: `fresh` is served as is, `stale` only when the upstream fails, and
 * `expired` not at all (its validators may still save a download).
 */
export function freshnessAt(
  entry: { freshUntil: number; staleUntil: number },
  now: number,
): Freshness {
  if (now < entry.freshUntil) return 'fresh';
  return now < entry.staleUntil ? 'stale' : 'expired';
}
