import { describe, expect, it } from 'vitest';
import { pageKind } from '../../../../src/adapters/site/gatsby/catalog.js';
import { MAX_ENUMERATE_REQUESTS } from '../../../../src/adapters/site/gatsby/enumerate.js';
import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import type { BoundSource, Ctx } from '../../../../src/core/ports.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import {
  D,
  documentation,
  guide,
  pythonApi,
  pythonGuide,
  recordAt,
  replaceResponse,
  rest,
  spec,
} from './sites.js';

function enumerate(ctx: Ctx, src: BoundSource<'gatsby'>): Promise<CatalogRecord[]> {
  if (gatsbyAdapter.enumerate === undefined) throw new Error('the adapter must enumerate');
  return gatsbyAdapter.enumerate(ctx, src);
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  const [outcome] = await Promise.allSettled([work]);
  if (outcome.status === 'fulfilled') throw new Error('expected a rejection');
  return outcome.reason;
}

const PAGE_DATA = `${D}/widgets/page-data/index/page-data.json`;
const STORE = `${D}/widgets/static/0f1e2d3c4b5a69788796a5b4c3d2e1f0.store.json`;
const ROTATED = '/widgets/static/ffffffffffffffffffffffffffffffff.store.json';

describe('gatsby enumerate: guide site', () => {
  it('merges sitemap, navigation and store into one record per page', async () => {
    const site = guide();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count()).toBe(3); // sitemap, page-data, store
    // Navigation order first, then pages only the sitemap knows.
    expect(records.map((record) => record.ref.slice(`${D}/widgets/`.length))).toEqual([
      '',
      'get-started/',
      'layers/feature-layers/',
      'tutorials/add-a-widget/',
      'release-notes/',
      'api-reference/gauge/',
      'api-reference/dial/',
      'faq/',
    ]);
    expect(recordAt(records, '/widgets/')).toMatchObject({
      title: 'Widgets SDK overview',
      kind: 'guide',
      description: 'What the Widgets SDK is for.',
      keywords: ['widgets'],
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      license: 'esri-website-terms',
    });
  });

  it('takes titles from the store, then the navigation, then the slug', async () => {
    const site = guide();
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/get-started/').title).toBe('Get started');
    expect(recordAt(records, '/api-reference/dial/').title).toBe('Dial'); // not in the store
    expect(recordAt(records, '/faq/').title).toBe('Faq'); // sitemap only
  });

  it('cleans store descriptions and keeps boost and breadcrumbs', async () => {
    const site = guide();
    const records = await enumerate(site.ctx(), site.bound());
    const started = recordAt(records, '/get-started/');
    expect(started.description).toBe('Install the package & draw a first widget.');
    expect(started.boost).toBe(2);
    expect(started.breadcrumb).toBeUndefined();
    expect(recordAt(records, '/layers/feature-layers/').breadcrumb).toBe('Layers');
    expect(recordAt(records, '/api-reference/gauge/').breadcrumb).toBe('API reference');
  });

  it('classifies pages by store page type and path', async () => {
    const site = guide();
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/tutorials/add-a-widget/').kind).toBe('tutorial');
    expect(recordAt(records, '/release-notes/').kind).toBe('release-notes');
    expect(recordAt(records, '/api-reference/gauge/').kind).toBe('api');
    expect(recordAt(records, '/faq/').kind).toBe('guide');
  });

  it('lets a classify rule of the source overrule the heuristics', async () => {
    const site = guide({
      classify: [
        ['^faq/', 'troubleshooting'],
        ['^api-reference/', 'guide'],
      ],
    });
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/faq/').kind).toBe('troubleshooting');
    expect(recordAt(records, '/api-reference/gauge/').kind).toBe('guide');
  });

  it('applies include and exclude to every rung, and never lists foreign nav links', async () => {
    const site = guide({ exclude: ['^api-reference/'] });
    const records = await enumerate(site.ctx(), site.bound());
    expect(records.some((record) => record.ref.includes('/api-reference/'))).toBe(false);
    expect(records.some((record) => record.ref.includes('/documentation/'))).toBe(false);
    expect(records).toHaveLength(6);
  });

  it('derives symbols from the slug pattern', async () => {
    const site = guide({ symbolsFromSlug: '^api-reference/([^/]+)/$' });
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/api-reference/gauge/')).toMatchObject({
      symbol: 'gauge',
      symbolKind: 'type',
      kind: 'api',
      title: 'Gauge',
    });
    expect(recordAt(records, '/get-started/').symbol).toBeUndefined();
  });

  it('ignores a slug pattern that does not compile', async () => {
    const site = guide({ symbolsFromSlug: '^api-reference/([^/]+' });
    const records = await enumerate(site.ctx(), site.bound());
    expect(records.every((record) => record.symbol === undefined)).toBe(true);
  });
});

