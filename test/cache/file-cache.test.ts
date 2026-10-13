import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/core/hash.js';
import { INIT_RETRY_MS } from '../../src/cache/file-cache.js';
import { nodeFs } from '../../src/cache/fs-port.js';
import { cacheLayout } from '../../src/cache/paths.js';
import { freshness, freshnessAt } from '../../src/cache/ttl.js';
import { DAY, FAKE_NOW, HOUR, MINUTE } from '../support/fake-clock.js';
import { entry, errno, fsWith, listFiles, useTempCaches } from './helpers.js';

const { tempDir, open } = useTempCaches();
const KEY = 'GET https://developers.arcgis.com/widgets/get-started/';

describe('laziness and layout', () => {
  it('touches no file until the first operation', async () => {
    const parent = await tempDir();
    const dir = join(parent, 'not-created-yet');
    const { cache } = await open({ dir });
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await cache.getHttp(KEY)).toBeUndefined();
    expect((await readFile(join(dir, 'v1', 'VERSION'), 'utf8')).trim()).toBe('1');
  });

  it('stores an entry as hashed metadata and body files, and nothing else', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(KEY, entry());
    await cache.putDerived('catalog', 'widgets|guide|latest', { records: 2 });

    const hash = sha256Hex(KEY);
    const derivedHash = sha256Hex('widgets|guide|latest');
    expect(await listFiles(dir)).toEqual(
      [
        'v1/VERSION',
        `v1/derived/catalog/${derivedHash.slice(0, 2)}/${derivedHash}.json.gz`,
        `v1/http/${hash.slice(0, 2)}/${hash}.body.gz`,
        `v1/http/${hash.slice(0, 2)}/${hash}.meta.json`,
      ].sort(),
    );
  });

  it('keeps URLs and keys out of file names', async () => {
    const { cache, dir } = await open();
    await cache.putHttp('GET https://developers.arcgis.com/widgets/CON/aux.htm?x=<>:"|', entry());
    await cache.putDerived('misc', '../../escape', 1);
    for (const file of await listFiles(dir)) {
      expect(file).toMatch(
        /^v1\/(VERSION|(http|derived\/misc)\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z.]+)$/,
      );
    }
  });

  it('compresses bodies', async () => {
    const { cache, dir } = await open();
    const body = '<p>The same sentence again and again.</p>'.repeat(2000);
    await cache.putHttp(KEY, entry({ body }));
    const bodyFile = cacheLayout(dir).http(KEY).body;
    expect((await stat(bodyFile)).size).toBeLessThan(body.length / 10);
  });
});

