/**
 * Per-host rules compiled once from the host table (design section 4.7): allowed paths,
 * GitHub owners, request methods and static robots denials. Pure functions over a URL.
 */
import type { HostPolicy } from '../core/types.js';
import { denyingPattern, robotsTarget, type RobotsRules } from './robots-matcher.js';

/** Request methods the gateway can issue. */
export type Method = 'GET' | 'POST';

/** A host row with its patterns compiled. */
export interface CompiledHost {
  policy: HostPolicy;
  allowPaths: RegExp[] | undefined;
  /** Lower-cased; GitHub treats owner names case-insensitively. */
  githubOwners: Set<string> | undefined;
  robots: RobotsRules;
}

/**
 * Compiles one host row.
 *
 * @throws SyntaxError when an `allowPaths` entry is not a valid regular expression: a broken
 *   registry row must fail at start-up, not allow or deny silently.
 */
export function compileHost(policy: HostPolicy): CompiledHost {
  return {
    policy,
    allowPaths: policy.allowPaths?.map((source) => new RegExp(source)),
    githubOwners:
      policy.githubOwners === undefined
        ? undefined
        : new Set(policy.githubOwners.map((owner) => owner.toLowerCase())),
    robots: { allow: [], disallow: policy.robotsDisallow },
  };
}

/**
 * The owner segment of a GitHub URL path, whatever the host:
 * `/repos/<owner>/<repo>/...` (API), `/wiki/<owner>/<repo>/<page>` (raw wiki) or
 * `/<owner>/<repo>/<ref>/<path>` (raw content).
 */
function githubOwner(pathname: string): string | undefined {
  const [first, second] = pathname.split('/').filter((segment) => segment.length > 0);
  const owner = first === 'repos' || first === 'wiki' ? second : first;
  return owner?.toLowerCase();
}

/**
 * Why a path is outside what the host row allows, or `undefined` when it is inside.
 *
 * Encoded slashes and backslashes are refused on restricted hosts: a server that decodes
 * them would read a different path from the one the patterns approved.
 */
export function pathViolation(host: CompiledHost, url: URL): string | undefined {
  const restricted = host.allowPaths !== undefined || host.githubOwners !== undefined;
  if (!restricted) return undefined;

  if (/%2f|%5c|\\/i.test(url.pathname)) {
    return `Encoded path separators are not accepted on ${host.policy.host}`;
  }
  if (host.allowPaths !== undefined && !host.allowPaths.some((re) => re.test(url.pathname))) {
    return `Only selected paths of ${host.policy.host} are read, and ${url.pathname} is not one of them`;
  }
  if (host.githubOwners !== undefined) {
    const owner = githubOwner(url.pathname);
    if (owner === undefined || !host.githubOwners.has(owner)) {
      return `Only repositories of ${(host.policy.githubOwners ?? []).join(', ')} are read`;
    }
  }
  return undefined;
}

/**
 * Why a method is refused on a host, or `undefined` when it is accepted. A host is used
 * with the one method its policy names (`GET` unless it says otherwise) and no other.
 */
export function methodViolation(host: CompiledHost, method: Method): string | undefined {
  const accepted = host.policy.method ?? 'GET';
  if (method === accepted) return undefined;
  return accepted === 'POST'
    ? `${host.policy.host} accepts POST requests only`
    : `${host.policy.host} is read with GET requests only`;
}

/** The static robots pattern that excludes the URL, or `undefined`. */
export function robotsViolation(host: CompiledHost, url: URL): string | undefined {
  return denyingPattern(host.robots, robotsTarget(url));
}
