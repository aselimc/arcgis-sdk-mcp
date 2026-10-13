import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import { DAY, MINUTE } from '../support/fake-clock.js';
import {
  PAGE,
  hostRow,
  json,
  makeRig,
  mcpError,
  networkError,
  page,
  status,
  timeoutError,
} from './harness.js';

const DOC = 'https://developers.arcgis.com/javascript/latest/get-started/';
const HOSTS = [
  hostRow('developers.arcgis.com'),
  hostRow('archive.developers.arcgis.com', { capability: null }),
  hostRow('esearchapi.esri.com', { capability: 'site-search' }),
];

describe('gateway: upstream outcomes', () => {
  it.each([404, 410])('turns %i into DOC_NOT_FOUND and remembers it for an hour', async (code) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, status(code), page(PAGE));

    const first = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(first.code).toBe('DOC_NOT_FOUND');
    expect(first.details?.why).toBe(`The server answered ${code}`);

    rig.clock.advance(59 * MINUTE);
    const second = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(second.code).toBe('DOC_NOT_FOUND');
    expect(rig.origin.calls).toHaveLength(1);

    rig.clock.advance(2 * MINUTE);
    expect((await rig.http.get({ url: DOC, expect: 'html' })).text).toBe(PAGE);
    expect(rig.origin.calls).toHaveLength(2);
  });

  it.each([403, 429])('reports %i as UPSTREAM_BLOCKED: no retry, no stale copy', async (code) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE), status(code, { 'retry-after': '1' }));
    await rig.http.get({ url: DOC, expect: 'html' });
    rig.clock.advance(2 * DAY);

    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(error.code).toBe('UPSTREAM_BLOCKED');
    expect(error.details).toMatchObject({ retryable: false, why: `The server answered ${code}` });
    expect(rig.origin.calls).toHaveLength(2);
    expect(rig.sleeps).toEqual([]);
    expect(rig.http.hostStates()[0]?.lastError).toBe(`HTTP ${code}`);
  });

  it('retries a 5xx twice, after 0.5 s and 1.5 s, then gives up', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, status(503));
    const budget = newBudget(12, 25_000, rig.clock);

    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html', budget }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ why: 'HTTP 503', retryable: true });
    expect(rig.origin.calls).toHaveLength(3);
    expect(rig.sleeps).toEqual([500, 1500]);
    // Each attempt is a request, so each one is counted.
    expect(budget.used).toBe(3);
  });

  it('applies jitter to the back-off', async () => {
    const low = makeRig({ hosts: HOSTS, random: () => 0 });
    low.origin.on(DOC, status(500));
    await mcpError(low.http.get({ url: DOC, expect: 'html' }));
    expect(low.sleeps).toEqual([400, 1200]);

    const high = makeRig({ hosts: HOSTS, random: () => 0.999 });
    high.origin.on(DOC, status(500));
    await mcpError(high.http.get({ url: DOC, expect: 'html' }));
    expect(high.sleeps[0]).toBeGreaterThan(590);
    expect(high.sleeps[0]).toBeLessThanOrEqual(600);
  });

  it.each([
    ['a timeout', timeoutError, 'timeout'],
    ['a network error', networkError, 'network error: fetch failed'],
  ])('retries %s and recovers', async (_label, failure, why) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, failure(), page(PAGE));
    const res = await rig.http.get({ url: DOC, expect: 'html' });
    expect(res.cache).toBe('miss');
    expect(rig.origin.calls).toHaveLength(2);
    expect(rig.sleeps).toEqual([500]);

    const dead = makeRig({ hosts: HOSTS });
    dead.origin.on(DOC, failure());
    const error = await mcpError(dead.http.get({ url: DOC, expect: 'html' }));
    expect(error.details).toMatchObject({ why, retryable: true });
  });

  it('waits as long as Retry-After asks when that fits the deadline', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, status(503, { 'retry-after': '3' }), page(PAGE));
    const res = await rig.http.get({
      url: DOC,
      expect: 'html',
      budget: newBudget(12, 25_000, rig.clock),
    });
    expect(res.text).toBe(PAGE);
    expect(rig.sleeps).toEqual([3000]);
  });

  it('does not retry when Retry-After reaches past the deadline', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, status(503, { 'retry-after': '60' }), page(PAGE));
    const error = await mcpError(
      rig.http.get({ url: DOC, expect: 'html', budget: newBudget(12, 25_000, rig.clock) }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(rig.origin.calls).toHaveLength(1);
    expect(rig.sleeps).toEqual([]);
  });

  it('serves a stale copy younger than 30 days when the host fails', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE), status(502));
    const fresh = await rig.http.get({ url: DOC, expect: 'html' });

    rig.clock.advance(29 * DAY);
    const stale = await rig.http.get({ url: DOC, expect: 'html' });
    expect(stale).toMatchObject({ cache: 'stale', text: PAGE, fetchedAt: fresh.fetchedAt });
    expect(rig.logger.messages('warn')).toContain('serving stale copy');

    rig.clock.advance(2 * DAY);
    const error = await mcpError(rig.http.get({ url: DOC, expect: 'html' }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('reports a cancelled request without counting it against the host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(DOC, page(PAGE));
    const controller = new AbortController();
    controller.abort();
    const error = await mcpError(
      rig.http.get({ url: DOC, expect: 'html', signal: controller.signal }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.why).toBe('cancelled by the caller');
    expect(rig.origin.calls).toEqual([]);
  });
});

describe('gateway: getJson', () => {
  const INDEX = 'https://developers.arcgis.com/javascript/latest/search-index.json';

  it('parses the body and returns the response beside it', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(INDEX, json([{ title: 'Layers' }]));
    const { data, res } = await rig.http.getJson<Array<{ title: string }>>({ url: INDEX });
    expect(data[0]?.title).toBe('Layers');
    expect(res.cache).toBe('miss');
  });

  it('reports a truncated document as retryable and does not keep it', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(
      INDEX,
      new Response('{"records":[{"title":"Lay', {
        headers: { 'content-type': 'application/json' },
      }),
      json({ records: [] }),
    );
    const error = await mcpError(rig.http.getJson({ url: INDEX }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.retryable).toBe(true);

    const { data } = await rig.http.getJson({ url: INDEX });
    expect(data).toEqual({ records: [] });
    expect(rig.origin.calls).toHaveLength(2);
  });
});
