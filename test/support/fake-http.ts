import { consumeBudget } from '../../src/core/async.js';
import { McpDocError } from '../../src/core/errors.js';
import type {
  Clock,
  HttpClient,
  HttpRequest,
  HttpResponse,
  RateLimitSnapshot,
} from '../../src/core/ports.js';
import type { CacheState } from '../../src/core/types.js';
import {
  DEFAULT_CONTENT_TYPE,
  HTML_CATCH_ALL,
  UnrecordedRequestError,
  bodyMatches,
  hostOf,
  matches,
  normalise,
  type Cassette,
  type InjectedFault,
  type Matcher,
  type RecordedResponse,
  type Responder,
  type Route,
  type SeenRequest,
  type Fault,
} from './cassette.js';
import { FakeClock } from './fake-clock.js';

// Re-exported so that a test needs one import for the fake and the data it is fed.
export { UnrecordedRequestError };
export type { Cassette, Fault, Interaction, RecordedResponse, SeenRequest } from './cassette.js';

/**
 * A replay {@link HttpClient}: answers from recorded interactions, fails loudly on anything
 * unrecorded, and can inject the failures of the real gateway. No network, no timers.
 *
 * Like the real client it validates the body against `expect`, enforces an explicit
 * `maxBytes`, counts every non-cached request against `req.budget`, and throws only
 * `McpDocError` for upstream conditions. For `encoding: 'base64'` record the body already
 * base64-encoded; it is returned as written.
 */
export class FakeHttp implements HttpClient {
  /** Every request, in order, including failed and unrecorded ones. */
  readonly requests: SeenRequest[] = [];
  /** `METHOD url` of every request that had no recording. Assert it is empty. */
  readonly unrecorded: string[] = [];

  private readonly routes: Route[] = [];
  private readonly faults: InjectedFault[] = [];
  private readonly quotas = new Map<string, RateLimitSnapshot>();
  private readonly breakers = new Map<
    string,
    { breaker: 'closed' | 'open' | 'half-open'; lastError?: string }
  >();
  private readonly clock: Clock;

  constructor(options: { cassette?: Cassette; clock?: Clock } = {}) {
    this.clock = options.clock ?? new FakeClock();
    for (const interaction of options.cassette?.interactions ?? []) {
      this.on(interaction.url, interaction.response, interaction.method ?? 'GET');
    }
  }

  /**
   * Records a response for a URL (exact match, fragment ignored) or a pattern. Calling it
   * again for the same matcher and method queues a further response; the last one repeats.
   * A function responder computes the response from the request.
   */
  on(matcher: Matcher, response: Responder, method: 'GET' | 'POST' = 'GET'): this {
    const key = String(matcher);
    const existing = this.routes.find(
      (route) => route.method === method && String(route.matcher) === key,
    );
    if (existing !== undefined) existing.responders.push(response);
    else this.routes.push({ method, matcher, responders: [response], served: 0 });
    return this;
  }

  /**
   * Injects a fault for matching requests.
   *
   * @param options.times how many requests fail before the recording answers again (default: all).
   * @param options.stale for transient faults: serve the recording with `cache: 'stale'`, as
   *   the gateway does when it holds an expired copy.
   */
  fail(matcher: Matcher, fault: Fault, options: { times?: number; stale?: boolean } = {}): this {
    this.faults.push({
      matcher,
      fault,
      remaining: options.times ?? Number.POSITIVE_INFINITY,
      stale: options.stale ?? false,
    });
    return this;
  }

  /** Removes every injected fault. */
  heal(): this {
    this.faults.length = 0;
    return this;
  }

  /** Sets what `hostStates()` reports for a host. */
  setBreaker(host: string, breaker: 'closed' | 'open' | 'half-open', lastError?: string): this {
    this.breakers.set(host, lastError === undefined ? { breaker } : { breaker, lastError });
    return this;
  }

  /** Number of requests seen, optionally only those matching a URL or pattern. */
  count(matcher?: Matcher): number {
    if (matcher === undefined) return this.requests.length;
    return this.requests.filter((request) => matches(matcher, request.url)).length;
  }

  /** Distinct hosts contacted, in first-contact order. */
  hosts(): string[] {
    return [...new Set(this.requests.map((request) => hostOf(request.url)))];
  }

  /** Forgets the request log (recordings and faults stay). */
  resetLog(): void {
    this.requests.length = 0;
    this.unrecorded.length = 0;
  }

