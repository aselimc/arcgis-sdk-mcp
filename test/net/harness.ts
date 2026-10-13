/**
 * Test harness of the gateway: a scripted origin behind an injected `fetch`, a fake clock that
 * `sleep` advances, an in-memory cache and a host table. Nothing here touches the network.
 */
import type { Config } from '../../src/core/config.js';
import { isMcpDocError, type McpDocError } from '../../src/core/errors.js';
import type { SourcePolicy } from '../../src/core/ports.js';
import type { Capability, HostPolicy } from '../../src/core/types.js';
import { createHttpClient } from '../../src/net/index.js';
import { makeConfig } from '../support/builders.js';
import { FakeClock } from '../support/fake-clock.js';
import { FakeLogger } from '../support/fake-logger.js';
import { fakePolicy, permissiveHost } from '../support/fake-policy.js';
import { MemoryCache } from '../support/memory-cache.js';

/** One request that reached the scripted origin. */
export interface OriginCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** What the origin answers: a response, a failure, or a function of the request. */
export type Reply = Response | Error | ((call: OriginCall) => Response | Error);

interface Route {
  matcher: string | RegExp;
  replies: Reply[];
  served: number;
}

/** A 200 page. */
export function page(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

/** A 200 JSON document. */
export function json(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A 200 body with an explicit content type. */
export function body(text: string | Uint8Array, contentType: string): Response {
  return new Response(text, { status: 200, headers: { 'content-type': contentType } });
}

/** A bodiless answer with a status and headers. */
export function status(code: number, headers: Record<string, string> = {}): Response {
  // The Response constructor refuses a body for these statuses, and wants null for them.
  return new Response(null, { status: code, headers });
}

/** A redirect to `location`. */
export function redirect(location: string, code = 301): Response {
  return status(code, { location });
}

/** The failure `fetch` reports when its timeout signal fires. */
export function timeoutError(): Error {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

/** The failure `fetch` reports for a refused or reset connection. */
export function networkError(): Error {
  return new TypeError('fetch failed');
}

/** A minimal page that is long enough not to look like a stub. */
export const PAGE =
  '<!doctype html><html><body><main><h1>Title</h1><p>Body text.</p></main></body></html>';

/**
 * A scripted origin. `on` queues replies for a URL or pattern (the last one repeats);
 * `robots.txt` answers 404 unless scripted with {@link FakeOrigin.robots}. `calls` lists
 * document requests in order; robots reads are kept apart in `robotsCalls`.
 */
export class FakeOrigin {
  readonly calls: OriginCall[] = [];
  readonly robotsCalls: string[] = [];
  /** `METHOD url` of requests no route matched; they fail as network errors. */
  readonly unrouted: string[] = [];

  private readonly routes: Route[] = [];
  private readonly robotsReplies = new Map<string, Reply>();

  on(matcher: string | RegExp, ...replies: Reply[]): this {
    const existing = this.routes.find((route) => String(route.matcher) === String(matcher));
    if (existing === undefined) this.routes.push({ matcher, replies: [...replies], served: 0 });
    else existing.replies.push(...replies);
    return this;
  }

  /** Scripts `https://<host>/robots.txt`: the file's text, or any reply. */
  robots(host: string, reply: string | Reply): this {
    this.robotsReplies.set(
      host,
      typeof reply === 'string' ? () => body(reply, 'text/plain') : reply,
    );
    return this;
  }

  /** URLs of the document requests, in order. */
  urls(): string[] {
    return this.calls.map((call) => call.url);
  }

  /** The injected `fetch`. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: OriginCall = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    };
    if (init?.redirect !== 'manual') throw new Error('the gateway must use redirect: manual');

    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      this.robotsCalls.push(url);
      return produce(this.robotsReplies.get(parsed.host) ?? (() => status(404)), call);
    }

    this.calls.push(call);
    const route = this.routes.find((candidate) =>
      typeof candidate.matcher === 'string'
        ? candidate.matcher === url
        : candidate.matcher.test(url),
    );
    if (route === undefined) {
      this.unrouted.push(`${call.method} ${url}`);
      throw networkError();
    }
    const reply = route.replies[Math.min(route.served, route.replies.length - 1)];
    route.served += 1;
    if (reply === undefined) throw new Error(`route ${String(route.matcher)} has no replies`);
    return produce(reply, call);
  };
}

function produce(reply: Reply, call: OriginCall): Response {
  const produced = typeof reply === 'function' ? reply(call) : reply;
  if (produced instanceof Error) throw produced;
  // A Response body can be read once; routes that repeat hand out a copy each time.
  return produced.clone();
}

/**
 * An origin that answers when the test says so. Every document request waits in `waiting`
 * until the test answers it, and is rejected with the reason of its signal when that fires
 * first, as the built-in `fetch` does. `robots.txt` answers 404 at once.
 */
export class GatedOrigin {
  /** Requests that have reached the origin and are not answered yet, oldest first. */
  readonly waiting: Array<{ url: string; answer: (reply: Response) => void }> = [];
  /** URL of every document request, in order. */
  readonly urls: string[] = [];

  /** The injected `fetch`. */
  readonly fetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname === '/robots.txt') return Promise.resolve(status(404));
    this.urls.push(url);
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      const entry = { url, answer: resolve };
      this.waiting.push(entry);
      signal?.addEventListener('abort', () => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        // The rejection reason is whatever the caller aborted with: that is the point.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(signal.reason);
      });
    });
  };

  /** Resolves once `count` requests are waiting at the origin. */
  async reached(count = 1): Promise<void> {
    while (this.waiting.length < count) await new Promise((resolve) => setImmediate(resolve));
  }

  /** Answers the oldest waiting request. */
  answer(reply: Response): void {
    const next = this.waiting.shift();
    if (next === undefined) throw new Error('no request is waiting at the origin');
    next.answer(reply);
  }
}

