import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import { createHttpClient } from '../../src/net/index.js';
import { DAY, HOUR, MINUTE, SECOND } from '../support/fake-clock.js';
import {
  PAGE,
  hostRow,
  json,
  makeRig,
  mcpError,
  page,
  redirect,
  refreshStub,
  status,
} from './harness.js';

const HOST = 'developers.arcgis.com';
const at = (path: string) => `https://${HOST}${path}`;

describe('gateway: circuit breaker', () => {
  /** Five refusals on five different URLs: each is one failure, none is retried. */
  async function openCircuit(rig: ReturnType<typeof makeRig>): Promise<void> {
    rig.origin.on(/\/blocked\//, status(403));
    for (let n = 0; n < 5; n += 1) {
      await mcpError(rig.http.get({ url: at(`/blocked/${n}`), expect: 'html' }));
    }
  }

  it('opens after five failures in a minute and stops contacting the host', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(at('/fine/'), page(PAGE));
    await openCircuit(rig);
    expect(rig.http.hostStates()).toEqual([{ host: HOST, breaker: 'open', lastError: 'HTTP 403' }]);

    const error = await mcpError(rig.http.get({ url: at('/fine/'), expect: 'html' }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ why: `circuit open for ${HOST}`, retryable: true });
    expect(rig.origin.calls).toHaveLength(5);
  });

  it('counts the attempts of a retried request', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(/./, status(500));
    // Three attempts, then two more: the fifth failure opens the circuit mid-request.
    await mcpError(rig.http.get({ url: at('/a/'), expect: 'html' }));
    const second = await mcpError(rig.http.get({ url: at('/b/'), expect: 'html' }));
    expect(second.details?.why).toBe(`circuit open for ${HOST}`);
    expect(rig.origin.calls).toHaveLength(5);
  });

  it('forgets failures older than a minute', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(/\/blocked\//, status(429)).on(at('/fine/'), page(PAGE));
    for (let n = 0; n < 4; n += 1) {
      await mcpError(rig.http.get({ url: at(`/blocked/${n}`), expect: 'html' }));
    }
    rig.clock.advance(61 * SECOND);
    await mcpError(rig.http.get({ url: at('/blocked/late'), expect: 'html' }));
    expect(rig.http.hostStates()[0]?.breaker).toBe('closed');
    expect((await rig.http.get({ url: at('/fine/'), expect: 'html' })).status).toBe(200);
  });

  it('allows one probe after five minutes and closes when it succeeds', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(at('/fine/'), page(PAGE));
    await openCircuit(rig);

    rig.clock.advance(4 * MINUTE);
    await mcpError(rig.http.get({ url: at('/fine/'), expect: 'html' }));
    expect(rig.origin.calls).toHaveLength(5);

    rig.clock.advance(MINUTE);
    expect(rig.http.hostStates()[0]?.breaker).toBe('half-open');
    expect((await rig.http.get({ url: at('/fine/'), expect: 'html' })).cache).toBe('miss');
    expect(rig.http.hostStates()[0]?.breaker).toBe('closed');
  });

  it('re-opens for a full period when the probe fails', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(at('/fine/'), page(PAGE));
    await openCircuit(rig);
    rig.clock.advance(5 * MINUTE);

    await mcpError(rig.http.get({ url: at('/blocked/probe'), expect: 'html' }));
    expect(rig.origin.calls).toHaveLength(6);
    expect(rig.http.hostStates()[0]?.breaker).toBe('open');

    rig.clock.advance(4 * MINUTE);
    const error = await mcpError(rig.http.get({ url: at('/fine/'), expect: 'html' }));
    expect(error.details?.why).toContain('circuit open');
  });

  it('answers from a stale copy while the circuit is open', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(at('/fine/'), page(PAGE));
    await rig.http.get({ url: at('/fine/'), expect: 'html' });
    rig.clock.advance(2 * DAY);
    await openCircuit(rig);

    const res = await rig.http.get({ url: at('/fine/'), expect: 'html' });
    expect(res.cache).toBe('stale');
    expect(rig.origin.urls().filter((url) => url === at('/fine/'))).toHaveLength(1);
  });

  it('keeps hosts apart', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST), hostRow('doc.arcgis.com')] });
    rig.origin.on('https://doc.arcgis.com/en/', page(PAGE));
    await openCircuit(rig);
    expect((await rig.http.get({ url: 'https://doc.arcgis.com/en/', expect: 'html' })).status).toBe(
      200,
    );
  });
});

