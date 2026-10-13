import { describe, expect, it } from 'vitest';
import type { TtlClass } from '../../src/core/types.js';
import {
  REMOTE_SEARCH_EMPTY_TTL_MS,
  STALE_IF_ERROR_MS,
  TTL_CLASSES,
  TTL_MS,
  freshness,
  freshnessAt,
  staleIfErrorMs,
} from '../../src/cache/ttl.js';
import { DAY, FAKE_NOW, HOUR } from '../support/fake-clock.js';

/** The TTL table of design section 6.2, written out. */
const TABLE: Array<[ttl: TtlClass, fresh: number, staleAfterFetch: number]> = [
  ['immutable', 365 * DAY, 365 * DAY],
  ['page', DAY, 30 * DAY],
  ['index', DAY, 30 * DAY],
  ['volatile', 6 * HOUR, 30 * DAY],
  ['github-meta', 7 * DAY, 30 * DAY],
  ['spec', 7 * DAY, 30 * DAY],
  ['remote-search', DAY, DAY],
  ['negative', HOUR, HOUR],
];

describe('TTL table', () => {
  it('covers every class', () => {
    expect(TABLE.map(([ttl]) => ttl).sort()).toEqual([...TTL_CLASSES].sort());
  });

  it.each(TABLE)('%s', (ttl, fresh, staleAfterFetch) => {
    expect(TTL_MS[ttl]).toBe(fresh);
    expect(freshness(ttl, FAKE_NOW)).toEqual({
      freshUntil: FAKE_NOW + fresh,
      staleUntil: FAKE_NOW + staleAfterFetch,
    });
  });

  it('keeps a stale-if-error window of 30 days for everything but remote search and misses', () => {
    expect(STALE_IF_ERROR_MS).toBe(30 * DAY);
    for (const ttl of TTL_CLASSES) {
      const never = ttl === 'remote-search' || ttl === 'negative';
      expect(staleIfErrorMs(ttl)).toBe(never ? 0 : 30 * DAY);
    }
  });

  it('never ends the stale window before the fresh one', () => {
    for (const ttl of TTL_CLASSES) {
      const window = freshness(ttl, FAKE_NOW);
      expect(window.staleUntil).toBeGreaterThanOrEqual(window.freshUntil);
    }
  });

  it('asks an empty remote search again after one hour', () => {
    expect(REMOTE_SEARCH_EMPTY_TTL_MS).toBe(HOUR);
    expect(freshness('remote-search', FAKE_NOW, { empty: true })).toEqual({
      freshUntil: FAKE_NOW + HOUR,
      staleUntil: FAKE_NOW + HOUR,
    });
    // The flag means nothing for other classes.
    expect(freshness('page', FAKE_NOW, { empty: true })).toEqual(freshness('page', FAKE_NOW));
  });
});

describe('freshnessAt', () => {
  const window = freshness('page', FAKE_NOW);

  it.each([
    [0, 'fresh'],
    [DAY - 1, 'fresh'],
    [DAY, 'stale'],
    [30 * DAY - 1, 'stale'],
    [30 * DAY, 'expired'],
    [400 * DAY, 'expired'],
  ] as const)('a page %d ms after the fetch is %s', (age, expected) => {
    expect(freshnessAt(window, FAKE_NOW + age)).toBe(expected);
  });

  it('never calls a remote search result stale', () => {
    const search = freshness('remote-search', FAKE_NOW);
    expect(freshnessAt(search, FAKE_NOW + DAY - 1)).toBe('fresh');
    expect(freshnessAt(search, FAKE_NOW + DAY)).toBe('expired');
  });
});
