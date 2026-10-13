/**
 * The HTTP gateway (design section 6.2): the single place where this server talks to the
 * network. In order: URL guard and source policy, offline mode, single-flight, cache lookup,
 * then per hop live robots, request budget, circuit breaker, rate limiter and fetch, with
 * redirects and meta-refresh hops re-checked against the policy, body validation, negative
 * caching and stale-if-error.
 */
import { singleFlight } from '../core/async.js';
import { isMcpDocError } from '../core/errors.js';
import { PACKAGE_NAME } from '../core/names.js';
import type { CachedHttpEntry, HttpClient, HttpRequest, HttpResponse } from '../core/ports.js';
import type { HostPolicy } from '../core/types.js';
import { CircuitBreakers } from './circuit-breaker.js';
import { hostOf, located, notFound, refused, staleMayAnswer, unavailable } from './errors.js';
import { createExchange } from './exchange.js';
import {
  cacheKey,
  conditionalHeaders,
  defaultTtl,
  freshnessWindow,
  isFresh,
  isNegative,
} from './freshness.js';
import type { GatewayDeps } from './gateway-deps.js';
import { HttpCacheView, toResponse } from './http-cache.js';
import { publishRateLimits, type RateLimitSnapshot } from './rate-limit-info.js';
import { createRateLimiter } from './rate-limiter.js';
import { LiveRobots, createRobotsFetcher } from './robots-live.js';
import { parseTarget, resolveHop } from './url-guard.js';
import { acceptHeader, decodeBody, isSoftNotFound, shapeMismatch } from './validate.js';

/** Redirects and meta-refresh hops followed for one request. */
export const MAX_HOPS = 5;

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** A request after the guard and the policy have accepted it. */
interface Accepted {
  req: HttpRequest;
  method: 'GET' | 'POST';
  target: URL;
  host: HostPolicy;
  key: string;
}

