/**
 * Size accounting and the size-cap sweep of the disk cache. The sweep removes the least
 * recently read entries first and keeps immutable ones (pinned package files, content at a
 * tag or commit) for last, since those are the entries that can never be refreshed cheaper
 * than they were fetched.
 */
import { join } from 'node:path';
import { isMissing, listDir, readIfExists, type CacheFs } from './fs-port.js';
import { BODY_SUFFIX, DERIVED_SUFFIX, META_SUFFIX, type CacheLayout } from './paths.js';

/** Leftover files (interrupted writes, bodies without metadata) are removed after this age. */
export const LEFTOVER_MAX_AGE_MS = 3_600_000;

/** The sweep frees space down to this share of the cap, so that it does not run at the brim. */
export const SWEEP_TARGET_RATIO = 0.9;

/** One cache entry on disk: an HTTP response (two files) or a derived value (one file). */
export interface StoredEntry {
  /** Files of the entry, the one that makes it visible first. */
  files: string[];
  bytes: number;
  /** Epoch milliseconds of the last read or write. */
  lastRead: number;
  /** Metadata file of an HTTP entry; absent for derived values. */
  meta?: string;
}

/** A file that belongs to no complete entry. */
export interface Leftover {
  path: string;
  bytes: number;
  mtimeMs: number;
}

/** Everything found under the cache root. */
export interface CacheScan {
  entries: StoredEntry[];
  leftovers: Leftover[];
  /** Total size of entries and leftovers. */
  bytes: number;
}

/** Outcome of one {@link sweepCache}. */
export interface SweepResult {
  bytesBefore: number;
  bytesAfter: number;
  /** Entries evicted for the size cap. */
  evicted: number;
  /** Leftover files removed for their age. */
  leftoversRemoved: number;
}

interface FoundFile {
  dir: string;
  name: string;
  bytes: number;
  mtimeMs: number;
}

/** Every file below `dir`. Files and directories that vanish during the walk are skipped. */
async function walk(fs: CacheFs, dir: string): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  for (const entry of await listDir(fs, dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(fs, path)));
    } else if (entry.isFile()) {
      try {
        const { size, mtimeMs } = await fs.stat(path);
        found.push({ dir, name: entry.name, bytes: size, mtimeMs });
      } catch (error) {
        // Another process, or a concurrent sweep, removed it between readdir and stat.
        if (!isMissing(error)) throw error;
      }
    }
  }
  return found;
}

function scanHttp(files: FoundFile[], scan: CacheScan): void {
  const metas = new Map<string, FoundFile>();
  const bodies = new Map<string, FoundFile>();
  for (const file of files) {
    const path = join(file.dir, file.name);
    if (file.name.endsWith(META_SUFFIX)) metas.set(path.slice(0, -META_SUFFIX.length), file);
    else if (file.name.endsWith(BODY_SUFFIX)) bodies.set(path.slice(0, -BODY_SUFFIX.length), file);
    else scan.leftovers.push({ path, bytes: file.bytes, mtimeMs: file.mtimeMs });
  }
  for (const [stem, meta] of metas) {
    const body = bodies.get(stem);
    bodies.delete(stem);
    const metaPath = `${stem}${META_SUFFIX}`;
    scan.entries.push({
      files: body === undefined ? [metaPath] : [metaPath, `${stem}${BODY_SUFFIX}`],
      bytes: meta.bytes + (body?.bytes ?? 0),
      lastRead: meta.mtimeMs,
      meta: metaPath,
    });
  }
  // A body without metadata is a write in progress or the rest of an interrupted one.
  for (const [stem, body] of bodies) {
    scan.leftovers.push({
      path: `${stem}${BODY_SUFFIX}`,
      bytes: body.bytes,
      mtimeMs: body.mtimeMs,
    });
  }
}

function scanDerived(files: FoundFile[], scan: CacheScan): void {
  for (const file of files) {
    const path = join(file.dir, file.name);
    if (file.name.endsWith(DERIVED_SUFFIX)) {
      scan.entries.push({ files: [path], bytes: file.bytes, lastRead: file.mtimeMs });
    } else {
      scan.leftovers.push({ path, bytes: file.bytes, mtimeMs: file.mtimeMs });
    }
  }
}

/** Lists the entries and leftover files of a cache directory with their sizes. */
export async function scanCache(fs: CacheFs, layout: CacheLayout): Promise<CacheScan> {
  const scan: CacheScan = { entries: [], leftovers: [], bytes: 0 };
  scanHttp(await walk(fs, layout.httpDir), scan);
  scanDerived(await walk(fs, layout.derivedDir), scan);
  scan.bytes =
    scan.entries.reduce((sum, entry) => sum + entry.bytes, 0) +
    scan.leftovers.reduce((sum, leftover) => sum + leftover.bytes, 0);
  return scan;
}

async function isImmutable(fs: CacheFs, entry: StoredEntry): Promise<boolean> {
  if (entry.meta === undefined) return false;
  try {
    const data = await readIfExists(fs, entry.meta);
    if (data === undefined) return false;
    return (JSON.parse(data.toString('utf8')) as { ttl?: unknown }).ttl === 'immutable';
  } catch {
    // Unreadable metadata makes the entry a miss anyway: evict it with the ordinary ones.
    return false;
  }
}

async function removeEntry(fs: CacheFs, entry: StoredEntry): Promise<void> {
  for (const file of entry.files) await fs.rm(file);
}

/**
 * Brings the cache under `maxBytes`.
 *
 * Old leftover files go first, whatever the size. When the rest still exceeds the cap,
 * entries are removed in order of last read until the total is at most
 * {@link SWEEP_TARGET_RATIO} of the cap: every other entry before any immutable one.
 * Metadata is read only for the entries the sweep is about to remove.
 *
 * @param now epoch milliseconds, from the same clock that stamps last-read times.
 */
export async function sweepCache(
  fs: CacheFs,
  layout: CacheLayout,
  options: { maxBytes: number; now: number },
): Promise<SweepResult> {
  const scan = await scanCache(fs, layout);
  let bytes = scan.bytes;
  let leftoversRemoved = 0;
  for (const leftover of scan.leftovers) {
    if (options.now - leftover.mtimeMs < LEFTOVER_MAX_AGE_MS) continue;
    await fs.rm(leftover.path);
    bytes -= leftover.bytes;
    leftoversRemoved += 1;
  }

  let evicted = 0;
  if (bytes > options.maxBytes) {
    const target = Math.floor(options.maxBytes * SWEEP_TARGET_RATIO);
    const oldestFirst = [...scan.entries].sort((a, b) => a.lastRead - b.lastRead);
    const immutable: StoredEntry[] = [];
    const evict = async (entry: StoredEntry) => {
      await removeEntry(fs, entry);
      bytes -= entry.bytes;
      evicted += 1;
    };
    for (const entry of oldestFirst) {
      if (bytes <= target) break;
      if (await isImmutable(fs, entry)) immutable.push(entry);
      else await evict(entry);
    }
    for (const entry of immutable) {
      if (bytes <= target) break;
      await evict(entry);
    }
  }
  return { bytesBefore: scan.bytes, bytesAfter: bytes, evicted, leftoversRemoved };
}
