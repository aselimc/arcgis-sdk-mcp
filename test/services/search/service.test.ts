import { describe, expect, it } from 'vitest';
import { decodeCursor } from '../../../src/core/cursor.js';
import { McpDocError } from '../../../src/core/errors.js';
import type { SearchProvider } from '../../../src/core/ports.js';
import type { SearchHit } from '../../../src/core/types.js';
import { createIndexService } from '../../../src/services/index/service.js';
import { createSearchService } from '../../../src/services/search/service.js';
import { makeDocPage, makeHit, makeRecord } from '../../support/builders.js';
import { HOUR } from '../../support/fake-clock.js';
import { makeCall } from '../../support/make-ctx.js';
import { JS_RECORDS, jsSdk, kotlinSdk } from '../support/catalogue.js';
import { fakeVersions, makeHarness } from '../support/harness.js';
import { adapterRegistry, TestAdapter } from '../support/test-adapter.js';

const JS = 'https://developers.arcgis.com/javascript/latest';

const unavailable = new McpDocError('UPSTREAM_UNAVAILABLE', 'developers.arcgis.com is not responding', {
  why: 'HTTP 503',
  retryable: true,
});

describe('search scope', () => {
  it('searches the named product and echoes how it was resolved', async () => {
    const h = makeHarness({ labels: { 'js-maps-sdk/latest': '5.1' } });
    const response = await h.services.search.search({ query: 'cluster points', product: 'javascript', limit: 3 }, h.call());
    expect(response.scope).toEqual({ products: ['js-maps-sdk'], resolvedFrom: 'javascript', line: 'latest' });
    expect(response.mode).toBe('local');
    expect(response.hits[0]).toMatchObject({
      ref: `${JS}/clustering/`,
      match: 'title',
      version: '5.1',
      breadcrumb: 'Guide > Visualization',
      excerpt: 'Group nearby point features into clusters that grow with zoom level.',
    });
    expect(response.notes).toEqual([]);
  });

  it('narrows to one source with product/section', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'search', product: 'rest-api/portal', limit: 5 }, h.call());
    expect(response.scope.sources).toEqual(['portal']);
    expect(new Set(response.hits.map((hit) => hit.source))).toEqual(new Set(['portal']));
    expect(h.adapter('javadoc').calls.map((call) => call.source)).toEqual(['portal']);
  });

  it('uses the one SDK detected in the project and says so', async () => {
    const h = makeHarness({
      workspace: [{ product: 'kotlin-maps-sdk', package: 'com.esri:arcgis-maps-kotlin', version: '300.0.0', file: 'build.gradle.kts' }],
    });
    const response = await h.services.search.search({ query: 'offline', limit: 3 }, h.call());
    expect(response.scope.products).toEqual(['kotlin-maps-sdk']);
    expect(response.scope.resolvedFrom).toBe('workspace');
    expect(response.notes[0]).toContain('detected in the project');
  });

  it('lets the router pick at most three products and names them', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'featurelayer offline rest', limit: 5 }, h.call());
    expect(response.scope.products.length).toBeLessThanOrEqual(3);
    expect(response.scope.products).toEqual(expect.arrayContaining(['js-maps-sdk', 'kotlin-maps-sdk']));
    expect(response.notes[0]).toMatch(/^Scope: .*most likely products/);
  });

  it('takes the product a symbol-shaped query names', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'arcgis-map', limit: 3 }, h.call());
    expect(response.scope).toMatchObject({ products: ['js-maps-sdk'], resolvedFrom: 'query' });
  });

  it('answers a query that names no product with guidance instead of an error', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'zzzz qqqq', limit: 3 }, h.call());
    expect(response).toMatchObject({ total: 0, hits: [], scope: { products: [] } });
    expect(response.notes[0]).toContain('No product matched the query');
    expect(response.notes.at(-1)).toContain('does not prove');
  });

  it('rejects an unknown product and an unknown version', async () => {
    const h = makeHarness();
    await expect(h.services.search.search({ query: 'map', product: 'nope', limit: 3 }, h.call())).rejects.toMatchObject({
      code: 'UNKNOWN_PRODUCT',
    });
    await expect(
      h.services.search.search({ query: 'map', product: 'js-maps-sdk', version: '1.0', limit: 3 }, h.call()),
    ).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
  });

  it('leaves out routed products that lack the requested version line', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'kotlin javascript offline map', version: 'v200', limit: 5 }, h.call());
    expect(response.scope.products).toEqual(['kotlin-maps-sdk']);
    expect(response.scope.line).toBe('v200');
    expect(new Set(response.hits.map((hit) => hit.line))).toEqual(new Set(['v200']));
  });
});

