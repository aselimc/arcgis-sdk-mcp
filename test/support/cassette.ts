import type { HttpRequest } from '../../src/core/ports.js';
import type { CacheState } from '../../src/core/types.js';

/**
 * Recording types and matching rules of the HTTP fake. Tests import them from
 * `fake-http.ts`, which re-exports the public ones.
 */

/**
 * A fault to inject for a URL. Numbers are HTTP statuses; the outcome is what the real
 * gateway (design section 6.2) produces for that status after its own retries:
 *
 * | Fault | Outcome |
 * |---|---|
 * | `304` | the recorded response with `cache: 'revalidated'` |
 * | `404`, `410` | `DOC_NOT_FOUND` |
 * | `403`, `429` | `UPSTREAM_BLOCKED` |
 * | `408`, `500`, `502`, `503`, `504`, `'timeout'`, `'network'` | the recorded response with `cache: 'stale'` when `stale: true`, else `UPSTREAM_UNAVAILABLE` |
 * | `'html'` | an HTML catch-all page instead of the recording: `DOC_NOT_FOUND` unless HTML was expected |
 * | `'truncated'` | the first half of the recorded body |
 * | `'empty'` | an empty body |
 */
export type Fault =
  | 304
  | 403
  | 404
  | 408
  | 410
  | 429
  | 500
  | 502
  | 503
  | 504
  | 'timeout'
  | 'network'
  | 'html'
  | 'truncated'
  | 'empty';

/** A recorded response. `json` is a shorthand for a JSON `body`. */
export interface RecordedResponse {
  /** Default 200. A recorded non-200 status behaves like the fault of the same number. */
  status?: number;
  /** Default derived from the request's `expect`. */
  contentType?: string;
  body?: string;
  json?: unknown;
  /** Set when the recording stands for a redirected request. */
  finalUrl?: string;
  aliasChain?: string[];
  etag?: string;
  lastModified?: string;
  /** Default `miss`. `hit` responses do not consume the request budget. */
  cache?: CacheState;
}

/** One request and its response. Several interactions for the same request are served in order; the last repeats. */
export interface Interaction {
  method?: 'GET' | 'POST';
  url: string;
  response: RecordedResponse;
}

/** A set of recorded interactions, usually loaded from a JSON file with `loadCassette`. */
export interface Cassette {
  name?: string;
  interactions: Interaction[];
}

/** Thrown for a request with no recording. Deliberately not an `McpDocError`, so it cannot be mistaken for an upstream failure and swallowed by a fallback. */
export class UnrecordedRequestError extends Error {
  override readonly name = 'UnrecordedRequestError';

  constructor(
    readonly method: string,
    readonly url: string,
  ) {
    super(`No recorded response for ${method} ${url}`);
  }
}

/** One request seen by the fake. */
export interface SeenRequest {
  method: 'GET' | 'POST';
  url: string;
  expect: HttpRequest['expect'];
  body?: string;
  headers?: Record<string, string>;
}

export type Matcher = string | RegExp;
export type Responder = RecordedResponse | ((req: HttpRequest) => RecordedResponse);

export interface Route {
  method: 'GET' | 'POST';
  matcher: Matcher;
  responders: Responder[];
  served: number;
}

export interface InjectedFault {
  matcher: Matcher;
  fault: Fault;
  remaining: number;
  stale: boolean;
}

export const HTML_CATCH_ALL =
  '<!doctype html><html><head><title>Not found</title></head><body><main>Page not found</main></body></html>';

export const DEFAULT_CONTENT_TYPE: Record<HttpRequest['expect'], string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain; charset=utf-8',
  yaml: 'text/yaml',
};

/** URLs are compared without their fragment, which never reaches a server. */
export function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

export function matches(matcher: Matcher, url: string): boolean {
  return typeof matcher === 'string' ? normalise(matcher) === url : matcher.test(url);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function looksLikeHtml(body: string): boolean {
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(body);
}

/** The gateway's parse sniff: does the body have the shape the caller asked for? */
export function bodyMatches(expect: HttpRequest['expect'], body: string): boolean {
  const text = body.trimStart();
  switch (expect) {
    case 'json':
      return text.startsWith('{') || text.startsWith('[');
    case 'xml':
      return text.startsWith('<') && !looksLikeHtml(text);
    case 'html':
      return text.includes('<');
    case 'yaml':
    case 'text':
      return !looksLikeHtml(text);
  }
}
