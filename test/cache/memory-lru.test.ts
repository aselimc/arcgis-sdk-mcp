import { describe, expect, it } from 'vitest';
import { createMemoryLru } from '../../src/cache/memory-lru.js';

const sized =
  <V>(value: V, bytes: number, calls?: { count: number }) =>
  async () => {
    if (calls !== undefined) calls.count += 1;
    return { value, bytes };
  };

describe('createMemoryLru', () => {
  it('computes once per key and remembers the value', async () => {
    const lru = createMemoryLru(1000);
    const calls = { count: 0 };
    const value = { index: [1, 2, 3] };
    expect(await lru.memo('a', sized(value, 100, calls))).toBe(value);
    expect(await lru.memo('a', sized({ index: [] }, 100, calls))).toBe(value);
    expect(calls.count).toBe(1);
    expect(lru.stats()).toEqual({ bytes: 100, entries: 1 });
  });

  it('shares one computation between concurrent callers', async () => {
    const lru = createMemoryLru(1000);
    let release: (value: { value: string; bytes: number }) => void = () => undefined;
    let started = 0;
    const compute = () => {
      started += 1;
      return new Promise<{ value: string; bytes: number }>((resolve) => {
        release = resolve;
      });
    };
    const first = lru.memo('a', compute);
    const second = lru.memo('a', compute);
    release({ value: 'done', bytes: 4 });
    expect(await Promise.all([first, second])).toEqual(['done', 'done']);
    expect(started).toBe(1);
  });

  it('does not remember a rejected computation', async () => {
    const lru = createMemoryLru(1000);
    await expect(
      lru.memo('a', async () => {
        throw new Error('index build failed');
      }),
    ).rejects.toThrow('index build failed');
    expect(await lru.memo('a', sized('second try', 10))).toBe('second try');
    expect(lru.stats().entries).toBe(1);
  });

  it('turns a synchronous throw of the computation into a rejection', async () => {
    const lru = createMemoryLru(1000);
    const broken = (() => {
      throw new Error('sync');
    }) as unknown as () => Promise<{ value: string; bytes: number }>;
    await expect(lru.memo('a', broken)).rejects.toThrow('sync');
  });

  it('drops the least recently used values to stay under the byte budget', async () => {
    const lru = createMemoryLru(300);
    await lru.memo('a', sized('A', 100));
    await lru.memo('b', sized('B', 100));
    await lru.memo('c', sized('C', 100));
    // Reading `a` makes `b` the least recently used.
    await lru.memo('a', sized('never', 100));
    await lru.memo('d', sized('D', 100));

    const calls = { count: 0 };
    expect(await lru.memo('a', sized('recomputed', 100, calls))).toBe('A');
    expect(await lru.memo('c', sized('recomputed', 100, calls))).toBe('C');
    expect(await lru.memo('d', sized('recomputed', 100, calls))).toBe('D');
    expect(calls.count).toBe(0);
    expect(lru.stats()).toEqual({ bytes: 300, entries: 3 });
    expect(await lru.memo('b', sized('recomputed', 100, calls))).toBe('recomputed');
    expect(calls.count).toBe(1);
  });

  it('returns a value larger than the whole budget without keeping it', async () => {
    const lru = createMemoryLru(100);
    await lru.memo('small', sized('S', 50));
    const calls = { count: 0 };
    expect(await lru.memo('huge', sized('H', 101, calls))).toBe('H');
    expect(await lru.memo('huge', sized('H', 101, calls))).toBe('H');
    expect(calls.count).toBe(2);
    expect(lru.stats()).toEqual({ bytes: 50, entries: 1 });
  });

  it('remembers undefined and null', async () => {
    const lru = createMemoryLru(100);
    const calls = { count: 0 };
    expect(await lru.memo('u', sized(undefined, 1, calls))).toBeUndefined();
    expect(await lru.memo('u', sized(undefined, 1, calls))).toBeUndefined();
    expect(await lru.memo('n', sized(null, 1, calls))).toBeNull();
    expect(await lru.memo('n', sized(null, 1, calls))).toBeNull();
    expect(calls.count).toBe(2);
  });

  it('counts fractional and zero sizes as at least one byte', async () => {
    const lru = createMemoryLru(100);
    await lru.memo('zero', sized('z', 0));
    await lru.memo('fraction', sized('f', 2.2));
    expect(lru.stats()).toEqual({ bytes: 4, entries: 2 });
  });

  it('forgets everything on clear', async () => {
    const lru = createMemoryLru(1000);
    await lru.memo('a', sized('A', 10));
    lru.clear();
    expect(lru.stats()).toEqual({ bytes: 0, entries: 0 });
    expect(await lru.memo('a', sized('again', 10))).toBe('again');
  });

  it('does not let a computation that started before clear repopulate the memo', async () => {
    const lru = createMemoryLru(1000);
    let release: (value: { value: string; bytes: number }) => void = () => undefined;
    const pending = lru.memo(
      'a',
      () =>
        new Promise<{ value: string; bytes: number }>((resolve) => {
          release = resolve;
        }),
    );
    lru.clear();
    const fresh = lru.memo('a', sized('after clear', 10));
    release({ value: 'before clear', bytes: 10 });
    expect(await pending).toBe('before clear');
    expect(await fresh).toBe('after clear');
    expect(await lru.memo('a', sized('unused', 10))).toBe('after clear');
    expect(lru.stats().entries).toBe(1);
  });

  it('accepts a budget below one byte', async () => {
    const lru = createMemoryLru(0);
    expect(await lru.memo('a', sized('A', 1))).toBe('A');
    expect(lru.stats().entries).toBe(1);
  });
});
