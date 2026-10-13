import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import { MAX_HOPS } from '../../src/net/http-client.js';
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

const BASE = 'https://developers.arcgis.com';
const START = `${BASE}/kotlin/release-notes/`;
const HOSTS = [
  hostRow('developers.arcgis.com'),
  hostRow('doc.arcgis.com'),
  hostRow('api.github.com', { capability: 'github' }),
  hostRow('cdn.jsdelivr.net', { capability: 'package-cdn' }),
  hostRow('archive.developers.arcgis.com', { capability: null }),
];

describe('gateway: HTTP redirects', () => {
  it('follows a redirect, records the chain and caches under the requested URL', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const target = `${BASE}/kotlin/release-notes/release-notes-300-1/`;
    rig.origin.on(START, redirect(target, 302)).on(target, page(PAGE));

    const res = await rig.http.get({ url: START, expect: 'html' });
    expect(res).toMatchObject({ url: START, finalUrl: target, aliasChain: [START], cache: 'miss' });
    expect(rig.policy.checked).toEqual([START, target]);

    const again = await rig.http.get({ url: START, expect: 'html' });
    expect(again).toMatchObject({ cache: 'hit', finalUrl: target, aliasChain: [START] });
    expect(rig.origin.urls()).toEqual([START, target]);
  });

  it.each([301, 302, 303, 307, 308])('follows status %i', async (code) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(START, redirect('/moved/', code)).on(`${BASE}/moved/`, page(PAGE));
    const res = await rig.http.get({ url: START, expect: 'html' });
    // A relative Location is resolved against the URL that sent it.
    expect(res.finalUrl).toBe(`${BASE}/moved/`);
  });

  it('follows across allow-listed hosts and re-checks each one', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const target = 'https://doc.arcgis.com/en/survey123/';
    rig.origin.on(START, redirect(target)).on(target, page(PAGE));
    const res = await rig.http.get({ url: START, expect: 'html' });
    expect(res.finalUrl).toBe(target);
    expect(rig.policy.checked).toEqual([START, target]);
    expect(rig.http.hostStates().map((state) => state.host)).toEqual([
      'developers.arcgis.com',
      'doc.arcgis.com',
    ]);
  });

  it('refuses a redirect that leaves the allow-list, and never requests the target', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const target = 'https://www.esri.com/en-us/arcgis/products/';
    rig.origin.on(START, redirect(target)).on(target, page(PAGE));

    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details).toMatchObject({ url: target, host: 'www.esri.com' });
    expect(error.details?.why).toContain(`${START} redirects to www.esri.com`);
    expect(rig.origin.urls()).toEqual([START]);
  });

  it('answers LINK_ONLY with the target URL when a redirect leads to a link-only host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const target = 'https://archive.developers.arcgis.com/javascript/4.20/';
    rig.origin.on(START, redirect(target));
    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('LINK_ONLY');
    expect(error.details?.url).toBe(target);
    expect(rig.origin.urls()).toEqual([START]);
  });

  it('answers SOURCE_DISABLED when a redirect leads to a host whose capability is off', async () => {
    const rig = makeRig({ hosts: HOSTS, enabled: ['website'] });
    rig.origin.on(START, redirect('https://cdn.jsdelivr.net/npm/@arcgis/core@5.1.0/x.d.ts'));
    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('SOURCE_DISABLED');
    expect(rig.origin.calls).toHaveLength(1);
  });

  it.each([
    ['plain http', 'http://developers.arcgis.com/kotlin/'],
    ['a cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['a loopback address', 'https://127.0.0.1:8443/'],
    ['an IPv6 loopback', 'https://[::1]/'],
    ['localhost', 'https://localhost/'],
    ['a URL with credentials', 'https://token@developers.arcgis.com/kotlin/'],
    ['another port', 'https://developers.arcgis.com:8080/kotlin/'],
    ['a file URL', 'file:///etc/passwd'],
  ])('refuses a redirect to %s whatever the policy allows', async (_label, location) => {
    // The permissive policy accepts every https host, so this is the guard alone.
    const rig = makeRig();
    rig.origin.on(START, redirect(location)).on(/.*/, page(PAGE));
    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(rig.origin.urls()).toEqual([START]);
    expect(rig.policy.checked).toEqual([START]);
  });

  it(`follows ${MAX_HOPS} hops and stops at the next one`, async () => {
    const hop = (n: number) => `${BASE}/hop/${n}/`;
    const chainOf = (length: number) => {
      const rig = makeRig({ hosts: HOSTS });
      for (let n = 0; n < length; n += 1) rig.origin.on(hop(n), redirect(hop(n + 1)));
      rig.origin.on(hop(length), page(PAGE));
      return rig;
    };

    const ok = chainOf(MAX_HOPS);
    const res = await ok.http.get({ url: hop(0), expect: 'html' });
    expect(res.aliasChain).toHaveLength(MAX_HOPS);
    expect(res.finalUrl).toBe(hop(MAX_HOPS));

    const tooLong = chainOf(MAX_HOPS + 1);
    const error = await mcpError(tooLong.http.get({ url: hop(0), expect: 'html' }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(error.details?.why).toBe(`More than ${MAX_HOPS} redirects`);
    expect(tooLong.origin.calls).toHaveLength(MAX_HOPS + 1);
  });

  it('breaks a redirect loop', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const other = `${BASE}/kotlin/other/`;
    rig.origin.on(START, redirect(other)).on(other, redirect(START));
    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(error.details?.why).toContain('leads back to');
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('rejects a redirect without a usable Location', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(START, status(302));
    const error = await mcpError(rig.http.get({ url: START, expect: 'html' }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.retryable).toBe(false);

    const garbled = makeRig({ hosts: HOSTS });
    garbled.origin.on(START, redirect('https://'));
    expect((await mcpError(garbled.http.get({ url: START, expect: 'html' }))).code).toBe(
      'DOC_NOT_FOUND',
    );
  });

  it('counts every hop against the request budget', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(START, redirect('/a/')).on(`${BASE}/a/`, page(PAGE));
    const budget = newBudget(12, 25_000, rig.clock);
    await rig.http.get({ url: START, expect: 'html', budget });
    expect(budget.used).toBe(2);

    const tight = makeRig({ hosts: HOSTS });
    tight.origin.on(START, redirect('/a/')).on(`${BASE}/a/`, page(PAGE));
    const error = await mcpError(
      tight.http.get({ url: START, expect: 'html', budget: newBudget(1, 25_000, tight.clock) }),
    );
    expect(error.details?.why).toBe('request budget');
    expect(tight.origin.urls()).toEqual([START]);
  });

  it('sends caller headers to the addressed host only', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const api = 'https://api.github.com/repos/Esri/old-name';
    const sameHost = 'https://api.github.com/repositories/42';
    const elsewhere = 'https://cdn.jsdelivr.net/npm/@esri/thing@1.0.0/package.json';
    rig.origin
      .on(api, redirect(sameHost))
      .on(sameHost, redirect(elsewhere))
      .on(elsewhere, json({ name: 'thing' }));

    await rig.http.getJson({ url: api, headers: { Authorization: 'Bearer secret' } });
    const [first, second, third] = rig.origin.calls;
    expect(first?.headers.authorization).toBe('Bearer secret');
    expect(second?.headers.authorization).toBe('Bearer secret');
    expect(third?.headers.authorization).toBeUndefined();
    expect(third?.headers['user-agent']).toMatch(/^arcgis-sdk-mcp\//);
  });

  it('does not follow a redirect of a POST', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(START, redirect('/elsewhere/', 307));
    const error = await mcpError(
      rig.http.get({ url: START, expect: 'json', method: 'POST', body: '{}' }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.retryable).toBe(false);
    expect(rig.origin.calls).toHaveLength(1);
  });
});

describe('gateway: meta-refresh stubs', () => {
  const SECTION = 'https://doc.arcgis.com/en/survey123/';
  const LANDING = 'https://doc.arcgis.com/en/survey123/get-started/';

  it('follows the stub to the real page and records the alias', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(SECTION, refreshStub('get-started/')).on(LANDING, page(PAGE));
    const res = await rig.http.get({ url: SECTION, expect: 'html' });
    expect(res).toMatchObject({ finalUrl: LANDING, aliasChain: [SECTION], text: PAGE });
    expect(rig.policy.checked).toEqual([SECTION, LANDING]);
  });

  it('mixes redirects and stubs within one chain', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin
      .on(START, redirect(SECTION))
      .on(SECTION, refreshStub(LANDING))
      .on(LANDING, page(PAGE));
    const res = await rig.http.get({ url: START, expect: 'html' });
    expect(res.aliasChain).toEqual([START, SECTION]);
    expect(res.finalUrl).toBe(LANDING);
  });

  it('refuses a stub that points off the allow-list', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const target = 'https://evil.example.com/landing';
    rig.origin.on(SECTION, refreshStub(target)).on(target, page(PAGE));
    const error = await mcpError(rig.http.get({ url: SECTION, expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details?.url).toBe(target);
    expect(rig.origin.urls()).toEqual([SECTION]);
  });

  it('refuses a stub that points at a private address', async () => {
    const rig = makeRig();
    rig.origin.on(SECTION, refreshStub('https://10.0.0.5/admin')).on(/.*/, page(PAGE));
    const error = await mcpError(rig.http.get({ url: SECTION, expect: 'html' }));
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(rig.origin.urls()).toEqual([SECTION]);
  });

  it('answers LINK_ONLY when a stub points at a link-only host', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(SECTION, refreshStub('https://archive.developers.arcgis.com/x/'));
    expect((await mcpError(rig.http.get({ url: SECTION, expect: 'html' }))).code).toBe('LINK_ONLY');
  });

  it('breaks a refresh loop', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(SECTION, refreshStub(LANDING)).on(LANDING, refreshStub(SECTION));
    const error = await mcpError(rig.http.get({ url: SECTION, expect: 'html' }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(rig.origin.calls).toHaveLength(2);

    const self = makeRig({ hosts: HOSTS });
    self.origin.on(SECTION, refreshStub(SECTION));
    expect((await mcpError(self.http.get({ url: SECTION, expect: 'html' }))).code).toBe(
      'DOC_NOT_FOUND',
    );
    expect(self.origin.calls).toHaveLength(1);
  });

  it('looks for a stub only when a page was expected', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = `${BASE}/data.xml`;
    rig.origin.on(
      url,
      new Response('<feed><meta http-equiv="refresh" content="0; url=/x"></feed>', {
        headers: { 'content-type': 'application/xml' },
      }),
    );
    const res = await rig.http.get({ url, expect: 'xml' });
    expect(res.finalUrl).toBe(url);
  });
});
