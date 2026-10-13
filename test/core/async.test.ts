import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeadlineExceededError,
  budgetExhausted,
  consumeBudget,
  newBudget,
  singleFlight,
  withDeadline,
} from '../../src/core/async.js';
import { FakeClock, SECOND } from '../support/fake-clock.js';

function deferred<V>(): {
  promise: Promise<V>;
  resolve: (v: V) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: V) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('shares one in-flight call per key', async () => {
    const flights = singleFlight<string, number>();
    const gate = deferred<number>();
    const work = vi.fn(() => gate.promise);

    const first = flights.run('a', work);
    const second = flights.run('a', work);
    expect(second).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);
    expect(flights.has('a')).toBe(true);
    expect(flights.size()).toBe(1);

    gate.resolve(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
    expect(flights.has('a')).toBe(false);
    expect(flights.size()).toBe(0);
  });

  it('runs different keys independently', async () => {
    const flights = singleFlight<string, string>();
    const results = await Promise.all([
      flights.run('a', async () => 'A'),
      flights.run('b', async () => 'B'),
    ]);
    expect(results).toEqual(['A', 'B']);
  });

  it('starts fresh after the previous call settled', async () => {
    const flights = singleFlight<string, number>();
    let calls = 0;
    const work = async (): Promise<number> => ++calls;
    expect(await flights.run('a', work)).toBe(1);
    expect(await flights.run('a', work)).toBe(2);
  });

  it('does not remember a failure', async () => {
    const flights = singleFlight<string, number>();
    const failing = flights.run('a', async () => {
      throw new Error('boom');
    });
    const sharing = flights.run('a', async () => 1);
    await expect(failing).rejects.toThrow('boom');
    await expect(sharing).rejects.toThrow('boom');
    expect(flights.has('a')).toBe(false);
    await expect(flights.run('a', async () => 7)).resolves.toBe(7);
  });

  it('turns a synchronous throw into a rejection', async () => {
    const flights = singleFlight<string, number>();
    const run = flights.run('a', () => {
      throw new Error('sync boom');
    });
    await expect(run).rejects.toThrow('sync boom');
    expect(flights.size()).toBe(0);
  });
});

describe('withDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the work is on time', async () => {
    vi.useFakeTimers();
    const result = withDeadline(Promise.resolve('done'), 1000);
    await expect(result).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a rejection through unchanged and clears the timer', async () => {
    vi.useFakeTimers();
    const failure = new Error('upstream');
    await expect(withDeadline(Promise.reject(failure), 1000)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with DeadlineExceededError when the time runs out', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const result = withDeadline(gate.promise, 250);
    const assertion = expect(result).rejects.toBeInstanceOf(DeadlineExceededError);
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    await expect(result).rejects.toMatchObject({ ms: 250, name: 'DeadlineExceededError' });
  });

  it('lets the work finish in the background without an unhandled rejection', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const gate = deferred<string>();
      let finished = false;
      const work = gate.promise.finally(() => {
        finished = true;
      });
      const result = withDeadline(work, 100);
      const assertion = expect(result).rejects.toBeInstanceOf(DeadlineExceededError);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;

      gate.reject(new Error('late failure'));
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(finished).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('request budget', () => {
  it('starts unused with a deadline relative to the clock', () => {
    const clock = new FakeClock();
    expect(newBudget(12, 25 * SECOND, clock)).toEqual({
      maxRequests: 12,
      used: 0,
      deadline: clock.now() + 25_000,
    });
  });

  it('counts requests and refuses beyond the maximum', () => {
    const clock = new FakeClock();
    const budget = newBudget(2, 10 * SECOND, clock);
    expect(consumeBudget(budget, clock)).toBe(true);
    expect(consumeBudget(budget, clock)).toBe(true);
    expect(budgetExhausted(budget, clock)).toBe(true);
    expect(consumeBudget(budget, clock)).toBe(false);
    expect(budget.used).toBe(2);
  });

  it('refuses once the deadline has passed, leaving the count unchanged', () => {
    const clock = new FakeClock();
    const budget = newBudget(5, 10 * SECOND, clock);
    clock.advance(10 * SECOND - 1);
    expect(budgetExhausted(budget, clock)).toBe(false);
    expect(consumeBudget(budget, clock)).toBe(true);
    clock.advance(1);
    expect(budgetExhausted(budget, clock)).toBe(true);
    expect(consumeBudget(budget, clock)).toBe(false);
    expect(budget.used).toBe(1);
  });
});