describe('pageKind', () => {
  const src = guide().bound();

  it.each([
    ['release-notes/', 'release-notes'],
    ['release-notes/release-notes-2-4-0/', 'release-notes'],
    ['whats-new-world-geocoding-service/', 'release-notes'],
    ['guide/changelog/', 'release-notes'],
    ['tutorials/add-a-layer/', 'tutorial'],
    ['sample-code/Routing/', 'sample'],
    ['sample-code/', 'guide'],
    ['api-reference/gauge/', 'api'],
    ['notes-on-releases/', 'guide'],
    ['', 'guide'],
  ] as const)('classifies %s as %s', (rel, kind) => {
    expect(pageKind(src, rel)).toBe(kind);
  });

  it('prefers the page type of the store, and the kind of a symbol over both', () => {
    expect(pageKind(src, 'layers/intro/', { pageType: 'Tutorial' })).toBe('tutorial');
    expect(pageKind(src, 'layers/intro/', { pageType: 'Sample' })).toBe('sample');
    expect(pageKind(src, 'whats-new/', { symbolKind: 'api' })).toBe('api');
  });
});

describe('gatsby enumerate: degradation', () => {
  it('reads only the sitemap while site-index is off', async () => {
    const site = guide();
    const ctx = site.ctx({ policy: fakePolicy({ enabled: ['website'] }) });
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.requests.map((request) => request.url)).toEqual([`${D}/widgets/sitemap-0.xml`]);
    expect(records).toHaveLength(8);
    expect(recordAt(records, '/layers/feature-layers/').title).toBe('Feature layers');
    expect(recordAt(records, '/widgets/').title).toBe('Guide'); // the source title
  });

  it('rediscovers a rotated store once, with a revalidating request', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, 404);
    ctx.http.on(PAGE_DATA, {
      json: { result: { data: { search: { publicStoreURL: ROTATED } } }, staticQueryHashes: [] },
    });
    ctx.http.on(`${D}${ROTATED}`, {
      json: [{ title: 'Start here', url: '/get-started/', pageType: 'Topic' }],
    });
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(ctx.http.count(STORE)).toBe(1);
    expect(ctx.http.count(`${D}${ROTATED}`)).toBe(1);
    const pageDataRequests = ctx.http.requests.filter((request) => request.url === PAGE_DATA);
    expect(pageDataRequests[0]?.headers).toBeUndefined();
    expect(pageDataRequests[1]?.headers).toEqual({ 'Cache-Control': 'no-cache' });
    expect(recordAt(records, '/get-started/').title).toBe('Start here');
  });

  it('gives a rotated store up after one rediscovery and answers from the navigation', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/\.store\.json$/, 404);
    ctx.http.on(PAGE_DATA, {
      json: { result: { data: { search: { publicStoreURL: ROTATED } } }, staticQueryHashes: [] },
    });
    ctx.http.on(`${D}${ROTATED}`, { json: [] });
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(ctx.http.count(/\.store\.json$/)).toBe(2);
    expect(recordAt(records, '/get-started/').title).toBe('Get started'); // navigation title
    expect(recordAt(records, '/widgets/').title).toBe('Overview');
    expect(ctx.logger.entries.some((entry) => entry.msg.includes('not rediscovered'))).toBe(true);
  });

  it('does not ask twice when rediscovery names the same file', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, 404);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(STORE)).toBe(1);
    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(records).toHaveLength(8);
  });

  it.each([
    ['a 5xx', 503],
    ['an oversized body', 'oversized'],
    ['a truncated body', 'truncated'],
  ] as const)('continues without the store after %s', async (_label, fault) => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, fault);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(STORE)).toBe(1); // only a missing file triggers rediscovery
    expect(records).toHaveLength(8);
    expect(recordAt(records, '/widgets/').title).toBe('Overview');
  });

  it('stops asking a host that refused, and still lists the sitemap', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/\/page-data\//, 403);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count()).toBe(2);
    expect(records).toHaveLength(8);
  });

  it('lists from the index files when the sitemap is failing', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/sitemap-0\.xml$/, 503);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(/sitemap/)).toBe(1);
    expect(records.map((record) => record.title)).toContain('Dial');
    expect(records).toHaveLength(7); // everything but the sitemap-only page
  });

  it('fails with the sitemap error when nothing can be listed', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/.*/, 503);
    const error = await rejection(enumerate(ctx, site.bound()));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.url).toBe(`${D}/widgets/sitemap-0.xml`);
  });

  it('fails, not retryable, when the site lists no page under the base', async () => {
    const site = guide({ include: ['^nothing-like-this/'] });
    const error = await rejection(enumerate(site.ctx(), site.bound()));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.retryable).toBe(false);
  });

  it('rejects instead of returning a partial catalogue when the call budget runs out', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = bindSource(
      site.product,
      site.source,
      makeLine(),
      undefined,
      newBudget(1, 60_000, ctx.clock),
    );
    const error = await rejection(enumerate(ctx, src));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(ctx.http.count()).toBe(2); // the second request found the budget spent
  });

  it('wraps an unexpected exception as INTERNAL', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = site.bound();
    // A request outside the cassette makes the fake throw a plain Error.
    const elsewhere = bindSource(
      site.product,
      { ...site.source, config: { base: '/elsewhere/' } },
      src.line,
    );
    const error = await rejection(enumerate(ctx, elsewhere));
    expect(isMcpDocError(error) && error.code).toBe('INTERNAL');
  });

  it('lists nothing, and requests nothing, for a link-only line', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = bindSource(site.product, site.source, makeLine({ access: 'link-only' }));
    expect(await enumerate(ctx, src)).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });
});

