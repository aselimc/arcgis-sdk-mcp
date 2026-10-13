/**
 * The gateway's error vocabulary. Every failure that leaves `src/net` is a `McpDocError`
 * carrying `details.url` and `details.host` (the table on `HttpClient.get`).
 */
import { McpDocError, isMcpDocError, toMcpDocError, type ErrorDetails } from '../core/errors.js';

/** Host of a URL for error details; the input itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function where(url: string): Pick<ErrorDetails, 'url' | 'host'> {
  return { url, host: hostOf(url) };
}

/** `DOC_NOT_FOUND`: the server has no such document (404, 410, soft 404, wrong body shape). */
export function notFound(url: string, why: string): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', `${url} does not exist`, { why, ...where(url) });
}

/** `UPSTREAM_BLOCKED`: the server refused us. Never retried and never worked around. */
export function blocked(url: string, status: number): McpDocError {
  return new McpDocError('UPSTREAM_BLOCKED', `${hostOf(url)} refused the request`, {
    why: `The server answered ${status}`,
    ...where(url),
    retryable: false,
  });
}

/**
 * `UPSTREAM_BLOCKED` without a request: the host asked for a pause (a `Retry-After` on a
 * refusal, or a quota it reported as spent) and that pause is still running. Sending anyway
 * is what gets a client banned, so the answer is given here.
 *
 * @param until `Clock.now()` value at which the pause ends.
 */
export function paused(url: string, until: number): McpDocError {
  const host = hostOf(url);
  return new McpDocError('UPSTREAM_BLOCKED', `${host} refused the request`, {
    why: `${host} asked for no further requests until ${new Date(until).toISOString()}, so none was sent`,
    ...where(url),
    retryable: false,
  });
}

/**
 * `UPSTREAM_UNAVAILABLE` for a failure of the host. `retryable` separates transient
 * conditions (5xx, timeout, open breaker), for which a stale copy may answer instead, from
 * permanent ones (oversized body, unexpected protocol behaviour), for which it may not.
 *
 * A request this server gave up on by its own decision is {@link declined}, not this.
 */
export function unavailable(url: string, why: string, retryable = true): McpDocError {
  const host = hostOf(url);
  const what = retryable ? `${host} is not responding` : `${host} sent an unusable response`;
  return new McpDocError('UPSTREAM_UNAVAILABLE', what, { why, ...where(url), retryable });
}

/**
 * Why the gateway gave up on a request by its own decision, with nothing learned about the
 * host:
 *
 * - `budget`: the caller's request count is used up or its deadline has passed (also when
 *   the deadline cut a request short that was already on its way);
 * - `pacing`: the politeness limits of the host leave no start time before the caller's
 *   deadline, although the budget itself is not spent;
 * - `cancelled`: the caller aborted its signal.
 */
export type Declined = 'budget' | 'pacing' | 'cancelled';

/**
 * Error details as the gateway fills them. `declined` tells "we did not ask" from "the host
 * failed", which the code and `retryable` cannot: both are a retryable
 * `UPSTREAM_UNAVAILABLE`. A caller that drops a failed input and carries on must not do so
 * for a declined request, or it presents part of a source as the whole.
 */
export interface GatewayErrorDetails extends ErrorDetails {
  declined?: Declined;
}

const DECLINED: Readonly<Record<Declined, { what: string; why: string; next?: string }>> = {
  budget: {
    what: 'No answer from {host} within the request budget',
    why: 'The request budget of this call (a number of requests and a deadline) is spent',
    next: 'Repeat the call: what it has read so far is cached, so the next one gets further',
  },
  pacing: {
    what: 'The request to {host} was not sent',
    why: 'Requests to {host} are spaced out, and the next one may only start after the deadline of this call',
    next: 'Repeat the call after a short wait',
  },
  cancelled: { what: 'The request to {host} was cancelled', why: 'cancelled by the caller' },
};

/**
 * `UPSTREAM_UNAVAILABLE` (`retryable: true`, so a stale copy may answer) for a request the
 * gateway gave up on itself. The message does not blame the host, and `details.declined`
 * names the reason.
 */
export function declined(url: string, reason: Declined): McpDocError {
  const host = hostOf(url);
  const { what, why, next } = DECLINED[reason];
  const details: GatewayErrorDetails = {
    why: why.replace('{host}', host),
    ...(next === undefined ? {} : { next }),
    ...where(url),
    retryable: true,
    declined: reason,
  };
  return new McpDocError('UPSTREAM_UNAVAILABLE', what.replace('{host}', host), details);
}

/** Why the gateway declined the request behind `error`; `undefined` for any other failure. */
export function declinedBy(error: unknown): Declined | undefined {
  if (!isMcpDocError(error)) return undefined;
  const details: GatewayErrorDetails | undefined = error.details;
  return details?.declined;
}

/** `OFFLINE_MISS`: offline mode and nothing usable in the cache. */
export function offlineMiss(url: string): McpDocError {
  return new McpDocError('OFFLINE_MISS', `${url} is not in the cache`, {
    why: 'Offline mode is on, so nothing is fetched',
    next: 'Unset ARCGIS_DOCS_OFFLINE to fetch it',
    ...where(url),
  });
}

/** `HOST_NOT_ALLOWED`: a URL the gateway refuses whatever the policy says. */
export function refused(url: string, why: string): McpDocError {
  return new McpDocError('HOST_NOT_ALLOWED', `${hostOf(url)} cannot be read`, {
    why,
    ...where(url),
  });
}

/**
 * Makes sure an error thrown by a collaborator (policy, cache, an unexpected bug) leaves the
 * gateway as a `McpDocError` that names the URL. `why` replaces the cause only when given.
 */
export function located(error: unknown, url: string, why?: string): McpDocError {
  const base = toMcpDocError(error);
  const located = new McpDocError(base.code, base.message, {
    ...base.details,
    ...where(url),
    ...(why === undefined ? {} : { why }),
  });
  located.cause = isMcpDocError(error) ? error.cause : error;
  return located;
}

/** True for the transient `UPSTREAM_UNAVAILABLE` that a stale copy may stand in for. */
export function staleMayAnswer(error: unknown): boolean {
  return (
    isMcpDocError(error) &&
    error.code === 'UPSTREAM_UNAVAILABLE' &&
    error.details?.retryable === true
  );
}
