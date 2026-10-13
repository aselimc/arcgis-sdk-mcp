/**
 * The in-memory side of the cache: a byte-bounded LRU of computed values (loaded search
 * indexes, parsed documents) behind `Cache.memo`.
 */
import { LRUCache } from 'lru-cache';

/** A memoised value. Boxed because the LRU cannot store `undefined` or `null`. */
interface Box {
  value: unknown;
}

/** Byte-bounded memo with shared in-flight computations. */
export interface MemoryLru {
  /**
   * Returns the remembered value of `key`, or runs `compute` once and remembers its result
   * with the size it reports. Concurrent calls for the same key share one computation. A
   * rejected computation is not remembered. A value larger than the whole budget is returned
   * but not kept.
   */
  memo<V>(key: string, compute: () => Promise<{ value: V; bytes: number }>): Promise<V>;
  /** Forgets every remembered value; computations in flight still deliver to their callers. */
  clear(): void;
  /** Bytes and number of the remembered values. */
  stats(): { bytes: number; entries: number };
}

/**
 * Creates the memo.
 *
 * @param maxBytes total size of the remembered values, as reported by the computations;
 *   the least recently used ones are dropped to stay under it.
 */
export function createMemoryLru(maxBytes: number): MemoryLru {
  const sizes = new Map<string, number>();
  const values = new LRUCache<string, Box>({
    maxSize: Math.max(1, Math.floor(maxBytes)),
    sizeCalculation: (_box, key) => sizes.get(key) ?? 1,
    dispose: (_box, key, reason) => {
      // On `set` the size map already holds the replacement's size.
      if (reason !== 'set') sizes.delete(key);
    },
  });
  const inFlight = new Map<string, Promise<unknown>>();
  // Bumped by clear(), so that a computation started before it does not repopulate the memo.
  let generation = 0;

  return {
    memo<V>(key: string, compute: () => Promise<{ value: V; bytes: number }>): Promise<V> {
      const remembered = values.get(key);
      // The caller chose V for this key when it stored the value.
      if (remembered !== undefined) return Promise.resolve(remembered.value as V);
      const running = inFlight.get(key);
      if (running !== undefined) return running as Promise<V>;

      const startedIn = generation;
      const started = (async () => {
        const { value, bytes } = await compute();
        if (startedIn === generation) {
          // The LRU requires a positive integer size.
          sizes.set(key, Math.max(1, Math.ceil(bytes)));
          values.set(key, { value });
          // A value above maxSize is refused by the LRU; drop its size record as well.
          if (!values.has(key)) sizes.delete(key);
        }
        return value;
      })().finally(() => {
        if (inFlight.get(key) === started) inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },

    clear() {
      generation += 1;
      inFlight.clear();
      values.clear();
      sizes.clear();
    },

    stats: () => ({ bytes: values.calculatedSize, entries: values.size }),
  };
}
