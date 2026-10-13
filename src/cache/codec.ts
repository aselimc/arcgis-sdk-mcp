/**
 * Compression and per-key serialisation shared by the two disk stores.
 */
import { promisify } from 'node:util';
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib';

const gzipAsync = promisify(gzipCallback);
const gunzipAsync = promisify(gunzipCallback);

/** Gzip-compresses UTF-8 text on the thread pool, so a 30 MB index does not block the loop. */
export function gzipText(text: string): Promise<Buffer> {
  return gzipAsync(Buffer.from(text, 'utf8'));
}

/**
 * Decompresses a gzip buffer. Rejects when the data is truncated or its checksum does not
 * match, which is how a damaged cache file is recognised.
 */
export function gunzipBytes(data: Uint8Array): Promise<Buffer> {
  return gunzipAsync(data);
}

/** Runs asynchronous tasks one after another per key. */
export interface KeyedLock {
  /** Runs `task` after every earlier task of the same key has settled. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Creates a lock that serialises work per key inside this process. An entry is two files, so
 * without it a read could pair the new body of a concurrent write with the old metadata.
 */
export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        // Only the last task of a key removes it, so the map does not grow with idle keys.
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
