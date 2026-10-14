import type { HttpRequest } from '../../src/core/ports.js';
import type { CacheState } from '../../src/core/types.js';

/**
 * Recording types and matching rules of the HTTP fake. Tests import them from
 * `fake-http.ts`, which re-exports the public ones.
 */

/**
 * A fault to inject for a URL. Numbers are HTTP statuses; the outcome is what the real
 * gateway produces for that status after its own retries:
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
 * | `'oversized'` | `UPSTREAM_UNAVAILABLE`, not retryable: the body exceeded the size cap |
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
  | 'empty'
  | 'oversized';

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
  /** Present when the request asked for a base64 body. */
  encoding?: 'base64';
  body?: string;
  headers?: Record<string, string>;
  /** Present when the request asked to bypass a fresh cached copy. */
  revalidate?: true;
}

/** Selects requests: an exact URL (fragment ignored) or a pattern tested against the URL. */
export type Matcher = string | RegExp;

/** A fixed response, or a function computing one from the request. */
export type Responder = RecordedResponse | ((req: HttpRequest) => RecordedResponse);

/** The queued responses for one method and matcher, and how many have been served. */
export interface Route {
  method: 'GET' | 'POST';
  matcher: Matcher;
  responders: Responder[];
  served: number;
}

/** A fault waiting to be applied to matching requests `remaining` more times. */
export interface InjectedFault {
  matcher: Matcher;
  fault: Fault;
  remaining: number;
  stale: boolean;
}

/** What a catch-all host returns for a path that does not exist: a 200 HTML page. */
export const HTML_CATCH_ALL =
  '<!doctype html><html><head><title>Not found</title></head><body><main>Page not found</main></body></html>';

/** Content type reported when a recording does not state one. */
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

/** True when a normalised URL is selected by the matcher. */
export function matches(matcher: Matcher, url: string): boolean {
  if (typeof matcher === 'string') return normalise(matcher) === url;
  // A pattern with the `g` or `y` flag keeps state between calls; start every test afresh.
  matcher.lastIndex = 0;
  return matcher.test(url);
}

/** Host of a URL, or an empty string when the text is not a URL. */
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
