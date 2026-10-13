import { mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEFTOVER_MAX_AGE_MS,
  SWEEP_TARGET_RATIO,
  scanCache,
  sweepCache,
} from '../../src/cache/evict.js';
import { SWEEP_INTERVAL_MS, type FileCache } from '../../src/cache/file-cache.js';
import { nodeFs } from '../../src/cache/fs-port.js';
import { cacheLayout } from '../../src/cache/paths.js';
import { FAKE_NOW, HOUR, MINUTE, type FakeClock } from '../support/fake-clock.js';
import { entry, errno, fsWith, listFiles, useTempCaches } from './helpers.js';

const { open } = useTempCaches();

const key = (name: string) => `GET https://developers.arcgis.com/widgets/${name}/`;
/** Incompressible text, so that the size on disk is close to the size given. */
function noise(chars: number, seed: number): string {
  let state = seed + 1;
  let text = '';
  while (text.length < chars) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    text += state.toString(36);
  }
  return text.slice(0, chars);
}

async function present(cache: { getHttp(key: string): Promise<unknown> }, names: string[]) {
  const found: string[] = [];
  for (const name of names) if ((await cache.getHttp(key(name))) !== undefined) found.push(name);
  return found;
}

async function writeAged(path: string, content: string, mtimeMs: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await utimes(path, new Date(mtimeMs), new Date(mtimeMs));
}

/**
 * Fills a cache whose cap is far away, then opens the same directory with a cap under which
 * exactly `keep` of the equally sized entries fit after a sweep (which frees down to 90 %).
 */
async function filled(fill: (cache: FileCache, clock: FakeClock) => Promise<number>, keep: number) {
  const writer = await open();
  // Uses up the hourly background sweep, so that only the explicit one below evicts.
  await writer.cache.sweep();
  const count = await fill(writer.cache, writer.clock);
  const perEntry = (await writer.cache.info()).bytes / count;
  const maxBytes = Math.floor(((keep + 0.5) * perEntry) / SWEEP_TARGET_RATIO);
  const sweeper = await open({ dir: writer.dir, clock: writer.clock, maxBytes });
  return { cache: sweeper.cache, dir: writer.dir, maxBytes, perEntry };
}

