/**
 * Small concurrency primitives: single-flight de-duplication, deadlines and the per-call
 * request budget.
 */
import type { Clock, RequestBudget } from './ports.js';

/** De-duplicates concurrent work by key. */
export interface SingleFlight<K, V> {
  /**
   * Runs `fn` unless a call with the same key is already in flight, in which case its
   * promise is shared. The key is released when the promise settles, so a failure is not
   * remembered and the next call starts fresh.
   */
  run(key: K, fn: () => Promise<V>): Promise<V>;
  /** True while a call with this key is in flight. */
  has(key: K): boolean;
  /** Number of calls in flight. */
  size(): number;
}

/** Creates an empty {@link SingleFlight} group. */
export function singleFlight<K, V>(): SingleFlight<K, V> {
  const inFlight = new Map<K, Promise<V>>();
  return {
    run(key, fn) {
      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;
      // The async wrapper turns a synchronous throw from fn into a rejection.
      const started = (async () => fn())().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
    has: (key) => inFlight.has(key),
    size: () => inFlight.size,
  };
}

/** Rejection value of {@link withDeadline} when the time runs out. */
export class DeadlineExceededError extends Error {
  override readonly name = 'DeadlineExceededError';

  constructor(readonly ms: number) {
    super(`Deadline of ${ms} ms exceeded`);
  }
}

/**
 * Settles like `promise`, or rejects with {@link DeadlineExceededError} after `ms`.
 *
 * The underlying work is **not** cancelled: it keeps running and its eventual result or
 * failure is ignored here (index builds rely on this to finish in the background). A late
 * rejection never becomes an unhandled rejection.
 */
export function withDeadline<V>(promise: Promise<V>, ms: number): Promise<V> {
  return new Promise<V>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DeadlineExceededError(ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        // The rejection reason is passed through untouched; it is the caller's error to type.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      },
    );
  });
}

/** A fresh budget of `maxRequests` upstream requests that expires `deadlineMs` from now. */
export function newBudget(maxRequests: number, deadlineMs: number, clock: Clock): RequestBudget {
  return { maxRequests, used: 0, deadline: clock.now() + deadlineMs };
}

/** True when no further request may be issued: the count is spent or the deadline has passed. */
export function budgetExhausted(budget: RequestBudget, clock: Clock): boolean {
  return budget.used >= budget.maxRequests || clock.now() >= budget.deadline;
}

/**
 * Takes one request from the budget.
 *
 * @returns `false`, leaving the budget unchanged, when it is exhausted. The HTTP client
 *   calls this once per request that would reach the network (cache hits are free).
 */
export function consumeBudget(budget: RequestBudget, clock: Clock): boolean {
  if (budgetExhausted(budget, clock)) return false;
  budget.used += 1;
  return true;
}
