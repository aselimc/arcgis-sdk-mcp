import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import { isMcpDocError, type ErrorCode } from '../../src/core/errors.js';
import { parseSitemap } from '../../src/core/sitemap.js';
import { FakeClock } from './fake-clock.js';
import { FakeHttp, UnrecordedRequestError, type Fault } from './fake-http.js';
import {
  FIXTURES_DIR,
  fixturePath,
  hasFixture,
  loadCassette,
  readFixture,
  readJsonFixture,
} from './fixtures.js';

const BASE = 'https://developers.arcgis.com/widgets';
const selftest = (file: string): string[] => ['..', 'support', 'selftest', file];

async function codeOf(promise: Promise<unknown>): Promise<ErrorCode | 'no error' | 'other error'> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return isMcpDocError(error) ? error.code : 'other error';
  }
}

describe('fixture loader', () => {
  it('resolves paths under test/fixtures', () => {
    expect(fixturePath('cassettes', 'site', 'a.json').startsWith(FIXTURES_DIR)).toBe(true);
    expect(hasFixture(...selftest('cassette.json'))).toBe(true);
    expect(hasFixture(...selftest('missing.json'))).toBe(false);
  });

  it('reads text with normalised line endings and parses JSON', () => {
    const xml = readFixture(...selftest('sitemap-0.xml'));
    expect(xml).not.toContain('\r');
    expect(parseSitemap(xml).entries).toHaveLength(2);
    expect(readJsonFixture<{ name: string }>(...selftest('cassette.json')).name).toBe(
      'support self-test',
    );
  });

  it('loads a cassette and inlines bodyFile', () => {
    const cassette = loadCassette(...selftest('cassette.json'));
    expect(cassette.name).toBe('support self-test');
    expect(cassette.interactions).toHaveLength(4);
    const [sitemap] = cassette.interactions;
    expect(sitemap?.response.body).toContain('<urlset');
    expect(sitemap?.response).not.toHaveProperty('bodyFile');
  });
});

