/**
 * Requests the gateway gives up on by its own decision: a cancelled caller, a spent budget, a
 * deadline that cuts a request short, pacing that leaves no start time. None of them says
 * anything about the host, so none may count towards its circuit breaker, and each is told
 * apart from a failing host by `details.declined`.
 */
import { describe, expect, it } from 'vitest';
import { budgetExhausted, newBudget } from '../../src/core/async.js';
import { declined, declinedBy, unavailable } from '../../src/net/errors.js';
import {
  GatedOrigin,
  PAGE,
  hostRow,
  json,
  makeRig,
  mcpError,
  page,
  timeoutError,
} from './harness.js';

const HOST = 'developers.arcgis.com';
const HOSTS = [hostRow(HOST)];
const at = (path: string) => `https://${HOST}${path}`;

describe('declined errors', () => {
  it.each([
    ['budget', 'No answer from developers.arcgis.com within the request budget'],
    ['pacing', 'The request to developers.arcgis.com was not sent'],
    ['cancelled', 'The request to developers.arcgis.com was cancelled'],
  ] as const)('%s: retryable, located, and not worded as a failing host', (reason, message) => {
    const error = declined(at('/p/'), reason);
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.message).toBe(message);
    expect(error.details).toMatchObject({
      url: at('/p/'),
      host: HOST,
      retryable: true,
      declined: reason,
    });
    expect(declinedBy(error)).toBe(reason);
  });

  it('reads nothing into other failures', () => {
    expect(declinedBy(unavailable(at('/p/'), 'HTTP 503'))).toBeUndefined();
    expect(declinedBy(new Error('boom'))).toBeUndefined();
    expect(declinedBy(undefined)).toBeUndefined();
  });
});

describe('gateway: cancellation', () => {
  // The MCP SDK aborts with the client's reason string; an embedder may abort with anything.
  it.each<[string, unknown]>([
    ['the default reason', undefined],
    ['a string', 'User cancelled'],
    ['an Error', new Error('client went away')],
  ])('returns at once and leaves the breaker alone when aborted with %s', async (_label, why) => {
    const gate = new GatedOrigin();
    const rig = makeRig({ hosts: HOSTS, fetchImpl: gate.fetch });

    for (let n = 0; n < 5; n += 1) {
      const controller = new AbortController();
      const pending = mcpError(
        rig.http.get({ url: at(`/p/${n}`), expect: 'html', signal: controller.signal }),
      );
      await gate.reached();
      controller.abort(why);
      const error = await pending;
      expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(error.details).toMatchObject({
        why: 'cancelled by the caller',
        declined: 'cancelled',
      });
    }
    // No retry back-off was waited out, and five cancellations did not open the circuit.
    expect(rig.sleeps).toEqual([]);
    expect(rig.http.hostStates()).toEqual([{ host: HOST, breaker: 'closed' }]);

    const next = rig.http.get({ url: at('/p/next'), expect: 'html' });
    await gate.reached();
    gate.answer(page(PAGE));
    expect((await next).text).toBe(PAGE);
  });
});

describe('gateway: a deadline that cuts a request short', () => {
  it('reports the spent budget and does not charge the host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    // The transport times out because the caller had 150 ms left, not the host's 20 s.
    rig.origin.on(/\/slow\//, timeoutError()).on(at('/fine/'), page(PAGE));

    for (let n = 0; n < 5; n += 1) {
      const budget = newBudget(12, 150, rig.clock);
      const error = await mcpError(rig.http.get({ url: at(`/slow/${n}`), expect: 'html', budget }));
      expect(error.details).toMatchObject({ declined: 'budget', retryable: true });
      expect(error.message).toBe(`No answer from ${HOST} within the request budget`);
    }
    expect(rig.origin.calls).toHaveLength(5);
    expect(rig.sleeps).toEqual([]);
    expect(rig.http.hostStates()).toEqual([{ host: HOST, breaker: 'closed' }]);
    expect((await rig.http.get({ url: at('/fine/'), expect: 'html' })).text).toBe(PAGE);
  });

  it('still charges a timeout that had the full time of the host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(/./, timeoutError());
    const budget = newBudget(12, 25_000, rig.clock);
    const error = await mcpError(rig.http.get({ url: at('/slow/'), expect: 'html', budget }));
    expect(error.details).toMatchObject({ why: 'timeout', retryable: true });
    expect(declinedBy(error)).toBeUndefined();
    expect(rig.http.hostStates()[0]?.lastError).toBe('timeout');
  });
});

describe('gateway: pacing that cannot meet the deadline', () => {
  const HUB = hostRow('hub.arcgis.com', {
    ratePerSec: 1 / 60,
    maxConcurrent: 1,
    minIntervalMs: 60_000,
  });

  it('says that the request was not sent, with the budget still unspent', async () => {
    const rig = makeRig({ hosts: [HUB] });
    rig.origin.on(/./, json({ openapi: '3.0.0' }));
    const budget = newBudget(12, 25_000, rig.clock);
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/events/v1/docs-json', budget });

    const error = await mcpError(
      rig.http.getJson({ url: 'https://hub.arcgis.com/api/discussions/v2/docs-json', budget }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.message).toBe('The request to hub.arcgis.com was not sent');
    expect(error.details).toMatchObject({ declined: 'pacing', retryable: true });
    expect(error.details?.why).toContain('spaced out');
    // Neither the count nor the deadline is used up, so `budgetExhausted` cannot tell this
    // case from a failing host; `details.declined` does.
    expect(budgetExhausted(budget, rig.clock)).toBe(false);
    expect(budget.used).toBe(1);
    expect(rig.origin.calls).toHaveLength(1);
    expect(rig.sleeps).toEqual([]);
    expect(rig.http.hostStates()).toEqual([{ host: 'hub.arcgis.com', breaker: 'closed' }]);
  });

  it('reads the next document once the interval fits the deadline', async () => {
    const rig = makeRig({ hosts: [HUB] });
    rig.origin.on(/./, json({ openapi: '3.0.0' }));
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/events/v1/docs-json' });

    const budget = newBudget(12, 120_000, rig.clock);
    await rig.http.getJson({ url: 'https://hub.arcgis.com/api/discussions/v2/docs-json', budget });
    expect(rig.sleeps).toEqual([60_000]);
    // The third one would start at 120 s, which is the deadline.
    const error = await mcpError(
      rig.http.getJson({ url: 'https://hub.arcgis.com/api/newsletters/v1/docs-json', budget }),
    );
    expect(declinedBy(error)).toBe('pacing');
    expect(rig.origin.calls).toHaveLength(2);
  });
});