/** Builds the gateway. `createHttpClient` in `index.ts` is the public factory. */
export function createGateway(deps: GatewayDeps): HttpClient {
  const { config, logger, clock, policy } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const userAgent = `${PACKAGE_NAME}/${config.version} (+${config.repoUrl})`;

  const store = new HttpCacheView(deps.cache, clock, logger);
  const flights = singleFlight<string, HttpResponse>();
  const breakers = new CircuitBreakers(clock);
  const limiter = createRateLimiter({ clock, sleep });
  const quotas = new Map<string, RateLimitSnapshot>();
  const exchange = createExchange({
    fetchImpl,
    clock,
    logger,
    sleep,
    random: deps.random ?? Math.random,
    breakers,
    limiter,
    onRateLimit: (host, seen) => quotas.set(host, { ...quotas.get(host), ...seen }),
  });
  const robots = new LiveRobots({
    cache: deps.cache,
    clock,
    logger,
    agentToken: PACKAGE_NAME,
    fetchRobots: createRobotsFetcher({ fetchImpl, limiter, userAgent }),
  });

  /** The policy's verdict on a URL; a refused redirect target says where it came from. */
  function check(url: URL, method: 'GET' | 'POST', cameFrom?: string): HostPolicy {
    try {
      return policy.check(url, method).host;
    } catch (error) {
      if (cameFrom === undefined || !isMcpDocError(error)) throw located(error, url.href);
      const reason = error.details?.why === undefined ? '' : `: ${error.details.why}`;
      throw located(error, url.href, `${cameFrom} redirects to ${url.host}${reason}`);
    }
  }

  /** Live robots apply to pages of documentation sites, not to API and registry endpoints. */
  async function robotsGate(host: HostPolicy, url: URL, method: 'GET' | 'POST'): Promise<void> {
    if (method !== 'GET' || host.capability !== 'website') return;
    const pattern = await robots.denial(host.host, url);
    if (pattern !== undefined) {
      throw refused(url.href, `robots.txt of ${host.host} disallows it (${pattern})`);
    }
  }

  /** Cache lookup, then the network. `stale` is the expired copy revalidation may confirm. */
  async function load(accepted: Accepted): Promise<HttpResponse> {
    const { key, target } = accepted;
    const cached = await store.read(key);
    if (cached !== undefined && isFresh(cached, clock.now())) {
      if (isNegative(cached)) throw notFound(target.href, cached.body);
      return toResponse(cached, 'hit');
    }
    const stale = cached !== undefined && !isNegative(cached) ? cached : undefined;
    try {
      return await fetchChain(accepted, stale);
    } catch (error) {
      if (stale === undefined || !staleMayAnswer(error)) throw error;
      logger.warn('serving stale copy', { url: target.href, why: String(error) });
      return toResponse(stale, 'stale');
    }
  }

  /** Follows the request through redirects and meta-refresh stubs to a validated body. */
  async function fetchChain(
    { req, method, target, host: firstHost, key }: Accepted,
    stale: CachedHttpEntry | undefined,
  ): Promise<HttpResponse> {
    const url = target.href;
    const ttl = req.ttl ?? defaultTtl(firstHost, target, req.expect);
    const callerHeaders = Object.fromEntries(
      Object.entries(req.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const maxBytes =
      req.maxBytes ??
      (req.expect === 'html' ? config.limits.pageMaxBytes : config.limits.indexMaxBytes);

    let current = target;
    let host = firstHost;
    const chain: string[] = [];

    /** Moves to a redirect or meta-refresh target after re-checking it. */
    const follow = async (rawTarget: string, how: string): Promise<void> => {
      if (method !== 'GET') throw unavailable(url, `Unexpected ${how} on a ${method}`, false);
      const next = resolveHop(rawTarget, current);
      if (next === undefined) throw await store.miss(key, url, `The ${how} target is not a URL`);
      if (next.href === url || next.href === current.href || chain.includes(next.href)) {
        throw await store.miss(key, url, `The ${how} leads back to ${next.href}`);
      }
      if (chain.length >= MAX_HOPS) {
        throw await store.miss(key, url, `More than ${MAX_HOPS} redirects`);
      }
      host = check(next, method, current.href);
      chain.push(current.href);
      current = next;
    };

    for (;;) {
      await robotsGate(host, current, method);
      const validators = current.href === stale?.finalUrl ? conditionalHeaders(host, stale) : {};
      const response = await exchange({
        url: current,
        host,
        method,
        headers: {
          accept: acceptHeader(req.expect),
          // The caller's headers (an API token, say) go to the host it addressed and no further.
          ...(current.host === target.host ? callerHeaders : {}),
          'user-agent': userAgent,
          ...validators,
        },
        body: req.body,
        maxBytes,
        timeoutMs: req.timeoutMs,
        budget: req.budget,
        signal: req.signal,
      });
      const { status, headers } = response;
      const etag = headers.get('etag') ?? undefined;
      const lastModified = headers.get('last-modified') ?? undefined;
      const validatorsSeen = {
        ...(etag === undefined ? {} : { etag }),
        ...(lastModified === undefined ? {} : { lastModified }),
      };

      if (status === 304) {
        if (stale === undefined || Object.keys(validators).length === 0) {
          throw unavailable(url, 'Unexpected 304 for an unconditional request', false);
        }
        const patch = { ...freshnessWindow(ttl, clock.now()), ...validatorsSeen };
        await store.touch(key, patch);
        return toResponse({ ...stale, ...patch }, 'revalidated');
      }
      if (REDIRECTS.has(status)) {
        const location = headers.get('location');
        if (location === null) throw unavailable(url, `HTTP ${status} without Location`, false);
        await follow(location, 'redirect');
        continue;
      }
      if (status >= 400 && status < 500) {
        // 404, 410 and the other client errors that mean "no such document here".
        throw await store.miss(key, url, `The server answered ${status}`);
      }
      if (status < 200 || status > 299) throw unavailable(url, `Unexpected HTTP ${status}`, false);

      const contentType = headers.get('content-type') ?? '';
      if (isSoftNotFound(host, response.body.byteLength)) {
        throw await store.miss(key, url, `${host.host} answered with its "not found" page`);
      }
      const mismatch = shapeMismatch(
        req.expect,
        contentType,
        response.body,
        host,
        current.pathname,
      );
      if (mismatch !== undefined) throw await store.miss(key, url, mismatch);

      const text = decodeBody(response.body, contentType, req.encoding);
      if (req.expect === 'html' && req.encoding !== 'base64') {
        const refresh = deps.detectMetaRefresh(text, current.href);
        if (refresh !== undefined) {
          await follow(refresh, 'meta refresh');
          continue;
        }
      }

      const now = clock.now();
      const entry: CachedHttpEntry = {
        url,
        finalUrl: current.href,
        aliasChain: chain,
        status: 200,
        contentType,
        body: text,
        ...validatorsSeen,
        fetchedAt: now,
        ...freshnessWindow(ttl, now),
        ttl,
      };
      await store.write(key, entry);
      return toResponse(entry, 'miss');
    }
  }

  async function get(req: HttpRequest): Promise<HttpResponse> {
    try {
      const target = parseTarget(req.url);
      const method = req.method ?? 'GET';
      const host = check(target, method);
      const key = cacheKey(method, target, req.body, req.encoding);
      if (config.offline) return await store.offline(key, target.href);
      // Concurrent identical requests share one flight, and with it the first caller's
      // budget and cancellation signal.
      return await flights.run(key, () => load({ req, method, target, host, key }));
    } catch (error) {
      throw isMcpDocError(error) && error.details?.url !== undefined
        ? error
        : located(error, req.url);
    }
  }

  const client: HttpClient = {
    get,
    async getJson<J = unknown>(req: Omit<HttpRequest, 'expect'>) {
      const res = await get({ ...req, expect: 'json' });
      try {
        return { data: JSON.parse(res.text) as J, res };
      } catch {
        // Expire the bad copy, or the retry this error invites would be answered from cache.
        const key = cacheKey(req.method ?? 'GET', parseTarget(req.url), req.body, req.encoding);
        await store.touch(key, { freshUntil: 0, staleUntil: 0 });
        const host = hostOf(res.finalUrl);
        throw unavailable(res.finalUrl, `${host} returned JSON that does not parse`);
      }
    },
    hostStates: () => breakers.states(),
  };
  publishRateLimits(client, (host) => quotas.get(host));
  return client;
}
