/**
 * Access rules of the HTTP transport, shared by the `node:http` server (`http.ts`) and the
 * web-standard endpoint (`http-fetch.ts`) that hosted deployments use:
 *
 * - an optional bearer token (`ARCGIS_DOCS_HTTP_TOKEN`), compared in constant time;
 * - fail closed: bound beyond loopback, or running on a hosting platform, the server does not
 *   serve at all without a token;
 * - the host names `Host` and `Origin` may carry.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SERVER_NAME } from '../core/names.js';
import { isLoopbackHost } from './args.js';

/** Host names that always name this machine, in the form the SDK's guards compare. */
export const LOOPBACK_NAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Realm of the `WWW-Authenticate` challenge. */
export const AUTH_REALM = SERVER_NAME;

/** True for an address that binds every interface, where no `Host` value can be expected. */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

/** An IPv6 literal in the bracketed form `Host` headers and URLs use. */
export const bracketed = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

/**
 * Why this server must not serve without a token, or `undefined` when it may (a loopback
 * bind on a machine that is not a hosting platform).
 *
 * @param host the bind address; `undefined` for a platform function, which has none and
 *   always needs a token.
 * @param platform the hosting platform detected from the environment.
 */
export function tokenRequirement(
  host: string | undefined,
  platform: string | undefined,
): string | undefined {
  if (platform !== undefined) return `it runs on ${platform}`;
  if (host === undefined) return 'it runs as a hosted function';
  if (host !== undefined && !isLoopbackHost(host)) return `--host ${host} is not a loopback address`;
  return undefined;
}

/** The message a server that refuses to start (or answer) without a token gives. */
export function missingTokenMessage(reason: string): string {
  return (
    `ARCGIS_DOCS_HTTP_TOKEN is not set and ${reason}. A server other machines can reach ` +
    'needs a bearer token: set ARCGIS_DOCS_HTTP_TOKEN to a random secret of at least 32 ' +
    'characters (for example the output of "openssl rand -hex 32") and send it as ' +
    '"Authorization: Bearer <token>"'
  );
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Outcome of checking an `Authorization` header. */
export type BearerCheck = 'ok' | 'missing' | 'invalid';

/**
 * Checks an `Authorization` header against the expected token.
 *
 * Both sides are hashed before `timingSafeEqual`, so the comparison takes the same time
 * whatever the length or content of the presented token, and the expected token's length
 * does not leak either. The scheme is case-insensitive (RFC 9110); the token is not.
 */
export function checkBearer(header: string | null | undefined, expected: string): BearerCheck {
  if (header === undefined || header === null || header.trim() === '') return 'missing';
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  // Hash a placeholder for a malformed header too, so it costs what a wrong token costs.
  const presented = match?.[1] ?? '';
  const equal = timingSafeEqual(digest(presented), digest(expected));
  return match !== null && equal ? 'ok' : 'invalid';
}

/** Status, headers and body of a refused request (RFC 6750 section 3). */
export interface Challenge {
  status: 401;
  headers: Record<string, string>;
  body: { error: string };
}

/** The 401 answer for a missing or wrong token. */
export function bearerChallenge(outcome: Exclude<BearerCheck, 'ok'>): Challenge {
  const challenge =
    outcome === 'missing'
      ? `Bearer realm="${AUTH_REALM}"`
      : `Bearer realm="${AUTH_REALM}", error="invalid_token"`;
  return {
    status: 401,
    headers: { 'www-authenticate': challenge },
    body: {
      error:
        outcome === 'missing'
          ? 'Unauthorized: send "Authorization: Bearer <token>" with the token of ARCGIS_DOCS_HTTP_TOKEN'
          : 'Unauthorized: the bearer token is not valid',
    },
  };
}

/**
 * Host names `Host` and `Origin` may carry, or `undefined` when they are not checked.
 *
 * - Loopback bind: loopback names plus the configured extra names.
 * - A named remote address: that name, loopback, and the extra names.
 * - A wildcard bind: the extra names plus loopback when any are configured; otherwise no
 *   check, because no `Host` value can be expected (the bearer token, required there, is
 *   what keeps a rebinding page out).
 * - No bind address (a platform function): the extra names, which on Vercel include the
 *   deployment's own host names.
 */
export function allowedHostnames(
  host: string | undefined,
  extra: readonly string[],
): string[] | undefined {
  if (host === undefined) return [...new Set([...extra, ...LOOPBACK_NAMES])];
  if (isLoopbackHost(host)) return [...new Set([...LOOPBACK_NAMES, ...extra])];
  if (isWildcardHost(host)) {
    return extra.length === 0 ? undefined : [...new Set([...extra, ...LOOPBACK_NAMES])];
  }
  return [...new Set([bracketed(host.toLowerCase()), ...LOOPBACK_NAMES, ...extra])];
}
