import { describe, expect, it } from 'vitest';
import { bindSource } from '../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../src/core/errors.js';
import { parseSitemap } from '../../src/core/sitemap.js';
import type { SourceAdapter } from '../../src/core/ports.js';
import type { CatalogRecord } from '../../src/core/types.js';
import { describeAdapterContract } from './adapter-contract.js';
import { makeHost, makeLine, makeProduct, makeSource } from './builders.js';
import { fakeRegistry } from './fake-registry.js';
import { loadCassette } from './fixtures.js';
import { makeCtx } from './make-ctx.js';

const widgets = makeProduct({
  aliases: ['widgets', '@example/widgets'],
  keywords: ['widgets', 'charts', 'offline'],
  lines: [
    makeLine({ vars: { prefix: '' } }),
    makeLine({ id: 'v1', label: '1.x LTS', current: false, vars: { prefix: 'v1/' } }),
  ],
  sources: [
    makeSource('gatsby', { base: '/widgets/{prefix}' }),
    makeSource('docc', { base: '/widgets/{prefix}api-reference/' }, { id: 'api', floor: false }),
    makeSource(
      'github-repo',
      { repo: 'Esri/widgets-samples', preset: 'samples-metadata' },
      { id: 'samples', floor: false, capability: 'github', lines: ['latest'] },
    ),
  ],
});
const gadgets = makeProduct({
  id: 'gadgets-help',
  name: 'Gadgets Help',
  aliases: ['gadgets'],
  tier: 'link',
  keywords: ['gadgets', 'offline'],
  homepage: 'https://doc.esri.com/en/gadgets/latest/',
  lines: [makeLine()],
  sources: [makeSource('docfx-esri', { slug: 'gadgets' }, { id: 'help' })],
});
const registry = fakeRegistry({ products: [widgets, gadgets], hosts: [makeHost()] });

function codeOf(run: () => unknown): string {
  try {
    run();
    return 'no error';
  } catch (error) {
    return isMcpDocError(error) ? error.code : 'other error';
  }
}

describe('fakeRegistry', () => {
  it('lists and gets products, hosts and briefs', () => {
    expect(registry.all()).toEqual([widgets, gadgets]);
    expect(registry.get('widgets-sdk')).toBe(widgets);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.hosts()).toEqual([makeHost()]);
    expect(registry.briefs()).toEqual([]);
    const brief = {
      slug: 'ai/overview',
      title: 'AI',
      verifiedOn: '2026-10-13',
      sources: [],
      markdown: '# AI',
    };
    expect(fakeRegistry({ briefs: [brief] }).briefs()).toEqual([brief]);
    expect(fakeRegistry().all()).toHaveLength(1);
    expect(fakeRegistry().hosts()).toEqual([]);
  });

  it('resolves ids, aliases, names and scopes', () => {
    expect(registry.resolve('widgets-sdk')).toEqual({
      product: widgets,
      resolvedFrom: 'widgets-sdk',
      how: 'id',
    });
    expect(registry.resolve(' Widgets-SDK ').how).toBe('id');
    expect(registry.resolve('@example/widgets')).toMatchObject({ product: widgets, how: 'alias' });
    expect(registry.resolve('Gadgets Help')).toMatchObject({ product: gadgets, how: 'alias' });
    const scoped = registry.resolve('widgets/api');
    expect(scoped).toMatchObject({ product: widgets, how: 'scope', resolvedFrom: 'widgets/api' });
    expect(scoped.source?.id).toBe('api');
  });

  it('throws UNKNOWN_PRODUCT with the nearest ids', () => {
    for (const input of ['widgets-sdx', 'widgets/unknown-section', 'nothing/api', '/api']) {
      expect(
        codeOf(() => registry.resolve(input)),
        input,
      ).toBe('UNKNOWN_PRODUCT');
    }
    try {
      registry.resolve('widgets-sdx');
    } catch (error) {
      expect(isMcpDocError(error) && error.details?.candidates).toEqual(['widgets-sdk']);
    }
  });

  it('routes a query to developer and help products by vocabulary', () => {
    expect(registry.route('widgets charts')).toEqual([{ product: 'widgets-sdk', confidence: 1 }]);
    expect(registry.route('offline gadgets')).toEqual([
      { product: 'widgets-sdk', confidence: 0.5 },
    ]);
    expect(registry.route('unrelated words')).toEqual([]);
    expect(registry.route('   ')).toEqual([]);
    const both = fakeRegistry({ products: [widgets, { ...gadgets, tier: 'help' }] });
    expect(both.route('offline gadgets').map((entry) => entry.product)).toEqual([
      'gadgets-help',
      'widgets-sdk',
    ]);
    expect(both.route('offline gadgets', 1)).toHaveLength(1);
  });

  it('finds the owner of a URL by longest prefix, per line', () => {
    const owner = (url: string) => {
      const found = registry.ownerOf(new URL(url));
      return found === undefined
        ? undefined
        : `${found.product.id}/${found.source.id}@${found.line.id}`;
    };
    expect(owner('https://developers.arcgis.com/widgets/guide/intro/#usage')).toBe(
      'widgets-sdk/guide@latest',
    );
    expect(owner('https://developers.arcgis.com/widgets/api-reference/widget/')).toBe(
      'widgets-sdk/api@latest',
    );
    expect(owner('https://developers.arcgis.com/widgets/v1/guide/intro/')).toBe(
      'widgets-sdk/guide@v1',
    );
    expect(owner('https://developers.arcgis.com/widgets/v1/api-reference/widget/')).toBe(
      'widgets-sdk/api@v1',
    );
    expect(owner('https://doc.esri.com/en/gadgets/latest/help/a.html')).toBe(
      'gadgets-help/help@latest',
    );
    expect(owner('https://github.com/Esri/widgets-samples/blob/main/README.md')).toBe(
      'widgets-sdk/samples@latest',
    );
    expect(owner('https://raw.githubusercontent.com/Esri/Widgets-Samples/main/README.md')).toBe(
      'widgets-sdk/samples@latest',
    );
    expect(owner('https://github.com/Esri/other/blob/main/README.md')).toBeUndefined();
    expect(owner('https://developers.arcgis.com/elsewhere/')).toBeUndefined();
  });

  it('returns the current line by default and a named line by id or label', () => {
    expect(registry.line(widgets).id).toBe('latest');
    expect(registry.line(widgets, 'v1').id).toBe('v1');
    expect(registry.line(widgets, '1.x lts').id).toBe('v1');
    expect(codeOf(() => registry.line(widgets, '9.9'))).toBe('VERSION_UNAVAILABLE');
    const noCurrent = makeProduct({ lines: [makeLine({ id: 'only', current: false })] });
    expect(registry.line(noCurrent).id).toBe('only');
    expect(() => registry.line(makeProduct({ lines: [] }))).toThrow(/no version line/);
  });
});

