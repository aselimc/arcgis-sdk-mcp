import { describe, expect, it } from 'vitest';
import { decodeCursor } from '../../../src/core/cursor.js';
import { McpDocError } from '../../../src/core/errors.js';
import { createIndexService } from '../../../src/services/index/service.js';
import { createSearchService } from '../../../src/services/search/service.js';
import { makeRecord } from '../../support/builders.js';
import { HOUR } from '../../support/fake-clock.js';
import { makeCall } from '../../support/make-ctx.js';
import { JS_RECORDS, PRODUCTS } from '../support/catalogue.js';
import { fakeVersions, makeHarness } from '../support/harness.js';
import { adapterRegistry, TestAdapter } from '../support/test-adapter.js';

const JS = 'https://developers.arcgis.com/javascript/latest';

const unavailable = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com is not responding',
  {
    why: 'HTTP 503',
    retryable: true,
  },
);

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
    const first = await h.services.search.search(
      { query: 'feature', product: 'js-maps-sdk', limit: 2 },
      h.call(),
    );
    const other = { query: 'layer', product: 'js-maps-sdk', limit: 2 };
    await expect(
      h.services.search.search({ ...other, cursor: first.nextCursor ?? '' }, h.call()),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { next: 'arcgis_docs_search({"query":"layer","product":"js-maps-sdk"})' },
    });
    await expect(
      h.services.search.search({ ...other, cursor: '!!!' }, h.call()),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });
  });

  it('expires a cursor when the index behind it was rebuilt with other content', async () => {
    const h = makeHarness();
    const request = { query: 'feature', product: 'js-maps-sdk', limit: 2 };
    const first = await h.services.search.search(request, h.call());
    h.ctx.clock.advance(25 * HOUR);
    h.adapter('gatsby').addRecords([
      makeRecord({
        product: 'js-maps-sdk',
        ref: `${JS}/new-feature-page/`,
        title: 'A new feature page',
      }),
    ]);
    await expect(
      h.services.search.search({ ...request, cursor: first.nextCursor ?? '' }, h.call()),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });
  });
});

describe('search degradation', () => {
  it('explains zero hits: other kinds, site search, and that absence is not proof', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'authentication', product: 'js-maps-sdk', kind: 'sample', limit: 3 },
      h.call(),
    );
    expect(response.total).toBe(0);
    // The same search without the filter comes first, as a call that can be copied.
    expect(response.notes).toEqual([
      'Other content types have hits (the best is a "guide" page): repeat without "kind", arcgis_docs_search({"query":"authentication","product":"js-maps-sdk"}).',
      expect.stringContaining('ARCGIS_DOCS_SOURCES=+site-search'),
      expect.stringContaining('does not prove'),
    ]);
  });

  // Regression: a Flutter search for "route" named the R bridge as the nearest product, and
  // a Unity search the JavaScript SDK: whatever the router guessed from one word.
  it('names another product for a query without hits only when it is related to the scope', async () => {
    const related = PRODUCTS.map((product) =>
      product.id === 'js-maps-sdk' ? { ...product, related: ['kotlin-maps-sdk'] } : product,
    );
    const query = { query: 'kotlin geodatabase', product: 'js-maps-sdk', limit: 3 };
    const linked = makeHarness({ products: related });
    const withRelation = await linked.services.search.search(query, linked.call());
    expect(withRelation.total).toBe(0);
    expect(withRelation.notes).toContain('Nearest other product for this query: kotlin-maps-sdk.');

    const apart = makeHarness({
      products: PRODUCTS.map((product) => ({ ...product, related: [] })),
    });
    const without = await apart.services.search.search(query, apart.call());
    expect(without.notes.join('\n')).not.toContain('Nearest other product');
  });

  it('says which sources were not searched while their index is building', async () => {
    const h = makeHarness({
      config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } },
    });
    const release = h.adapter('astro').block('enumerate');
    const response = await h.services.search.search(
      { query: 'cluster points', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(response.notes).toContain(
      'not searched yet: js-maps-sdk/core (index is building, retry)',
    );
    release();
    await h.index.idle();
  });

  it('answers from a stale index and labels it', async () => {
    const h = makeHarness();
    await h.services.search.search(
      { query: 'cluster', product: 'js-maps-sdk', limit: 1 },
      h.call(),
    );
    h.ctx.clock.advance(25 * HOUR);
    h.adapter('gatsby').failOn('enumerate', unavailable);
    const response = await h.services.search.search(
      { query: 'cluster points', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(response.notes).toContainEqual(
      expect.stringMatching(
        /^degraded: js-maps-sdk\/guide answered from an older index snapshot: UPSTREAM_UNAVAILABLE/,
      ),
    );
  });

  it('falls back to the product card when nothing can be searched', async () => {
    const h = makeHarness();
    for (const type of ['gatsby', 'astro', 'npm-dts', 'docc'] as const) {
      h.adapter(type).failOn('enumerate', unavailable);
    }
    const response = await h.services.search.search(
      { query: 'reticulate splines', product: 'js-maps-sdk', limit: 5 },
      h.call(),
    );
    expect(response.hits.map((hit) => hit.ref)).toEqual([`${JS}/`, `${JS}/get-started/`]);
    expect(response.hits[0]).toMatchObject({ title: 'Maps SDK for JavaScript', match: 'title' });
    expect(response.notes).toContainEqual(
      expect.stringMatching(/^degraded: no search index is available/),
    );
    expect(response.notes).toContainEqual(
      expect.stringMatching(/^degraded: js-maps-sdk\/guide has no index/),
    );
  });

  it('skips sources whose capability is off and says how to enable them', async () => {
    const h = makeHarness({ enabled: ['github', 'package-cdn'] });
    const response = await h.services.search.search(
      { query: 'FeatureLayer', product: 'js-maps-sdk', limit: 5 },
      h.call(),
    );
    expect(response.hits.map((hit) => hit.source)).toEqual(['typings']);
    expect(response.notes).toContainEqual(
      expect.stringContaining(
        'not searched: js-maps-sdk/guide: capability "website" is switched off',
      ),
    );
  });

  it('survives a version service that fails', async () => {
    const h = makeHarness();
    const ctx = h.ctx;
    const index = createIndexService(
      ctx,
      adapterRegistry([new TestAdapter('gatsby').setRecords(JS_RECORDS)]),
    );
    const search = createSearchService({
      ctx,
      index,
      versions: { ...fakeVersions(), label: async () => Promise.reject(new Error('oracle down')) },
      provider: { id: 'site-search', search: async () => [] },
    });
    const response = await search.search(
      { query: 'cluster points', product: 'js-maps-sdk', limit: 1 },
      makeCall(ctx),
    );
    expect(response.hits[0]?.version).toBeUndefined();
  });
});
