/**
 * The three refusals of the source policy as `McpDocError`s. Every one carries `details.url`
 * and `details.host`, which the HTTP contract promises to callers. They are exported so that
 * the gateway's live robots check refuses with exactly the same error as the static one.
 */
import { formatCall } from '../core/budget.js';
import type { Config } from '../core/config.js';
import { McpDocError } from '../core/errors.js';
import { TOOLS } from '../core/names.js';
import type { Capability, HostPolicy } from '../core/types.js';
import { sourcesValue } from './presets.js';

/** Most documentation hosts listed as candidates of a `HOST_NOT_ALLOWED` error. */
const MAX_HOST_CANDIDATES = 12;

/** Words of the last path segments, as a search query that may find the page elsewhere. */
function queryFromUrl(url: URL): string {
  const words = url.pathname
    .split('/')
    .slice(-2)
    .join(' ')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/%[0-9a-f]{2}/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return words === '' ? url.hostname : words;
}

/**
 * `HOST_NOT_ALLOWED`: the URL is outside the allow-list (scheme, host, port, path or GitHub
 * owner). `candidates` name the documentation hosts; `next` is a search for the page.
 */
export function hostNotAllowed(url: URL, why: string, hosts: readonly HostPolicy[]): McpDocError {
  const documentationHosts = hosts
    .filter((host) => host.capability === 'website')
    .map((host) => host.host)
    .slice(0, MAX_HOST_CANDIDATES);
  return new McpDocError('HOST_NOT_ALLOWED', `${url.host} is not a documentation source`, {
    why,
    next: formatCall(TOOLS.search, { query: queryFromUrl(url) }),
    ...(documentationHosts.length > 0 ? { candidates: documentationHosts } : {}),
    url: url.href,
    host: url.host,
    retryable: false,
  });
}

/** `LINK_ONLY`: a known host or path that this server never fetches. */
export function linkOnly(url: URL, why: string): McpDocError {
  return new McpDocError('LINK_ONLY', `${url.href} is not fetched by this server`, {
    why,
    next: `Open ${url.href} in a browser, or search the current documentation with ${formatCall(
      TOOLS.search,
      { query: queryFromUrl(url) },
    )}`,
    url: url.href,
    host: url.host,
    retryable: false,
  });
}

/**
 * `LINK_ONLY` for a path that the host's robots rules exclude. Used for the static rules of
 * the host table and, by the gateway, for rules read from a live `robots.txt`.
 */
export function robotsDenied(url: URL, pattern: string): McpDocError {
  return linkOnly(url, `robots rules of ${url.host} exclude this path (Disallow: ${pattern})`);
}

/**
 * `SOURCE_DISABLED`: the host needs a capability that is switched off. `next` names the
 * exact `ARCGIS_DOCS_SOURCES` value that switches it on while keeping the current settings.
 */
export function sourceDisabled(
  url: URL,
  capability: Capability,
  config: Pick<Config, 'preset' | 'capabilities' | 'mode'>,
): McpDocError {
  return new McpDocError('SOURCE_DISABLED', `${url.host} needs capability "${capability}"`, {
    why: `Capability "${capability}" is switched off (preset ${config.preset})`,
    next: `Set ARCGIS_DOCS_SOURCES=${sourcesValue(config, capability)} and restart the server`,
    url: url.href,
    host: url.host,
    capability,
    retryable: false,
  });
}
