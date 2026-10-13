/**
 * Retry timing for transient upstream failures (design section 6.2): two retries after
 * 0.5 s and 1.5 s with jitter, a `Retry-After` header honoured when it fits the deadline.
 */

/** Base delay before each retry; its length is the number of retries. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1500];

/** Jitter applied to the base delay: plus or minus this fraction. */
export const JITTER = 0.2;

/**
 * Longest `Retry-After` honoured when the caller set no deadline. A server asking for more
 * is not going to answer within a tool call; the failure is reported instead.
 */
export const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Parses a `Retry-After` header: delay seconds or an HTTP date.
 *
 * @returns the delay in milliseconds from `now` (never negative), or `undefined` when the
 *   header is absent or malformed.
 */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Inputs of {@link retryDelay}. */
export interface RetryDecision {
  /** Zero-based number of the attempt that just failed. */
  attempt: number;
  /** Parsed `Retry-After` of the failed response, if any. */
  retryAfterMs?: number | undefined;
  now: number;
  /** `Clock.now()` value after which the caller no longer wants an answer. */
  deadline?: number | undefined;
  /** Uniform random number in [0, 1). */
  random: () => number;
}

/**
 * How long to wait before the next attempt.
 *
 * @returns `undefined` when there should be no further attempt: the retries are used up, or
 *   the wait (the server's `Retry-After` included) would end at or after the deadline.
 */
export function retryDelay(decision: RetryDecision): number | undefined {
  const base = RETRY_DELAYS_MS[decision.attempt];
  if (base === undefined) return undefined;
  const jittered = base * (1 - JITTER + 2 * JITTER * decision.random());
  // The server's own figure is a lower bound: retrying sooner than asked is impolite.
  const delay = Math.round(Math.max(jittered, decision.retryAfterMs ?? 0));
  if (decision.deadline === undefined) return delay > MAX_RETRY_AFTER_MS ? undefined : delay;
  return decision.now + delay >= decision.deadline ? undefined : delay;
}
