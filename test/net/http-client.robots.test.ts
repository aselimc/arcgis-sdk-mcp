import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../support/fake-clock.js';
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

describe('gateway: live robots.txt', () => {
  const ROBOTS = [
    'User-agent: *',
    'Disallow: *?q=',
    'Disallow: /downloads',
    'Disallow: /private/',
    'Allow: /private/public-notes/',
    'Sitemap: https://developers.arcgis.com/sitemap-index.xml',
  ].join('\n');

  it('refuses a path the live file disallows, without requesting it', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.robots(HOST, ROBOTS).on(/./, page(PAGE));

    const error = await mcpError(rig.http.get({ url: at('/downloads/sdk.zip'), expect: 'html' }));
    // The same error as for a rule compiled into the host table: the page exists and the
    // host is a documentation host, it is just not fetched by a program.
    expect(error.code).toBe('LINK_ONLY');
    expect(error.message).toBe(`${at('/downloads/sdk.zip')} is not fetched by this server`);
    expect(error.details).toMatchObject({
      why: `robots rules of ${HOST} exclude this path (Disallow: /downloads)`,
      retryable: false,
    });
    expect(error.details?.next).toContain(`Open ${at('/downloads/sdk.zip')} in a browser`);
    expect((await mcpError(rig.http.get({ url: at('/x/?q=map'), expect: 'html' }))).code).toBe(
      'LINK_ONLY',
    );
    expect(rig.origin.calls).toEqual([]);

    // The longer Allow wins over the shorter Disallow.
    expect(
      (await rig.http.get({ url: at('/private/public-notes/a/'), expect: 'html' })).status,
    ).toBe(200);
    expect((await rig.http.get({ url: at('/javascript/latest/'), expect: 'html' })).status).toBe(
      200,
    );
  });

  it('reads the file once per host per 24 hours', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.robots(HOST, ROBOTS).on(/./, page(PAGE));
    for (let n = 0; n < 3; n += 1) await rig.http.get({ url: at(`/p/${n}`), expect: 'html' });
    expect(rig.origin.robotsCalls).toEqual([`https://${HOST}/robots.txt`]);

    rig.clock.advance(23 * HOUR);
    await rig.http.get({ url: at('/p/later'), expect: 'html' });
    expect(rig.origin.robotsCalls).toHaveLength(1);

    rig.clock.advance(2 * HOUR);
    await rig.http.get({ url: at('/p/next-day'), expect: 'html' });
    expect(rig.origin.robotsCalls).toHaveLength(2);
  });

  it('remembers the rules across restarts through the cache', async () => {
    const first = makeRig({ hosts: [hostRow(HOST)] });
    first.origin.robots(HOST, ROBOTS).on(/./, page(PAGE));
    await first.http.get({ url: at('/p/1'), expect: 'html' });

    const second = makeRig({ hosts: [hostRow(HOST)], cache: first.cache, clock: first.clock });
    second.origin.on(/./, page(PAGE));
    const error = await mcpError(second.http.get({ url: at('/downloads/'), expect: 'html' }));
    expect(error.code).toBe('LINK_ONLY');
    expect(second.origin.robotsCalls).toEqual([]);
  });

  it('does not ask before serving a fresh cached copy', async () => {
    const first = makeRig({ hosts: [hostRow(HOST)] });
    first.origin.on(/./, page(PAGE));
    await first.http.get({ url: at('/p/1'), expect: 'html' });
    await first.cache.clear('derived');

    const second = makeRig({ hosts: [hostRow(HOST)], cache: first.cache, clock: first.clock });
    expect((await second.http.get({ url: at('/p/1'), expect: 'html' })).cache).toBe('hit');
    expect(second.origin.robotsCalls).toEqual([]);
  });

  it('applies to the host a redirect or a stub leads to', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST), hostRow('doc.arcgis.com')] });
    rig.origin
      .robots('doc.arcgis.com', 'User-agent: *\nDisallow: /en/asset/')
      .on(at('/go/'), redirect('https://doc.arcgis.com/en/asset/logo/'))
      .on(at('/stub/'), refreshStub('https://doc.arcgis.com/en/asset/other/'))
      .on(/doc\.arcgis\.com/, page(PAGE));

    for (const start of [at('/go/'), at('/stub/')]) {
      const error = await mcpError(rig.http.get({ url: start, expect: 'html' }));
      expect(error.code).toBe('LINK_ONLY');
      expect(error.details?.host).toBe('doc.arcgis.com');
    }
    expect(rig.origin.urls()).toEqual([at('/go/'), at('/stub/')]);
  });

  it('is not read for API, registry and CDN hosts, nor for a POST', async () => {
    const rig = makeRig({
      hosts: [
        hostRow('api.github.com', { capability: 'github' }),
        hostRow('registry.npmjs.org', { capability: 'registries' }),
        hostRow('cdn.jsdelivr.net', { capability: 'package-cdn' }),
        hostRow('esearchapi.esri.com', { capability: 'site-search' }),
      ],
      enabled: ['github', 'registries', 'package-cdn', 'site-search'],
    });
    rig.origin.on(/./, json({ ok: true }));
    await rig.http.getJson({ url: 'https://api.github.com/repos/Esri/calcite-design-system' });
    await rig.http.getJson({ url: 'https://registry.npmjs.org/-/package/@arcgis/core/dist-tags' });
    await rig.http.getJson({ url: 'https://cdn.jsdelivr.net/npm/@arcgis/core@5.1.0/package.json' });
    await rig.http.getJson({
      url: 'https://esearchapi.esri.com/search',
      method: 'POST',
      body: '{}',
    });
    expect(rig.origin.robotsCalls).toEqual([]);
  });

  it('falls back to the static rules when the file cannot be read, and asks again in an hour', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.robots(HOST, status(503)).on(/./, page(PAGE));
    expect((await rig.http.get({ url: at('/downloads/'), expect: 'html' })).status).toBe(200);

    rig.clock.advance(30 * MINUTE);
    await rig.http.get({ url: at('/p/1'), expect: 'html' });
    expect(rig.origin.robotsCalls).toHaveLength(1);

    rig.origin.robots(HOST, ROBOTS);
    rig.clock.advance(31 * MINUTE);
    const error = await mcpError(rig.http.get({ url: at('/downloads/other'), expect: 'html' }));
    expect(error.code).toBe('LINK_ONLY');
    expect(rig.origin.robotsCalls).toHaveLength(2);
  });

  it('keeps a known denial when a later read fails', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.robots(HOST, ROBOTS).on(/./, page(PAGE));
    await rig.http.get({ url: at('/p/1'), expect: 'html' });

    rig.origin.robots(HOST, new TypeError('fetch failed'));
    rig.clock.advance(25 * HOUR);
    const error = await mcpError(rig.http.get({ url: at('/downloads/'), expect: 'html' }));
    expect(error.code).toBe('LINK_ONLY');
  });

  it('never serves a stale copy of a path that is now disallowed', async () => {
    const rig = makeRig({ hosts: [hostRow(HOST)] });
    rig.origin.on(/./, page(PAGE));
    await rig.http.get({ url: at('/downloads/'), expect: 'html' });

    rig.origin.robots(HOST, ROBOTS);
    rig.clock.advance(25 * HOUR);
    const error = await mcpError(rig.http.get({ url: at('/downloads/'), expect: 'html' }));
    expect(error.code).toBe('LINK_ONLY');
    expect(rig.origin.calls).toHaveLength(1);
  });
});
