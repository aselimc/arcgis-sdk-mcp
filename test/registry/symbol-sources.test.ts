import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/core/types.js';
import { sourceYieldsSymbols, symbolLookupOf } from '../../src/registry/symbol-sources.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { PRODUCTS } from './registry-data.js';

const GITHUB_PROBE = { url: 'https://api.github.com/repos/Esri/x', expect: 'json' } as const;

describe('sourceYieldsSymbols', () => {
  it('needs the option that turns symbols on for a Gatsby, docfx or GitHub source', () => {
    const product = makeProduct();
    const gatsby = makeSource('gatsby', { base: '/widgets/' });
    expect(sourceYieldsSymbols(product, gatsby)).toBe(false);
    expect(
      sourceYieldsSymbols(product, makeSource('gatsby', { base: '/widgets/', symbols: 'typedoc' })),
    ).toBe(true);
    const repo = makeSource(
      'github-repo',
      { repo: 'Esri/x', preset: 'markdown-docs' },
      { kinds: ['spec'], probe: GITHUB_PROBE },
    );
    // A repository of specification pages is indexed as pages: `kinds: ['spec']` is no symbol.
    expect(sourceYieldsSymbols(product, repo)).toBe(false);
    const headings = { ...repo, config: { ...repo.config, symbolsFromHeadings: 2 } };
    expect(sourceYieldsSymbols(product, headings)).toBe(true);
  });

  it('gives a legacy-help book symbols only inside the scope of a docfx table of contents', () => {
    const current = makeSource(
      'docfx-esri',
      { slug: 'arcgis-pro', scope: 'arcpy/', symbols: 'toc' },
      { id: 'arcpy', kinds: ['api'] },
    );
    const legacy = makeSource(
      'legacy-help',
      { host: 'pro.arcgis.com', base: '/en/pro-app/{line}/', books: [{ path: 'arcpy/functions' }] },
      { id: 'legacy', kinds: ['api'], floor: false },
    );
    const outside = {
      ...legacy,
      config: { ...legacy.config, books: [{ path: 'help/data' }] },
    };
    const product: Product = makeProduct({ sources: [current, legacy] });
    expect(sourceYieldsSymbols(product, legacy)).toBe(true);
    expect(sourceYieldsSymbols(product, outside)).toBe(false);
    expect(sourceYieldsSymbols(makeProduct({ sources: [legacy] }), legacy)).toBe(false);
  });
});

describe('symbolLookupOf', () => {
  it('tells symbol records, titled API pages and pages apart', () => {
    const titled = makeSource(
      'legacy-help',
      { host: 'doc.arcgis.com', base: '/en/x/latest/', books: [{ path: 'commands' }] },
      { kinds: ['api'] },
    );
    // A legacy-help page has the first declared kind: `api` after `help` is never emitted.
    const helpFirst = { ...titled, kinds: ['help', 'api'] } satisfies typeof titled;
    expect(symbolLookupOf(makeProduct({ sources: [titled] }))).toBe('titles');
    expect(symbolLookupOf(makeProduct({ sources: [helpFirst] }))).toBe('none');
    expect(
      symbolLookupOf(
        makeProduct({ sources: [makeSource('npm-dts', { package: '@x/y', docUrl: '/x/' })] }),
      ),
    ).toBe('symbols');
  });

  /**
   * The products whose profile may not claim symbol lookups. A source that starts to yield
   * symbols (or stops) changes this list, and with it the README coverage table.
   */
  it('names the products whose API or specification pages carry no symbols', () => {
    const without = (lookup: string): string[] =>
      PRODUCTS.filter((product) => product.tier === 'developer')
        .filter((product) => product.sources.some((source) => /api|spec/.test(source.kinds.join())))
        .filter((product) => symbolLookupOf(product) === lookup)
        .map((product) => product.id)
        .sort();
    expect(without('titles')).toEqual([
      'appstudio',
      'autocad-api',
      'cityengine',
      'earth-automation-api',
      'survey123-dev',
      'web-appbuilder',
    ]);
    expect(without('none')).toEqual([
      '3d-tiles-esri-crs',
      'arcgis-pbf',
      'file-geodatabase-api',
      'i3s-spec',
      'knowledge-pbf',
      'lerc',
      'projection-engine-db',
      'spatially-optimized-parquet',
      'tile-package-spec',
      'velocity-grpc',
    ]);
    // The flagship references stay symbol sources.
    for (const id of ['js-maps-sdk', 'arcpy', 'python-api', 'cim-spec', 'rest-api']) {
      expect(symbolLookupOf(PRODUCTS.find((product) => product.id === id) as Product)).toBe(
        'symbols',
      );
    }
  });
});
