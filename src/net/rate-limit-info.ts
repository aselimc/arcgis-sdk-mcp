/**
 * Quota facts of upstream hosts: what the rate-limit headers of their responses said, the
 * pause that follows from them. The gateway reports them through `HttpClient.rateLimit`.
 */
import type { Clock, RateLimitSnapshot } from '../core/ports.js';

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
