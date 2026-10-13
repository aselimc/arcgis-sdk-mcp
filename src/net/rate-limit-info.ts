/**
 * Quota headers seen by the gateway, made available to the GitHub client.
 *
 * `HttpResponse` and `McpDocError` carry no response headers, and the GitHub client receives
 * the gateway only as the `HttpClient` port. Both live in this package, so the gateway
 * publishes what it saw under its own object identity and the GitHub client asks for it.
 * A client that is not this gateway (a test fake) simply has nothing published.
 */
import type { HttpClient } from '../core/ports.js';

/** The latest quota facts of one host. Times are `Clock.now()` values. */
export interface RateLimitSnapshot {
  /** `x-ratelimit-remaining`. */
  remaining?: number;
  /** `x-ratelimit-reset`, converted to milliseconds. */
  resetAt?: number;
  /** End of the pause a `Retry-After` header asked for on a 403 / 429. */
  retryAfterUntil?: number;
}

type Reader = (host: string) => RateLimitSnapshot | undefined;

const published = new WeakMap<object, Reader>();

/** Called once by the gateway: makes its per-host snapshots readable through `client`. */
export function publishRateLimits(client: HttpClient, read: Reader): void {
  published.set(client, read);
}

/** The snapshot `client` holds for `host`; `undefined` when it has none or publishes none. */
export function rateLimitOf(client: HttpClient, host: string): RateLimitSnapshot | undefined {
  return published.get(client)?.(host);
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
