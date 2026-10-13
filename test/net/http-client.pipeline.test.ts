import { describe, expect, it } from 'vitest';
import { budgetExhausted, newBudget } from '../../src/core/async.js';
import { DAY, HOUR } from '../support/fake-clock.js';
import { PAGE, hostRow, json, makeRig, mcpError, page, status } from './harness.js';

const DOC = 'https://developers.arcgis.com/javascript/latest/get-started/';
const HOSTS = [
  hostRow('developers.arcgis.com'),
  hostRow('archive.developers.arcgis.com', { capability: null }),
  hostRow('esearchapi.esri.com', { capability: 'site-search' }),
];

describe('gateway: policy and URL guard', () => {
  it('refuses a host outside the allow-list without contacting it', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const error = await mcpError(rig.http.get({ url: 'https://example.com/x', expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details).toMatchObject({ url: 'https://example.com/x', host: 'example.com' });
    expect(rig.origin.calls).toEqual([]);
    expect(rig.origin.robotsCalls).toEqual([]);
  });

  it('answers LINK_ONLY for a link-only host without contacting it', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const error = await mcpError(
      rig.http.get({ url: 'https://archive.developers.arcgis.com/old', expect: 'html' }),
    );
    expect(error.code).toBe('LINK_ONLY');
    expect(rig.origin.calls).toEqual([]);
  });

  it('answers SOURCE_DISABLED when the host capability is off', async () => {
    const rig = makeRig({ hosts: HOSTS, enabled: ['website'] });
    const error = await mcpError(
      rig.http.get({ url: 'https://esearchapi.esri.com/search', expect: 'json', method: 'POST' }),
    );
    expect(error.code).toBe('SOURCE_DISABLED');
    expect(error.details?.capability).toBe('site-search');
    expect(rig.origin.calls).toEqual([]);
  });

  it.each([
    ['plain http', 'http://developers.arcgis.com/x'],
    ['another scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'https://user:pw@developers.arcgis.com/x'],
    ['a non-default port', 'https://developers.arcgis.com:8443/x'],
    ['an IPv4 literal', 'https://169.254.169.254/latest/meta-data/'],
    ['a decimal IPv4 literal', 'https://2130706433/'],
    ['an IPv6 literal', 'https://[::1]/'],
    ['localhost', 'https://localhost/admin'],
    ['a single-label name', 'https://intranet/wiki'],
    ['a .internal name', 'https://metadata.google.internal/x'],
    ['text that is not a URL', 'not a url'],
  ])('refuses %s before the policy is asked', async (_label, url) => {
    // No host table: the fake policy would allow any https host, so only the guard stands.
    const rig = makeRig();
    const error = await mcpError(rig.http.get({ url, expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(rig.policy.checked).toEqual([]);
    expect(rig.origin.calls).toEqual([]);
    expect(rig.origin.robotsCalls).toEqual([]);
  });

  it('wraps an unexpected policy failure as INTERNAL with the URL', async () => {
    const rig = makeRig();
    rig.policy.check = () => {
      throw new TypeError('boom');
    };
    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(error.code).toBe('INTERNAL');
    expect(error.details?.url).toBe(DOC);
  });
});

describe('gateway: request and cache', () => {
  it('sends the project User-Agent and an Accept header that matches the expectation', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE)).on(`${DOC}index.json`, json({ ok: true }));
    await rig.http.get({ url: DOC, expect: 'html' });
    await rig.http.get({ url: `${DOC}index.json`, expect: 'json' });

    const [first, second] = rig.origin.calls;
    expect(first?.headers['user-agent']).toBe(
      'arcgis-sdk-mcp/0.0.0-test (+https://github.com/aselimc/arcgis-sdk-mcp)',
    );
    expect(first?.headers.accept).toContain('text/html');
    expect(second?.headers.accept).toContain('application/json');
  });

  it('never lets a caller header replace the User-Agent', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    await rig.http.get({ url: DOC, expect: 'html', headers: { 'User-Agent': 'curl/8' } });
    expect(rig.origin.calls[0]?.headers['user-agent']).toMatch(/^arcgis-sdk-mcp\//);
  });

  it('fetches once, then answers from cache until the entry expires', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE, { etag: 'W/"v1"' }));

    const first = await rig.http.get({ url: DOC, expect: 'html' });
    expect(first).toMatchObject({
      url: DOC,
      finalUrl: DOC,
      status: 200,
      text: PAGE,
      etag: 'W/"v1"',
      cache: 'miss',
      aliasChain: [],
      fetchedAt: rig.clock.iso(),
    });

    rig.clock.advance(23 * HOUR);
    const second = await rig.http.get({ url: DOC, expect: 'html' });
    expect(second.cache).toBe('hit');
    expect(second.text).toBe(PAGE);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(rig.origin.calls).toHaveLength(1);
  });

  it('ignores the fragment: it is never sent and does not split the cache', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    await rig.http.get({ url: `${DOC}#install`, expect: 'html' });
    const again = await rig.http.get({ url: `${DOC}#usage`, expect: 'html' });
    expect(again.cache).toBe('hit');
    expect(rig.origin.urls()).toEqual([DOC]);
  });

  it('shares one flight between concurrent identical requests', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    const [a, b, c] = await Promise.all([
      rig.http.get({ url: DOC, expect: 'html' }),
      rig.http.get({ url: DOC, expect: 'html' }),
      rig.http.get({ url: DOC, expect: 'html' }),
    ]);
    expect(rig.origin.calls).toHaveLength(1);
    expect([a.text, b.text, c.text]).toEqual([PAGE, PAGE, PAGE]);
  });

  it('keeps POST requests with different bodies apart, and does not repeat a failed POST', async () => {
    const rig = makeRig({ hosts: HOSTS, enabled: ['website', 'site-search'] });
    const url = 'https://esearchapi.esri.com/search';
    rig.origin.on(url, (call) => json({ echo: call.body }));

    const one = await rig.http.getJson({ url, method: 'POST', body: '{"q":"a"}' });
    const two = await rig.http.getJson({ url, method: 'POST', body: '{"q":"b"}' });
    const oneAgain = await rig.http.getJson({ url, method: 'POST', body: '{"q":"a"}' });
    expect(one.data).toEqual({ echo: '{"q":"a"}' });
    expect(two.data).toEqual({ echo: '{"q":"b"}' });
    expect(oneAgain.res.cache).toBe('hit');
    expect(rig.origin.calls.map((call) => call.method)).toEqual(['POST', 'POST']);

    rig.origin.on('https://esearchapi.esri.com/down', status(503));
    const error = await mcpError(
      rig.http.get({ url: 'https://esearchapi.esri.com/down', method: 'POST', expect: 'json' }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(rig.origin.calls).toHaveLength(3);
  });

  it('treats a failing cache as empty and a failed write as harmless', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    rig.cache.getHttp = () => Promise.reject(new Error('disk gone'));
    rig.cache.putHttp = () => Promise.reject(new Error('disk full'));

    const res = await rig.http.get({ url: DOC, expect: 'html' });
    expect(res.cache).toBe('miss');
    expect(rig.logger.messages('warn')).toEqual(['cache read failed', 'cache write failed']);
  });

  it('reports the breaker state of every contacted host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    expect(rig.http.hostStates()).toEqual([]);
    await rig.http.get({ url: DOC, expect: 'html' });
    expect(rig.http.hostStates()).toEqual([{ host: 'developers.arcgis.com', breaker: 'closed' }]);
  });
});