describe('sweep', () => {
  it('does nothing while the cache is under its cap', async () => {
    const { cache } = await open({ maxBytes: 1_000_000 });
    await cache.sweep();
    await cache.putHttp(key('a'), entry({ body: noise(20_000, 1) }));
    await cache.putDerived('catalog', 'k', noise(20_000, 2));
    const result = await cache.sweep();
    expect(result).toMatchObject({ evicted: 0, leftoversRemoved: 0 });
    expect(result.bytesAfter).toBe(result.bytesBefore);
    expect(result.bytesBefore).toBe((await cache.info()).bytes);
    expect(await present(cache, ['a'])).toEqual(['a']);
  });

  it('evicts the least recently read entries first, down to 90 % of the cap', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { cache, maxBytes, perEntry } = await filled(async (writer, clock) => {
      for (const [i, name] of names.entries()) {
        await writer.putHttp(key(name), entry({ body: noise(30_000, i) }));
        clock.advance(MINUTE);
      }
      // Reading `a` and `b` makes them the most recently used.
      await writer.getHttp(key('a'));
      clock.advance(MINUTE);
      await writer.getHttp(key('b'));
      clock.advance(MINUTE);
      return names.length;
    }, 3);

    const result = await cache.sweep();

    expect(result.bytesBefore).toBeGreaterThan(maxBytes);
    expect(result.bytesAfter).toBeLessThanOrEqual(maxBytes * SWEEP_TARGET_RATIO);
    // It stopped as soon as the target was met: one entry fewer would have been too many.
    expect(result.bytesAfter + perEntry).toBeGreaterThan(maxBytes * SWEEP_TARGET_RATIO);
    expect(result.evicted).toBe(3);
    expect((await cache.info()).bytes).toBe(result.bytesAfter);
    expect(await present(cache, names)).toEqual(['a', 'b', 'f']);
  });

  it('keeps immutable entries until nothing else is left to evict', async () => {
    const names = ['pinned-1', 'pinned-2', 'page-1', 'page-2'];
    const { cache } = await filled(async (writer, clock) => {
      // The immutable entries are the oldest, and are still spared.
      for (const [i, name] of names.entries()) {
        const ttl = name.startsWith('pinned') ? 'immutable' : 'page';
        await writer.putHttp(key(name), entry({ body: noise(30_000, i), ttl }));
        clock.advance(MINUTE);
      }
      return names.length;
    }, 2);

    const result = await cache.sweep();
    expect(result.evicted).toBe(2);
    expect(await present(cache, names)).toEqual(['pinned-1', 'pinned-2']);
  });

  it('evicts immutable entries, oldest first, when they alone exceed the cap', async () => {
    const names = ['pinned-1', 'pinned-2', 'pinned-3', 'page'];
    const { cache } = await filled(async (writer, clock) => {
      for (const [i, name] of names.entries()) {
        const ttl = name.startsWith('pinned') ? 'immutable' : 'page';
        await writer.putHttp(key(name), entry({ body: noise(30_000, i), ttl }));
        clock.advance(MINUTE);
      }
      return names.length;
    }, 2);

    const result = await cache.sweep();
    expect(result.evicted).toBe(2);
    expect(await present(cache, names)).toEqual(['pinned-2', 'pinned-3']);
  });

  it('evicts derived values by the same rule', async () => {
    const { cache } = await filled(async (writer, clock) => {
      for (const [i, name] of ['old', 'read', 'new'].entries()) {
        await writer.putDerived('catalog', name, noise(40_000, i));
        clock.advance(MINUTE);
      }
      // Reading the oldest value makes `read` the least recently used.
      await writer.getDerived('catalog', 'old');
      return 3;
    }, 2);

    expect((await cache.sweep()).evicted).toBe(1);
    expect(await cache.getDerived('catalog', 'old')).toBeDefined();
    expect(await cache.getDerived('catalog', 'read')).toBeUndefined();
    expect(await cache.getDerived('catalog', 'new')).toBeDefined();
  });

  it('treats an entry with unreadable metadata as ordinary', async () => {
    const { cache, dir } = await filled(async (writer, clock) => {
      await writer.putHttp(key('broken'), entry({ body: noise(30_000, 1), ttl: 'immutable' }));
      clock.advance(MINUTE);
      await writer.putHttp(key('page'), entry({ body: noise(30_000, 2) }));
      return 2;
    }, 1);
    const meta = cacheLayout(dir).http(key('broken')).meta;
    await writeAged(meta, 'garbage', FAKE_NOW);

    const result = await cache.sweep();
    expect(result.evicted).toBe(1);
    expect(await present(cache, ['broken', 'page'])).toEqual(['page']);
    expect((await listFiles(dir)).filter((file) => file.includes('/http/'))).toHaveLength(2);
  });

  it('removes old leftovers and keeps recent ones, whatever the size', async () => {
    const { cache, clock, dir } = await open({ maxBytes: 10_000_000 });
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    const layout = cacheLayout(dir);
    const old = clock.now() - LEFTOVER_MAX_AGE_MS;
    const recent = clock.now() - LEFTOVER_MAX_AGE_MS + MINUTE;
    const shard = join(layout.httpDir, 'zz');
    await writeAged(join(shard, 'entry.meta.json.123.abcdef.tmp'), 'interrupted', old);
    await writeAged(join(shard, 'entry.body.gz.123.abcdef.tmp'), 'in progress', recent);
    await writeAged(join(shard, `${'0'.repeat(64)}.body.gz`), 'orphaned body', old);
    await writeAged(join(shard, `${'1'.repeat(64)}.body.gz`), 'body being written', recent);
    await writeAged(join(layout.derivedDir, 'misc', 'zz', 'value.json.gz.9.ff.tmp'), 'x', old);
    await writeAged(join(layout.derivedDir, 'misc', 'zz', 'notes.txt'), 'stray', old);

    const result = await cache.sweep();

    expect(result).toMatchObject({ evicted: 0, leftoversRemoved: 4 });
    const files = await listFiles(dir);
    expect(files.filter((file) => file.includes('/zz/'))).toEqual([
      `v1/http/zz/${'1'.repeat(64)}.body.gz`,
      'v1/http/zz/entry.body.gz.123.abcdef.tmp',
    ]);
    expect(await present(cache, ['a'])).toEqual(['a']);
  });

  it('counts leftovers in the size but not in the entries', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    const before = await cache.info();
    await writeAged(join(cacheLayout(dir).httpDir, 'zz', 'x.tmp'), '12345', Date.now());
    expect(await cache.info()).toEqual({ ...before, bytes: before.bytes + 5 });
  });

  it('counts an entry whose body file is gone by its metadata alone', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    const paths = cacheLayout(dir).http(key('a'));
    await nodeFs.rm(paths.body);
    const scan = await scanCache(nodeFs, cacheLayout(dir));
    expect(scan.entries).toEqual([
      expect.objectContaining({ files: [paths.meta], meta: paths.meta, lastRead: FAKE_NOW }),
    ]);
    expect(scan.bytes).toBe((await stat(paths.meta)).size);
  });

  it('skips files that vanish while it walks the directory', async () => {
    const { cache, dir } = await open();
    await cache.putHttp(key('a'), entry());
    await cache.putHttp(key('b'), entry());
    await cache.idle();
    const gone = cacheLayout(dir).http(key('a')).meta;
    const fs = fsWith({
      stat: async (path) => {
        if (path === gone) throw errno('ENOENT');
        return nodeFs.stat(path);
      },
    });
    const scan = await scanCache(fs, cacheLayout(dir));
    expect(scan.entries).toHaveLength(1);
    // The body of the vanished entry is now a leftover.
    expect(scan.leftovers).toHaveLength(1);
  });

  it('rejects when the directory cannot be listed', async () => {
    const { dir } = await open();
    const fs = fsWith({
      readdir: async () => {
        throw errno('EACCES');
      },
    });
    await expect(scanCache(fs, cacheLayout(dir))).rejects.toMatchObject({ code: 'EACCES' });
    const failingStat = fsWith({
      stat: async () => {
        throw errno('EIO');
      },
    });
    const { cache, dir: used } = await open();
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    await expect(
      sweepCache(failingStat, cacheLayout(used), { maxBytes: 1, now: FAKE_NOW }),
    ).rejects.toMatchObject({ code: 'EIO' });
  });
});

