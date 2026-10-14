/**
 * One hop of the gateway pipeline: request budget, circuit breaker,
 * rate limiter, the fetch itself and the retries of a transient failure. Redirects, caching
 * and body validation are the caller's business (`http-client.ts`).
 */
import { budgetExhausted, consumeBudget } from '../core/async.js';
import type { Clock, Logger, RequestBudget } from '../core/ports.js';
import type { HostPolicy } from '../core/types.js';
import type { CircuitBreakers } from './circuit-breaker.js';
import { blocked, declined, paused, unavailable } from './errors.js';
import { TransportError, send, type TransportResponse } from './fetch-transport.js';
import { readRateLimit, type HostQuotas } from './rate-limit-info.js';
import type { RateLimiter } from './rate-limiter.js';
import { parseRetryAfter, retryDelay } from './retry.js';

/** Timeout of one attempt when neither the request nor the host names one. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Statuses that mean "you may not have this": reported, never retried, never worked around. */
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 407, 429, 451]);

/** One request to one host, after policy and cache have had their say. */
export interface Hop {
  url: URL;
  host: HostPolicy;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | undefined;
  maxBytes: number;
  timeoutMs?: number | undefined;
  budget?: RequestBudget | undefined;
  signal?: AbortSignal | undefined;
}

/** Collaborators of {@link createExchange}. */
export interface ExchangeDeps {
  fetchImpl: typeof fetch;
  clock: Clock;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  breakers: CircuitBreakers;
  limiter: RateLimiter;
  /** Receives the quota headers of every response, and says when a host asked for a pause. */
  quotas: HostQuotas;
}

/** Sends a hop and resolves with any response that is neither a refusal nor a server error. */
export type Exchange = (hop: Hop) => Promise<TransportResponse>;

/**
 * Builds the {@link Exchange} function.
 *
 * It rejects with `UPSTREAM_BLOCKED` for a refusal (also the local one while a pause the host
 * asked for is running) and `UPSTREAM_UNAVAILABLE` for everything else: `retryable: true`
 * when the breaker is open, the host kept failing through the retries, or the gateway gave up
 * itself (`declined` in `errors.ts`: budget, pacing, cancellation); `retryable: false` for an
 * oversized body.
 *
 * Only what the host did counts towards its circuit breaker. A request that was cancelled,
 * that found no start time, or that the caller's deadline cut short says nothing about the
 * host and is abandoned instead.
 */
export function createExchange(deps: ExchangeDeps): Exchange {
  const { clock, breakers, limiter, logger } = deps;

  /** Sends once. Resolves with a response or the transient failure that may be retried. */
  async function attempt(
    hop: Hop,
  ): Promise<TransportResponse | { transient: string; retryAfterMs?: number }> {
    const url = hop.url.href;
    const host = hop.host.host;
    const deadline = hop.budget?.deadline;
    // Asked afresh each time: the caller can cancel during any of the waits below.
    const cancelled = (): boolean => hop.signal?.aborted === true;
    if (cancelled()) throw declined(url, 'cancelled');
    if (hop.budget !== undefined && budgetExhausted(hop.budget, clock)) {
      throw declined(url, 'budget');
    }
    const pausedUntil = deps.quotas.pausedUntil(host);
    if (pausedUntil !== undefined) throw paused(url, pausedUntil);
    if (!breakers.allow(host)) throw unavailable(url, `circuit open for ${host}`);

    const release = await limiter.acquire(host, hop.host, { deadline, signal: hop.signal });
    if (release === undefined) {
      breakers.abandon(host);
      if (cancelled()) throw declined(url, 'cancelled');
      // Still inside the budget: the host's pacing, not the budget, kept the request back.
      const spent = hop.budget !== undefined && budgetExhausted(hop.budget, clock);
      throw declined(url, spent ? 'budget' : 'pacing');
    }
    // Counted only now: the budget is for requests that reach the network.
    if (hop.budget !== undefined && !consumeBudget(hop.budget, clock)) {
      release();
      breakers.abandon(host);
      throw declined(url, 'budget');
    }

    const wanted = hop.timeoutMs ?? hop.host.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const left = deadline === undefined ? Number.POSITIVE_INFINITY : deadline - clock.now();
    // A timeout shorter than the host is normally given is the caller's deadline, not the
    // host's failure to answer in time.
    const cutShort = left < wanted;
    const timeoutMs = Math.min(wanted, left);
    const startedAt = clock.now();
    let response: TransportResponse;
    try {
      response = await send(deps.fetchImpl, {
        url,
        method: hop.method,
        headers: hop.headers,
        body: hop.body,
        timeoutMs: Math.max(1, timeoutMs),
        maxBytes: hop.maxBytes,
        signal: hop.signal,
      });
    } catch (error) {
      const failure =
        error instanceof TransportError ? error : new TransportError('network', String(error));
      logger.debug('http failure', { url, kind: failure.kind });
      if (failure.kind === 'aborted') {
        breakers.abandon(host);
        throw declined(url, 'cancelled');
      }
      if (failure.kind === 'timeout' && cutShort) {
        breakers.abandon(host);
        throw declined(url, 'budget');
      }
      if (failure.kind === 'oversized') {
        // The host answered; the document is simply too large to be one of ours.
        breakers.success(host);
        throw unavailable(url, `The body exceeds the size cap of ${hop.maxBytes} bytes`, false);
      }
      breakers.failure(host, failure.kind);
      return { transient: failure.message };
    } finally {
      release();
    }

    const { status, headers } = response;
    logger.debug('http', { url, status, ms: clock.now() - startedAt });
    const retryAfterMs = parseRetryAfter(headers.get('retry-after'), clock.now());
    const refusedByHost = REFUSALS.has(status);
    const quota = readRateLimit(headers, clock.now(), refusedByHost ? retryAfterMs : undefined);
    if (quota !== undefined) deps.quotas.record(host, quota);

    if (refusedByHost) {
      breakers.failure(host, `HTTP ${status}`);
      throw blocked(url, status);
    }
    if (status >= 500) {
      breakers.failure(host, `HTTP ${status}`);
      return retryAfterMs === undefined
        ? { transient: `HTTP ${status}` }
        : { transient: `HTTP ${status}`, retryAfterMs };
    }
    breakers.success(host);
    return response;
  }

  return async (hop) => {
    for (let n = 0; ; n += 1) {
      const outcome = await attempt(hop);
      if (!('transient' in outcome)) return outcome;

      const failure = unavailable(hop.url.href, outcome.transient);
      // A POST is not repeated here: the gateway cannot know that it is safe to send twice.
      if (hop.method === 'POST') throw failure;
      const delay = retryDelay({
        attempt: n,
        retryAfterMs: outcome.retryAfterMs,
        now: clock.now(),
        deadline: hop.budget?.deadline,
        random: deps.random,
      });
      if (delay === undefined) throw failure;
      await deps.sleep(delay);
    }
  };
}
