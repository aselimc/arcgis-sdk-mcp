/**
 * TTL classes of cached HTTP entries (design section 6.2): how long each class is fresh, how
 * long a copy may still be served when the upstream fails, and which class a URL gets when
 * the caller names none.
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
 * The stale-if-error window of a class. Remote search results are never served stale: an
 * outdated hit list is worse than falling back to the local index.
 */
export function staleIfErrorMs(ttl: TtlClass): number {
  return ttl === 'remote-search' ? 0 : STALE_IF_ERROR_MS;
}

/**
 * True when an expired entry of this class is refreshed with a conditional request
 * (`If-None-Match` / `If-Modified-Since`, as the host row says). Immutable entries are never
 * revalidated, and search results and remembered misses have no validator worth sending.
 */
export function revalidates(ttl: TtlClass): boolean {
  return ttl !== 'immutable' && ttl !== 'remote-search' && ttl !== 'negative';
}

/** Options of {@link freshness}. */
export interface FreshnessOptions {
  /** `remote-search` only: the search returned no hit. */
  empty?: boolean;
}

/**
 * The freshness window of an entry fetched or revalidated at `now` (epoch milliseconds).
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

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
/** An exact npm version after the last `@`: `4.31.6`, `5.0.0-next.12`; not `4`, `latest`, `^5`. */
const PINNED_NPM = /@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?(?:\/|$)/;
const REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'pypi.org',
  'api.nuget.org',
  'pub.dev',
  'www.arcgis.com',
  'plc-api.esri.com',
]);
const SPEC_HOSTS = new Set(['hub.arcgis.com', 'sitescan-api.arcgis.com']);
/** A file named like an OpenAPI document; a guide page about OpenAPI is still a page. */
const SPEC_PATH = /(?:(?:openapi|swagger|apidocs)[^/]*\.(?:json|ya?ml)|\/docs-json)$/i;
const INDEX_PATH = /(?:\.(?:json|xml|ya?ml|inv|js)|\/sitemap[^/]*)$/i;

function githubRawClass(segments: string[]): TtlClass {
  // /<owner>/<repo>/<ref>/<path>, or /<owner>/<repo>/refs/tags/<tag>/<path>.
  const [, , ref, kind] = segments;
  if (ref !== undefined && COMMIT_SHA.test(ref)) return 'immutable';
  return ref === 'refs' && kind === 'tags' ? 'immutable' : 'volatile';
}

function githubApiClass(segments: string[]): TtlClass {
  // /repos/<owner>/<repo>[/<resource>...]
  const [, , , resource, sub, ref] = segments;
  if (resource === undefined || resource === 'license') return 'github-meta';
  if (resource === 'git' && sub === 'trees' && ref !== undefined && COMMIT_SHA.test(ref)) {
    return 'immutable';
  }
  return 'volatile';
}

/**
 * The TTL class of a request that names none.
 *
 * Only what the URL itself proves is treated as immutable: an exact npm version on jsDelivr,
 * a commit SHA or `refs/tags/` on GitHub. A bare ref such as `v1.2.0` could be a branch, so
 * callers that resolved a release tag pass `ttl: 'immutable'` themselves.
 *
 * @param expect the body shape the caller asked for; structured bodies on documentation
 *   hosts are index files, everything else is a page.
 */
export function defaultTtlClass(
  url: URL,
  expect?: 'html' | 'json' | 'xml' | 'text' | 'yaml',
): TtlClass {
  const host = url.hostname;
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);

  if (host === 'cdn.jsdelivr.net' || host === 'data.jsdelivr.com') {
    return PINNED_NPM.test(url.pathname) ? 'immutable' : 'volatile';
  }
  if (host === 'raw.githubusercontent.com') return githubRawClass(segments);
  if (host === 'api.github.com') return githubApiClass(segments);
  if (host === 'esearchapi.esri.com') return 'remote-search';
  if (REGISTRY_HOSTS.has(host)) return 'volatile';
  if (SPEC_HOSTS.has(host) || SPEC_PATH.test(url.pathname)) return 'spec';
  if (expect === 'json' || expect === 'xml' || expect === 'yaml') return 'index';
  if (expect === undefined && INDEX_PATH.test(url.pathname)) return 'index';
  return 'page';
}
