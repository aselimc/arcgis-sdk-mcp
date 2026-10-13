import { describe, expect, it } from 'vitest';
import type { CachedHttpEntry } from '../../src/core/ports.js';
import { DAY, FAKE_NOW, FakeClock, HOUR, MINUTE, SECOND } from './fake-clock.js';
import { FakeLogger } from './fake-logger.js';
import { MemoryCache } from './memory-cache.js';
import { Prng, forSeeds } from './prng.js';

describe('FakeClock', () => {
  it('moves only when told to', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(FAKE_NOW);
    expect(clock.iso()).toBe('2026-10-13T12:00:00.000Z');
    expect(clock.today()).toBe('2026-10-13');
    expect(clock.advance(12 * HOUR)).toBe(FAKE_NOW + 12 * HOUR);
    expect(clock.today()).toBe('2026-10-14');
    clock.set('2027-01-01T00:00:00Z');
    expect(clock.today()).toBe('2027-01-01');
    clock.set(0);
    expect(clock.iso()).toBe('1970-01-01T00:00:00.000Z');
    expect(new FakeClock('2026-01-02T03:04:05Z').iso()).toBe('2026-01-02T03:04:05.000Z');
    expect([SECOND, MINUTE, HOUR, DAY]).toEqual([1000, 60_000, 3_600_000, 86_400_000]);
  });
});

describe('FakeLogger', () => {
  it('captures entries by level', () => {
    const logger = new FakeLogger();
    logger.debug('d');
    logger.info('i', { n: 1 });
    logger.warn('w');
    logger.error('e');
    expect(logger.messages()).toEqual(['d', 'i', 'w', 'e']);
    expect(logger.messages('warn')).toEqual(['w']);
    expect(logger.entries[1]).toEqual({ level: 'info', msg: 'i', fields: { n: 1 } });
    expect(logger.entries[0]).not.toHaveProperty('fields');
    logger.clear();
    expect(logger.entries).toEqual([]);
  });
});

describe('MemoryCache', () => {
  const entry: CachedHttpEntry = {
    url: 'https://h.example/a',
    finalUrl: 'https://h.example/a',
    aliasChain: [],
    status: 200,
    contentType: 'text/html',
    body: '<p>a</p>',
    fetchedAt: FAKE_NOW,
    freshUntil: FAKE_NOW + DAY,
    staleUntil: FAKE_NOW + 30 * DAY,
    ttl: 'page',
  };

  it('stores HTTP entries by value and patches them on touch', async () => {
    const cache = new MemoryCache();
    expect(await cache.getHttp('k')).toBeUndefined();
    await cache.putHttp('k', entry);
    const read = await cache.getHttp('k');
    expect(read).toEqual(entry);
    expect(read).not.toBe(entry);
    await cache.touchHttp('k', { freshUntil: 1, staleUntil: 2, etag: '"v2"' });
    expect(await cache.getHttp('k')).toMatchObject({
      freshUntil: 1,
      staleUntil: 2,
      etag: '"v2"',
      body: '<p>a</p>',
    });
    await cache.touchHttp('missing', { freshUntil: 1, staleUntil: 2 });
    expect(cache.httpKeys()).toEqual(['k']);
    expect(cache.reads.http).toBe(3);
    expect(cache.writes.http).toBe(2);
  });

  it('stores derived values per namespace as JSON', async () => {
    const cache = new MemoryCache();
    await cache.putDerived('catalog', 'k', { records: [1, 2], dropped: undefined });
    await cache.putDerived('symbols', 'k', 'other namespace');
    expect(await cache.getDerived('catalog', 'k')).toEqual({ records: [1, 2] });
    expect(await cache.getDerived('symbols', 'k')).toBe('other namespace');
    expect(await cache.getDerived('doc', 'k')).toBeUndefined();
    expect(cache.derivedKeys()).toEqual([
      ['catalog', 'k'],
      ['symbols', 'k'],
    ]);
    await cache.deleteDerived('catalog', 'k');
    expect(await cache.getDerived('catalog', 'k')).toBeUndefined();
    expect(cache.writes.derived).toBe(2);
    expect(cache.reads.derived).toBe(4);
  });

  it('memoises per key, shares in-flight work and forgets failures', async () => {
    const cache = new MemoryCache();
    let computes = 0;
    const compute = async () => ({ value: ++computes, bytes: 100 });
    const [a, b] = await Promise.all([cache.memo('k', compute), cache.memo('k', compute)]);
    expect([a, b]).toEqual([1, 1]);
    expect(await cache.memo('other', compute)).toBe(2);
    expect(cache.memoComputes).toBe(2);
    expect(cache.memoSize()).toBe(200);

    await expect(
      cache.memo('bad', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await cache.memo('bad', async () => ({ value: 'ok', bytes: 1 }))).toBe('ok');

    cache.evictMemo();
    expect(cache.memoSize()).toBe(0);
    expect(await cache.memo('k', compute)).toBe(3);
  });

  it('reports size and clears by scope', async () => {
    const cache = new MemoryCache();
    await cache.putHttp('h', entry);
    await cache.putDerived('misc', 'd', { a: 1 });
    await cache.memo('m', async () => ({ value: 1, bytes: 10 }));
    const info = await cache.info();
    expect(info.entries).toBe(2);
    expect(info.bytes).toBeGreaterThan(0);
    expect(info.dir).toBe('(memory)');

    await cache.clear('http');
    expect(cache.httpKeys()).toEqual([]);
    expect(cache.derivedKeys()).toHaveLength(1);
    expect(cache.memoSize()).toBe(10);
    await cache.putHttp('h', entry);
    await cache.clear('derived');
    expect(cache.httpKeys()).toEqual(['h']);
    expect(cache.derivedKeys()).toEqual([]);
    await cache.clear();
    expect((await cache.info()).entries).toBe(0);
    expect(cache.memoSize()).toBe(0);
  });
});

describe('Prng', () => {
  it('is deterministic per seed and stays in range', () => {
    const draw = (seed: number): number[] => {
      const rng = new Prng(seed);
      return Array.from({ length: 5 }, () => rng.int(1, 6));
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
    const rng = new Prng(1);
    for (let i = 0; i < 500; i++) {
      const float = rng.next();
      expect(float >= 0 && float < 1).toBe(true);
      const int = rng.int(-2, 2);
      expect(int >= -2 && int <= 2 && Number.isInteger(int)).toBe(true);
    }
    expect(rng.string(8, 'ab')).toMatch(/^[ab]{8}$/);
    expect(rng.words(3).split(' ')).toHaveLength(3);
    expect(['x', 'y']).toContain(rng.pick(['x', 'y']));
    expect(typeof rng.chance()).toBe('boolean');
    expect(() => rng.pick([])).toThrow(/non-empty/);
  });

  it('names the failing seed', () => {
    const seeds: number[] = [];
    forSeeds(3, (_rng, seed) => seeds.push(seed));
    expect(seeds).toEqual([1, 2, 3]);
    expect(() =>
      forSeeds(5, (_rng, seed) => {
        if (seed === 4) throw new Error('nope');
      }),
    ).toThrow('property failed for seed 4');
  });
});
