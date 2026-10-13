/**
 * The derived store: computed JSON values (catalogues, symbol indexes, version reports,
 * licence lookups) as one gzip file each, `derived/<namespace>/<aa>/<sha256>.json.gz`.
 */
import type { Clock, DerivedNamespace } from '../core/ports.js';
import { gunzipBytes, gzipText, type KeyedLock } from './codec.js';
import { readIfExists, type CacheFs } from './fs-port.js';
import type { CacheLayout } from './paths.js';

/** Dependencies of {@link createDerivedStore}. */
export interface DerivedStoreDeps {
  fs: CacheFs;
  layout: CacheLayout;
  clock: Clock;
  lock: KeyedLock;
  /** Atomic file replacement. */
  write: (path: string, data: Uint8Array | string) => Promise<void>;
  /** Told about every value removed because it could not be read back. */
  onCorrupt: (key: string, reason: string) => void;
}

/** Disk operations on derived values. File-system failures reject. */
export interface DerivedStore {
  get(ns: DerivedNamespace, key: string): Promise<unknown>;
  /** `json` is the already serialised value. */
  put(ns: DerivedNamespace, key: string, json: string): Promise<void>;
  delete(ns: DerivedNamespace, key: string): Promise<void>;
}

/** The file content: the key proves that the file belongs to the key that hashed to its name. */
interface Envelope {
  k: string;
  v?: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && typeof (value as Envelope).k === 'string';
}

/**
 * The namespace becomes a directory name. The type already restricts it; this check keeps a
 * value that slipped past the type system (a cast, plain JavaScript) from leaving the cache.
 */
function assertNamespace(ns: string): void {
  if (!/^[a-z][a-z-]*$/.test(ns)) throw new TypeError(`Invalid derived namespace "${ns}"`);
}

/** Serialises a value for {@link DerivedStore.put}; `undefined` is stored as an absent value. */
export function derivedJson(key: string, value: unknown): string {
  const envelope: Envelope = { k: key, v: value };
  return JSON.stringify(envelope);
}

/** Creates the derived store over a cache layout. */
export function createDerivedStore(deps: DerivedStoreDeps): DerivedStore {
  const { fs, layout, clock, lock, write, onCorrupt } = deps;
  const lockKey = (ns: string, key: string) => `${ns}\u0000${key}`;

  return {
    get(ns, key) {
      assertNamespace(ns);
      return lock.run(lockKey(ns, key), async () => {
        const path = layout.derived(ns, key);
        const compressed = await readIfExists(fs, path);
        if (compressed === undefined) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse((await gunzipBytes(compressed)).toString('utf8'));
        } catch {
          parsed = undefined;
        }
        if (!isEnvelope(parsed) || parsed.k !== key) {
          await fs.rm(path);
          onCorrupt(key, 'unreadable derived value');
          return undefined;
        }
        // Last-read time for the eviction sweep, from the injected clock (see http-store.ts).
        await fs.utimes(path, clock.now()).catch(() => undefined);
        return parsed.v;
      });
    },

    put(ns, key, json) {
      assertNamespace(ns);
      return lock.run(lockKey(ns, key), async () => {
        const path = layout.derived(ns, key);
        await write(path, await gzipText(json));
        await fs.utimes(path, clock.now()).catch(() => undefined);
      });
    },

    delete(ns, key) {
      assertNamespace(ns);
      return lock.run(lockKey(ns, key), () => fs.rm(layout.derived(ns, key)));
    },
  };
}