/** A minimal sitemap adapter written against the ports, to run the shared contract suite for real. */
const sitemapAdapter: SourceAdapter<'sitemap'> = {
  type: 'sitemap',
  maxEnumerateRequests: 1,
  async enumerate(ctx, src) {
    const res = await ctx.http.get({ url: src.url('sitemap-0.xml'), expect: 'xml' });
    return parseSitemap(res.text).entries.map((entry): CatalogRecord => ({
      ref: entry.loc,
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      kind: 'guide',
      title: entry.loc,
      license: 'esri-website-terms',
    }));
  },
  async read(ctx, src, target) {
    const res = await ctx.http.get({ url: target.url.href, expect: 'html' });
    return ctx.render.render(
      'html',
      { html: res.text },
      {
        url: res.finalUrl,
        kind: 'guide',
        license: 'esri-website-terms',
        product: src.product.id,
        res,
      },
    );
  },
  async probe(ctx, src) {
    const res = await ctx.http.get({ url: src.url('sitemap-0.xml'), expect: 'xml' });
    return { ok: true, records: parseSitemap(res.text).entries.length, ms: 0 };
  },
};

describeAdapterContract('sample sitemap adapter', () => {
  const source = makeSource('sitemap', { url: '/widgets/sitemap-0.xml' });
  const product = makeProduct({ sources: [source] });
  return {
    adapter: sitemapAdapter,
    product,
    source,
    allowedHosts: ['developers.arcgis.com'],
    minRecords: 2,
    readRef: 'https://developers.arcgis.com/widgets/get-started/',
    ctx: () => {
      const ctx = makeCtx({
        products: [product],
        cassette: loadCassette('..', 'support', 'selftest', 'cassette.json'),
      });
      ctx.http.on('https://developers.arcgis.com/widgets/get-started/', {
        body: '<html><body><main><h1>Get started</h1></main></body></html>',
      });
      return ctx;
    },
  };
});

describeAdapterContract('read-only adapter without enumerate or a read ref', () => {
  const source = makeSource('static', { entries: [] });
  const product = makeProduct({ sources: [source] });
  return {
    adapter: {
      type: 'static',
      maxEnumerateRequests: 1,
      read: async () => {
        throw new Error('not used');
      },
      probe: async () => ({ ok: true, ms: 0 }),
    },
    product,
    source,
    line: makeLine(),
    ctx: () => makeCtx({ products: [product] }),
  };
});

describe('describeAdapterContract', () => {
  it('needs a current line when none is given', () => {
    const product = makeProduct({ lines: [makeLine({ current: false })] });
    const source = makeSource('static', { entries: [] });
    expect(bindSource(product, source, makeLine()).url()).toBe(product.homepage);
  });
});
