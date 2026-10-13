import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach } from 'vitest';
import type { CachedHttpEntry } from '../../src/core/ports.js';
import {
  createFileCache,
  type FileCache,
  type FileCacheOptions,
} from '../../src/cache/file-cache.js';
import { nodeFs, type CacheFs } from '../../src/cache/fs-port.js';
import { freshness } from '../../src/cache/ttl.js';
import { FAKE_NOW, FakeClock } from '../support/fake-clock.js';
import { FakeLogger } from '../support/fake-logger.js';

const MEBIBYTE = 1024 * 1024;

/**
 * Registers clean-up for the temporary directories and caches of one test file and returns
 * the functions that create them. Background sweeps are awaited before a directory is
 * removed, so that no test leaves work running into the next one.
 */
export function useTempCaches() {
  const dirs: string[] = [];
  const caches: FileCache[] = [];

  afterEach(async () => {
    await Promise.all(caches.splice(0).map((cache) => cache.idle()));
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })),
    );
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-cache-'));
    dirs.push(dir);
    return dir;
  }

  async function open(options: Partial<FileCacheOptions> = {}) {
    const clock = (options.clock as FakeClock | undefined) ?? new FakeClock();
    const logger = (options.logger as FakeLogger | undefined) ?? new FakeLogger();
    const dir = options.dir ?? (await tempDir());
    const cache = createFileCache({
      maxBytes: 100 * MEBIBYTE,
      memoryMaxBytes: 16 * MEBIBYTE,
      // Rename retries must not slow the suite down.
      sleep: async () => undefined,
      ...options,
      dir,
      clock,
      logger,
    });
    caches.push(cache);
    return { cache, clock, logger, dir };
  }

  return { tempDir, open };
}

/** A cached response for `url`, fetched at the fake start time. */
export function entry(overrides: Partial<CachedHttpEntry> = {}): CachedHttpEntry {
  const url = overrides.url ?? 'https://developers.arcgis.com/widgets/get-started/';
  const ttl = overrides.ttl ?? 'page';
  const fetchedAt = overrides.fetchedAt ?? FAKE_NOW;
  return {
    url,
    finalUrl: url,
    aliasChain: [],
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<html><body><h1>Get started</h1><p>Install the widget package.</p></body></html>',
    fetchedAt,
    ...freshness(ttl, fetchedAt),
    ttl,
    ...overrides,
  };
}

/** A Node-style system error. */
export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected failure`), { code });
}

/** The real file system with some operations replaced. */
export function fsWith(overrides: Partial<CacheFs>): CacheFs {
  return { ...nodeFs, ...overrides };
}

async function listOnce(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((item) => item.isFile())
    .map((item) =>
      join(item.parentPath, item.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort();
}

/**
 * Every file below `dir`, as paths relative to it with forward slashes, sorted.
 *
 * The listing is taken once it has stopped changing: on Windows a delete completes only when
 * the last handle closes, and a scanner that still holds the file can leave a short-lived
 * directory entry behind (seen once as an upper-cased `.tmp` name).
 */
export async function listFiles(dir: string): Promise<string[]> {
  let previous = await listOnce(dir);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(15);
    const current = await listOnce(dir);
    if (current.join('|') === previous.join('|')) return current;
    previous = current;
  }
  return previous;
}