describe('HTTP entries', () => {
  it('returns undefined for an unknown key', async () => {
    const { cache } = await open();
    expect(await cache.getHttp(KEY)).toBeUndefined();
  });

  it('round-trips every field', async () => {
    const { cache } = await open();
    const stored = entry({
      finalUrl: 'https://developers.arcgis.com/widgets/latest/get-started/',
      aliasChain: ['https://developers.arcgis.com/widgets/get-started/'],
      etag: 'W/"abc123"',
      lastModified: 'Tue, 13 Oct 2026 08:00:00 GMT',
      contentType: 'text/html; charset=utf-8',
    });
    await cache.putHttp(KEY, stored);
    expect(await cache.getHttp(KEY)).toEqual(stored);
  });

  it('leaves absent optional fields absent', async () => {
    const { cache } = await open();
    await cache.putHttp(KEY, entry());
    const loaded = await cache.getHttp(KEY);
    expect(loaded).toBeDefined();
    expect(Object.hasOwn(loaded!, 'etag')).toBe(false);
    expect(Object.hasOwn(loaded!, 'lastModified')).toBe(false);
  });

  it.each([
    ['an empty body', ''],
    ['non-ASCII text', 'Größe: 10 m² — 地図 🗺️\r\nsecond line\u0000end'],
    ['base64 of binary data', Buffer.from([0, 255, 31, 139, 8, 0, 127, 128]).toString('base64')],
    ['a large body', 'x'.repeat(3_000_000)],
  ])('preserves %s exactly', async (_label, body) => {
    const { cache } = await open();
    await cache.putHttp(KEY, entry({ body }));
    expect((await cache.getHttp(KEY))?.body).toBe(body);
  });

  it('stores negative entries like any other', async () => {
    const { cache } = await open();
    const miss = entry({ status: 404, body: '', ttl: 'negative' });
    await cache.putHttp(KEY, miss);
    expect(await cache.getHttp(KEY)).toEqual(miss);
  });

  it('replaces an entry on a second put', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(KEY, entry({ body: 'first', etag: '"1"' }));
    await cache.putHttp(KEY, entry({ body: 'second' }));
    const loaded = await cache.getHttp(KEY);
    expect(loaded?.body).toBe('second');
    expect(loaded?.etag).toBeUndefined();
    expect((await listFiles(dir)).filter((file) => file.includes('/http/'))).toHaveLength(2);
  });

  it('keeps entries apart by key', async () => {
    const { cache } = await open();
    await cache.putHttp('GET https://a.example/', entry({ body: 'A' }));
    await cache.putHttp('GET https://a.example/ base64', entry({ body: 'B' }));
    expect((await cache.getHttp('GET https://a.example/'))?.body).toBe('A');
    expect((await cache.getHttp('GET https://a.example/ base64'))?.body).toBe('B');
  });

  it('survives a restart', async () => {
    const first = await open();
    await first.cache.putHttp(KEY, entry({ etag: '"v1"' }));
    await first.cache.idle();
    const second = await open({ dir: first.dir });
    expect(await second.cache.getHttp(KEY)).toEqual(entry({ etag: '"v1"' }));
  });

  it('gives each caller its own copy', async () => {
    const { cache } = await open();
    await cache.putHttp(KEY, entry({ aliasChain: ['https://a.example/'] }));
    const first = await cache.getHttp(KEY);
    first!.aliasChain.push('https://mutated.example/');
    expect((await cache.getHttp(KEY))?.aliasChain).toEqual(['https://a.example/']);
  });

  it('ends with a consistent entry when the same key is written concurrently', async () => {
    const { cache } = await open();
    const bodies = Array.from({ length: 12 }, (_, i) => `body ${i} ${'x'.repeat(i * 1000)}`);
    await Promise.all([
      ...bodies.map((body) => cache.putHttp(KEY, entry({ body }))),
      ...bodies.map(() => cache.getHttp(KEY)),
    ]);
    expect((await cache.getHttp(KEY))?.body).toBe(bodies.at(-1));
  });
});

describe('touchHttp', () => {
  it('extends freshness and replaces validators after a 304, keeping the body', async () => {
    const { cache, clock } = await open();
    await cache.putHttp(
      KEY,
      entry({ etag: '"old"', lastModified: 'Mon, 12 Oct 2026 08:00:00 GMT' }),
    );
    clock.advance(2 * DAY);

    await cache.touchHttp(KEY, { ...freshness('page', clock.now()), etag: '"new"' });

    const loaded = await cache.getHttp(KEY);
    expect(loaded).toEqual(
      entry({
        etag: '"new"',
        lastModified: 'Mon, 12 Oct 2026 08:00:00 GMT',
        freshUntil: FAKE_NOW + 3 * DAY,
        staleUntil: FAKE_NOW + 32 * DAY,
      }),
    );
    // The fetch time still says when the body was downloaded.
    expect(loaded?.fetchedAt).toBe(FAKE_NOW);
  });

  it('keeps validators that the patch does not mention', async () => {
    const { cache, clock } = await open();
    await cache.putHttp(KEY, entry({ etag: '"keep"' }));
    await cache.touchHttp(KEY, {
      ...freshness('page', clock.now() + HOUR),
      lastModified: 'Tue, 13 Oct 2026 09:00:00 GMT',
    });
    expect(await cache.getHttp(KEY)).toMatchObject({
      etag: '"keep"',
      lastModified: 'Tue, 13 Oct 2026 09:00:00 GMT',
    });
  });

  it('is a no-op for an entry that is gone', async () => {
    const { cache, dir } = await open();
    await cache.touchHttp(KEY, freshness('page', FAKE_NOW));
    expect(await cache.getHttp(KEY)).toBeUndefined();
    expect((await listFiles(dir)).filter((file) => file.includes('/http/'))).toEqual([]);
  });
});

