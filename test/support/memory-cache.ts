import type { Cache, CachedHttpEntry, DerivedNamespace } from '../../src/core/ports.js';

/**
 * An in-memory {@link Cache} with the observable behaviour of the disk cache:
 *
 * - values are stored as JSON text, so a value that does not survive `JSON.stringify`
 *   (a `Map`, a class instance, `undefined` fields) fails here exactly as it would on disk,
 *   and callers never share object identity with the cache;
 * - `memo` computes once per key and shares an in-flight computation; a rejected
 *   computation is not remembered.
 *
 * Counters (`reads`, `writes`, `memoComputes`) let tests assert that something was, or was
 * not, served from cache.
 */
export class MemoryCache implements Cache {
  readonly reads = { http: 0, derived: 0 };
  readonly writes = { http: 0, derived: 0 };
  memoComputes = 0;

  private readonly http = new Map<string, string>();
  private readonly derived = new Map<string, string>();
  private readonly memos = new Map<string, Promise<unknown>>();
  private memoBytes = 0;

  async getHttp(key: string): Promise<CachedHttpEntry | undefined> {
    this.reads.http += 1;
    const stored = this.http.get(key);
    return stored === undefined ? undefined : (JSON.parse(stored) as CachedHttpEntry);
  }

  async putHttp(key: string, entry: CachedHttpEntry): Promise<void> {
    this.writes.http += 1;
    this.http.set(key, JSON.stringify(entry));
  }

  async touchHttp(
    key: string,
    patch: Pick<CachedHttpEntry, 'freshUntil' | 'staleUntil'> & {
      etag?: string;
      lastModified?: string;
    },
  ): Promise<void> {
    const stored = this.http.get(key);
    // Touching an entry that was evicted in the meantime is a no-op, as on disk.
    if (stored === undefined) return;
    this.writes.http += 1;
    this.http.set(key, JSON.stringify({ ...(JSON.parse(stored) as CachedHttpEntry), ...patch }));
  }

  async getDerived<V>(ns: DerivedNamespace, key: string): Promise<V | undefined> {
    this.reads.derived += 1;
    const stored = this.derived.get(`${ns}\u0000${key}`);
    return stored === undefined ? undefined : (JSON.parse(stored) as V);
  }

  async putDerived<V>(ns: DerivedNamespace, key: string, value: V): Promise<void> {
    this.writes.derived += 1;
    this.derived.set(`${ns}\u0000${key}`, JSON.stringify(value));
  }

  async deleteDerived(ns: DerivedNamespace, key: string): Promise<void> {
    this.derived.delete(`${ns}\u0000${key}`);
  }

  memo<V>(key: string, compute: () => Promise<{ value: V; bytes: number }>): Promise<V> {
    const existing = this.memos.get(key);
    if (existing !== undefined) return existing as Promise<V>;
    this.memoComputes += 1;
    const started = compute().then(
      ({ value, bytes }) => {
        this.memoBytes += bytes;
        return value;
      },
      (error: unknown) => {
        this.memos.delete(key);
        throw error;
      },
    );
    this.memos.set(key, started);
    return started;
  }

  async info(): Promise<{ dir: string; bytes: number; entries: number }> {
    const stored = [...this.http.values(), ...this.derived.values()];
    return {
      dir: '(memory)',
      bytes: stored.reduce((sum, text) => sum + text.length, 0),
      entries: stored.length,
    };
  }

  async clear(scope: 'http' | 'derived' | 'all' = 'all'): Promise<void> {
    if (scope !== 'derived') this.http.clear();
    if (scope !== 'http') this.derived.clear();
    if (scope === 'all') this.evictMemo();
  }

  /** Drops every memoised value, as the byte-bounded LRU would under memory pressure. */
  evictMemo(): void {
    this.memos.clear();
    this.memoBytes = 0;
  }

  /** Bytes reported by the memoised computations still held. */
  memoSize(): number {
    return this.memoBytes;
  }

  /** Keys of the stored HTTP entries, for assertions. */
  httpKeys(): string[] {
    return [...this.http.keys()];
  }

  /** `[namespace, key]` pairs of the stored derived values, for assertions. */
  derivedKeys(): Array<[ns: string, key: string]> {
    return [...this.derived.keys()].map((joined) => {
      const [ns = '', key = ''] = joined.split('\u0000');
      return [ns, key];
    });
  }
}
