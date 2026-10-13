/**
 * Atomic file replacement: write a temporary file next to the target, then rename it over
 * the target. A reader sees the old content or the new content, never a partial file, and a
 * crash leaves at worst an orphaned temporary file that the sweep removes.
 */
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { errnoCode, isMissing, type CacheFs } from './fs-port.js';

/** Suffix of temporary files; the sweep deletes old ones. */
export const TEMP_SUFFIX = '.tmp';

/**
 * Pauses before each retry of a failed rename. On Windows a rename fails with `EPERM`,
 * `EBUSY` or `EACCES` while an antivirus scanner, the search indexer or another server
 * process has the target open; the handle is usually released within milliseconds.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [20, 60, 180];

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Options of {@link atomicWrite}. */
export interface AtomicWriteOptions {
  /** Waits between rename attempts; replaced in tests so that they do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function tempPathFor(path: string): string {
  // The process id and random bytes keep two server processes that share a cache directory
  // from writing the same temporary file.
  return `${path}.${process.pid}.${randomBytes(6).toString('hex')}${TEMP_SUFFIX}`;
}

async function writeCreatingDir(fs: CacheFs, path: string, data: Uint8Array | string) {
  try {
    await fs.writeFile(path, data);
  } catch (error) {
    if (!isMissing(error)) throw error;
    // The shard directory is created on first use, or was removed by `cache clear`.
    await fs.mkdir(dirname(path));
    await fs.writeFile(path, data);
  }
}

/**
 * Writes `data` to `path` atomically, creating the parent directory when needed.
 *
 * The rename is tried up to four times (three retries) when it fails with `EPERM`, `EBUSY`
 * or `EACCES`. When it still fails, or fails for another reason, the temporary file is
 * removed and the error is rethrown; the previous content of `path` is untouched.
 */
export async function atomicWrite(
  fs: CacheFs,
  path: string,
  data: Uint8Array | string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const temp = tempPathFor(path);
  await writeCreatingDir(fs, temp, data);

  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, path);
      return;
    } catch (error) {
      const wait = RENAME_RETRY_DELAYS_MS[attempt];
      if (wait === undefined || !RETRYABLE.has(errnoCode(error) ?? '')) {
        await fs.rm(temp).catch(() => undefined);
        throw error;
      }
      await sleep(wait);
    }
  }
}
