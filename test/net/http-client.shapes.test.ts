/**
 * One URL read under two expectations. A cached entry is a verdict ("this URL holds a JSON
 * index", "this URL is not a page"), so each expectation has its own: neither answers for
 * the other, and a miss for one never replaces the good copy of the other.
 */
import { describe, expect, it } from 'vitest';
import { HOUR } from '../support/fake-clock.js';
import { PAGE, hostRow, json, makeRig, mcpError, page } from './harness.js';

const HOST = 'developers.arcgis.com';
const HOSTS = [hostRow(HOST)];
const INDEX = `https://${HOST}/flutter/toolkit-api-reference/index.json`;
const RECORDS = [{ name: 'Compass', kind: 'class' }];

describe('gateway: one URL, two expectations', () => {
  it('keeps the index readable after the same URL was read as a page', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(INDEX, json(RECORDS));
    expect((await rig.http.getJson({ url: INDEX })).res.cache).toBe('miss');

    // An agent passes the index URL to the page reader.
    const asPage = await mcpError(rig.http.get({ url: INDEX, expect: 'html' }));
    expect(asPage.code).toBe('DOC_NOT_FOUND');
    expect(asPage.details?.why).toBe('Expected a page, got application/json');

    const again = await rig.http.getJson({ url: INDEX });
    expect(again.res.cache).toBe('hit');
    expect(again.data).toEqual(RECORDS);
  });

  it('does the same in the other order, and a day later', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(INDEX, json(RECORDS));
    expect((await mcpError(rig.http.get({ url: INDEX, expect: 'html' }))).code).toBe(
      'DOC_NOT_FOUND',
    );
    expect((await rig.http.getJson({ url: INDEX })).data).toEqual(RECORDS);

    rig.clock.advance(25 * HOUR);
    expect((await mcpError(rig.http.get({ url: INDEX, expect: 'html' }))).code).toBe(
      'DOC_NOT_FOUND',
    );
    expect((await rig.http.getJson({ url: INDEX })).data).toEqual(RECORDS);
  });

  it('remembers each verdict on its own', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(INDEX, json(RECORDS));
    await mcpError(rig.http.get({ url: INDEX, expect: 'html' }));
    await mcpError(rig.http.get({ url: INDEX, expect: 'html' }));
    await rig.http.getJson({ url: INDEX });
    await rig.http.getJson({ url: INDEX });
    // One request per expectation; the repeats were answered from the cache.
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('never hands a body validated as one shape to a caller that expects another', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = `https://${HOST}/javascript/latest/`;
    rig.origin.on(url, page(PAGE));
    await rig.http.get({ url, expect: 'html' });

    // The page is cached and fresh, but it was never checked as JSON or XML.
    const asJson = await mcpError(rig.http.getJson({ url }));
    expect(asJson.code).toBe('DOC_NOT_FOUND');
    expect(asJson.details?.why).toBe('Expected json, got an HTML page');
    expect((await mcpError(rig.http.get({ url, expect: 'xml' }))).code).toBe('DOC_NOT_FOUND');
    expect((await rig.http.get({ url, expect: 'html' })).cache).toBe('hit');
  });

  it('serves text and yaml from one copy: they pass the same check', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = `https://${HOST}/net/latest/xrefmap.yml`;
    rig.origin.on(
      url,
      new Response('references: []', { headers: { 'content-type': 'text/yaml' } }),
    );
    await rig.http.get({ url, expect: 'yaml' });
    expect((await rig.http.get({ url, expect: 'text' })).cache).toBe('hit');
  });

  it('expires the JSON copy, and no other, when the JSON does not parse', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = `https://${HOST}/javascript/latest/data.js`;
    const truncated = new Response('{"records":[', {
      headers: { 'content-type': 'application/javascript' },
    });
    rig.origin.on(url, truncated);
    expect((await rig.http.get({ url, expect: 'text' })).text).toBe('{"records":[');
    expect((await mcpError(rig.http.getJson({ url }))).code).toBe('UPSTREAM_UNAVAILABLE');
    expect((await rig.http.get({ url, expect: 'text' })).cache).toBe('hit');
  });
});

describe('gateway: one URL, two expectations, offline', () => {
  it('finds the copy of the expectation it is asked for', async () => {
    const online = makeRig({ hosts: HOSTS });
    online.origin.on(INDEX, json(RECORDS));
    await online.http.getJson({ url: INDEX });

    const rig = makeRig({ hosts: HOSTS, cache: online.cache, config: { offline: true } });
    expect((await rig.http.getJson({ url: INDEX })).data).toEqual(RECORDS);
    expect((await mcpError(rig.http.get({ url: INDEX, expect: 'html' }))).code).toBe(
      'OFFLINE_MISS',
    );
  });
});