describe('search pipeline', () => {
  it('puts exact symbol matches first', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'applyEdits', product: 'js-maps-sdk', limit: 5 }, h.call());
    expect(response.hits[0]).toMatchObject({
      title: 'FeatureLayer.applyEdits',
      match: 'symbol',
      symbolKind: 'method',
    });
    // Pages that only mention the name follow.
    expect(response.hits.map((hit) => hit.ref)).toContain(`${JS}/editing/`);
  });

  it('falls back to text search when a camelCase word names no symbol', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'OAuth', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(response.hits[0]?.ref).toBe(`${JS}/authentication/`);
  });

  it('filters by kind, counting it in the total', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'cluster', product: 'js-maps-sdk', kind: 'sample', limit: 5 }, h.call());
    expect(response.scope.kind).toBe('sample');
    expect(response.hits.map((hit) => hit.kind)).toEqual(['sample']);
    expect(response.total).toBe(1);
  });

  it('returns each page once when two sources list it', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'FeatureLayer', product: 'js-maps-sdk', limit: 20 }, h.call());
    const refs = response.hits.map((hit) => hit.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(response.hits[0]).toMatchObject({ source: 'core', title: 'FeatureLayer' });
  });

  it('finds text of pages read earlier through the body index', async () => {
    const h = makeHarness();
    const before = await h.services.search.search({ query: 'debounce interval', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(before.total).toBe(0);

    h.index.addBody(
      makeDocPage({
        url: `${JS}/popups/`,
        product: 'js-maps-sdk',
        markdown: '# Configure popups\n\nIntro.\n\n## Performance\n\nSet a debounce interval for hover popups.',
      }),
    );
    const after = await h.services.search.search({ query: 'debounce interval', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(after.hits[0]).toMatchObject({
      ref: `${JS}/popups/#performance`,
      match: 'body',
      excerpt: 'Set a debounce interval for hover popups.',
    });
  });

  it('ranks a retired product below a live one for the same title', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'FeatureLayer', limit: 10 }, h.call());
    expect(response.scope.products).toEqual(expect.arrayContaining(['js-maps-sdk', 'arcobjects']));
    const products = response.hits.map((hit) => hit.product);
    expect(products[0]).not.toBe('arcobjects');
    expect(products.indexOf('arcobjects')).toBeGreaterThan(products.indexOf('js-maps-sdk'));
  });

  it('down-weights another version line that happens to be loaded', async () => {
    const h = makeHarness();
    await h.services.search.search({ query: 'offline', product: 'kotlin-maps-sdk', version: 'v200', limit: 3 }, h.call());
    const response = await h.services.search.search({ query: 'take a map offline', product: 'kotlin-maps-sdk', limit: 5 }, h.call());
    const current = response.hits.find((hit) => hit.ref.endsWith('/kotlin/offline-maps/'));
    const lts = response.hits.find((hit) => hit.ref.endsWith('/kotlin/v200/offline-maps/'));
    expect(response.hits[0]).toBe(current);
    expect(lts?.line).toBe('v200');
    // Same title and rank class, so the gap is the line weight.
    expect(lts?.score).toBeLessThan((current?.score ?? 0) * 0.5);
  });

  it('caps excerpts at 240 characters', async () => {
    const long = makeRecord({
      ref: 'https://developers.arcgis.com/widgets/long/',
      title: 'Verbose widget',
      description: 'lorem ipsum '.repeat(60),
    });
    const own = makeHarness({ records: [...JS_RECORDS, { ...long, product: 'js-maps-sdk' }] });
    const response = await own.services.search.search({ query: 'verbose widget', product: 'js-maps-sdk', limit: 1 }, own.call());
    expect(response.hits[0]?.excerpt?.length).toBeLessThanOrEqual(240);
  });
});

