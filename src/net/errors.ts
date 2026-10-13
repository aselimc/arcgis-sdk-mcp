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
 * `UPSTREAM_UNAVAILABLE`. `retryable` separates transient conditions (5xx, timeout, open
 * breaker, spent budget), for which a stale copy may answer instead, from permanent ones
 * (oversized body, unexpected protocol behaviour), for which it may not.
 */
export function unavailable(url: string, why: string, retryable = true): McpDocError {
  const host = hostOf(url);
  const what = retryable ? `${host} is not responding` : `${host} sent an unusable response`;
  return new McpDocError('UPSTREAM_UNAVAILABLE', what, { why, ...where(url), retryable });
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
