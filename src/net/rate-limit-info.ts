/**
 * Quota facts of upstream hosts: what the rate-limit headers of their responses said, the
 * pause that follows from them, and how the GitHub client reads them from the gateway.
 */
import type { Clock, HttpClient } from '../core/ports.js';

/** The latest quota facts of one host. Times are `Clock.now()` values. */
export interface RateLimitSnapshot {
  /** `x-ratelimit-remaining`. */
  remaining?: number;
  /** `x-ratelimit-reset`, converted to milliseconds. */
  resetAt?: number;
  /** End of the pause a `Retry-After` header asked for on a 403 / 429. */
  retryAfterUntil?: number;
}

/**
 * The part of the gateway that reports quota facts: a method next to `hostStates()` on the
 * object behind the `HttpClient` port. A client that wraps the gateway forwards it like any
 * other method; one that has no such method (a test fake) simply knows no quota.
 */
export interface QuotaSource {
  /** What `host` last said about its quota; `undefined` when it never said anything. */
  rateLimit(host: string): RateLimitSnapshot | undefined;
}

/** True when `http` can report quota facts. */
export function isQuotaSource(http: HttpClient): http is HttpClient & QuotaSource {
  return typeof (http as Partial<QuotaSource>).rateLimit === 'function';
}

/** The snapshot `http` holds for `host`; `undefined` when it has none or reports none. */
export function rateLimitOf(http: HttpClient, host: string): RateLimitSnapshot | undefined {
  return isQuotaSource(http) ? http.rateLimit(host) : undefined;
}

/** The quota facts of every host the gateway has heard from. */
export class HostQuotas {
  private readonly seen = new Map<string, RateLimitSnapshot>();

  constructor(private readonly clock: Clock) {}

  /** Merges the facts of one more response into what is known about `host`. */
  record(host: string, snapshot: RateLimitSnapshot): void {
    this.seen.set(host, { ...this.seen.get(host), ...snapshot });
  }

  /** What `host` last said, as it said it. */
  of(host: string): RateLimitSnapshot | undefined {
    return this.seen.get(host);
  }

  /**
   * The `Clock.now()` value before which `host` wants no further request: the end of a
   * `Retry-After` pause, or the reset time of a quota it reported as used up. `undefined`
   * when requests may be sent. A spent quota without a reset time sets no pause: there is no
   * telling when it ends, and the circuit breaker bounds the damage.
   */
  pausedUntil(host: string): number | undefined {
    const facts = this.seen.get(host);
    if (facts === undefined) return undefined;
    const spentUntil = facts.remaining === 0 ? (facts.resetAt ?? 0) : 0;
    const until = Math.max(facts.retryAfterUntil ?? 0, spentUntil);
    return until > this.clock.now() ? until : undefined;
  }
}

function nonNegativeInt(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

/**
 * Reads the quota headers of one response.
 *
 * @param retryAfterMs the parsed `Retry-After` of a refusal (403 / 429), if any.
 * @returns `undefined` when the response says nothing about quota.
 */
export function readRateLimit(
  headers: Headers,
  now: number,
  retryAfterMs?: number,
): RateLimitSnapshot | undefined {
  const remaining = nonNegativeInt(headers.get('x-ratelimit-remaining'));
  const resetSeconds = nonNegativeInt(headers.get('x-ratelimit-reset'));
  if (remaining === undefined && resetSeconds === undefined && retryAfterMs === undefined) {
    return undefined;
  }
  return {
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetSeconds === undefined ? {} : { resetAt: resetSeconds * 1000 }),
    ...(retryAfterMs === undefined ? {} : { retryAfterUntil: now + retryAfterMs }),
  };
}
