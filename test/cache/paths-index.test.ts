import { rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/core/hash.js';
import { createKeyedLock, gunzipBytes, gzipText } from '../../src/cache/codec.js';
import { errnoCode, isMissing, listDir, nodeFs, readIfExists } from '../../src/cache/fs-port.js';
import { createCache } from '../../src/cache/index.js';
import { CACHE_SCHEMA_VERSION, cacheLayout, resolveCacheDir } from '../../src/cache/paths.js';
import { makeConfig } from '../support/builders.js';
import { FakeClock } from '../support/fake-clock.js';
import { FakeLogger } from '../support/fake-logger.js';
import { entry, useTempCaches } from './helpers.js';

const { tempDir } = useTempCaches();

describe('resolveCacheDir', () => {
  it('uses the configured directory, made absolute', () => {
    expect(resolveCacheDir({ cacheDir: join('some', 'relative', 'dir') })).toBe(
      resolve('some', 'relative', 'dir'),
    );
  });

  it('falls back to the per-user cache directory of the platform', () => {
    const dir = resolveCacheDir({});
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.split(sep)).toContain('arcgis-sdk-mcp');
    // env-paths appends "-nodejs" unless told otherwise; the design asks for the bare name.
    expect(dir).not.toContain('nodejs');
  });
});

describe('cacheLayout', () => {
  const layout = cacheLayout(join('C:', 'cache'));

  it('puts everything under a directory named after the schema version', () => {
    expect(CACHE_SCHEMA_VERSION).toBe('1');
    expect(layout.root).toBe(join('C:', 'cache', 'v1'));
    expect(layout.versionFile).toBe(join(layout.root, 'VERSION'));
    expect(layout.httpDir).toBe(join(layout.root, 'http'));
    expect(layout.derivedDir).toBe(join(layout.root, 'derived'));
  });

  it('names HTTP entries by the hash of their key, in a two-character shard', () => {
    const hash = sha256Hex('GET https://a.example/');
    expect(layout.http('GET https://a.example/')).toEqual({
      meta: join(layout.httpDir, hash.slice(0, 2), `${hash}.meta.json`),
      body: join(layout.httpDir, hash.slice(0, 2), `${hash}.body.gz`),
    });
  });

  it('names derived values by namespace and hash', () => {
    const hash = sha256Hex('widgets|guide');
    expect(layout.derived('symbols', 'widgets|guide')).toBe(
      join(layout.derivedDir, 'symbols', hash.slice(0, 2), `${hash}.json.gz`),
    );
  });
});

describe('createCache', () => {
  const created: Array<{ idle(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(created.splice(0).map((cache) => cache.idle()));
  });

  it('builds a working disk cache in the configured directory, lazily', async () => {
    const dir = join(await tempDir(), 'cache');
    const cache = createCache({
      config: makeConfig({ cacheDir: dir, cacheMaxMb: 1, memoryMaxMb: 1 }),
      logger: new FakeLogger(),
      clock: new FakeClock(),
    });
    created.push(cache as unknown as { idle(): Promise<void> });
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });

    const key = 'GET https://developers.arcgis.com/widgets/';
    await cache.putHttp(key, entry());
    await cache.putDerived('versions', 'widgets', { latest: '1.2.3' });
    expect(await cache.getHttp(key)).toEqual(entry());
    expect(await cache.getDerived('versions', 'widgets')).toEqual({ latest: '1.2.3' });
    expect(await cache.memo('m', async () => ({ value: 'memoised', bytes: 8 }))).toBe('memoised');
    expect(await cache.info()).toMatchObject({ dir, entries: 2 });

    await cache.clear();
    expect(await cache.info()).toEqual({ dir, bytes: 0, entries: 0 });
  });

  it('applies the megabyte limits of the configuration', async () => {
    const dir = await tempDir();
    const cache = createCache({
      config: makeConfig({ cacheDir: dir, cacheMaxMb: 1, memoryMaxMb: 1 }),
      logger: new FakeLogger(),
      clock: new FakeClock(),
    });
    created.push(cache as unknown as { idle(): Promise<void> });
    let computed = 0;
    const big = async () => {
      computed += 1;
      return { value: 'x', bytes: 700 * 1024 };
    };
    await cache.memo('a', big);
    await cache.memo('b', big);
    await cache.memo('a', big);
    expect(computed).toBe(3);
  });
});

describe('fs helpers', () => {
  it('reads the code of system errors only', () => {
    expect(errnoCode(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe('EPERM');
    expect(errnoCode(Object.assign(new Error('x'), { code: 42 }))).toBeUndefined();
    expect(errnoCode(new Error('x'))).toBeUndefined();
    expect(errnoCode('EPERM')).toBeUndefined();
    expect(errnoCode(null)).toBeUndefined();
  });

  it('recognises a missing file or directory', async () => {
    const dir = await tempDir();
    expect(await readIfExists(nodeFs, join(dir, 'absent.json'))).toBeUndefined();
    expect(await listDir(nodeFs, join(dir, 'absent'))).toEqual([]);
    expect(isMissing(Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toBe(true);
    expect(isMissing(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
  });

  it('rejects for other read errors', async () => {
    const dir = await tempDir();
    // Reading a directory as a file is EISDIR, not a miss.
    await expect(readIfExists(nodeFs, dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('removes trees and tolerates missing paths', async () => {
    const dir = await tempDir();
    await nodeFs.mkdir(join(dir, 'a', 'b'));
    await nodeFs.writeFile(join(dir, 'a', 'b', 'file.txt'), 'x');
    await nodeFs.rm(join(dir, 'a'));
    await nodeFs.rm(join(dir, 'a'));
    expect(await listDir(nodeFs, dir)).toEqual([]);
    await rm(dir, { recursive: true });
  });
});

describe('codec', () => {
  it('round-trips text through gzip', async () => {
    const text = 'Größe 地図 '.repeat(1000);
    const compressed = await gzipText(text);
    expect(compressed.length).toBeLessThan(Buffer.byteLength(text) / 5);
    expect((await gunzipBytes(compressed)).toString('utf8')).toBe(text);
  });

  it('rejects damaged data', async () => {
    const compressed = await gzipText('some text that is long enough to have a checksum');
    compressed[compressed.length - 5]! ^= 0xff;
    await expect(gunzipBytes(compressed)).rejects.toThrow();
  });

  it('runs tasks of one key in order and of different keys independently', async () => {
    const lock = createKeyedLock();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = lock.run('a', async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('a1');
    });
    const second = lock.run('a', async () => {
      order.push('a2');
    });
    await lock.run('b', async () => {
      order.push('b1');
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });

  it('keeps running after a task fails and reports the failure to its caller only', async () => {
    const lock = createKeyedLock();
    const failed = lock.run('a', async () => {
      throw new Error('first failed');
    });
    const next = lock.run('a', async () => 'second ran');
    await expect(failed).rejects.toThrow('first failed');
    expect(await next).toBe('second ran');
  });
});