describe('stale-if-error', () => {
  it('keeps serving an entry past its freshness so the gateway can label it stale', async () => {
    const { cache, clock } = await open();
    await cache.putHttp(KEY, entry());

    clock.advance(DAY - MINUTE);
    expect(freshnessAt((await cache.getHttp(KEY))!, clock.now())).toBe('fresh');

    clock.advance(2 * MINUTE);
    const stale = await cache.getHttp(KEY);
    expect(stale?.body).toBe(entry().body);
    expect(freshnessAt(stale!, clock.now())).toBe('stale');

    clock.set(FAKE_NOW + 30 * DAY - MINUTE);
    expect(freshnessAt((await cache.getHttp(KEY))!, clock.now())).toBe('stale');
  });

  it('still returns an entry after 30 days, marked expired, so its validators can be reused', async () => {
    const { cache, clock } = await open();
    await cache.putHttp(KEY, entry({ etag: '"v1"' }));
    clock.advance(30 * DAY);
    const expired = await cache.getHttp(KEY);
    expect(expired?.etag).toBe('"v1"');
    expect(freshnessAt(expired!, clock.now())).toBe('expired');
  });

  it('has no stale window for remote search results', async () => {
    const { cache, clock } = await open();
    await cache.putHttp(KEY, entry({ ttl: 'remote-search' }));
    clock.advance(DAY);
    expect(freshnessAt((await cache.getHttp(KEY))!, clock.now())).toBe('expired');
  });
});

describe('derived values', () => {
  it('round-trips JSON values', async () => {
    const { cache } = await open();
    const value = { records: [{ ref: 'https://a.example/', title: 'Größe' }], count: 1, ok: true };
    await cache.putDerived('catalog', 'k', value);
    expect(await cache.getDerived('catalog', 'k')).toEqual(value);
  });

  it.each([
    ['a string', 'text'],
    ['a number', 42],
    ['zero', 0],
    ['false', false],
    ['null', null],
    ['an array', [1, 'two', null]],
  ])('round-trips %s', async (_label, value) => {
    const { cache } = await open();
    await cache.putDerived('misc', 'k', value);
    expect(await cache.getDerived('misc', 'k')).toEqual(value);
  });

  it('separates namespaces', async () => {
    const { cache } = await open();
    await cache.putDerived('catalog', 'k', 'catalog value');
    await cache.putDerived('symbols', 'k', 'symbols value');
    expect(await cache.getDerived('catalog', 'k')).toBe('catalog value');
    expect(await cache.getDerived('symbols', 'k')).toBe('symbols value');
    expect(await cache.getDerived('bodies', 'k')).toBeUndefined();
  });

  it('stores values as JSON, so undefined fields are dropped as on any JSON round trip', async () => {
    const { cache } = await open();
    await cache.putDerived('misc', 'k', { kept: 1, dropped: undefined });
    expect(await cache.getDerived('misc', 'k')).toEqual({ kept: 1 });
    await cache.putDerived('misc', 'nothing', undefined);
    expect(await cache.getDerived('misc', 'nothing')).toBeUndefined();
  });

  it('rejects a value that JSON cannot carry', async () => {
    const { cache } = await open();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(cache.putDerived('misc', 'k', cyclic)).rejects.toThrow(TypeError);
    await expect(cache.putDerived('misc', 'k', { big: 10n })).rejects.toThrow(TypeError);
  });

  it('deletes a value and tolerates deleting a missing one', async () => {
    const { cache } = await open();
    await cache.putDerived('versions', 'k', { latest: '1.2.3' });
    await cache.deleteDerived('versions', 'k');
    expect(await cache.getDerived('versions', 'k')).toBeUndefined();
    await expect(cache.deleteDerived('versions', 'k')).resolves.toBeUndefined();
  });

  it('survives a restart', async () => {
    const first = await open();
    await first.cache.putDerived('license', 'Esri/widget-kit', 'apache-2.0');
    await first.cache.idle();
    const second = await open({ dir: first.dir });
    expect(await second.cache.getDerived('license', 'Esri/widget-kit')).toBe('apache-2.0');
  });

  it('refuses a namespace that could leave the cache directory', async () => {
    const { cache, logger } = await open();
    const bad = '../outside' as 'misc';
    await cache.putDerived(bad, 'k', 1);
    expect(await cache.getDerived(bad, 'k')).toBeUndefined();
    await cache.deleteDerived(bad, 'k');
    expect(logger.entries.map((item) => (item.fields as { operation: string }).operation)).toEqual([
      'putDerived',
      'getDerived',
      'deleteDerived',
    ]);
  });
});

