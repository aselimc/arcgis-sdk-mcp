import { describe, expect, it } from 'vitest';
import { BREAKER_DEFAULTS, CircuitBreakers } from '../../src/net/circuit-breaker.js';
import { GLOBAL_CONCURRENCY, createRateLimiter } from '../../src/net/rate-limiter.js';
import {
  MAX_RETRY_AFTER_MS,
  RETRY_DELAYS_MS,
  parseRetryAfter,
  retryDelay,
} from '../../src/net/retry.js';
import { FakeClock, MINUTE, SECOND } from '../support/fake-clock.js';

describe('CircuitBreakers', () => {
  it('uses the design values by default', () => {
    expect(BREAKER_DEFAULTS).toEqual({ threshold: 5, windowMs: 60_000, openMs: 300_000 });
  });

  it('walks closed, open, half-open, closed', () => {
    const clock = new FakeClock();
    const breakers = new CircuitBreakers(clock, { threshold: 2 });
    expect(breakers.state('h')).toBe('closed');
    expect(breakers.states()).toEqual([]);

    expect(breakers.allow('h')).toBe(true);
    breakers.failure('h', 'timeout');
    breakers.failure('h', 'HTTP 502');
    expect(breakers.state('h')).toBe('open');
    expect(breakers.allow('h')).toBe(false);

    clock.advance(5 * MINUTE);
    expect(breakers.state('h')).toBe('half-open');
    expect(breakers.allow('h')).toBe(true);
    // Only one probe at a time.
    expect(breakers.allow('h')).toBe(false);
    breakers.success('h');
    expect(breakers.state('h')).toBe('closed');
    expect(breakers.allow('h')).toBe(true);
    expect(breakers.states()).toEqual([{ host: 'h', breaker: 'closed', lastError: 'HTTP 502' }]);
  });

  it('lets another probe through after an abandoned one', () => {
    const clock = new FakeClock();
    const breakers = new CircuitBreakers(clock, { threshold: 1, openMs: SECOND });
    breakers.failure('h', 'network');
    clock.advance(SECOND);
    expect(breakers.allow('h')).toBe(true);
    breakers.abandon('h');
    expect(breakers.state('h')).toBe('half-open');
    expect(breakers.allow('h')).toBe(true);
  });

  it('starts counting afresh after a success', () => {
    const breakers = new CircuitBreakers(new FakeClock(), { threshold: 3 });
    breakers.failure('h', 'a');
    breakers.failure('h', 'b');
    breakers.success('h');
    breakers.failure('h', 'c');
    breakers.failure('h', 'd');
    expect(breakers.state('h')).toBe('closed');
  });
});