describe('gatsby enumerate: static queries', () => {
  it('finds nav and search through staticQueryHashes', async () => {
    const site = rest();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.unrecorded).toEqual([]);
    expect(records).toHaveLength(6);
    // sitemap, page-data, five static queries (the pointers are in the last), store
    expect(ctx.http.count()).toBe(8);
    expect(recordAt(records, '/gadget-service/').title).toBe('Gadget Service');
  });

  it('remembers what each hash holds and skips the others next time', async () => {
    const site = rest();
    const ctx = site.ctx();
    await enumerate(ctx, site.bound());
    ctx.http.resetLog();
    const records = await enumerate(ctx, site.bound());
    expect(records).toHaveLength(6);
    expect(ctx.http.count(/\/sq\/d\//)).toBe(1);
    expect(ctx.http.count(/sq\/d\/3000000003\.json$/)).toBe(1);
    expect(ctx.http.count()).toBe(4);
  });

  it('uses the resource hierarchy as breadcrumb where it lists a page', async () => {
    const site = rest();
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/apply-changes-gadget-service/').breadcrumb).toBe(
      'Gadget Root > Gadget Service',
    );
    expect(recordAt(records, '/query-gadget-layer/').breadcrumb).toBe(
      'Gadget Root > Gadget Service > Gadget Layer',
    );
    // Not in the hierarchy: the navigation folder.
    expect(recordAt(records, '/find-gadget-candidates/').breadcrumb).toBe('Operations');
  });

  it('skips a static query that fails and keeps looking', async () => {
    const site = rest();
    const ctx = site.ctx();
    ctx.http.fail(/sq\/d\/2000000002\.json$/, 503);
    const records = await enumerate(ctx, site.bound());
    expect(recordAt(records, '/gadget-service/').title).toBe('Gadget Service');
  });
});