describe('VERSION file', () => {
  it('discards a cache written by another schema version', async () => {
    const first = await open();
    await first.cache.putHttp(KEY, entry());
    await first.cache.putDerived('misc', 'k', 1);
    await first.cache.idle();
    await writeFile(join(first.dir, 'v1', 'VERSION'), '0\n');

    const second = await open({ dir: first.dir });
    expect(await second.cache.getHttp(KEY)).toBeUndefined();
    expect(await second.cache.getDerived('misc', 'k')).toBeUndefined();
    expect(await listFiles(first.dir)).toEqual(['v1/VERSION']);
    expect((await readFile(join(first.dir, 'v1', 'VERSION'), 'utf8')).trim()).toBe('1');
  });

  it('discards entries when the VERSION file is missing', async () => {
    const dir = await tempDir();
    const layout = cacheLayout(dir);
    await mkdir(join(layout.httpDir, 'ab'), { recursive: true });
    await writeFile(join(layout.httpDir, 'ab', 'unknown.meta.json'), '{}');
    const { cache } = await open({ dir });
    await cache.getHttp(KEY);
    expect(await listFiles(dir)).toEqual(['v1/VERSION']);
  });

  it('keeps entries when the version matches, whatever the trailing whitespace', async () => {
    const first = await open();
    await first.cache.putHttp(KEY, entry());
    await first.cache.idle();
    await writeFile(join(first.dir, 'v1', 'VERSION'), '1\r\n');
    const second = await open({ dir: first.dir });
    expect(await second.cache.getHttp(KEY)).toBeDefined();
  });
});

describe('corrupt entries are misses and are deleted', () => {
  async function corruptHttp(damage: (paths: { meta: string; body: string }) => Promise<void>) {
    const opened = await open();
    await opened.cache.putHttp(KEY, entry());
    await opened.cache.idle();
    await damage(cacheLayout(opened.dir).http(KEY));
    expect(await opened.cache.getHttp(KEY)).toBeUndefined();
    expect((await listFiles(opened.dir)).filter((file) => file.includes('/http/'))).toEqual([]);
    expect(opened.logger.messages('debug')).toContain('cache: removed a damaged entry');
    // The slot works again afterwards.
    await opened.cache.putHttp(KEY, entry({ body: 'fresh copy' }));
    expect((await opened.cache.getHttp(KEY))?.body).toBe('fresh copy');
  }

  it('metadata that is not JSON', () =>
    corruptHttp(({ meta }) => writeFile(meta, '{"key": "GET ht')));

  it('metadata that is empty', () => corruptHttp(({ meta }) => writeFile(meta, '')));

  it('metadata with a missing field', () =>
    corruptHttp(async ({ meta }) => {
      const parsed = JSON.parse(await readFile(meta, 'utf8')) as Record<string, unknown>;
      delete parsed.freshUntil;
      await writeFile(meta, JSON.stringify(parsed));
    }));

  it('metadata with an unknown TTL class', () =>
    corruptHttp(async ({ meta }) => {
      const parsed = JSON.parse(await readFile(meta, 'utf8')) as Record<string, unknown>;
      await writeFile(meta, JSON.stringify({ ...parsed, ttl: 'forever' }));
    }));

  it('metadata that belongs to another key', () =>
    corruptHttp(async ({ meta }) => {
      const parsed = JSON.parse(await readFile(meta, 'utf8')) as Record<string, unknown>;
      await writeFile(meta, JSON.stringify({ ...parsed, key: 'GET https://other.example/' }));
    }));

  it('a body that is not gzip', () => corruptHttp(({ body }) => writeFile(body, 'plain text')));

  it('a truncated body', () =>
    corruptHttp(async ({ body }) => {
      const data = await readFile(body);
      await writeFile(body, data.subarray(0, data.length - 6));
    }));

  it('a body from another write', () =>
    corruptHttp(({ body }) => writeFile(body, gzipSync('a different response'))));

  it('a missing body file', () => corruptHttp(({ body }) => nodeFs.rm(body)));

  it('a damaged derived value', async () => {
    const { cache, dir, logger } = await open();
    await cache.putDerived('symbols', 'k', { a: 1 });
    await cache.idle();
    const path = cacheLayout(dir).derived('symbols', 'k');

    for (const damage of [
      Buffer.from('not gzip'),
      gzipSync('not json'),
      gzipSync('"a bare string"'),
      gzipSync(JSON.stringify({ k: 'another key', v: 1 })),
      gzipSync('null'),
    ]) {
      await writeFile(path, damage);
      expect(await cache.getDerived('symbols', 'k')).toBeUndefined();
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(logger.messages('debug').filter((msg) => msg.includes('damaged'))).toHaveLength(5);
  });

  it('touching a corrupt entry removes it', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(KEY, entry());
    await writeFile(cacheLayout(dir).http(KEY).meta, 'garbage');
    await cache.touchHttp(KEY, freshness('page', FAKE_NOW));
    expect((await listFiles(dir)).filter((file) => file.includes('/http/'))).toEqual([]);
  });
});