describe('gateway: offline mode', () => {
  it('answers OFFLINE_MISS without any request when nothing is cached', async () => {
    const rig = makeRig({ hosts: HOSTS, config: { offline: true } });
    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(error.code).toBe('OFFLINE_MISS');
    expect(error.details?.next).toContain('ARCGIS_DOCS_OFFLINE');
    expect(rig.origin.calls).toEqual([]);
    expect(rig.origin.robotsCalls).toEqual([]);
  });

  it('serves what an earlier online session cached, labelled stale once expired', async () => {
    const online = makeRig({ hosts: HOSTS });
    online.origin.on(DOC, page(PAGE));
    await online.http.get({ url: DOC, expect: 'html' });

    const rig = makeRig({
      hosts: HOSTS,
      config: { offline: true },
      cache: online.cache,
      clock: online.clock,
    });
    expect((await rig.http.get({ url: DOC, expect: 'html' })).cache).toBe('hit');

    // Even past the 30-day stale window: offline, an old copy beats none.
    rig.clock.advance(90 * DAY);
    const old = await rig.http.get({ url: DOC, expect: 'html' });
    expect(old).toMatchObject({ cache: 'stale', text: PAGE });
    expect(rig.origin.calls).toEqual([]);
  });

  it('trusts a remembered miss for an hour only', async () => {
    const online = makeRig({ hosts: HOSTS });
    online.origin.on(DOC, status(404));
    await mcpError(online.http.get({ url: DOC, expect: 'html' }));

    const rig = makeRig({
      hosts: HOSTS,
      config: { offline: true },
      cache: online.cache,
      clock: online.clock,
    });
    expect((await mcpError(rig.http.get({ url: DOC, expect: 'html' }))).code).toBe('DOC_NOT_FOUND');
    rig.clock.advance(2 * HOUR);
    expect((await mcpError(rig.http.get({ url: DOC, expect: 'html' }))).code).toBe('OFFLINE_MISS');
  });

  it('still applies the policy', async () => {
    const rig = makeRig({ hosts: HOSTS, config: { offline: true } });
    const error = await mcpError(rig.http.get({ url: 'https://example.com/', expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
  });
});

describe('gateway: request budget', () => {
  it('counts requests that reach the network and nothing else', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(/arcgis\.com/, page(PAGE));
    const budget = newBudget(12, 25_000, rig.clock);

    await rig.http.get({ url: DOC, expect: 'html', budget });
    await rig.http.get({ url: DOC, expect: 'html', budget });
    await rig.http.get({ url: `${DOC}other/`, expect: 'html', budget });
    // The robots.txt read is outside the budget: once per host per day, not per call.
    expect(rig.origin.robotsCalls).toHaveLength(1);
    expect(budget.used).toBe(2);
  });

  it('stops at the request count with a retryable UPSTREAM_UNAVAILABLE', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(/arcgis\.com/, page(PAGE));
    const budget = newBudget(2, 25_000, rig.clock);
    await rig.http.get({ url: `${DOC}a/`, expect: 'html', budget });
    await rig.http.get({ url: `${DOC}b/`, expect: 'html', budget });

    const error = await mcpError(rig.http.get({ url: `${DOC}c/`, expect: 'html', budget }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ why: 'request budget', retryable: true });
    expect(budgetExhausted(budget, rig.clock)).toBe(true);
    expect(rig.origin.calls).toHaveLength(2);
    expect(budget.used).toBe(2);
  });

  it('stops at the deadline', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    const budget = newBudget(12, 25_000, rig.clock);
    rig.clock.advance(25_000);
    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html', budget }));
    expect(error.details?.why).toBe('request budget');
    expect(rig.origin.calls).toEqual([]);
  });

  it('serves the expired copy when the budget is spent', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    await rig.http.get({ url: DOC, expect: 'html' });
    rig.clock.advance(2 * DAY);

    const res = await rig.http.get({
      url: DOC,
      expect: 'html',
      budget: newBudget(0, 25_000, rig.clock),
    });
    expect(res.cache).toBe('stale');
    expect(rig.origin.calls).toHaveLength(1);
  });
});
