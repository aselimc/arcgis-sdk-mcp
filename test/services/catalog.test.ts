import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import { TOC_PAGE_SIZE } from '../../src/services/catalog.js';
import { resolveScope, workspaceSdks } from '../../src/services/scope.js';
import { makeProduct, makeRecord } from '../support/builders.js';
import { PRODUCTS, jsSdk, kotlinSdk } from './support/catalogue.js';
import { makeHarness } from './support/harness.js';

const list = (
  h: ReturnType<typeof makeHarness>,
  request: Partial<Parameters<typeof h.services.catalog.list>[0]> = {},
) => h.services.catalog.list({ includeLegacy: false, limit: 80, ...request });

describe('catalog list', () => {
  it('lists developer products by category, without product help, legacy or network', () => {
    const h = makeHarness();
    const { products, total, nextCursor } = list(h);
    expect(products.map((product) => product.id)).toEqual([
      'js-maps-sdk',
      'kotlin-maps-sdk',
      'rest-api',
      'ai-agents',
    ]);
    expect(total).toBe(4);
    expect(nextCursor).toBeUndefined();
    expect(h.ctx.http.requests).toEqual([]);
    expect(h.adapter('gatsby').count()).toBe(0);
  });

  it('filters by category, and "all" includes product help', () => {
    const h = makeHarness();
    expect(list(h, { category: 'native' }).products.map((p) => p.id)).toEqual(['kotlin-maps-sdk']);
    expect(list(h, { category: 'product-help' }).products.map((p) => p.id)).toEqual(['cityengine']);
    expect(list(h, { category: 'all' }).total).toBe(5);
    expect(list(h, { category: 'all', includeLegacy: true }).total).toBe(PRODUCTS.length);
    expect(list(h, { category: 'desktop-enterprise' }).total).toBe(0);
    expect(
      list(h, { category: 'desktop-enterprise', includeLegacy: true }).products.map((p) => p.id),
    ).toEqual(['arcobjects']);
  });

  it('ranks by the words of a query, names before keywords', () => {
    const h = makeHarness();
    expect(list(h, { query: 'kotlin offline mobile' }).products.map((p) => p.id)).toEqual([
      'kotlin-maps-sdk',
    ]);
    expect(list(h, { query: 'javascript rest' }).products.map((p) => p.id)).toEqual([
      'js-maps-sdk',
      'rest-api',
    ]);
    // "featurelayer" is a keyword of two products; only the live one is listed by default.
    expect(list(h, { query: 'featurelayer' }).products.map((p) => p.id)).toEqual(['js-maps-sdk']);
    expect(list(h, { query: 'no such thing' }).total).toBe(0);
  });

  it('pages with a cursor and rejects a cursor of another listing', () => {
    const h = makeHarness();
    const first = list(h, { limit: 3 });
    expect(first.products).toHaveLength(3);
    const second = list(h, { limit: 3, cursor: first.nextCursor ?? '' });
    expect(second.products.map((p) => p.id)).toEqual(['ai-agents']);
    expect(second.nextCursor).toBeUndefined();

    let caught: unknown;
    try {
      list(h, { limit: 3, category: 'all', cursor: first.nextCursor ?? '' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(McpDocError);
    expect(caught).toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { next: 'arcgis_docs_list_products({"category":"all"})' },
    });
  });
});

describe('catalog profile', () => {
  it('resolves the product and reports health per source', async () => {
    const h = makeHarness();
    const before = h.services.catalog.profile('@arcgis/core');
    expect(before.resolution).toMatchObject({ product: { id: 'js-maps-sdk' }, how: 'alias' });
    expect(before.health).toEqual({
      guide: { state: 'unknown' },
      core: { state: 'unknown' },
      typings: { state: 'unknown' },
      samples: { state: 'unknown' },
    });

    h.adapter('astro').failOn('enumerate', new McpDocError('UPSTREAM_UNAVAILABLE', 'down'));
    await h.index.ensure(jsSdk, ['guide', 'core'], h.ctx.registry.line(jsSdk), h.call());
    const after = h.services.catalog.profile('js-maps-sdk');
    expect(after.health.guide).toMatchObject({ state: 'ok', records: 8 });
    expect(after.health.core).toMatchObject({
      state: 'degraded',
      lastError: 'UPSTREAM_UNAVAILABLE: down',
    });
    expect(after.health.samples).toEqual({ state: 'unknown' });
  });

  it('reports sources whose capability is off as disabled', () => {
    const h = makeHarness({ enabled: ['website', 'site-index'] });
    expect(h.services.catalog.profile('js-maps-sdk').health.typings).toEqual({
      state: 'disabled',
      lastError: 'capability "package-cdn" is switched off',
    });
    expect(h.services.catalog.profile('ai-agents').health.briefs).toEqual({ state: 'unknown' });
  });

  it('rejects an unknown product', () => {
    const h = makeHarness();
    expect(() => h.services.catalog.profile('nope')).toThrow(McpDocError);
  });
});

describe('catalog toc', () => {
  it('returns the pages of a source, without member records', async () => {
    const h = makeHarness();
    const toc = await h.services.catalog.toc('js-maps-sdk', 'Core', undefined, h.call());
    expect(toc.entries.map((entry) => entry.title)).toEqual([
      'FeatureLayer',
      'GraphicsLayer',
      'MapView',
      'SceneView',
      'Point',
      'Query',
      'Point (statistics)',
    ]);
    expect(toc.total).toBe(7);
    expect(toc.nextCursor).toBeUndefined();
    expect(h.adapter('astro').count('enumerate')).toBe(1);
    expect(h.adapter('gatsby').count('enumerate')).toBe(0);
  });

  it('pages one hundred entries per call', async () => {
    const records = Array.from({ length: 230 }, (_, i) =>
      makeRecord({ ref: `https://developers.arcgis.com/widgets/p${i}/`, title: `Page ${i}` }),
    );
    const h = makeHarness({ products: [makeProduct()], records });
    const first = await h.services.catalog.toc('widgets-sdk', 'guide', undefined, h.call());
    expect(first.entries).toHaveLength(TOC_PAGE_SIZE);
    expect(first.total).toBe(230);
    const second = await h.services.catalog.toc('widgets-sdk', 'guide', first.nextCursor, h.call());
    const third = await h.services.catalog.toc('widgets-sdk', 'guide', second.nextCursor, h.call());
    expect(third.entries.map((entry) => entry.title).at(-1)).toBe('Page 229');
    expect(third.entries).toHaveLength(30);
    expect(third.nextCursor).toBeUndefined();

    await expect(
      h.services.catalog.toc('widgets-sdk', 'guide', 'garbage!', h.call()),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { next: 'arcgis_docs_list_products({"product":"widgets-sdk","section":"guide"})' },
    });
  });

  it('names the sections of the product when the section is unknown', async () => {
    const h = makeHarness();
    await expect(
      h.services.catalog.toc('kotlin', 'tutorials', undefined, h.call()),
    ).rejects.toMatchObject({
      code: 'SECTION_NOT_FOUND',
      details: {
        candidates: ['guide', 'api', 'samples'],
        next: 'arcgis_docs_list_products({"product":"kotlin-maps-sdk"})',
      },
    });
  });

  it('returns the entry links when the source cannot be enumerated', async () => {
    const h = makeHarness();
    h.adapter('gatsby').failOn('enumerate', new McpDocError('UPSTREAM_UNAVAILABLE', 'down'));
    const toc = await h.services.catalog.toc('kotlin-maps-sdk', 'guide', undefined, h.call());
    expect(toc.entries.map((entry) => entry.ref)).toEqual([
      'https://developers.arcgis.com/kotlin/',
    ]);
  });
});