describe('gateway: rate limiter', () => {
  it('paces requests to the host rate once the burst is used', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST, { ratePerSec: 2, maxConcurrent: 2 })] });
    rig.origin.on(/./, page(PAGE));
    for (let n = 0; n < 4; n += 1) await rig.http.get({ url: at(`/p/${n}`), expect: 'html' });
    // Two tokens of burst, then one request per half second.
    expect(rig.sleeps).toEqual([500, 500]);
  });

  it('honours the minimum interval of a host', async () => {
    const rig = makeRig({
      hosts: [
        hostRow('hub.arcgis.com', { ratePerSec: 1, maxConcurrent: 1, minIntervalMs: 60_000 }),
      ],
    });
    rig.origin.on(/./, json({ openapi: '3.0.0' }));
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/v3/docs-json' });
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/search/v1/docs-json' });
    expect(rig.sleeps).toEqual([60_000]);
  });

  it('gives up without a request when the wait would pass the deadline', async () => {
    const rig = makeRig({
      hosts: [
        hostRow('hub.arcgis.com', { ratePerSec: 1, maxConcurrent: 1, minIntervalMs: 60_000 }),
      ],
    });
    rig.origin.on(/./, json({ openapi: '3.0.0' }));
    const budget = newBudget(12, 25_000, rig.clock);
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/v3/docs-json', budget });

    const error = await mcpError(
      rig.http.getJson({ url: 'https://hub.arcgis.com/api/search/v1/docs-json', budget }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ why: 'request budget', retryable: true });
    expect(rig.origin.calls).toHaveLength(1);
    expect(rig.sleeps).toEqual([]);
    // The request never reached the network, so it was not counted.
    expect(budget.used).toBe(1);
  });

  it('runs at most the host concurrency at once, and four across hosts', async () => {
    const hosts = ['a', 'b', 'c'].map((name) =>
      hostRow(`${name}.example.com`, { maxConcurrent: 2 }),
    );
    const rig = makeRig({ hosts });
    let active = 0;
    let peak = 0;
    const perHost = new Map<string, number>();
    let peakPerHost = 0;
    const gates: Array<() => void> = [];
    // A slow origin: every response waits until the test releases it.
    const slowFetch: typeof fetch = async (input) => {
      // The gateway always passes the URL as a string.
      const url = new URL(typeof input === 'string' ? input : 'https://unexpected.invalid/');
      const host = url.host;
      if (url.pathname === '/robots.txt') return new Response(null, { status: 404 });
      active += 1;
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
      peak = Math.max(peak, active);
      peakPerHost = Math.max(peakPerHost, perHost.get(host) ?? 0);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      perHost.set(host, (perHost.get(host) ?? 0) - 1);
      return page(PAGE);
    };
    const http = createHttpClient({
      config: rig.config,
      logger: rig.logger,
      clock: rig.clock,
      cache: rig.cache,
      policy: rig.policy,
      detectMetaRefresh: () => undefined,
      fetchImpl: slowFetch,
      sleep: async () => undefined,
    });

    const pending = hosts.flatMap(({ host }) =>
      [1, 2, 3].map((n) => http.get({ url: `https://${host}/p/${n}`, expect: 'html' })),
    );
    // Release responses one at a time until all nine requests are done.
    let settled = 0;
    void Promise.all(pending.map((p) => p.then(() => (settled += 1))));
    while (settled < pending.length) {
      await new Promise((resolve) => setImmediate(resolve));
      gates.shift()?.();
    }
    await Promise.all(pending);
    expect(peak).toBe(4);
    expect(peakPerHost).toBe(2);
  });
});
