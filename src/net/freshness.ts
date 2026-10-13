/**
 * Freshness decisions of the gateway: which TTL class a request gets when the caller names
 * none, how long an entry of each class stays fresh and how long it may answer for a failing
 * host (design section 6.2), and the cache key of a request.
 *
 * The durations mirror `src/cache/ttl.ts`. They are repeated here because the gateway computes
 * `freshUntil` / `staleUntil` itself (the `Cache` port stores what it is given) and reaches
 * the cache only through that port.
 */
import { sha256Hex } from '../core/hash.js';
import type { CachedHttpEntry, HttpRequest } from '../core/ports.js';
import type { HostPolicy, TtlClass } from '../core/types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long an entry of each class is served without asking the origin. */
export const TTL_MS: Readonly<Record<TtlClass, number>> = {
  immutable: 365 * DAY,
  page: DAY,
  index: DAY,
  volatile: 6 * HOUR,
  'github-meta': 7 * DAY,
  spec: 7 * DAY,
  'remote-search': DAY,
  negative: HOUR,
};

/** An expired copy may answer for a failing host while it is younger than this. */
export const STALE_IF_ERROR_MS = 30 * DAY;

/** Classes that are never served stale: a remembered miss and third-party search results. */
const NEVER_STALE: ReadonlySet<TtlClass> = new Set<TtlClass>(['negative', 'remote-search']);

/** The freshness window of an entry of class `ttl` fetched or confirmed at `now`. */
export function freshnessWindow(
  ttl: TtlClass,
  now: number,
): Pick<CachedHttpEntry, 'freshUntil' | 'staleUntil'> {
  const freshUntil = now + TTL_MS[ttl];
  const staleUntil = NEVER_STALE.has(ttl) ? freshUntil : Math.max(freshUntil, now + STALE_IF_ERROR_MS);
  return { freshUntil, staleUntil };
}

/** `@1.2.3` (an exact version, not a range or a dist-tag) in a jsDelivr path. */
const PINNED_NPM_VERSION = /@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\/|$)/;

/** A full commit SHA as the ref segment of a raw.githubusercontent.com path. */
const RAW_AT_SHA = /^\/[^/]+\/[^/]+\/[0-9a-f]{40}\//;

/**
 * The TTL class of a request that does not name one, from the host's capability and the
 * shape of the URL:
 *
 * - `package-cdn`: `immutable` for a version-pinned file, else `volatile`;
 * - `github`: `immutable` for raw content at a commit SHA, else `volatile` (a caller that
 *   pinned a release tag says so itself);
 * - `registries`, `lifecycle-api`: `volatile`; `site-search`: `remote-search`;
 * - `website`: `page` for HTML; other bodies are `spec` on hosts without validators (the
 *   published OpenAPI documents) and `index` everywhere else.
 */
export function defaultTtl(host: HostPolicy, url: URL, expect: HttpRequest['expect']): TtlClass {
  switch (host.capability) {
    case 'package-cdn':
      return PINNED_NPM_VERSION.test(url.pathname) ? 'immutable' : 'volatile';
    case 'github':
      return url.hostname === 'raw.githubusercontent.com' && RAW_AT_SHA.test(url.pathname)
        ? 'immutable'
        : 'volatile';
    case 'site-search':
      return 'remote-search';
    case 'registries':
    case 'lifecycle-api':
      return 'volatile';
    default:
      if (expect === 'html') return 'page';
      return host.revalidate === 'none' ? 'spec' : 'index';
  }
}

/**
 * The cache and single-flight key of a request: method, URL without fragment, a hash of the
 * body, and the encoding (the same bytes are stored differently as text and as base64).
 */
export function cacheKey(
  method: 'GET' | 'POST',
  url: URL,
  body: string | undefined,
  encoding: HttpRequest['encoding'],
): string {
  const parts = [method, url.href];
  if (body !== undefined) parts.push(`body:${sha256Hex(body).slice(0, 32)}`);
  if (encoding === 'base64') parts.push('base64');
  return parts.join(' ');
}

/**
 * The entry as far as it may still be used at `now`: `undefined` once it is past
 * `staleUntil`, whatever the cache implementation chose to keep.
 */
export function usableEntry(
  entry: CachedHttpEntry | undefined,
  now: number,
): CachedHttpEntry | undefined {
  return entry !== undefined && now < entry.staleUntil ? entry : undefined;
}

/** True while the entry may be served without contacting the origin. */
export function isFresh(entry: CachedHttpEntry, now: number): boolean {
  return now < entry.freshUntil;
}

/** True for a remembered miss (404, soft 404, wrong body shape). */
export function isNegative(entry: CachedHttpEntry): boolean {
  return entry.ttl === 'negative';
}

/**
 * Conditional request headers for revalidating `entry`, per the host's rule: some hosts
 * honour only one validator (doc.esri.com answers 200 to `If-None-Match`), and a deploy-time
 * `Last-Modified` is worthless on others.
 */
export function conditionalHeaders(
  host: HostPolicy,
  entry: CachedHttpEntry,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const { revalidate } = host;
  if ((revalidate === 'etag' || revalidate === 'both') && entry.etag !== undefined) {
    headers['if-none-match'] = entry.etag;
  }
  if (
    (revalidate === 'last-modified' || revalidate === 'both') &&
    entry.lastModified !== undefined
  ) {
    headers['if-modified-since'] = entry.lastModified;
  }
  return headers;
}