describe('gatsby enumerate: sites with several sections', () => {
  it('reads the index of every section the seed page does not describe', async () => {
    const site = documentation();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(/page-data\/mapping\/layers\/page-data\.json$/)).toBe(1);
    expect(ctx.http.count(/page-data\/security\/oauth\/page-data\.json$/)).toBe(1);
    expect(ctx.http.count(/\.store\.json$/)).toBe(2);
    expect(ctx.http.count()).toBeLessThanOrEqual(MAX_ENUMERATE_REQUESTS);
    expect(recordAt(records, '/mapping/').title).toBe('Mapping introduction');
    expect(recordAt(records, '/security/tokens/').title).toBe('Tokens');
    expect(recordAt(records, '/mapping/tutorial-first-map/').kind).toBe('tutorial');
  });

  it('prefixes breadcrumbs with the section when there are several trees', async () => {
    const site = documentation();
    const records = await enumerate(site.ctx(), site.bound());
    expect(recordAt(records, '/mapping/layers/').breadcrumb).toBe('Mapping');
    expect(recordAt(records, '/security/oauth/').breadcrumb).toBe('Security');
  });

  it('stays inside the request cap when every section needs its own index', async () => {
    const site = documentation();
    const ctx = site.ctx();
    // Twenty sections of three pages each, none of which has page-data.
    const urls = Array.from({ length: 60 }, (_unused, i) => {
      const section = String(Math.floor(i / 3)).padStart(2, '0');
      return `<url><loc>${D}/documentation/s${section}/p${i}/</loc></url>`;
    });
    replaceResponse(ctx, 'documentation', `${D}/documentation/sitemap-0.xml`, {
      contentType: 'application/xml',
      body: `<urlset>${urls.join('')}</urlset>`,
    });
    ctx.http.fail(/page-data\/s\d\d\//, 404);
    const records = await enumerate(ctx, site.bound());

    // Sixty pages and the three glossary terms of the static query.
    expect(records).toHaveLength(63);
    expect(ctx.http.count()).toBeLessThanOrEqual(MAX_ENUMERATE_REQUESTS);
    // Eight further sections are asked, one page each; the rest keep their slug titles.
    expect(ctx.http.count(/page-data\/s\d\d\//)).toBe(8);
  });
});

describe('gatsby enumerate: site prefix above the source base', () => {
  it('walks up to the sitemap and keeps only pages under the base', async () => {
    const site = pythonApi();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(/sitemap-0\.xml$/)).toBe(2);
    const pages = records.filter((record) => !record.ref.includes('#'));
    expect(pages.map((record) => record.ref.slice(`${D}/pylib/latest/`.length))).toEqual([
      'api-reference/pylib.gis.toc.html',
      'api-reference/pylib.geocoding.html',
      'api-reference/pylib.features.html',
      'api-reference/',
    ]);
    expect(records.every((record) => record.kind === 'api')).toBe(true);
    expect(
      await ctx.cache.getDerived('misc', `gatsby-prefix:${D}/pylib/latest/api-reference/`),
    ).toBe(`${D}/pylib/latest/`);
  });

  it('asks a page of the section when the base page has no data', async () => {
    const site = pythonApi();
    const ctx = site.ctx();
    await enumerate(ctx, site.bound());
    expect(ctx.http.count(/page-data\/api-reference\/page-data\.json$/)).toBe(1);
    expect(
      ctx.http.count(/page-data\/api-reference\/pylib\.geocoding\.html\/page-data\.json$/),
    ).toBe(1);
    expect(ctx.http.count(/\.pagination\.json$/)).toBe(1);
  });

  it('falls back to slug titles for a guide whose pages have no index', async () => {
    const site = pythonGuide();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.unrecorded).toEqual([]);
    expect(records.map((record) => record.title)).toEqual(['Guide', 'Install', 'First notebook']);
    expect(records.some((record) => record.ref.includes('api-reference'))).toBe(false);
  });
});

describe('gatsby enumerate: indexes embedded in page-data', () => {
  it('reads the store and the page list from the page-data itself', async () => {
    const site = spec();
    const ctx = site.ctx();
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count()).toBe(2);
    expect(recordAt(records, '/objects/thingLayer/')).toMatchObject({
      title: 'thingLayer',
      symbol: 'thingLayer',
      symbolKind: 'type',
      kind: 'spec',
      breadcrumb: 'Objects',
      license: 'cc-by-nd',
    });
    expect(records).toHaveLength(4);
  });
});
