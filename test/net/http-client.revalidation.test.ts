import { describe, expect, it } from 'vitest';
import type { HostPolicy } from '../../src/core/types.js';
import { DAY, HOUR } from '../support/fake-clock.js';
import { PAGE, hostRow, makeRig, mcpError, page, redirect, status } from './harness.js';

const VALIDATORS = { etag: 'W/"abc"', 'last-modified': 'Mon, 05 Oct 2026 08:00:00 GMT' };

function rigFor(revalidate: HostPolicy['revalidate']) {
  return makeRig({ hosts: [hostRow('docs.example.com', { revalidate })] });
}

const URL_ = 'https://docs.example.com/guide/';

describe('gateway: conditional revalidation per host rule', () => {
  it.each<[HostPolicy['revalidate'], string | undefined, string | undefined]>([
    ['etag', VALIDATORS.etag, undefined],
    ['last-modified', undefined, VALIDATORS['last-modified']],
    ['both', VALIDATORS.etag, VALIDATORS['last-modified']],
    ['none', undefined, undefined],
  ])('rule "%s" sends exactly its validators', async (rule, ifNoneMatch, ifModifiedSince) => {
    const rig = rigFor(rule);
    rig.origin.on(URL_, page(PAGE, VALIDATORS));
    await rig.http.get({ url: URL_, expect: 'html' });
    expect(rig.origin.calls[0]?.headers['if-none-match']).toBeUndefined();

    rig.clock.advance(25 * HOUR);
    await rig.http.get({ url: URL_, expect: 'html' });
    const second = rig.origin.calls[1]?.headers;
    expect(second?.['if-none-match']).toBe(ifNoneMatch);
    expect(second?.['if-modified-since']).toBe(ifModifiedSince);
  });

  it('keeps the cached body on 304 and makes it fresh again', async () => {
    const rig = rigFor('etag');
    rig.origin.on(URL_, page(PAGE, VALIDATORS), status(304, { etag: 'W/"abc-2"' }));
    const first = await rig.http.get({ url: URL_, expect: 'html' });

    rig.clock.advance(25 * HOUR);
    const second = await rig.http.get({ url: URL_, expect: 'html' });
    expect(second).toMatchObject({
      cache: 'revalidated',
      text: PAGE,
      etag: 'W/"abc-2"',
      // The body is the one fetched the first time.
      fetchedAt: first.fetchedAt,
    });

    rig.clock.advance(23 * HOUR);
    const third = await rig.http.get({ url: URL_, expect: 'html' });
    expect(third.cache).toBe('hit');
    expect(third.etag).toBe('W/"abc-2"');
    expect(rig.origin.calls).toHaveLength(2);

    // The new validator is the one sent next time.
    rig.clock.advance(2 * HOUR);
    await rig.http.get({ url: URL_, expect: 'html' });
    expect(rig.origin.calls[2]?.headers['if-none-match']).toBe('W/"abc-2"');
  });

  it('replaces the entry when the origin answers 200', async () => {
    const rig = rigFor('etag');
    const changed = PAGE.replace('Body text.', 'New text.');
    rig.origin.on(URL_, page(PAGE, { etag: '"1"' }), page(changed, { etag: '"2"' }));
    await rig.http.get({ url: URL_, expect: 'html' });
    rig.clock.advance(25 * HOUR);
    const second = await rig.http.get({ url: URL_, expect: 'html' });
    expect(second).toMatchObject({ cache: 'miss', text: changed, etag: '"2"' });
  });

  it('fetches unconditionally when the host has no usable validator', async () => {
    const rig = rigFor('etag');
    rig.origin.on(URL_, page(PAGE, { 'last-modified': VALIDATORS['last-modified'] }));
    await rig.http.get({ url: URL_, expect: 'html' });
    rig.clock.advance(25 * HOUR);
    const second = await rig.http.get({ url: URL_, expect: 'html' });
    expect(second.cache).toBe('miss');
    expect(rig.origin.calls[1]?.headers['if-modified-since']).toBeUndefined();
  });

  it('rejects a 304 it did not ask for', async () => {
    const rig = rigFor('etag');
    rig.origin.on(URL_, status(304));
    const error = await mcpError(rig.http.get({ url: URL_, expect: 'html' }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.retryable).toBe(false);
  });

  it('sends the validators to the URL that produced the body, not to the redirect before it', async () => {
    const rig = rigFor('etag');
    const final = 'https://docs.example.com/guide/latest/';
    rig.origin.on(URL_, redirect(final)).on(final, page(PAGE, VALIDATORS), status(304));
    await rig.http.get({ url: URL_, expect: 'html' });

    rig.clock.advance(25 * HOUR);
    const second = await rig.http.get({ url: URL_, expect: 'html' });
    expect(second).toMatchObject({ cache: 'revalidated', finalUrl: final, aliasChain: [URL_] });
    const [, , hopAgain, finalAgain] = rig.origin.calls;
    expect(hopAgain?.headers['if-none-match']).toBeUndefined();
    expect(finalAgain?.headers['if-none-match']).toBe(VALIDATORS.etag);
  });

  it('survives a cache that cannot record the 304', async () => {
    const rig = rigFor('etag');
    rig.origin.on(URL_, page(PAGE, VALIDATORS), status(304));
    await rig.http.get({ url: URL_, expect: 'html' });
    rig.clock.advance(25 * HOUR);
    rig.cache.touchHttp = () => Promise.reject(new Error('read-only'));
    expect((await rig.http.get({ url: URL_, expect: 'html' })).cache).toBe('revalidated');
    expect(rig.logger.messages('warn')).toContain('cache touch failed');
  });
});

describe('gateway: TTL classes', () => {
  it('uses the class the caller names', async () => {
    const rig = rigFor('none');
    rig.origin.on(URL_, page(PAGE));
    await rig.http.get({ url: URL_, expect: 'html', ttl: 'volatile' });
    rig.clock.advance(5 * HOUR);
    expect((await rig.http.get({ url: URL_, expect: 'html', ttl: 'volatile' })).cache).toBe('hit');
    rig.clock.advance(2 * HOUR);
    expect((await rig.http.get({ url: URL_, expect: 'html', ttl: 'volatile' })).cache).toBe('miss');
  });

  it('keeps an immutable entry for a year', async () => {
    const rig = rigFor('etag');
    rig.origin.on(URL_, page(PAGE, VALIDATORS));
    await rig.http.get({ url: URL_, expect: 'html', ttl: 'immutable' });
    rig.clock.advance(364 * DAY);
    expect((await rig.http.get({ url: URL_, expect: 'html' })).cache).toBe('hit');
    expect(rig.origin.calls).toHaveLength(1);
  });

  it('defaults to a day for pages', async () => {
    const rig = rigFor('none');
    rig.origin.on(URL_, page(PAGE));
    await rig.http.get({ url: URL_, expect: 'html' });
    rig.clock.advance(23 * HOUR);
    expect((await rig.http.get({ url: URL_, expect: 'html' })).cache).toBe('hit');
    rig.clock.advance(2 * HOUR);
    expect((await rig.http.get({ url: URL_, expect: 'html' })).cache).toBe('miss');
  });

  it('never serves third-party search results stale', async () => {
    const rig = makeRig({
      hosts: [hostRow('esearchapi.esri.com', { capability: 'site-search', revalidate: 'none' })],
      enabled: ['site-search'],
    });
    const url = 'https://esearchapi.esri.com/search';
    rig.origin.on(
      url,
      new Response('{"search":{"hits":[]}}', { headers: { 'content-type': 'application/json' } }),
      status(503),
    );
    await rig.http.getJson({ url, method: 'POST', body: '{}' });
    rig.clock.advance(25 * HOUR);
    const error = await mcpError(rig.http.getJson({ url, method: 'POST', body: '{}' }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