describe('search paging', () => {
  it('continues with a cursor and stops at the end', async () => {
    const h = makeHarness();
    const request = { query: 'feature', product: 'js-maps-sdk', limit: 3 };
    const first = await h.services.search.search(request, h.call());
    expect(first.hits).toHaveLength(3);
    expect(first.total).toBeGreaterThan(3);
    expect(first.nextCursor).toBeDefined();
    expect(decodeCursor(first.nextCursor ?? '', 'arcgis_docs_search').o).toBe(3);

    const seen = new Set(first.hits.map((hit) => hit.ref));
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor !== undefined) {
      const page = await h.services.search.search({ ...request, cursor }, h.call());
      for (const hit of page.hits) {
        expect(seen.has(hit.ref)).toBe(false);
        seen.add(hit.ref);
      }
      cursor = page.nextCursor;
      pages += 1;
    }
    expect(seen.size).toBe(first.total);
    expect(pages).toBe(Math.ceil(first.total / 3));
  });

  it('rejects a cursor of another query, another tool, or garbage, with the restart call', async () => {
    const h = makeHarness();
    const first = await h.services.search.search({ query: 'feature', product: 'js-maps-sdk', limit: 2 }, h.call());
    const other = { query: 'layer', product: 'js-maps-sdk', limit: 2 };
    await expect(h.services.search.search({ ...other, cursor: first.nextCursor ?? '' }, h.call())).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { next: 'arcgis_docs_search({"query":"layer","product":"js-maps-sdk"})' },
    });
    await expect(h.services.search.search({ ...other, cursor: '!!!' }, h.call())).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });
  });

  it('expires a cursor when the index behind it was rebuilt with other content', async () => {
    const h = makeHarness();
    const request = { query: 'feature', product: 'js-maps-sdk', limit: 2 };
    const first = await h.services.search.search(request, h.call());
    h.ctx.clock.advance(25 * HOUR);
    h.adapter('gatsby').addRecords([
      makeRecord({ product: 'js-maps-sdk', ref: `${JS}/new-feature-page/`, title: 'A new feature page' }),
    ]);
    await expect(h.services.search.search({ ...request, cursor: first.nextCursor ?? '' }, h.call())).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });
  });
});

