/**
 * The HTTP store: one cached response is `<sha256>.meta.json` (everything but the body,
 * small, rewritten after a 304) plus `<sha256>.body.gz`.
 */
import * as z from 'zod/v4';
import type { CachedHttpEntry, Clock } from '../core/ports.js';
import type { TtlClass } from '../core/types.js';
import { gunzipBytes, gzipText, type KeyedLock } from './codec.js';
import { readIfExists, type CacheFs } from './fs-port.js';
import type { CacheLayout, HttpEntryPaths } from './paths.js';
import { TTL_MS } from './ttl.js';

/** Fields of `CachedHttpEntry` that `touchHttp` may change. */
export type HttpTouchPatch = Pick<CachedHttpEntry, 'freshUntil' | 'staleUntil'> & {
  etag?: string;
  lastModified?: string;
};

const MetaSchema = z.object({
  /** The cache key, kept to prove that the file belongs to the key that hashed to its name. */
  key: z.string(),
  url: z.string(),
  finalUrl: z.string(),
  aliasChain: z.array(z.string()),
  status: z.number().int(),
  contentType: z.string(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  fetchedAt: z.number(),
  freshUntil: z.number(),
  staleUntil: z.number(),
  ttl: z.enum(Object.keys(TTL_MS) as [TtlClass, ...TtlClass[]]),
  /** Size of the uncompressed body; a body file of another size belongs to another write. */
  bodyBytes: z.number().int().nonnegative(),
});

type Meta = z.infer<typeof MetaSchema>;

/** Dependencies of {@link createHttpStore}. */
export interface HttpStoreDeps {
  fs: CacheFs;
  layout: CacheLayout;
  clock: Clock;
  lock: KeyedLock;
  /** Atomic file replacement. */
  write: (path: string, data: Uint8Array | string) => Promise<void>;
  /** Told about every entry removed because it could not be read back. */
  onCorrupt: (key: string, reason: string) => void;
}

/** Disk operations on cached HTTP responses. File-system failures reject. */
export interface HttpStore {
  get(key: string): Promise<CachedHttpEntry | undefined>;
  put(key: string, entry: CachedHttpEntry): Promise<void>;
  touch(key: string, patch: HttpTouchPatch): Promise<void>;
}

function parseMeta(data: Buffer, key: string): Meta | undefined {
  try {
    const parsed = MetaSchema.safeParse(JSON.parse(data.toString('utf8')));
    return parsed.success && parsed.data.key === key ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toMeta(key: string, entry: CachedHttpEntry, bodyBytes: number): Meta {
  return {
    key,
    url: entry.url,
    finalUrl: entry.finalUrl,
    aliasChain: entry.aliasChain,
    status: entry.status,
    contentType: entry.contentType,
    ...(entry.etag === undefined ? {} : { etag: entry.etag }),
    ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
    fetchedAt: entry.fetchedAt,
    freshUntil: entry.freshUntil,
    staleUntil: entry.staleUntil,
    ttl: entry.ttl,
    bodyBytes,
  };
}

function toEntry(meta: Meta, body: string): CachedHttpEntry {
  const { key: _key, bodyBytes: _bodyBytes, etag, lastModified, ...rest } = meta;
  return {
    ...rest,
    body,
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

/** Creates the HTTP store over a cache layout. */
export function createHttpStore(deps: HttpStoreDeps): HttpStore {
  const { fs, layout, clock, lock, write, onCorrupt } = deps;

  /** Removes a damaged entry; the metadata goes first so that no reader finds half of it. */
  async function drop(key: string, paths: HttpEntryPaths, reason: string): Promise<undefined> {
    await fs.rm(paths.meta);
    await fs.rm(paths.body);
    onCorrupt(key, reason);
    return undefined;
  }

  /**
   * The modification time of the metadata file is the entry's last-read time, which the
   * eviction sweep sorts by. It is written from the injected clock, never left to the file
   * system, so that it follows the same time source as the freshness window.
   */
  async function markRead(paths: HttpEntryPaths): Promise<void> {
    // Losing one last-read update only makes the entry look older to the sweep.
    await fs.utimes(paths.meta, clock.now()).catch(() => undefined);
  }

  async function readMeta(key: string, paths: HttpEntryPaths): Promise<Meta | undefined> {
    const data = await readIfExists(fs, paths.meta);
    if (data === undefined) return undefined;
    return parseMeta(data, key) ?? drop(key, paths, 'unreadable metadata');
  }

  return {
    get: (key) =>
      lock.run(key, async () => {
        const paths = layout.http(key);
        const meta = await readMeta(key, paths);
        if (meta === undefined) return undefined;

        const compressed = await readIfExists(fs, paths.body);
        if (compressed === undefined) return drop(key, paths, 'body file missing');
        let body: Buffer;
        try {
          body = await gunzipBytes(compressed);
        } catch {
          return drop(key, paths, 'body does not decompress');
        }
        if (body.length !== meta.bodyBytes) return drop(key, paths, 'body size mismatch');

        await markRead(paths);
        return toEntry(meta, body.toString('utf8'));
      }),

    put: (key, entry) =>
      lock.run(key, async () => {
        const paths = layout.http(key);
        // Body first: metadata is what makes an entry visible, so it must land last.
        await write(paths.body, await gzipText(entry.body));
        const meta = toMeta(key, entry, Buffer.byteLength(entry.body, 'utf8'));
        await write(paths.meta, JSON.stringify(meta));
        await markRead(paths);
      }),

    touch: (key, patch) =>
      lock.run(key, async () => {
        const paths = layout.http(key);
        const meta = await readMeta(key, paths);
        // The entry was evicted or cleared since the conditional request was sent.
        if (meta === undefined) return;
        const next: Meta = {
          ...meta,
          freshUntil: patch.freshUntil,
          staleUntil: patch.staleUntil,
          ...(patch.etag === undefined ? {} : { etag: patch.etag }),
          ...(patch.lastModified === undefined ? {} : { lastModified: patch.lastModified }),
        };
        await write(paths.meta, JSON.stringify(next));
        await markRead(paths);
      }),
  };
}