describe('resolveScope', () => {
  const sdk = (product: string) => ({
    product,
    package: 'x',
    version: '1.0.0',
    file: 'package.json',
  });

  it('prefers the argument, then the single project SDK, then the query, then the router', async () => {
    const one = makeHarness({ workspace: [sdk('kotlin-maps-sdk'), sdk('kotlin-maps-sdk')] });
    expect(await resolveScope(one.ctx, { product: 'rest', query: 'x', max: 3 })).toMatchObject({
      origin: 'argument',
      resolutions: [{ product: { id: 'rest-api' }, how: 'alias' }],
    });
    expect(
      await resolveScope(one.ctx, { product: '  ', query: 'javascript', max: 3 }),
    ).toMatchObject({
      origin: 'workspace',
      resolutions: [{ product: { id: 'kotlin-maps-sdk' }, resolvedFrom: 'project' }],
    });

    const none = makeHarness();
    expect(await resolveScope(none.ctx, { query: 'arcgis-map', max: 3 })).toMatchObject({
      origin: 'query',
      resolutions: [{ product: { id: 'js-maps-sdk' } }],
    });
    const routed = await resolveScope(none.ctx, { query: 'kotlin or javascript', max: 3 });
    expect(routed.origin).toBe('router');
    expect(routed.resolutions.map((r) => r.product.id).sort()).toEqual([
      'js-maps-sdk',
      'kotlin-maps-sdk',
    ]);
    expect(await resolveScope(none.ctx, { query: 'zzzz', max: 3 })).toMatchObject({
      origin: 'none',
      resolutions: [],
    });
  });

  it('puts project SDKs first among routed products and falls back to them', async () => {
    const h = makeHarness({
      workspace: [sdk('kotlin-maps-sdk'), sdk('rest-api'), sdk('not-in-registry')],
    });
    const routed = await resolveScope(h.ctx, { query: 'javascript kotlin featurelayer', max: 3 });
    expect(routed.resolutions[0]?.product.id).toBe('kotlin-maps-sdk');
    expect(routed.workspace).toHaveLength(3);

    const fallback = await resolveScope(h.ctx, { query: 'zzzz', max: 1 });
    expect(fallback).toMatchObject({
      origin: 'workspace',
      resolutions: [{ product: { id: kotlinSdk.id } }],
    });
  });

  it('does not treat an ambiguous symbol-shaped query as naming a product', async () => {
    const h = makeHarness();
    const scope = await resolveScope(h.ctx, { query: 'FeatureLayer', max: 3 });
    expect(scope.origin).toBe('router');
    expect(scope.resolutions.length).toBeGreaterThan(1);
  });

  it('survives a failing workspace detector', async () => {
    const h = makeHarness();
    h.ctx.workspace = async () => Promise.reject(new Error('EACCES'));
    expect(await workspaceSdks(h.ctx)).toEqual([]);
    expect(h.ctx.logger.messages('warn')).toEqual(['workspace detection failed']);
  });
});
