/**
 * The gateway's view of the HTTP cache: reads that treat a failing cache as empty, writes
 * that never fail a fetch, the remembered miss, and the offline lookup.
 */
import { freshness } from '../cache/ttl.js';
import type { McpDocError } from '../core/errors.js';
import type { Cache, CachedHttpEntry, Clock, HttpResponse, Logger } from '../core/ports.js';
import type { CacheState } from '../core/types.js';
import { notFound, offlineMiss } from './errors.js';
import { isFresh, isNegative, usableEntry } from './freshness.js';

/** The response a caller sees for a cached entry. */
export function toResponse(entry: CachedHttpEntry, cache: CacheState): HttpResponse {
  return {
    url: entry.url,
    finalUrl: entry.finalUrl,
    status: entry.status,
    contentType: entry.contentType,
    text: entry.body,
    ...(entry.etag === undefined ? {} : { etag: entry.etag }),
    ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    cache,
    aliasChain: entry.aliasChain,
  };
}

/** Cache access as the gateway needs it. The cache is an optimisation, never a point of failure. */
export class HttpCacheView {
  constructor(
    private readonly cache: Cache,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** The entry while it may still be used (younger than `staleUntil`). */
  async read(key: string): Promise<CachedHttpEntry | undefined> {
    return usableEntry(await this.readAny(key), this.clock.now());
  }

  /** Stores an entry; a full or read-only disk must not turn a successful fetch into a failure. */
  async write(key: string, entry: CachedHttpEntry): Promise<void> {
    try {
      await this.cache.putHttp(key, entry);
    } catch (error) {
      this.logger.warn('cache write failed', { key, error: String(error) });
    }
  }

  /** Extends an entry after a 304, or expires it when both instants are zero. */
  async touch(key: string, patch: Parameters<Cache['touchHttp']>[1]): Promise<void> {
    try {
      await this.cache.touchHttp(key, patch);
    } catch (error) {
      this.logger.warn('cache touch failed', { key, error: String(error) });
    }
  }

  /**
   * Remembers for an hour that `url` has no document, with the reason as the entry's body.
   *
   * @returns the `DOC_NOT_FOUND` error for the caller to throw.
   */
  async miss(key: string, url: string, why: string): Promise<McpDocError> {
    const now = this.clock.now();
    await this.write(key, {
      url,
      finalUrl: url,
      aliasChain: [],
      status: 404,
      contentType: '',
      body: why,
      fetchedAt: now,
      ...freshness('negative', now),
      ttl: 'negative',
    });
    return notFound(url, why);
  }

  /**
   * Offline mode: whatever the cache holds, however old, labelled `stale` once it has expired.
   *
   * @throws McpDocError `OFFLINE_MISS` when nothing is cached, `DOC_NOT_FOUND` for a miss
   *   remembered within the last hour.
   */
  async offline(key: string, url: string): Promise<HttpResponse> {
    const entry = await this.readAny(key);
    if (entry === undefined) throw offlineMiss(url);
    const fresh = isFresh(entry, this.clock.now());
    if (!isNegative(entry)) return toResponse(entry, fresh ? 'hit' : 'stale');
    // An old "not found" proves nothing about today.
    throw fresh ? notFound(url, entry.body) : offlineMiss(url);
  }

  private async readAny(key: string): Promise<CachedHttpEntry | undefined> {
    try {
      return await this.cache.getHttp(key);
    } catch (error) {
      this.logger.warn('cache read failed', { key, error: String(error) });
      return undefined;
    }
  }
}