describe('search degradation', () => {
  it('explains zero hits: other kinds, site search, and that absence is not proof', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'authentication', product: 'js-maps-sdk', kind: 'sample', limit: 3 }, h.call());
    expect(response.total).toBe(0);
    expect(response.notes).toEqual([
      'Other content types have hits: repeat without "kind", or with kind "guide".',
      expect.stringContaining('ARCGIS_DOCS_SOURCES=+site-search'),
      expect.stringContaining('does not prove'),
    ]);
  });

  it('names the nearest other product when the scope has no hit', async () => {
    const h = makeHarness();
    const response = await h.services.search.search({ query: 'kotlin geodatabase', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(response.total).toBe(0);
    expect(response.notes).toContain('Nearest other product for this query: kotlin-maps-sdk.');
  });

  it('says which sources were not searched while their index is building', async () => {
    const h = makeHarness({ config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } } });
    const release = h.adapter('astro').block('enumerate');
    const response = await h.services.search.search({ query: 'cluster points', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(response.notes).toContain('not searched yet: js-maps-sdk/core (index is building, retry)');
    release();
    await h.index.idle();
  });

  it('answers from a stale index and labels it', async () => {
    const h = makeHarness();
    await h.services.search.search({ query: 'cluster', product: 'js-maps-sdk', limit: 1 }, h.call());
    h.ctx.clock.advance(25 * HOUR);
    h.adapter('gatsby').failOn('enumerate', unavailable);
    const response = await h.services.search.search({ query: 'cluster points', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(response.notes).toContainEqual(
      expect.stringMatching(/^degraded: js-maps-sdk\/guide answered from an older index snapshot: UPSTREAM_UNAVAILABLE/),
    );
  });

  it('falls back to the product card when nothing can be searched', async () => {
    const h = makeHarness();
    for (const type of ['gatsby', 'astro', 'npm-dts', 'docc'] as const) {
      h.adapter(type).failOn('enumerate', unavailable);
    }
    const response = await h.services.search.search({ query: 'reticulate splines', product: 'js-maps-sdk', limit: 5 }, h.call());
    expect(response.hits.map((hit) => hit.ref)).toEqual([`${JS}/`, `${JS}/get-started/`]);
    expect(response.hits[0]).toMatchObject({ title: 'Maps SDK for JavaScript', match: 'title' });
    expect(response.notes).toContainEqual(expect.stringMatching(/^degraded: no search index is available/));
    expect(response.notes).toContainEqual(expect.stringMatching(/^degraded: js-maps-sdk\/guide has no index/));
  });

  it('skips sources whose capability is off and says how to enable them', async () => {
    const h = makeHarness({ enabled: ['github', 'package-cdn'] });
    const response = await h.services.search.search({ query: 'FeatureLayer', product: 'js-maps-sdk', limit: 5 }, h.call());
    expect(response.hits.map((hit) => hit.source)).toEqual(['typings']);
    expect(response.notes).toContainEqual(expect.stringContaining('not searched: js-maps-sdk/guide: capability "website" is switched off'));
  });

  it('survives a version service that fails', async () => {
    const h = makeHarness();
    const ctx = h.ctx;
    const index = createIndexService(ctx, adapterRegistry([new TestAdapter('gatsby').setRecords(JS_RECORDS)]));
    const search = createSearchService({
      ctx,
      index,
      versions: { ...fakeVersions(), label: async () => Promise.reject(new Error('oracle down')) },
      provider: { id: 'site-search', search: async () => [] },
    });
    const response = await search.search({ query: 'cluster points', product: 'js-maps-sdk', limit: 1 }, makeCall(ctx));
    expect(response.hits[0]?.version).toBeUndefined();
  });
});

describe('site search', () => {
  const ESEARCH = 'https://esearchapi.esri.com/search';
  const body = {
    search: {
      hits: [
        {
          score: 30,
          doc: { url: `${JS}/popups/?highlight=arcade`, title: 'Configure popups', description: 'ignored' },
          highlight: { content: ['Use <b>Arcade</b> expressions in a popup'] },
        },
        { score: 20, doc: { url: `${JS}/arcade-profiles/`, title: 'Arcade profiles', description: 'Where expressions run.' } },
        { score: 10, doc: { url: 'https://developers.arcgis.com/kotlin/arcade/', title: 'Another product' } },
      ],
    },
  };

  it('fuses remote hits when the capability is on', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search', 'github', 'package-cdn'] });
    h.ctx.http.on(ESEARCH, { json: body }, 'POST');
    const response = await h.services.search.search({ query: 'arcade expressions', product: 'js-maps-sdk', limit: 5 }, h.call());
    expect(response.mode).toBe('local+site');
    expect(response.hits.map((hit) => hit.ref)).toEqual(expect.arrayContaining([`${JS}/popups/`, `${JS}/arcade-profiles/`]));
    // Hits of other products are dropped, even when the remote filter let them through.
    expect(response.hits.map((hit) => hit.product)).not.toContain('kotlin-maps-sdk');
    const remoteOnly = response.hits.find((hit) => hit.ref === `${JS}/arcade-profiles/`);
    expect(remoteOnly).toMatchObject({ match: 'site', excerpt: 'Where expressions run.', source: 'guide' });
    expect(response.notes.join(' ')).not.toContain('+site-search');

    const sent = JSON.parse(h.ctx.http.requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({
      q: 'arcade expressions',
      index: 'developers_arcgis_v1',
      partialfields: 'Content-Location:developers%2Earcgis%2Ecom/javascript/latest',
      start: 0,
    });
  });

  it('answers locally when the remote fails', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search'] });
    h.ctx.http.on(ESEARCH, { json: body }, 'POST').fail(ESEARCH, 403);
    const response = await h.services.search.search({ query: 'cluster points', product: 'js-maps-sdk', limit: 3 }, h.call());
    expect(response.mode).toBe('local+site');
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
  });

  it('answers without a slow remote and includes its hits on the next call', async () => {
    const h = makeHarness();
    const index = createIndexService(h.ctx, adapterRegistry([new TestAdapter('gatsby').setRecords(JS_RECORDS)]));
    let release: (hits: SearchHit[]) => void = () => undefined;
    let calls = 0;
    const provider: SearchProvider = {
      id: 'site-search',
      search: () => {
        calls += 1;
        return new Promise<SearchHit[]>((resolve) => {
          release = resolve;
        });
      },
    };
    const ctx = { ...h.ctx, policy: { ...h.ctx.policy, enabled: () => true } };
    const search = createSearchService({ ctx, index, versions: fakeVersions(), provider, siteSoftDeadlineMs: 20 });
    const request = { query: 'cluster points', product: 'js-maps-sdk', limit: 5 };

    const first = await search.search(request, makeCall(ctx));
    expect(first.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(first.notes).toContainEqual(expect.stringContaining('Site search did not answer in time'));

    release([makeHit({ ref: `${JS}/late-page/`, title: 'Late page', product: 'js-maps-sdk', match: 'site' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await search.search(request, makeCall(ctx));
    expect(second.hits.map((hit) => hit.ref)).toContain(`${JS}/late-page/`);
    expect(calls).toBe(1);
  });

  it('never fails the search for a remote failure that is not an upstream error', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search', 'github'], products: [kotlinSdk, jsSdk] });
    // Nothing is recorded for the endpoint: the fake rejects with a plain Error.
    const response = await h.services.search.search({ query: 'offline', product: 'kotlin-maps-sdk', limit: 3 }, h.call());
    expect(response.mode).toBe('local+site');
    expect(response.hits[0]?.ref).toBe('https://developers.arcgis.com/kotlin/offline-maps/');
    expect(h.ctx.http.unrecorded).toEqual(['POST https://esearchapi.esri.com/search']);
  });

  it('reports local mode for a product the remote index does not cover', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search', 'github'] });
    const response = await h.services.search.search({ query: 'mcp', product: 'ai-agents', limit: 3 }, h.call());
    expect(response.mode).toBe('local');
    expect(h.ctx.http.requests).toEqual([]);
  });
});