  async get(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method ?? 'GET';
    const url = normalise(req.url);
    this.requests.push({
      method,
      url,
      expect: req.expect,
      ...(req.encoding === 'base64' ? { encoding: req.encoding } : {}),
      ...(req.body === undefined ? {} : { body: req.body }),
      ...(req.headers === undefined ? {} : { headers: req.headers }),
      ...(req.revalidate === true ? { revalidate: true as const } : {}),
    });
    const host = hostOf(url);
    if (!this.breakers.has(host)) this.breakers.set(host, { breaker: 'closed' });

    const route = this.routes.find(
      (candidate) => candidate.method === method && matches(candidate.matcher, url),
    );
    const fault = this.takeFault(url);
    // A failed request must not use up a queued response: the retry should still see it.
    const recorded =
      route === undefined ? undefined : this.responseOf(route, req, fault === undefined);

    if (
      recorded?.cache !== 'hit' &&
      req.budget !== undefined &&
      !consumeBudget(req.budget, this.clock)
    ) {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', `No answer from ${host} within the request budget`, {
        why: 'The request budget of this call (a number of requests and a deadline) is spent',
        url,
        host,
        retryable: true,
        declined: 'budget',
      });
    }

    if (fault !== undefined) return this.applyFault(fault, req, url, host, recorded);

    if (recorded === undefined) {
      this.unrecorded.push(`${method} ${url}`);
      throw new UnrecordedRequestError(method, url);
    }
    const status = recorded.status ?? 200;
    if (status !== 200) {
      return this.applyFault({ fault: status as Fault, stale: false }, req, url, host, undefined);
    }
    return this.respond(req, url, recorded, recorded.cache ?? 'miss');
  }

  async getJson<J = unknown>(
    req: Omit<HttpRequest, 'expect'>,
  ): Promise<{ data: J; res: HttpResponse }> {
    const res = await this.get({ ...req, expect: 'json' });
    try {
      return { data: JSON.parse(res.text) as J, res };
    } catch {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', `${hostOf(res.url)} returned invalid JSON`, {
        why: 'The response body could not be parsed',
        url: res.url,
        host: hostOf(res.url),
        retryable: true,
      });
    }
  }

  hostStates(): Array<{
    host: string;
    breaker: 'closed' | 'open' | 'half-open';
    lastError?: string;
  }> {
    return [...this.breakers].map(([host, state]) => ({ host, ...state }));
  }

  /** Sets what `rateLimit(host)` reports, as a quota-reporting gateway would. */
  quota(host: string, snapshot: RateLimitSnapshot | undefined): this {
    if (snapshot === undefined) this.quotas.delete(host);
    else this.quotas.set(host, snapshot);
    return this;
  }

  rateLimit(host: string): RateLimitSnapshot | undefined {
    return this.quotas.get(host);
  }

  private responseOf(route: Route, req: HttpRequest, advance: boolean): RecordedResponse {
    const index = Math.min(route.served, route.responders.length - 1);
    if (advance) route.served += 1;
    const responder = route.responders[index];
    if (responder === undefined) throw new Error('route without responders');
    return typeof responder === 'function' ? responder(req) : responder;
  }

  private takeFault(url: string): Pick<InjectedFault, 'fault' | 'stale'> | undefined {
    const fault = this.faults.find(
      (candidate) => candidate.remaining > 0 && matches(candidate.matcher, url),
    );
    if (fault === undefined) return undefined;
    fault.remaining -= 1;
    return fault;
  }

  private applyFault(
    injected: Pick<InjectedFault, 'fault' | 'stale'>,
    req: HttpRequest,
    url: string,
    host: string,
    recorded: RecordedResponse | undefined,
  ): HttpResponse {
    const { fault } = injected;
    const body =
      recorded?.body ?? (recorded?.json === undefined ? '' : JSON.stringify(recorded.json));
    switch (fault) {
      case 304:
        if (recorded === undefined) throw new UnrecordedRequestError(req.method ?? 'GET', url);
        return this.respond(req, url, recorded, 'revalidated');
      case 404:
      case 410:
        throw new McpDocError('DOC_NOT_FOUND', `${url} does not exist`, {
          why: `The server answered ${fault}`,
          url,
          host,
        });
      case 403:
      case 429:
        this.breakers.set(host, { breaker: 'closed', lastError: `HTTP ${fault}` });
        throw new McpDocError('UPSTREAM_BLOCKED', `${host} refused the request`, {
          why: `The server answered ${fault}`,
          url,
          host,
          retryable: false,
        });
      case 'html':
        return this.respond(
          req,
          url,
          { body: HTML_CATCH_ALL, contentType: DEFAULT_CONTENT_TYPE.html },
          'miss',
        );
      case 'truncated':
        return this.respond(
          req,
          url,
          { ...recorded, body: body.slice(0, Math.floor(body.length / 2)), json: undefined },
          'miss',
        );
      case 'empty':
        return this.respond(req, url, { ...recorded, body: '', json: undefined }, 'miss');
      case 'oversized':
        throw tooLarge(url, host);
      default: {
        const reason = typeof fault === 'number' ? `HTTP ${fault}` : fault;
        this.breakers.set(host, {
          breaker: this.breakers.get(host)?.breaker ?? 'closed',
          lastError: reason,
        });
        if (injected.stale && recorded !== undefined)
          return this.respond(req, url, recorded, 'stale');
        throw new McpDocError('UPSTREAM_UNAVAILABLE', `${host} is not responding`, {
          why: reason,
          url,
          host,
          retryable: true,
        });
      }
    }
  }

  private respond(
    req: HttpRequest,
    url: string,
    recorded: RecordedResponse,
    cache: CacheState,
  ): HttpResponse {
    const raw = recorded.body ?? (recorded.json === undefined ? '' : JSON.stringify(recorded.json));
    const text = raw.replace(/^\uFEFF/, '');
    if (req.maxBytes !== undefined && Buffer.byteLength(text, 'utf8') > req.maxBytes) {
      throw tooLarge(url, hostOf(url));
    }
    if (!bodyMatches(req.expect, text)) {
      // HTML where JSON or XML was expected is how catch-all hosts answer a missing file.
      throw new McpDocError('DOC_NOT_FOUND', `${url} did not return ${req.expect}`, {
        why: 'The response had a different content type or shape than expected',
        url,
        host: hostOf(url),
      });
    }
    return {
      url,
      finalUrl: recorded.finalUrl ?? url,
      status: 200,
      contentType: recorded.contentType ?? DEFAULT_CONTENT_TYPE[req.expect],
      text,
      ...(recorded.etag === undefined ? {} : { etag: recorded.etag }),
      ...(recorded.lastModified === undefined ? {} : { lastModified: recorded.lastModified }),
      fetchedAt: this.clock.iso(),
      cache,
      aliasChain: recorded.aliasChain ?? [],
    };
  }
}

/** The gateway's answer to a body over the size cap: no retry would make it smaller. */
function tooLarge(url: string, host: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${host} sent a response over the size limit`, {
    why: 'The body exceeds the size cap for this kind of file',
    url,
    host,
    retryable: false,
  });
}
