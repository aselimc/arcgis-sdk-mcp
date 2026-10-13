import { describe, expect, it } from 'vitest';
import { astroAdapter, parseSearchIndex } from '../../../../src/adapters/site/astro.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { McpDocError } from '../../../../src/core/errors.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf, replaceResponses } from '../contract.js';

const BASE = 'https://developers.arcgis.com/widgets/';
const SITEMAP = `${BASE}sitemap-0.xml`;
const GUIDE_INDEX = `${BASE}__starship-mdx/search/mdxPages.json`;
const SAMPLE_INDEX = `${BASE}sample-code-search.json`;
const WPF_INDEX = `${BASE}sample-code-wpf-search.json`;
const API_INDEX = `${BASE}references-search.json`;

const guide = makeSource(
  'astro',
  {
    base: '/widgets/',
    sitemap: 'sitemap-0.xml',
    searchIndexes: [
      { url: '__starship-mdx/search/mdxPages.json', role: 'guide' },
      { url: 'sample-code-search.json', role: 'sample' },
      { url: 'sample-code-wpf-search.json', role: 'sample', platform: 'wpf' },
    ],
    exclude: ['^api-reference/', '/live/$'],
    classify: [
      ['^tutorials/', 'tutorial'],
      ['^release-notes', 'release-notes'],
    ],
  },
  { probe: { url: '/widgets/sitemap-0.xml', expect: 'xml', minRecords: 5 } },
);
const core = makeSource(
  'astro',
  {
    base: '/widgets/',
    searchIndexes: [{ url: 'references-search.json', role: 'api' }],
    include: ['^references/core/'],
  },
  {
    id: 'core',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: 'references-search.json', expect: 'json', minRecords: 10 },
  },
);
const product = makeProduct({ sources: [guide, core] });

const guideCassette = () => loadCassette('cassettes', 'site', 'core', 'astro-guide.json');
const apiCassette = () => loadCassette('cassettes', 'site', 'core', 'astro-api.json');
const guideCtx = (): TestCtx => makeCtx({ cassette: guideCassette() });
const apiCtx = (): TestCtx => makeCtx({ cassette: apiCassette() });
const boundGuide = () => bindSource(product, guide, makeLine());
const boundCore = () => bindSource(product, core, makeLine());

const byRef = (records: CatalogRecord[]) => new Map(records.map((record) => [record.ref, record]));
const envelope = (storedFields: unknown) => ({ index: JSON.stringify({ storedFields }) });

describeSiteAdapterContract('astro guide (sitemap + search indexes)', () => ({
  adapter: astroAdapter,
  product,
  source: guide,
  ctx: guideCtx,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 9,
  readRef: `${BASE}get-started/`,
  siteIndexFiles: [/search.*\.json$/],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, guideCassette(), {
          [GUIDE_INDEX]: {
            json: envelope({ 0: { heading: 'Get started', href: '/get-started/' } }),
          },
        }),
      outcome: 'degraded',
      minRecords: 6,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(SITEMAP, 404),
      outcome: 'degraded',
      minRecords: 6,
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, guideCassette(), {
          [SITEMAP]: { body: '<urlset></urlset>' },
          [GUIDE_INDEX]: { json: envelope({}) },
          [SAMPLE_INDEX]: { json: envelope({}) },
          [WPF_INDEX]: { json: envelope({}) },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(/\.json$/, 'html'),
      outcome: 'degraded',
      minRecords: 6,
    },
  },
}));

