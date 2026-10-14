import { describe, expect, it } from 'vitest';
import { makeDocPage, makeRecord } from '../../support/builders.js';
import { JS_RECORDS } from '../support/catalogue.js';
import { makeHarness } from '../support/harness.js';

const JS = 'https://developers.arcgis.com/javascript/latest';

describe('search scope', () => {
  it('searches the named product and echoes how it was resolved', async () => {
    const h = makeHarness({ labels: { 'js-maps-sdk/latest': '5.1' } });
    const response = await h.services.search.search(
      { query: 'cluster points', product: 'javascript', limit: 3 },
      h.call(),
    );
    expect(response.scope).toEqual({
      products: ['js-maps-sdk'],
      resolvedFrom: 'javascript',
      line: 'latest',
    });
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
    const response = await h.services.search.search(
      { query: 'search', product: 'rest-api/portal', limit: 5 },
      h.call(),
    );
    expect(response.scope.sources).toEqual(['portal']);
    expect(new Set(response.hits.map((hit) => hit.source))).toEqual(new Set(['portal']));
    expect(h.adapter('javadoc').calls.map((call) => call.source)).toEqual(['portal']);
  });

  it('uses the one SDK detected in the project and says so', async () => {
    const h = makeHarness({
      workspace: [
        {
          product: 'kotlin-maps-sdk',
          package: 'com.esri:arcgis-maps-kotlin',
          version: '300.0.0',
          file: 'build.gradle.kts',
        },
      ],
    });
    const response = await h.services.search.search({ query: 'offline', limit: 3 }, h.call());
    expect(response.scope.products).toEqual(['kotlin-maps-sdk']);
    expect(response.scope.resolvedFrom).toBe('workspace');
    expect(response.notes[0]).toContain('detected in the project');
  });

  it('lets the router pick at most three products and names them', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'featurelayer offline rest', limit: 5 },
      h.call(),
    );
    expect(response.scope.products.length).toBeLessThanOrEqual(3);
    expect(response.scope.products).toEqual(
      expect.arrayContaining(['js-maps-sdk', 'kotlin-maps-sdk']),
    );
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
    // Nothing was resolved, so the scope names no origin (it read "none").
    expect(response.scope).not.toHaveProperty('resolvedFrom');
    expect(response.notes[0]).toContain('No product matched the query');
    expect(response.notes.at(-1)).toContain('does not prove');
  });

  it('rejects an unknown product and an unknown version', async () => {
    const h = makeHarness();
    await expect(
      h.services.search.search({ query: 'map', product: 'nope', limit: 3 }, h.call()),
    ).rejects.toMatchObject({
      code: 'UNKNOWN_PRODUCT',
    });
    await expect(
      h.services.search.search(
        { query: 'map', product: 'js-maps-sdk', version: '1.0', limit: 3 },
        h.call(),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
  });

  it('leaves out routed products that lack the requested version line', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'kotlin javascript offline map', version: 'v200', limit: 5 },
      h.call(),
    );
    expect(response.scope.products).toEqual(['kotlin-maps-sdk']);
    expect(response.scope.line).toBe('v200');
    expect(new Set(response.hits.map((hit) => hit.line))).toEqual(new Set(['v200']));
  });
});

describe('search pipeline', () => {
  it('puts exact symbol matches first', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'applyEdits', product: 'js-maps-sdk', limit: 5 },
      h.call(),
    );
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
    const response = await h.services.search.search(
      { query: 'OAuth', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(response.hits[0]?.ref).toBe(`${JS}/authentication/`);
  });

  it('filters by kind, counting it in the total', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'cluster', product: 'js-maps-sdk', kind: 'sample', limit: 5 },
      h.call(),
    );
    expect(response.scope.kind).toBe('sample');
    expect(response.hits.map((hit) => hit.kind)).toEqual(['sample']);
    expect(response.total).toBe(1);
  });

  it('returns each page once when two sources list it', async () => {
    const h = makeHarness();
    const response = await h.services.search.search(
      { query: 'FeatureLayer', product: 'js-maps-sdk', limit: 20 },
      h.call(),
    );
    const refs = response.hits.map((hit) => hit.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(response.hits[0]).toMatchObject({ source: 'core', title: 'FeatureLayer' });
  });

  // Regression: a page listed by two sources was reported under whichever record ranked
  // higher, so an AI component showed js-maps-sdk/core for one query and /components for the
  // next. The source that lists the other among its fallbacks is now always the one named.
  it('names the primary source of a page two sources list, whichever ranked higher', async () => {
    const h = makeHarness();
    for (const query of ['FeatureLayer', 'Typings of the feature layer class']) {
      const response = await h.services.search.search(
        { query, product: 'js-maps-sdk', limit: 20 },
        h.call(),
      );
      const page = response.hits.filter(
        (hit) => hit.ref === `${JS}/references/core/layers/FeatureLayer/`,
      );
      expect(page.map((hit) => hit.source)).toEqual(['core']);
    }
  });

  it('finds text of pages read earlier through the body index', async () => {
    const h = makeHarness();
    const before = await h.services.search.search(
      { query: 'debounce interval', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(before.total).toBe(0);

    h.index.addBody(
      makeDocPage({
        url: `${JS}/popups/`,
        product: 'js-maps-sdk',
        markdown:
          '# Configure popups\n\nIntro.\n\n## Performance\n\nSet a debounce interval for hover popups.',
      }),
    );
    const after = await h.services.search.search(
      { query: 'debounce interval', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
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
    await h.services.search.search(
      { query: 'offline', product: 'kotlin-maps-sdk', version: 'v200', limit: 3 },
      h.call(),
    );
    const response = await h.services.search.search(
      { query: 'take a map offline', product: 'kotlin-maps-sdk', limit: 5 },
      h.call(),
    );
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
    const response = await own.services.search.search(
      { query: 'verbose widget', product: 'js-maps-sdk', limit: 1 },
      own.call(),
    );
    expect(response.hits[0]?.excerpt?.length).toBeLessThanOrEqual(240);
  });
});