describe('disk failures never fail a caller', () => {
  it('treats an unwritable directory as a cache that stores nothing', async () => {
    const fs = fsWith({
      mkdir: async () => {
        throw errno('EACCES');
      },
    });
    const { cache, logger } = await open({ fs });

    await expect(cache.putHttp(KEY, entry())).resolves.toBeUndefined();
    expect(await cache.getHttp(KEY)).toBeUndefined();
    await expect(cache.putDerived('misc', 'k', 1)).resolves.toBeUndefined();
    expect(await cache.getDerived('misc', 'k')).toBeUndefined();
    await expect(cache.touchHttp(KEY, freshness('page', FAKE_NOW))).resolves.toBeUndefined();
    await expect(cache.deleteDerived('misc', 'k')).resolves.toBeUndefined();

    // One warning for the whole outage, not one per call.
    expect(logger.messages('warn')).toEqual([
      'cache: disk operation failed, continuing without it',
    ]);
    // The memo does not depend on the disk.
    expect(await cache.memo('m', async () => ({ value: 7, bytes: 8 }))).toBe(7);
  });

  it('tries the directory again after a minute', async () => {
    let broken = true;
    const fs = fsWith({
      mkdir: async (path) => {
        if (broken) throw errno('EACCES');
        await nodeFs.mkdir(path);
      },
    });
    const { cache, clock } = await open({ fs });
    await cache.putHttp(KEY, entry());
    broken = false;

    clock.advance(INIT_RETRY_MS - 1);
    await cache.putHttp(KEY, entry());
    expect(await cache.getHttp(KEY)).toBeUndefined();

    clock.advance(1);
    await cache.putHttp(KEY, entry());
    expect(await cache.getHttp(KEY)).toBeDefined();
  });

  it('skips a write that keeps failing with EPERM and warns once', async () => {
    const fs = fsWith({
      rename: async (from, to) => {
        if (to.endsWith('VERSION')) return nodeFs.rename(from, to);
        throw errno('EPERM');
      },
    });
    const { cache, logger, dir } = await open({ fs });
    await cache.putHttp(KEY, entry());
    await cache.putHttp(KEY, entry());
    expect(await cache.getHttp(KEY)).toBeUndefined();
    expect(logger.messages('warn')).toHaveLength(1);
    expect(logger.messages('debug')).toContain('cache: disk operation failed');
    expect(await listFiles(dir)).toEqual(['v1/VERSION']);
  });

  it('completes a write whose rename fails twice with EPERM', async () => {
    let failures = 0;
    const fs = fsWith({
      rename: async (from, to) => {
        if (to.endsWith('.meta.json') && failures < 2) {
          failures += 1;
          throw errno('EPERM');
        }
        await nodeFs.rename(from, to);
      },
    });
    const { cache, logger } = await open({ fs });
    await cache.putHttp(KEY, entry());
    expect(failures).toBe(2);
    expect(await cache.getHttp(KEY)).toEqual(entry());
    expect(logger.messages('warn')).toEqual([]);
  });

  it('answers a miss when a file cannot be read, without deleting it', async () => {
    let locked = false;
    const fs = fsWith({
      readFile: async (path) => {
        if (locked && path.endsWith('.body.gz')) throw errno('EBUSY');
        return nodeFs.readFile(path);
      },
    });
    const { cache, logger } = await open({ fs });
    await cache.putHttp(KEY, entry());
    locked = true;
    expect(await cache.getHttp(KEY)).toBeUndefined();
    expect(logger.messages('warn')).toHaveLength(1);
    locked = false;
    expect(await cache.getHttp(KEY)).toEqual(entry());
  });

  it('still returns the entry when the last-read time cannot be recorded', async () => {
    const fs = fsWith({
      utimes: async () => {
        throw errno('EPERM');
      },
    });
    const { cache } = await open({ fs });
    await cache.putHttp(KEY, entry());
    await cache.putDerived('misc', 'k', 'v');
    expect(await cache.getHttp(KEY)).toEqual(entry());
    expect(await cache.getDerived('misc', 'k')).toBe('v');
  });
});

