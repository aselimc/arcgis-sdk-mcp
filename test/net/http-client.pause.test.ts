/**
 * A host that asks for a pause gets one: after a refusal with `Retry-After`, or once it has
 * reported its quota as used up, nothing is sent to it until the time it named. Sending
 * anyway is what turns a rate limit into a ban.
 */
import { describe, expect, it } from 'vitest';
import { HostQuotas, readRateLimit } from '../../src/net/rate-limit-info.js';
import { FAKE_NOW, FakeClock, MINUTE, SECOND } from '../support/fake-clock.js';
import { PAGE, hostRow, json, makeRig, mcpError, page, status } from './harness.js';

const HOST = 'developers.arcgis.com';
const HOSTS = [hostRow(HOST), hostRow('doc.arcgis.com')];
const at = (path: string) => `https://${HOST}${path}`;
const RESET_SECONDS = FAKE_NOW / 1000 + 30 * 60;

describe('HostQuotas', () => {
  it('knows no pause for a host it has not heard from, or that has quota left', () => {
    const quotas = new HostQuotas(new FakeClock());
    expect(quotas.of('h')).toBeUndefined();
    expect(quotas.pausedUntil('h')).toBeUndefined();
    quotas.record('h', { remaining: 12, resetAt: FAKE_NOW + MINUTE });
    expect(quotas.pausedUntil('h')).toBeUndefined();
  });

  it('pauses until the reset of a spent quota, and no longer', () => {
    const clock = new FakeClock();
    const quotas = new HostQuotas(clock);
    quotas.record('h', { remaining: 0, resetAt: FAKE_NOW + MINUTE });
    expect(quotas.pausedUntil('h')).toBe(FAKE_NOW + MINUTE);
    clock.advance(MINUTE);
    expect(quotas.pausedUntil('h')).toBeUndefined();
  });

  it('pauses for a Retry-After, and takes the later of two reasons', () => {
    const quotas = new HostQuotas(new FakeClock());
    quotas.record('h', { retryAfterUntil: FAKE_NOW + 90 * SECOND });
    expect(quotas.pausedUntil('h')).toBe(FAKE_NOW + 90 * SECOND);
    quotas.record('h', { remaining: 0, resetAt: FAKE_NOW + 5 * MINUTE });
    expect(quotas.pausedUntil('h')).toBe(FAKE_NOW + 5 * MINUTE);
    // A later response merges into what is known rather than replacing it.
    expect(quotas.of('h')).toEqual({
      remaining: 0,
      resetAt: FAKE_NOW + 5 * MINUTE,
      retryAfterUntil: FAKE_NOW + 90 * SECOND,
    });
  });

  it('sets no pause for a spent quota without a reset time', () => {
    const quotas = new HostQuotas(new FakeClock());
    quotas.record('h', { remaining: 0 });
    expect(quotas.pausedUntil('h')).toBeUndefined();
  });

  it('reads the headers of a response', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '7',
      'x-ratelimit-reset': String(RESET_SECONDS),
    });
    expect(readRateLimit(headers, FAKE_NOW)).toEqual({
      remaining: 7,
      resetAt: RESET_SECONDS * 1000,
    });
    expect(readRateLimit(new Headers(), FAKE_NOW, 2000)).toEqual({
      retryAfterUntil: FAKE_NOW + 2000,
    });
    expect(
      readRateLimit(new Headers({ 'x-ratelimit-remaining': 'many' }), FAKE_NOW),
    ).toBeUndefined();
  });
});

describe('gateway: a pause the host asked for', () => {
  it('sends nothing during the Retry-After of a refusal, and asks again afterwards', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin
      .on(at('/a/'), status(429, { 'retry-after': '120' }))
      .on(at('/b/'), page(PAGE))
      .on('https://doc.arcgis.com/en/', page(PAGE));
    expect((await mcpError(rig.http.get({ url: at('/a/'), expect: 'html' }))).code).toBe(
      'UPSTREAM_BLOCKED',
    );

    for (let n = 0; n < 6; n += 1) {
      rig.clock.advance(10 * SECOND);
      const error = await mcpError(rig.http.get({ url: at('/b/'), expect: 'html' }));
      expect(error.code).toBe('UPSTREAM_BLOCKED');
      expect(error.details).toMatchObject({ host: HOST, retryable: false });
      expect(error.details?.why).toContain(new Date(FAKE_NOW + 120 * SECOND).toISOString());
      expect(error.details?.why).toContain('none was sent');
    }
    expect(rig.origin.calls).toHaveLength(1);
    // Refusing locally is not a failure of the host: one refusal, and the circuit is closed.
    expect(rig.http.hostStates()).toEqual([
      { host: HOST, breaker: 'closed', lastError: 'HTTP 429' },
    ]);
    // Other hosts are not paused.
    expect((await rig.http.get({ url: 'https://doc.arcgis.com/en/', expect: 'html' })).text).toBe(
      PAGE,
    );

    rig.clock.advance(61 * SECOND);
    expect((await rig.http.get({ url: at('/b/'), expect: 'html' })).text).toBe(PAGE);
  });

  it('stops at a quota the host reports as used up, until its reset time', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const spent = {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(RESET_SECONDS),
    };
    // The last request the quota allowed is answered; the next one would be refused.
    rig.origin.on(at('/last.json'), json({ ok: true }, spent)).on(at('/next.json'), json({}));
    await rig.http.getJson({ url: at('/last.json') });
    expect(rig.http.rateLimit(HOST)).toEqual({ remaining: 0, resetAt: RESET_SECONDS * 1000 });

    const error = await mcpError(rig.http.getJson({ url: at('/next.json') }));
    expect(error.code).toBe('UPSTREAM_BLOCKED');
    expect(rig.origin.calls).toHaveLength(1);

    rig.clock.advance(31 * MINUTE);
    expect((await rig.http.getJson({ url: at('/next.json') })).data).toEqual({});
  });

  it('still answers from the cache during a pause', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/a/'), page(PAGE)).on(at('/b/'), status(403, { 'retry-after': '600' }));
    await rig.http.get({ url: at('/a/'), expect: 'html' });
    await mcpError(rig.http.get({ url: at('/b/'), expect: 'html' }));
    expect((await rig.http.get({ url: at('/a/'), expect: 'html' })).cache).toBe('hit');
  });

  it('reports no quota for a host that never stated one', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/a/'), page(PAGE));
    await rig.http.get({ url: at('/a/'), expect: 'html' });
    expect(rig.http.rateLimit(HOST)).toBeUndefined();
  });
});
