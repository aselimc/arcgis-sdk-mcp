/**
 * The disk cache: the HTTP and derived stores under `<dir>/v1`, the `VERSION` file, the
 * in-memory memo and the hourly size sweep, behind the `Cache` port.
 *
 * Two rules shape this file. Nothing touches the disk until the first cache operation, so
 * constructing the cache before the MCP handshake costs no I/O. And a cache that cannot be
 * used (read-only directory, full disk, a file held open by another process) must never fail
 * a tool call: every disk error is logged and treated as a miss or a skipped write.
 */
import type { Cache, CachedHttpEntry, Clock, Logger } from '../core/ports.js';
import { atomicWrite } from './atomic-write.js';
import { createKeyedLock } from './codec.js';
import { createDerivedStore, derivedJson } from './derived-store.js';
import { scanCache, sweepCache, type SweepResult } from './evict.js';
import { nodeFs, readIfExists, type CacheFs } from './fs-port.js';
import { createHttpStore } from './http-store.js';
import { createMemoryLru } from './memory-lru.js';
import { CACHE_SCHEMA_VERSION, cacheLayout } from './paths.js';

/** The size cap is enforced at most this often. */
export const SWEEP_INTERVAL_MS = 3_600_000;

/** After a failed start (unwritable directory) the cache tries again after this long. */
export const INIT_RETRY_MS = 60_000;

/** Options of {@link createFileCache}. */
export interface FileCacheOptions {
  /** Cache directory; `v1/` is created inside it on first use. */
  dir: string;
  /** Size cap of the files on disk. */
  maxBytes: number;
  /** Size cap of the in-memory memo. */
  memoryMaxBytes: number;
  logger: Logger;
  clock: Clock;
  /** File system; the real one unless a test injects faults. */
  fs?: CacheFs;
  /** Wait between rename retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** The `Cache` port plus the maintenance hooks that the CLI and the tests use. */
export interface FileCache extends Cache {
  /** Runs the size sweep now, whatever the last run time. */
  sweep(): Promise<SweepResult>;
  /** Settles when no background sweep is running. */
  idle(): Promise<void>;
}

/** Creates the disk cache. Performs no I/O until the first operation. */
export function createFileCache(options: FileCacheOptions): FileCache {
  const { logger, clock } = options;
  const fs = options.fs ?? nodeFs;
  const layout = cacheLayout(options.dir);
  const write = (path: string, data: Uint8Array | string) =>
    atomicWrite(fs, path, data, options.sleep === undefined ? {} : { sleep: options.sleep });
  const onCorrupt = (key: string, reason: string) => {
    logger.debug('cache: removed a damaged entry', { key, reason });
  };
  const lock = createKeyedLock();
  const http = createHttpStore({ fs, layout, clock, lock, write, onCorrupt });
  const derived = createDerivedStore({ fs, layout, clock, lock, write, onCorrupt });
  const memory = createMemoryLru(options.memoryMaxBytes);

  let ready: Promise<boolean> | undefined;
  let failedAt: number | undefined;
  let lastSweepAt: number | undefined;
  let sweeping: Promise<void> | undefined;
  const warned = new Set<string>();

  /** One warning per kind of failure; repeats go to debug so a dead disk cannot flood stderr. */
  function report(operation: string, error: unknown): void {
    const fields = { operation, dir: layout.dir, error };
    if (warned.has(operation)) {
      logger.debug('cache: disk operation failed', fields);
      return;
    }
    warned.add(operation);
    logger.warn('cache: disk operation failed, continuing without it', fields);
  }

  async function initialise(): Promise<boolean> {
    try {
      await fs.mkdir(layout.root);
      const version = (await readIfExists(fs, layout.versionFile))?.toString('utf8').trim();
      if (version !== CACHE_SCHEMA_VERSION) {
        // Entries of an unknown layout cannot be trusted: start over rather than guess.
        await fs.rm(layout.httpDir);
        await fs.rm(layout.derivedDir);
        await write(layout.versionFile, `${CACHE_SCHEMA_VERSION}\n`);
      }
      return true;
    } catch (error) {
      failedAt = clock.now();
      report('initialise', error);
      return false;
    }
  }

  function ensureReady(): Promise<boolean> {
    if (failedAt !== undefined && clock.now() - failedAt >= INIT_RETRY_MS) {
      failedAt = undefined;
      ready = undefined;
    }
    ready ??= initialise();
    return ready;
  }

  async function reading<T>(operation: string, task: () => Promise<T>): Promise<T | undefined> {
    if (!(await ensureReady())) return undefined;
    try {
      return await task();
    } catch (error) {
      report(operation, error);
      return undefined;
    }
  }

  function scheduleSweep(): void {
    const now = clock.now();
    if (sweeping !== undefined) return;
    if (lastSweepAt !== undefined && now - lastSweepAt < SWEEP_INTERVAL_MS) return;
    lastSweepAt = now;
    // Not awaited: the write that triggered it must not wait for a directory walk.
    sweeping = sweepCache(fs, layout, { maxBytes: options.maxBytes, now })
      .then(
        (result) => {
          if (result.evicted > 0 || result.leftoversRemoved > 0) {
            logger.info('cache: sweep finished', { ...result });
          }
        },
        (error: unknown) => {
          report('sweep', error);
        },
      )
      .finally(() => {
        sweeping = undefined;
      });
  }

  async function writing(operation: string, task: () => Promise<void>): Promise<void> {
    if (!(await ensureReady())) return;
    try {
      await task();
    } catch (error) {
      report(operation, error);
      return;
    }
    scheduleSweep();
  }

  return {
    getHttp: (key) => reading('getHttp', () => http.get(key)),

    putHttp: (key: string, entry: CachedHttpEntry) =>
      writing('putHttp', () => http.put(key, entry)),

    touchHttp: (key, patch) => writing('touchHttp', () => http.touch(key, patch)),

    // The caller chose V when it stored the value under this namespace and key.
    getDerived: <V>(ns: Parameters<Cache['getDerived']>[0], key: string) =>
      reading('getDerived', () => derived.get(ns, key)) as Promise<V | undefined>,

    async putDerived(ns, key, value) {
      // Serialised outside the guard: a value JSON cannot carry is a bug in the caller and
      // must surface, unlike a disk failure.
      const json = derivedJson(key, value);
      await writing('putDerived', () => derived.put(ns, key, json));
    },

    deleteDerived: (ns, key) => writing('deleteDerived', () => derived.delete(ns, key)),

    memo: (key, compute) => memory.memo(key, compute),

    async info() {
      // Read-only: `cache info` must not create a directory just to report that it is empty.
      const scan = await scanCache(fs, layout);
      return { dir: layout.dir, bytes: scan.bytes, entries: scan.entries.length };
    },

    async clear(scope = 'all') {
      if (scope !== 'derived') await fs.rm(layout.httpDir);
      if (scope !== 'http') await fs.rm(layout.derivedDir);
      if (scope === 'all') memory.clear();
    },

    sweep() {
      lastSweepAt = clock.now();
      return sweepCache(fs, layout, { maxBytes: options.maxBytes, now: lastSweepAt });
    },

    async idle() {
      await sweeping;
    },
  };
}