describe('memo', () => {
  it('remembers computed values in memory', async () => {
    const { cache } = await open();
    let computed = 0;
    const compute = async () => {
      computed += 1;
      return { value: { index: 'loaded' }, bytes: 1024 };
    };
    const first = await cache.memo('index|widgets', compute);
    expect(await cache.memo('index|widgets', compute)).toBe(first);
    expect(computed).toBe(1);
  });

  it('honours the memory budget', async () => {
    const { cache } = await open({ memoryMaxBytes: 100 });
    let computed = 0;
    const compute = async () => {
      computed += 1;
      return { value: 'v', bytes: 80 };
    };
    await cache.memo('a', compute);
    await cache.memo('b', compute);
    await cache.memo('a', compute);
    expect(computed).toBe(3);
  });
});

describe('info and clear', () => {
  it('reports an empty cache without creating the directory', async () => {
    const parent = await tempDir();
    const dir = join(parent, 'absent');
    const { cache } = await open({ dir });
    expect(await cache.info()).toEqual({ dir, bytes: 0, entries: 0 });
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('counts entries and the bytes they occupy on disk', async () => {
    const { cache, dir } = await open();
    await cache.putHttp('GET https://a.example/1', entry());
    await cache.putHttp('GET https://a.example/2', entry());
    await cache.putDerived('catalog', 'k', { a: 1 });
    await cache.idle();

    const files = (await listFiles(dir)).filter((file) => file !== 'v1/VERSION');
    let bytes = 0;
    for (const file of files) bytes += (await stat(join(dir, file))).size;
    expect(await cache.info()).toEqual({ dir, bytes, entries: 3 });
  });

  it.each([
    ['http', { http: false, derived: true, memo: true }],
    ['derived', { http: true, derived: false, memo: true }],
    ['all', { http: false, derived: false, memo: false }],
    [undefined, { http: false, derived: false, memo: false }],
  ] as const)('clear(%s)', async (scope, kept) => {
    const { cache } = await open();
    await cache.putHttp(KEY, entry());
    await cache.putDerived('catalog', 'k', 1);
    let computed = 0;
    const compute = async () => {
      computed += 1;
      return { value: 1, bytes: 1 };
    };
    await cache.memo('m', compute);

    await cache.clear(scope);

    expect((await cache.getHttp(KEY)) !== undefined).toBe(kept.http);
    expect((await cache.getDerived('catalog', 'k')) !== undefined).toBe(kept.derived);
    await cache.memo('m', compute);
    expect(computed).toBe(kept.memo ? 1 : 2);
  });

  it('accepts writes again after a clear', async () => {
    const { cache } = await open();
    await cache.putHttp(KEY, entry());
    await cache.clear();
    await cache.putHttp(KEY, entry({ body: 'after clear' }));
    await cache.putDerived('misc', 'k', 'after clear');
    expect((await cache.getHttp(KEY))?.body).toBe('after clear');
    expect(await cache.getDerived('misc', 'k')).toBe('after clear');
  });

  it('reports a clear that fails, because the user asked for it', async () => {
    const fs = fsWith({
      rm: async () => {
        throw errno('EPERM');
      },
    });
    const { cache } = await open({ fs });
    await expect(cache.clear()).rejects.toMatchObject({ code: 'EPERM' });
  });
});