describe('createRateLimiter', () => {
  function make(globalConcurrent?: number) {
    const clock = new FakeClock();
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
      ...(globalConcurrent === undefined ? {} : { globalConcurrent }),
    });
    return { clock, sleeps, limiter };
  }

  it('allows a burst of one second of requests, then spaces them', async () => {
    const { limiter, sleeps } = make();
    const limits = { ratePerSec: 2, maxConcurrent: 5 };
    for (let n = 0; n < 5; n += 1) (await limiter.acquire('h', limits))?.();
    expect(sleeps).toEqual([500, 500, 500]);
  });

  it('refills tokens while idle, up to the burst', async () => {
    const { limiter, sleeps, clock } = make();
    const limits = { ratePerSec: 2, maxConcurrent: 5 };
    for (let n = 0; n < 2; n += 1) (await limiter.acquire('h', limits))?.();
    clock.advance(10 * SECOND);
    for (let n = 0; n < 3; n += 1) (await limiter.acquire('h', limits))?.();
    expect(sleeps).toEqual([500]);
  });

  it('handles rates below one request per second', async () => {
    const { limiter, sleeps } = make();
    const limits = { ratePerSec: 0.5, maxConcurrent: 1 };
    for (let n = 0; n < 3; n += 1) (await limiter.acquire('h', limits))?.();
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('queues concurrent callers behind each other instead of sharing one token', async () => {
    const { limiter, clock } = make();
    const limits = { ratePerSec: 1, maxConcurrent: 3 };
    const startedAt = clock.now();
    const releases = await Promise.all([1, 2, 3].map(() => limiter.acquire('h', limits)));
    expect(releases.every((release) => release !== undefined)).toBe(true);
    // Starts at 0 s, 1 s and 2 s: the third caller had to wait for the second one's token.
    expect(clock.now() - startedAt).toBe(2000);
  });

  it('refuses, holding nothing, when the start would pass the deadline', async () => {
    const { limiter, clock, sleeps } = make();
    const limits = { ratePerSec: 1, maxConcurrent: 1, minIntervalMs: 10_000 };
    (await limiter.acquire('h', limits))?.();

    expect(await limiter.acquire('h', limits, { deadline: clock.now() + 5000 })).toBeUndefined();
    expect(sleeps).toEqual([]);
    // The refused request reserved nothing: the next one waits one interval, not two.
    (await limiter.acquire('h', limits, { deadline: clock.now() + 60_000 }))?.();
    expect(sleeps).toEqual([10_000]);
  });

  it('hands a freed slot to the next waiter, per host and globally', async () => {
    const { limiter } = make(2);
    const fast = { ratePerSec: 1000, maxConcurrent: 1 };
    expect(GLOBAL_CONCURRENCY).toBe(4);

    const first = await limiter.acquire('a', fast);
    let secondHeld = false;
    const second = limiter.acquire('a', fast).then((release) => {
      secondHeld = true;
      return release;
    });
    await Promise.resolve();
    expect(secondHeld).toBe(false);
    first?.();
    // Releasing twice must not free a second slot.
    first?.();
    const secondRelease = await second;
    expect(secondHeld).toBe(true);

    const other = await limiter.acquire('b', fast);
    let thirdHeld = false;
    const third = limiter.acquire('c', fast).then((release) => {
      thirdHeld = true;
      return release;
    });
    await Promise.resolve();
    // Two requests are in flight (hosts a and b): the global limit of two holds host c back.
    expect(thirdHeld).toBe(false);
    secondRelease?.();
    (await third)?.();
    other?.();
    expect(thirdHeld).toBe(true);
  });
});

describe('retry timing', () => {
  const now = Date.UTC(2026, 9, 13, 12);
  const mid = () => 0.5;

  it('has two retries', () => {
    expect(RETRY_DELAYS_MS).toEqual([500, 1500]);
    expect(retryDelay({ attempt: 0, now, random: mid })).toBe(500);
    expect(retryDelay({ attempt: 1, now, random: mid })).toBe(1500);
    expect(retryDelay({ attempt: 2, now, random: mid })).toBeUndefined();
  });

  it('keeps jitter within twenty percent', () => {
    expect(retryDelay({ attempt: 1, now, random: () => 0 })).toBe(1200);
    expect(retryDelay({ attempt: 1, now, random: () => 1 })).toBe(1800);
  });

  it('takes Retry-After as a lower bound', () => {
    expect(retryDelay({ attempt: 0, retryAfterMs: 4000, now, random: mid })).toBe(4000);
    expect(retryDelay({ attempt: 1, retryAfterMs: 100, now, random: mid })).toBe(1500);
  });

  it('gives up when the wait would end at or after the deadline', () => {
    expect(retryDelay({ attempt: 0, now, deadline: now + 501, random: mid })).toBe(500);
    expect(retryDelay({ attempt: 0, now, deadline: now + 500, random: mid })).toBeUndefined();
    expect(
      retryDelay({ attempt: 0, retryAfterMs: 30_000, now, deadline: now + 25_000, random: mid }),
    ).toBeUndefined();
  });

  it('caps Retry-After when there is no deadline', () => {
    expect(retryDelay({ attempt: 0, retryAfterMs: MAX_RETRY_AFTER_MS, now, random: mid })).toBe(
      MAX_RETRY_AFTER_MS,
    );
    expect(
      retryDelay({ attempt: 0, retryAfterMs: MAX_RETRY_AFTER_MS + 1, now, random: mid }),
    ).toBeUndefined();
  });

  it.each<[string | null, number | undefined]>([
    [null, undefined],
    ['120', 120_000],
    [' 0 ', 0],
    ['Tue, 13 Oct 2026 12:00:30 GMT', 30_000],
    ['Tue, 13 Oct 2026 11:00:00 GMT', 0],
    ['soon', undefined],
    ['-5', undefined],
  ])('parses Retry-After %j', (header, expected) => {
    expect(parseRetryAfter(header, now)).toBe(expected);
  });
});