describe('sweep scheduling', () => {
  /** Counts directory walks by watching the root of the HTTP store being listed. */
  function countingFs(dir: string) {
    const httpDir = cacheLayout(dir).httpDir;
    const counter = { sweeps: 0 };
    const fs = fsWith({
      readdir: async (path) => {
        if (path === httpDir) counter.sweeps += 1;
        return nodeFs.readdir(path);
      },
    });
    return { fs, counter };
  }

  it('runs after a write, at most once per hour', async () => {
    const dir = (await open()).dir;
    const { fs, counter } = countingFs(dir);
    const { cache, clock } = await open({ dir, fs });

    await cache.getHttp(key('a'));
    await cache.idle();
    expect(counter.sweeps).toBe(0);

    await cache.putHttp(key('a'), entry());
    await cache.idle();
    expect(counter.sweeps).toBe(1);

    for (let i = 0; i < 5; i += 1) {
      clock.advance(10 * MINUTE);
      await cache.putHttp(key(`b${i}`), entry());
      await cache.putDerived('misc', `k${i}`, i);
      await cache.idle();
    }
    expect(counter.sweeps).toBe(1);

    clock.advance(SWEEP_INTERVAL_MS - 50 * MINUTE);
    await cache.putDerived('misc', 'later', 1);
    await cache.idle();
    expect(counter.sweeps).toBe(2);
  });

  it('enforces the cap in the background after a write', async () => {
    const { cache, clock, logger } = await open({ maxBytes: 50_000 });
    await cache.putHttp(key('old'), entry({ body: noise(60_000, 1) }));
    await cache.idle();
    clock.advance(HOUR);
    await cache.putHttp(key('new'), entry({ body: noise(60_000, 2) }));
    await cache.idle();

    expect(await present(cache, ['old', 'new'])).toEqual(['new']);
    expect(logger.messages('info')).toEqual(['cache: sweep finished']);
  });

  it('does not sweep after a write that failed', async () => {
    const dir = (await open()).dir;
    const counting = countingFs(dir);
    const fs = fsWith({
      readdir: counting.fs.readdir,
      rename: async (from, to) => {
        if (to.endsWith('VERSION')) return nodeFs.rename(from, to);
        throw errno('ENOSPC');
      },
    });
    const { cache } = await open({ dir, fs });
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    expect(counting.counter.sweeps).toBe(0);
  });

  it('logs a failed background sweep and carries on', async () => {
    const fs = fsWith({
      readdir: async () => {
        throw errno('EACCES');
      },
    });
    const { cache, logger } = await open({ fs });
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    expect(logger.messages('warn')).toEqual([
      'cache: disk operation failed, continuing without it',
    ]);
    expect(await cache.getHttp(key('a'))).toBeDefined();
  });

  it('counts a manual sweep as the hourly one', async () => {
    const dir = (await open()).dir;
    const { fs, counter } = countingFs(dir);
    const { cache } = await open({ dir, fs });
    await cache.sweep();
    expect(counter.sweeps).toBe(1);
    await cache.putHttp(key('a'), entry());
    await cache.idle();
    expect(counter.sweeps).toBe(1);
  });
});