describe('FakeHttp replay', () => {
  const fromCassette = (): FakeHttp =>
    new FakeHttp({ cassette: loadCassette(...selftest('cassette.json')), clock: new FakeClock() });

  it('answers recorded requests and logs them', async () => {
    const http = fromCassette();
    const res = await http.get({ url: `${BASE}/sitemap-0.xml`, expect: 'xml' });
    expect(res).toMatchObject({
      url: `${BASE}/sitemap-0.xml`,
      finalUrl: `${BASE}/sitemap-0.xml`,
      status: 200,
      contentType: 'application/xml',
      cache: 'miss',
      aliasChain: [],
      fetchedAt: '2026-10-13T12:00:00.000Z',
    });
    const { data, res: jsonRes } = await http.getJson<{ pages: number }>({
      url: `${BASE}/index.json`,
    });
    expect(data.pages).toBe(2);
    expect(jsonRes.etag).toBe('W/"v1"');
    expect(jsonRes.contentType).toBe('application/json');
    expect(http.requests.map((request) => `${request.method} ${request.expect}`)).toEqual([
      'GET xml',
      'GET json',
    ]);
    expect(http.count()).toBe(2);
    expect(http.count(/index\.json$/)).toBe(1);
    expect(http.count(`${BASE}/index.json`)).toBe(1);
    expect(http.hosts()).toEqual(['developers.arcgis.com']);
    expect(http.unrecorded).toEqual([]);
  });

  it('matches by method and ignores the fragment', async () => {
    const http = fromCassette();
    await expect(
      http.get({ url: `${BASE}/search`, expect: 'json', method: 'POST', body: '{}' }),
    ).resolves.toMatchObject({
      status: 200,
    });
    expect(await codeOf(http.get({ url: `${BASE}/search`, expect: 'json' }))).toBe('other error');
    await expect(
      http.get({ url: `${BASE}/sitemap-0.xml#top`, expect: 'xml' }),
    ).resolves.toBeDefined();
    expect(http.requests[0]).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('fails loudly on an unrecorded request and remembers it', async () => {
    const http = fromCassette();
    await expect(http.get({ url: `${BASE}/nope/`, expect: 'html' })).rejects.toBeInstanceOf(
      UnrecordedRequestError,
    );
    expect(http.unrecorded).toEqual([`GET ${BASE}/nope/`]);
    expect(http.count()).toBe(1);
    http.resetLog();
    expect(http.count()).toBe(0);
    expect(http.unrecorded).toEqual([]);
  });

  it('treats a recorded non-200 status like the real gateway', async () => {
    expect(await codeOf(fromCassette().get({ url: `${BASE}/gone/`, expect: 'html' }))).toBe(
      'DOC_NOT_FOUND',
    );
  });

  it('validates the body against expect', async () => {
    const http = new FakeHttp()
      .on(`${BASE}/page/`, { body: '<!doctype html><html><body>Hi</body></html>' })
      .on(`${BASE}/data.json`, { body: '<!doctype html><html><body>catch-all</body></html>' })
      .on(`${BASE}/map.xml`, { body: '<html><body>catch-all</body></html>' })
      .on(`${BASE}/inv.txt`, { body: '# Sphinx inventory version 2' })
      .on(`${BASE}/toc.yml`, { body: '### YamlMime:XRefMap' })
      .on(`${BASE}/bom.json`, { body: '\uFEFF{"ok":true}' });
    await expect(http.get({ url: `${BASE}/page/`, expect: 'html' })).resolves.toMatchObject({
      contentType: 'text/html; charset=utf-8',
    });
    expect(await codeOf(http.getJson({ url: `${BASE}/data.json` }))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(http.get({ url: `${BASE}/map.xml`, expect: 'xml' }))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(http.get({ url: `${BASE}/page/`, expect: 'text' }))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(http.get({ url: `${BASE}/inv.txt`, expect: 'html' }))).toBe(
      'DOC_NOT_FOUND',
    );
    await expect(http.get({ url: `${BASE}/inv.txt`, expect: 'text' })).resolves.toBeDefined();
    await expect(http.get({ url: `${BASE}/toc.yml`, expect: 'yaml' })).resolves.toBeDefined();
    const { data, res } = await http.getJson<{ ok: boolean }>({ url: `${BASE}/bom.json` });
    expect(data.ok).toBe(true);
    expect(res.text.startsWith('{')).toBe(true);
  });

  it('serves queued responses in order, repeats the last, and supports patterns and functions', async () => {
    const http = new FakeHttp()
      .on(`${BASE}/page-data.json`, { json: { hash: 'aaa' } })
      .on(`${BASE}/page-data.json`, { json: { hash: 'bbb' } })
      .on(/\/echo\//, (req) => ({ json: { url: req.url } }));
    const hashes = [];
    for (let i = 0; i < 3; i++) {
      hashes.push(
        (await http.getJson<{ hash: string }>({ url: `${BASE}/page-data.json` })).data.hash,
      );
    }
    expect(hashes).toEqual(['aaa', 'bbb', 'bbb']);
    const echoed = await http.getJson<{ url: string }>({ url: `${BASE}/echo/1` });
    expect(echoed.data.url).toBe(`${BASE}/echo/1`);
  });

  it('reports redirects, validators and cache state from the recording', async () => {
    const http = new FakeHttp().on(`${BASE}/old/`, {
      body: '<main>moved</main>',
      finalUrl: `${BASE}/new/`,
      aliasChain: [`${BASE}/old/`],
      lastModified: 'Tue, 13 Oct 2026 10:00:00 GMT',
      cache: 'hit',
    });
    await expect(http.get({ url: `${BASE}/old/`, expect: 'html' })).resolves.toMatchObject({
      url: `${BASE}/old/`,
      finalUrl: `${BASE}/new/`,
      aliasChain: [`${BASE}/old/`],
      lastModified: 'Tue, 13 Oct 2026 10:00:00 GMT',
      cache: 'hit',
    });
  });

  it('rejects invalid JSON from getJson as an upstream failure', async () => {
    const http = new FakeHttp().on(`${BASE}/bad.json`, { body: '{"truncated": ' });
    expect(await codeOf(http.getJson({ url: `${BASE}/bad.json` }))).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('tolerates request URLs that are not URLs', async () => {
    const http = new FakeHttp().on('relative/path', { body: 'plain' });
    await expect(http.get({ url: 'relative/path', expect: 'text' })).resolves.toMatchObject({
      text: 'plain',
    });
    expect(http.hosts()).toEqual(['']);
  });
});

describe('FakeHttp budget', () => {
  it('counts network requests against the budget and stops when it is spent', async () => {
    const clock = new FakeClock();
    const http = new FakeHttp({ clock })
      .on(`${BASE}/a`, { body: 'a' })
      .on(`${BASE}/cached`, { body: 'c', cache: 'hit' });
    const budget = newBudget(2, 10_000, clock);
    await http.get({ url: `${BASE}/a`, expect: 'text', budget });
    await http.get({ url: `${BASE}/cached`, expect: 'text', budget });
    await http.get({ url: `${BASE}/a`, expect: 'text', budget });
    expect(budget.used).toBe(2);
    try {
      await http.get({ url: `${BASE}/a`, expect: 'text', budget });
      expect.unreachable();
    } catch (error) {
      expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
      // Worded and marked like the gateway's own refusal.
      expect(isMcpDocError(error) && error.details?.declined).toBe('budget');
      expect(isMcpDocError(error) && error.message).toMatch(/within the request budget$/);
    }
    // Cache hits stay free even when the budget is spent.
    await expect(
      http.get({ url: `${BASE}/cached`, expect: 'text', budget }),
    ).resolves.toBeDefined();
  });

  it('stops at the deadline', async () => {
    const clock = new FakeClock();
    const http = new FakeHttp({ clock }).on(`${BASE}/a`, { body: 'a' });
    const budget = newBudget(10, 5000, clock);
    clock.advance(5000);
    expect(await codeOf(http.get({ url: `${BASE}/a`, expect: 'text', budget }))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    expect(budget.used).toBe(0);
  });
});

describe('FakeHttp fault injection', () => {
  const recorded = (): FakeHttp =>
    new FakeHttp().on(`${BASE}/index.json`, {
      json: { pages: 2, list: ['a', 'b', 'c'] },
      etag: '"v1"',
    });
  const request = { url: `${BASE}/index.json`, expect: 'json' } as const;

  it.each<[Fault, ErrorCode]>([
    [404, 'DOC_NOT_FOUND'],
    [410, 'DOC_NOT_FOUND'],
    [403, 'UPSTREAM_BLOCKED'],
    [429, 'UPSTREAM_BLOCKED'],
    [408, 'UPSTREAM_UNAVAILABLE'],
    [500, 'UPSTREAM_UNAVAILABLE'],
    [502, 'UPSTREAM_UNAVAILABLE'],
    [503, 'UPSTREAM_UNAVAILABLE'],
    [504, 'UPSTREAM_UNAVAILABLE'],
    ['timeout', 'UPSTREAM_UNAVAILABLE'],
    ['network', 'UPSTREAM_UNAVAILABLE'],
    ['html', 'DOC_NOT_FOUND'],
    ['empty', 'DOC_NOT_FOUND'],
  ])('fault %s gives %s', async (fault, code) => {
    const http = recorded().fail(request.url, fault);
    expect(await codeOf(http.get(request))).toBe(code);
    expect(http.unrecorded).toEqual([]);
  });

  it('marks retryable and blocked failures and records the host error', async () => {
    const http = recorded().fail(/index/, 503, { times: 1 }).fail(/index/, 429, { times: 1 });
    const errors = [];
    for (let i = 0; i < 2; i++) {
      try {
        await http.get(request);
      } catch (error) {
        if (isMcpDocError(error)) errors.push(error);
      }
    }
    expect(
      errors.map((error) => [error.code, error.details?.retryable, error.details?.host]),
    ).toEqual([
      ['UPSTREAM_UNAVAILABLE', true, 'developers.arcgis.com'],
      ['UPSTREAM_BLOCKED', false, 'developers.arcgis.com'],
    ]);
    expect(http.hostStates()).toEqual([
      { host: 'developers.arcgis.com', breaker: 'closed', lastError: 'HTTP 429' },
    ]);
    // Both faults are used up: the recording answers again.
    await expect(http.get(request)).resolves.toMatchObject({ status: 200 });
  });

  it('serves the recording as revalidated for 304 and as stale for a transient fault with stale', async () => {
    const http = recorded()
      .fail(request.url, 304, { times: 1 })
      .fail(request.url, 'timeout', { times: 1, stale: true });
    await expect(http.get(request)).resolves.toMatchObject({ cache: 'revalidated', etag: '"v1"' });
    await expect(http.get(request)).resolves.toMatchObject({ cache: 'stale' });
    await expect(http.get(request)).resolves.toMatchObject({ cache: 'miss' });
  });

  it('does not consume a queued response on a failed request', async () => {
    const http = new FakeHttp()
      .on(`${BASE}/v.json`, { json: { n: 1 } })
      .on(`${BASE}/v.json`, { json: { n: 2 } })
      .fail(`${BASE}/v.json`, 503, { times: 1 });
    expect(await codeOf(http.getJson({ url: `${BASE}/v.json` }))).toBe('UPSTREAM_UNAVAILABLE');
    expect((await http.getJson<{ n: number }>({ url: `${BASE}/v.json` })).data.n).toBe(1);
  });

  it('truncates a body and serves HTML where HTML is expected', async () => {
    const http = recorded().fail(request.url, 'truncated', { times: 1 });
    expect(await codeOf(http.getJson(request))).toBe('UPSTREAM_UNAVAILABLE');

    const page = new FakeHttp()
      .on(`${BASE}/page/`, { body: '<main>real page</main>' })
      .fail(/page/, 'html');
    const res = await page.get({ url: `${BASE}/page/`, expect: 'html' });
    expect(res.text).toContain('Page not found');
  });

  it('applies faults to unrecorded URLs too, except 304 which needs a recording', async () => {
    const http = new FakeHttp().fail(/.*/, 503);
    expect(await codeOf(http.get({ url: `${BASE}/anything`, expect: 'html' }))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    expect(http.unrecorded).toEqual([]);

    const stale = new FakeHttp().fail(/.*/, 'network', { stale: true });
    expect(await codeOf(stale.get({ url: `${BASE}/anything`, expect: 'html' }))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );

    const notModified = new FakeHttp().fail(/.*/, 304);
    await expect(
      notModified.get({ url: `${BASE}/anything`, expect: 'html' }),
    ).rejects.toBeInstanceOf(UnrecordedRequestError);
  });

  it('heals and lets tests script breaker states', async () => {
    const http = recorded().fail(request.url, 503);
    expect(await codeOf(http.get(request))).toBe('UPSTREAM_UNAVAILABLE');
    http.heal();
    await expect(http.get(request)).resolves.toBeDefined();
    http.setBreaker('doc.esri.com', 'open', 'HTTP 503').setBreaker('pypi.org', 'half-open');
    expect(http.hostStates()).toEqual(
      expect.arrayContaining([
        { host: 'doc.esri.com', breaker: 'open', lastError: 'HTTP 503' },
        { host: 'pypi.org', breaker: 'half-open' },
      ]),
    );
  });
});