describeSiteAdapterContract('astro API reference (symbol index only)', () => ({
  adapter: astroAdapter,
  product,
  source: core,
  ctx: apiCtx,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 15,
  readRef: `${BASE}references/core/drawing/Canvas/#draw`,
  siteIndexFiles: [API_INDEX],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, apiCassette(), {
          [API_INDEX]: {
            json: envelope({ 0: { name: 'Canvas', path: '/references/core/drawing/Canvas/' } }),
          },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: { arrange: (ctx) => ctx.http.fail(API_INDEX, 404), outcome: 'typed-failure' },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, apiCassette(), { [API_INDEX]: { json: envelope({}) } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(API_INDEX, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
  },
}));

describe('astro: enumerate a guide', () => {
  it('merges the sitemap with the search indexes, the index entry winning', async () => {
    const ctx = guideCtx();
    const records = byRef(await astroAdapter.enumerate!(ctx, boundGuide()));

    expect([...records.keys()].sort()).toEqual(
      [
        BASE,
        `${BASE}get-started/`,
        `${BASE}layers/feature-layers/`,
        `${BASE}offline/maps/`,
        `${BASE}release-notes/`,
        `${BASE}sample-code/add-tile-layer/`,
        `${BASE}sample-code/draw-circle/`,
        `${BASE}tutorials/first-map/`,
        `${BASE}wpf/sample-code/draw-circle/`,
      ].sort(),
    );
    expect(records.get(`${BASE}get-started/`)).toMatchObject({
      title: 'Get started',
      kind: 'guide',
      description: 'Install the package and place a first widget.',
      breadcrumb: 'Introduction',
      boost: 2,
      license: 'esri-website-terms',
    });
    // Whatever spacing the site uses around ">", the project's separator comes out.
    expect(records.get(`${BASE}layers/feature-layers/`)?.breadcrumb).toBe('Layers > Vector layers');
    expect(ctx.http.count()).toBe(4);
  });

  it('classifies by the source rules and keeps slug titles for pages no index knows', async () => {
    const records = byRef(await astroAdapter.enumerate!(guideCtx(), boundGuide()));
    expect(records.get(`${BASE}tutorials/first-map/`)).toMatchObject({
      kind: 'tutorial',
      title: 'Build your first map',
    });
    expect(records.get(`${BASE}release-notes/`)).toMatchObject({
      kind: 'release-notes',
      title: 'Release notes',
    });
    // The base page has no slug; it is named after the source.
    expect(records.get(BASE)?.title).toBe('Guide');
  });

  it('gives sample entries a trailing slash, kind sample and the platform of their index', async () => {
    const records = byRef(await astroAdapter.enumerate!(guideCtx(), boundGuide()));
    expect(records.get(`${BASE}sample-code/draw-circle/`)).toMatchObject({
      kind: 'sample',
      title: 'Draw a circle',
      breadcrumb: 'Graphics',
    });
    expect(records.get(`${BASE}sample-code/draw-circle/`)?.platform).toBeUndefined();
    expect(records.get(`${BASE}wpf/sample-code/draw-circle/`)).toMatchObject({
      kind: 'sample',
      platform: 'wpf',
    });
  });

  it('applies the exclude filter to sitemap and index entries alike', async () => {
    const refs = (await astroAdapter.enumerate!(guideCtx(), boundGuide())).map((r) => r.ref);
    expect(refs.filter((ref) => /api-reference|\/live\/|gadgets/.test(ref))).toEqual([]);
  });

  it('falls back to slug titles when site-index is off', async () => {
    const ctx = guideCtx();
    ctx.policy = fakePolicy({ enabled: ['website'] });
    const records = byRef(await astroAdapter.enumerate!(ctx, boundGuide()));

    expect(ctx.http.count()).toBe(1);
    expect(records.size).toBe(6);
    expect(records.get(`${BASE}layers/feature-layers/`)?.title).toBe('Feature layers');
    // The sitemap rung still knows a sample page by its path.
    expect(records.get(`${BASE}sample-code/draw-circle/`)).toMatchObject({
      kind: 'sample',
      title: 'Draw circle',
    });
  });

  it('continues without a failing secondary index and says so in the log', async () => {
    const ctx = guideCtx();
    ctx.http.fail(WPF_INDEX, 503);
    const records = await astroAdapter.enumerate!(ctx, boundGuide());
    expect(records).toHaveLength(8);
    expect(ctx.logger.messages('warn')).toEqual([
      'Search index sample-code-wpf-search.json is unavailable; enumerating without it',
    ]);
  });

  it('rejects instead of returning a partial catalogue when the request budget runs out', async () => {
    const ctx = guideCtx();
    const src = bindSource(product, guide, makeLine(), undefined, newBudget(2, 60_000, ctx.clock));
    await expect(astroAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: SAMPLE_INDEX },
    });
  });

  it('answers LINK_ONLY for a link-only line without a request', async () => {
    const ctx = guideCtx();
    const src = bindSource(product, guide, makeLine({ id: 'v1', access: 'link-only' }));
    await expect(astroAdapter.enumerate!(ctx, src)).rejects.toMatchObject({ code: 'LINK_ONLY' });
    expect(ctx.http.count()).toBe(0);
  });

  it('returns nothing, without failing, when its only inputs need site-index', async () => {
    const ctx = apiCtx();
    ctx.policy = fakePolicy({ enabled: ['website'] });
    await expect(astroAdapter.enumerate!(ctx, boundCore())).resolves.toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });

  it('substitutes line variables into the base', async () => {
    const versioned = makeSource('astro', { base: '/widgets/{prefix}', sitemap: 'sitemap-0.xml' });
    const ctx = makeCtx();
    ctx.http.on('https://developers.arcgis.com/widgets/v2/sitemap-0.xml', {
      body: '<urlset><url><loc>https://developers.arcgis.com/widgets/v2/maps/</loc></url><url><loc>https://developers.arcgis.com/widgets/maps/</loc></url></urlset>',
    });
    const line = makeLine({ id: 'v2', current: false, vars: { prefix: 'v2/' } });
    const records = await astroAdapter.enumerate!(
      ctx,
      bindSource(makeProduct({ sources: [versioned] }), versioned, line),
    );
    expect(records.map((record) => [record.ref, record.line])).toEqual([
      ['https://developers.arcgis.com/widgets/v2/maps/', 'v2'],
    ]);
  });
});

