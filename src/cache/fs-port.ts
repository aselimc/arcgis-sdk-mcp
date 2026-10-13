/**
 * The slice of `node:fs/promises` the cache uses, as an interface. The disk cache receives
 * it by injection so that tests can make a `rename` fail with `EPERM` (antivirus scanners and
 * indexers hold files open on Windows) or a directory unwritable, without touching real
 * permissions.
 */
import * as fsp from 'node:fs/promises';

/** A directory entry as returned by `readdir`. */
export interface CacheDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** File-system operations of the disk cache. All paths are absolute. */
export interface CacheFs {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file or a directory tree; a missing path is not an error. */
  rm(path: string): Promise<void>;
  readdir(path: string): Promise<CacheDirent[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  /** Sets access and modification time to `timeMs` (epoch milliseconds). */
  utimes(path: string, timeMs: number): Promise<void>;
}

/** The real file system. */
export const nodeFs: CacheFs = {
  mkdir: async (path) => {
    await fsp.mkdir(path, { recursive: true });
  },
  readFile: (path) => fsp.readFile(path),
  writeFile: (path, data) => fsp.writeFile(path, data),
  rename: (from, to) => fsp.rename(from, to),
  // maxRetries makes Node retry EBUSY, EMFILE, ENFILE, ENOTEMPTY and EPERM, which a
  // recursive delete meets on Windows whenever another process has a file open.
  rm: (path) => fsp.rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
  readdir: (path) => fsp.readdir(path, { withFileTypes: true }),
  stat: (path) => fsp.stat(path),
  utimes: (path, timeMs) => fsp.utimes(path, new Date(timeMs), new Date(timeMs)),
};

/** The `code` of a Node system error (`ENOENT`, `EPERM`, ...), or `undefined`. */
export function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** True when the error says that the file or directory does not exist. */
export function isMissing(error: unknown): boolean {
  const code = errnoCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `readFile` that answers `undefined` for a missing file and rejects for anything else. */
export async function readIfExists(fs: CacheFs, path: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** `readdir` that answers an empty list for a missing directory. */
export async function listDir(fs: CacheFs, path: string): Promise<CacheDirent[]> {
  try {
    return await fs.readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
