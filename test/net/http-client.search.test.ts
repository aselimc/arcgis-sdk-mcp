/**
 * The `remote-search` TTL class: a hit list is kept for 24 hours, an
 * empty one for an hour, and an error object answered with HTTP 200 is not kept at all.
 */
import { describe, expect, it } from 'vitest';
import { searchOutcome } from '../../src/net/search-result.js';
import { HOUR, MINUTE } from '../support/fake-clock.js';
import { hostRow, json, makeRig } from './harness.js';

const ENDPOINT = 'https://esearchapi.esri.com/search';
const HOSTS = [hostRow('esearchapi.esri.com', { capability: 'site-search' })];
const HITS = { search: { hits: [{ doc: { url: 'https://developers.arcgis.com/x/' } }] } };
const NO_HITS = { search: { hits: [] } };
const OVERLOADED = { error: { message: 'temporarily overloaded' } };

function make() {
  const rig = makeRig({ hosts: HOSTS, enabled: ['site-search'] });
  const search = (query: string) =>
    rig.http.getJson({ url: ENDPOINT, method: 'POST', body: JSON.stringify({ q: query }) });
  return { ...rig, search };
}

describe('searchOutcome', () => {
  it.each<[string, unknown, ReturnType<typeof searchOutcome>]>([
    ['a hit list', HITS, 'hits'],
    ['an empty hit list', NO_HITS, 'empty'],
    ['an error object', OVERLOADED, 'error'],
    ['hits beside an error', { ...HITS, error: { detail: 'partial failure' } }, 'error'],
    ['no hit list', { search: {} }, 'error'],
    ['hits that are not a list', { search: { hits: 3 } }, 'error'],
    ['another document', { took: 3 }, 'error'],
    ['a list', [], 'error'],
    ['null', null, 'error'],
  ])('%s is %s', (_label, body, expected) => {
    expect(searchOutcome(JSON.stringify(body))).toBe(expected);
  });

  it('takes text that is not JSON for an error', () => {
    expect(searchOutcome('{"search":{"hits":[')).toBe('error');
  });
});

describe('gateway: remote search results', () => {
  it('keeps a hit list for 24 hours', async () => {
    const rig = make();
    rig.origin.on(ENDPOINT, json(HITS));
    await rig.search('layers');

    rig.clock.advance(23 * HOUR);
    expect((await rig.search('layers')).res.cache).toBe('hit');
    rig.clock.advance(2 * HOUR);
    expect((await rig.search('layers')).res.cache).toBe('miss');
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('asks again after an hour when nothing was found', async () => {
    const rig = make();
    rig.origin.on(ENDPOINT, json(NO_HITS), json(HITS));
    expect((await rig.search('feed')).data).toEqual(NO_HITS);

    rig.clock.advance(59 * MINUTE);
    expect((await rig.search('feed')).res.cache).toBe('hit');
    rig.clock.advance(2 * MINUTE);
    const later = await rig.search('feed');
    expect(later.res.cache).toBe('miss');
    expect(later.data).toEqual(HITS);
  });

  it('hands an error object to the caller without remembering it', async () => {
    const rig = make();
    rig.origin.on(ENDPOINT, json(OVERLOADED), json(HITS));
    // The provider decides what the error means; the gateway only refuses to cache it.
    const failed = await rig.search('layers');
    expect(failed.data).toEqual(OVERLOADED);
    expect(failed.res.cache).toBe('miss');
    expect(rig.cache.writes.http).toBe(0);

    const retried = await rig.search('layers');
    expect(retried.data).toEqual(HITS);
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('never serves a search result stale', async () => {
    const rig = make();
    rig.origin.on(ENDPOINT, json(HITS), new TypeError('fetch failed'));
    await rig.search('layers');
    rig.clock.advance(25 * HOUR);
    await expect(rig.search('layers')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