describe('astro: API symbol records', () => {
  const symbols = async () => byRef(await astroAdapter.enumerate!(apiCtx(), boundCore()));
  const CANVAS = `${BASE}references/core/drawing/Canvas/`;
  const UNITS = `${BASE}references/core/support/units/`;
  const CPP = `${BASE}references/core/cpp/`;

  it('qualifies a type with its breadcrumb and leaves it without a parent', async () => {
    expect((await symbols()).get(`${CANVAS}#Canvas`)).toMatchObject({
      kind: 'api',
      title: 'Canvas',
      symbol: 'Canvas',
      qualified: '@example/widgets-core/Canvas',
      symbolKind: 'class',
      breadcrumb: '@example/widgets-core',
      boost: 0.5,
    });
    expect((await symbols()).get(`${CANVAS}#Canvas`)?.parent).toBeUndefined();
  });

  it('makes a member of every anchored entry whose breadcrumb names a type', async () => {
    const records = await symbols();
    expect(records.get(`${CANVAS}#draw`)).toMatchObject({
      title: 'draw()',
      symbol: 'draw',
      qualified: '@example/widgets-core/Canvas.draw',
      parent: '@example/widgets-core/Canvas',
      symbolKind: 'method',
    });
    expect(records.get(`${CANVAS}#event-redraw`)).toMatchObject({
      symbol: 'redraw',
      parent: '@example/widgets-core/Canvas',
      symbolKind: 'event',
    });
    // A property of a type declared inside a module page belongs to that type.
    expect(records.get(`${CANVAS}#CanvasEvents-redraw`)).toMatchObject({
      qualified: '@example/widgets-core/drawing/Canvas/CanvasEvents.redraw',
      parent: '@example/widgets-core/drawing/Canvas/CanvasEvents',
    });
    expect(records.get(`${CANVAS}#%5BSymbol.iterator%5D`)).toMatchObject({
      symbol: '[Symbol.iterator]',
      parent: '@example/widgets-core/Canvas',
    });
  });

  it('keeps module-level functions and types top-level', async () => {
    const records = await symbols();
    expect(records.get(`${UNITS}#toPixels`)).toMatchObject({
      symbol: 'toPixels',
      qualified: '@example/widgets-core/support/units/toPixels',
      symbolKind: 'function',
    });
    expect(records.get(`${UNITS}#toPixels`)?.parent).toBeUndefined();
    expect(records.get(`${CANVAS}#CanvasEvents`)?.parent).toBeUndefined();
    expect(records.get(UNITS)).toMatchObject({ symbol: 'units', symbolKind: 'module' });
  });

  it('keeps the first of two entries with the same URL', async () => {
    expect((await symbols()).get(`${UNITS}#UnitKinds`)).toMatchObject({
      symbolKind: 'type',
      boost: 0.3,
    });
  });

  it('reads indexes without package breadcrumbs (class pages, member anchors, plain pages)', async () => {
    const records = await symbols();
    expect(records.get(`${CPP}renderer.html`)).toMatchObject({
      symbol: 'Renderer',
      qualified: 'Renderer',
      symbolKind: 'class',
    });
    expect(records.get(`${CPP}renderer.html#paint`)).toMatchObject({
      qualified: 'Renderer.paint',
      parent: 'Renderer',
      symbolKind: 'function',
    });
    expect(records.get(`${CPP}rendertypes-h.html#BlendMode-enum`)).toMatchObject({
      symbol: 'BlendMode',
      symbolKind: 'enumeration',
    });
    // Titles that are not names stay pages: searchable, but not symbols.
    expect(records.get(`${CPP}rendertypes-h.html`)?.symbol).toBeUndefined();
    expect(records.get(`${CPP}class-list.html`)).toMatchObject({
      kind: 'api',
      title: 'All classes',
    });
    expect(records.get(`${CPP}class-list.html`)?.symbol).toBeUndefined();
  });

  it('leaves out entries of other sources that share the index', async () => {
    const refs = [...(await symbols()).keys()];
    expect(refs.some((ref) => ref.includes('/references/components/'))).toBe(false);
    expect(refs).toHaveLength(16);
  });

  it('derives type symbols from page slugs when the source says so', async () => {
    const spec = makeSource(
      'astro',
      { base: '/widgets/', sitemap: 'sitemap-0.xml', symbolsFromSlug: '^objects/(.+)/$' },
      { kinds: ['spec', 'api'] },
    );
    const ctx = makeCtx();
    ctx.http.on(SITEMAP, {
      body: `<urlset><url><loc>${BASE}objects/layerDefinition/</loc></url><url><loc>${BASE}objects/rest/job/</loc></url><url><loc>${BASE}overview/</loc></url></urlset>`,
    });
    const records = byRef(
      await astroAdapter.enumerate!(
        ctx,
        bindSource(makeProduct({ sources: [spec] }), spec, makeLine()),
      ),
    );
    expect(records.get(`${BASE}objects/layerDefinition/`)).toMatchObject({
      kind: 'api',
      title: 'layerDefinition',
      symbol: 'layerDefinition',
      qualified: 'layerDefinition',
      symbolKind: 'type',
    });
    expect(records.get(`${BASE}objects/rest/job/`)).toMatchObject({
      symbol: 'job',
      qualified: 'rest.job',
    });
    expect(records.get(`${BASE}overview/`)).toMatchObject({ kind: 'spec' });
    expect(records.get(`${BASE}overview/`)?.symbol).toBeUndefined();
  });
});