/** A host row for the test table: generous limits, ETag revalidation, capability `website`. */
export function hostRow(host: string, overrides: Partial<HostPolicy> = {}): HostPolicy {
  return { ...permissiveHost(host), ...overrides };
}

/** The stand-in for the HTML extractor's detector: `<meta http-equiv="refresh" content="0; url=X">`. */
export function detectMetaRefresh(html: string, baseUrl: string): string | undefined {
  const target = /<meta http-equiv="refresh" content="\d+;\s*url=([^"]+)"/i.exec(html)?.[1];
  return target === undefined ? undefined : new URL(target, baseUrl).href;
}

/** A meta-refresh stub page pointing at `target`. */
export function refreshStub(target: string): Response {
  return page(`<html><head><meta http-equiv="refresh" content="0; url=${target}"></head></html>`);
}

/** Everything a gateway test needs. */
export interface Rig {
  http: ReturnType<typeof createHttpClient>;
  origin: FakeOrigin;
  clock: FakeClock;
  cache: MemoryCache;
  logger: FakeLogger;
  policy: SourcePolicy & { checked: string[] };
  config: Config;
  /** Every wait the gateway asked for (rate pacing and retry back-off), in milliseconds. */
  sleeps: number[];
}

/** Options of {@link makeRig}. */
export interface RigOptions {
  /** Host table. Omitted: every https host is allowed under capability `website`. */
  hosts?: HostPolicy[];
  enabled?: Capability[];
  config?: Partial<Config>;
  cache?: MemoryCache;
  clock?: FakeClock;
  origin?: FakeOrigin;
  /** Jitter source; the default 0.5 gives the unjittered delays. */
  random?: () => number;
  /** Replaces the scripted origin's `fetch`, for tests that control when an answer arrives. */
  fetchImpl?: typeof fetch;
}

/** Builds a gateway over fakes. Waiting advances the fake clock instead of real time. */
export function makeRig(options: RigOptions = {}): Rig {
  const clock = options.clock ?? new FakeClock();
  const origin = options.origin ?? new FakeOrigin();
  const cache = options.cache ?? new MemoryCache();
  const logger = new FakeLogger();
  const config = makeConfig(options.config);
  const policy = fakePolicy({
    ...(options.hosts === undefined ? {} : { hosts: options.hosts }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
  const sleeps: number[] = [];
  const http = createHttpClient({
    config,
    logger,
    clock,
    cache,
    policy,
    detectMetaRefresh,
    fetchImpl: options.fetchImpl ?? origin.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    random: options.random ?? (() => 0.5),
  });
  return { http, origin, clock, cache, logger, policy, config, sleeps };
}

/** Awaits a rejection and returns the error, failing the test when the promise resolves. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

/**
 * Awaits a rejection and checks the gateway's error contract: a `McpDocError` that names the
 * URL and the host.
 */
export async function mcpError(promise: Promise<unknown>): Promise<McpDocError> {
  const error = await rejection(promise);
  if (!isMcpDocError(error)) throw new Error(`expected a McpDocError, got ${String(error)}`);
  if (error.details?.url === undefined || error.details.host === undefined) {
    throw new Error(`${error.code} carries no url/host: ${JSON.stringify(error.details)}`);
  }
  return error;
}