describe('astro: parseSearchIndex', () => {
  const url = GUIDE_INDEX;
  const failure = (data: unknown): unknown => {
    try {
      parseSearchIndex(data, url);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('reads storedFields from the JSON string, and from an object should the site change', () => {
    const stored = { 0: { title: ' A ', url: '/a/', boost: 0, pageType: '' } };
    expect(parseSearchIndex(envelope(stored), url)).toEqual([{ title: 'A', url: '/a/' }]);
    expect(parseSearchIndex({ index: { storedFields: stored } }, url)).toEqual([
      { title: 'A', url: '/a/' },
    ]);
  });

  it.each([
    ['a missing envelope', null],
    ['an index that is not JSON', { index: '{"storedFields":' }],
    ['a missing storedFields member', { index: '{"documents":{}}' }],
    ['an empty index', envelope({})],
    ['renamed fields', envelope({ 0: { name: 'A', path: '/a/' }, 1: null })],
  ])('reports %s as a typed, non-retryable failure', (_, data) => {
    const error = failure(data);
    expect(error).toBeInstanceOf(McpDocError);
    expect(error).toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url, host: 'developers.arcgis.com', retryable: false },
    });
  });
});

describe('astro: read, symbol, sample, probe', () => {
  it('reads a page through the html renderer with provenance and the requested kind', async () => {
    const ctx = guideCtx();
    const page = await astroAdapter.read(ctx, boundGuide(), {
      url: new URL(`${BASE}get-started/#install`),
      select: { section: 'install' },
      focusedCode: true,
    });

    expect(page).toMatchObject({
      ref: `${BASE}get-started/#install`,
      url: `${BASE}get-started/`,
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      kind: 'guide',
      cache: 'miss',
    });
    expect(page.attribution).toContain(`${BASE}get-started/`);
    expect(ctx.http.requests).toMatchObject([{ url: `${BASE}get-started/`, expect: 'html' }]);
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'html',
      opts: { select: { section: 'install' }, focusedCode: true },
    });
  });

  it('infers the kind from the path when no record is given', async () => {
    const ctx = guideCtx();
    ctx.http.on(/widgets\/(tutorials|elsewhere)\//, { body: '<main><h1>Page</h1></main>' });
    const kindOf = async (ref: string) =>
      (await astroAdapter.read(ctx, boundGuide(), { url: new URL(ref) })).kind;

    expect(await kindOf(`${BASE}sample-code/draw-circle/`)).toBe('sample');
    expect(await kindOf(`${BASE}tutorials/first-map/`)).toBe('tutorial');
  });

  it('reports the landing URL and the hops when the gateway followed a redirect', async () => {
    const ctx = guideCtx();
    ctx.http.on(`${BASE}old-name/`, {
      body: '<main><h1>New name</h1></main>',
      finalUrl: `${BASE}new-name/`,
      aliasChain: [`${BASE}old-name/`],
    });
    const page = await astroAdapter.read(ctx, boundGuide(), {
      url: new URL(`${BASE}old-name/#setup`),
    });
    expect(page.ref).toBe(`${BASE}new-name/#setup`);
    expect(page.redirectedFrom).toEqual([`${BASE}old-name/`]);
  });

  it('passes the family of the source probe as a hint', async () => {
    const hinted = { ...core, probe: { ...core.probe, family: 'astro-js-ref' as const } };
    const ctx = apiCtx();
    await astroAdapter.read(ctx, bindSource(product, hinted, makeLine()), {
      url: new URL(`${BASE}references/core/drawing/Canvas/`),
    });
    expect(rendererOf(ctx).calls[0]?.input).toMatchObject({ familyHint: 'astro-js-ref' });
  });

  it('looks a symbol up by its anchor, decoded', async () => {
    const ctx = apiCtx();
    const records = byRef(await astroAdapter.enumerate!(ctx, boundCore()));
    const iterator = records.get(`${BASE}references/core/drawing/Canvas/#%5BSymbol.iterator%5D`)!;
    const page = await astroAdapter.symbol!(ctx, boundCore(), iterator, 'signature');

    expect(page.kind).toBe('api');
    expect(rendererOf(ctx).calls.at(-1)?.opts).toEqual({
      select: { member: '[Symbol.iterator]' },
      detail: 'signature',
    });
  });

  it('reads a type page whole when its record has no anchor', async () => {
    const ctx = apiCtx();
    ctx.http.on(`${BASE}references/core/support/units/`, { body: '<main><h1>units</h1></main>' });
    const records = byRef(await astroAdapter.enumerate!(ctx, boundCore()));
    await astroAdapter.symbol!(
      ctx,
      boundCore(),
      records.get(`${BASE}references/core/support/units/`)!,
      'full',
    );
    expect(rendererOf(ctx).calls.at(-1)?.opts).toEqual({ detail: 'full' });
  });

  it('reads a sample page as kind sample', async () => {
    const ctx = guideCtx();
    const records = byRef(await astroAdapter.enumerate!(ctx, boundGuide()));
    const page = await astroAdapter.sample!(
      ctx,
      boundGuide(),
      records.get(`${BASE}sample-code/draw-circle/`)!,
    );
    expect(page).toMatchObject({ kind: 'sample', ref: `${BASE}sample-code/draw-circle/` });
  });

  it('probes the sitemap and counts its entries', async () => {
    const result = await astroAdapter.probe(guideCtx(), boundGuide());
    expect(result).toMatchObject({ ok: true, records: 9 });
  });

  it('probes a search index by counting stored documents, and not at all without site-index', async () => {
    expect(await astroAdapter.probe(apiCtx(), boundCore())).toMatchObject({
      ok: true,
      records: 18,
    });

    const ctx = apiCtx();
    ctx.policy = fakePolicy({ enabled: ['website'] });
    expect(await astroAdapter.probe(ctx, boundCore())).toMatchObject({
      ok: false,
      error: 'Capability "site-index" is switched off',
    });
    expect(ctx.http.count()).toBe(0);
  });

  it('fails the probe when the index shrinks below the expected size', async () => {
    const ctx = apiCtx();
    const small = { ...core, probe: { ...core.probe, minRecords: 500 } };
    expect(await astroAdapter.probe(ctx, bindSource(product, small, makeLine()))).toMatchObject({
      ok: false,
      records: 18,
      error: 'Expected at least 500 records, found 18',
    });
  });
});
