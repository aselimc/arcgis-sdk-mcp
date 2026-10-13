import { describe, expect, it, vi } from 'vitest';
import {
  bindSource,
  classifyUrl,
  defaultSymbolRead,
  expandTemplate,
  humanizeSlug,
  matchUrlFilter,
  sourceBaseUrls,
  sourceRootUrl,
} from '../../src/core/adapter-helpers.js';
import { newBudget } from '../../src/core/async.js';
import type { ReadTarget } from '../../src/core/ports.js';
import {
  ADAPTER_TYPES,
  type AdapterConfigMap,
  type AdapterType,
  type AnySourceDef,
  type UrlFilter,
} from '../../src/core/types.js';
import { makeDocPage, makeLine, makeProduct, makeRecord, makeSource } from '../support/builders.js';
import { FakeClock } from '../support/fake-clock.js';
import { makeCtx } from '../support/make-ctx.js';

const latest = makeLine();
const v200 = makeLine({
  id: 'v200',
  label: '200.x LTS',
  current: false,
  vars: { prefix: 'v200/' },
});
const D = 'https://developers.arcgis.com';

describe('expandTemplate', () => {
  it('substitutes line variables and {line}, leaving unknown placeholders', () => {
    expect(expandTemplate('/swift/{prefix}api-reference/', v200)).toBe(
      '/swift/v200/api-reference/',
    );
    expect(
      expandTemplate('/swift/{prefix}api-reference/', makeLine({ vars: { prefix: '' } })),
    ).toBe('/swift/api-reference/');
    expect(expandTemplate('/en/pro-app/{line}/', makeLine({ id: '3.6' }))).toBe('/en/pro-app/3.6/');
    expect(expandTemplate('/x/{line}/', makeLine({ id: '3.6', vars: { line: 'custom' } }))).toBe(
      '/x/custom/',
    );
    expect(expandTemplate('/references/{pkg}/components/{tag}/', latest)).toBe(
      '/references/{pkg}/components/{tag}/',
    );
  });
});

/** One representative config per adapter type, with the root and ownership prefixes expected for it. */
const CASES: {
  [A in AdapterType]: { config: AdapterConfigMap[A]; root: string; bases: string[] };
} = {
  astro: { config: { base: '/widgets/' }, root: `${D}/widgets/`, bases: [`${D}/widgets/`] },
  gatsby: { config: { base: 'widgets' }, root: `${D}/widgets/`, bases: [`${D}/widgets/`] },
  docc: {
    config: { base: '/swift/{prefix}api-reference/' },
    root: `${D}/swift/api-reference/`,
    bases: [`${D}/swift/api-reference/`],
  },
  dokka: {
    config: { base: '/kotlin/api-reference' },
    root: `${D}/kotlin/api-reference/`,
    bases: [`${D}/kotlin/api-reference/`],
  },
  dartdoc: {
    config: { base: '/flutter/api-reference/reference/', index: 'index.json' },
    root: `${D}/flutter/api-reference/reference/`,
    bases: [`${D}/flutter/api-reference/reference/`],
  },
  'docfx-net': {
    config: { base: 'https://esri.github.io/toolkit/', xrefmaps: ['xrefmap.yml'] },
    root: 'https://esri.github.io/toolkit/',
    bases: ['https://esri.github.io/toolkit/'],
  },
  javadoc: {
    config: { base: '/java/v200/api-reference/reference/' },
    root: `${D}/java/v200/api-reference/reference/`,
    bases: [`${D}/java/v200/api-reference/reference/`],
  },
  sphinx: {
    config: { base: '/geoanalytics/api-reference/' },
    root: `${D}/geoanalytics/api-reference/`,
    bases: [`${D}/geoanalytics/api-reference/`],
  },
  'docfx-esri': {
    config: { slug: 'arcgis-pro', scope: 'arcpy/', toc: 'arcpy/toc.json' },
    root: 'https://doc.esri.com/en/arcgis-pro/latest/',
    bases: ['https://doc.esri.com/en/arcgis-pro/latest/arcpy/'],
  },
  'legacy-help': {
    config: {
      host: 'doc.arcgis.com',
      base: '/en/cityengine/latest/',
      books: [{ path: 'cga' }, { path: '/python' }],
    },
    root: 'https://doc.arcgis.com/en/cityengine/latest/',
    bases: [
      'https://doc.arcgis.com/en/cityengine/latest/cga/',
      'https://doc.arcgis.com/en/cityengine/latest/python/',
    ],
  },
  sitemap: {
    config: {
      url: 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml',
      urls: ['/web-appbuilder/guide/sitemap.xml', '/web-appbuilder/guide/sitemap-2.xml'],
    },
    root: 'https://support.esri.com/en-us/knowledge-base/',
    bases: ['https://support.esri.com/en-us/knowledge-base/', `${D}/web-appbuilder/guide/`],
  },
  static: {
    config: {
      entries: [
        { url: 'https://esri.github.io/cityengine-sdk/html/', title: 'SDK', kind: 'api' },
        { url: '/kotlin/migrate/', title: 'Migrate', kind: 'guide' },
      ],
    },
    root: 'https://esri.github.io/cityengine-sdk/html/',
    bases: ['https://esri.github.io/cityengine-sdk/html/', `${D}/kotlin/migrate/`],
  },
  openapi: {
    config: {
      specs: [
        'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
        { url: 'https://hub.arcgis.com/api/search/definition/swagger-ui-init.js', embedded: true },
      ],
    },
    root: 'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
    bases: [
      'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
      'https://hub.arcgis.com/api/search/definition/swagger-ui-init.js',
    ],
  },
  'npm-dts': {
    config: { package: '@arcgis/core', docUrl: '/javascript/latest/references/core/{path}/' },
    root: `${D}/javascript/latest/references/core/`,
    bases: [`${D}/javascript/latest/references/core/`],
  },
  'npm-cem': {
    config: {
      packages: ['@arcgis/map-components'],
      file: 'dist/docs/api.json',
      docUrl: '/javascript/latest/references/{pkg}/components/{tag}/',
    },
    root: `${D}/javascript/latest/references/`,
    bases: [`${D}/javascript/latest/references/`],
  },
  'npm-json': {
    config: {
      package: '@arcgis/coding-components',
      file: 'arcade-api.json',
      mapper: 'arcade-api',
      docUrl: '/arcade/function-reference/',
    },
    root: `${D}/arcade/function-reference/`,
    bases: [`${D}/arcade/function-reference/`],
  },
  'github-repo': {
    config: { repo: 'Esri/example-samples', preset: 'samples-metadata' },
    root: 'https://github.com/Esri/example-samples/',
    bases: ['https://github.com/Esri/example-samples/'],
  },
  xmldoc: {
    config: { repo: 'Esri/example-sdk', dir: 'References/API' },
    root: 'https://github.com/Esri/example-sdk/',
    bases: ['https://github.com/Esri/example-sdk/'],
  },
  pkgdown: {
    config: { host: 'r.esri.com', packages: ['arcgis', 'arcgislayers'] },
    root: 'https://r.esri.com/',
    bases: ['https://r.esri.com/arcgis/', 'https://r.esri.com/arcgislayers/'],
  },
  brief: { config: { slugs: ['ai/*'] }, root: 'brief:', bases: [] },
};

function sourceFor<A extends AdapterType>(adapter: A): AnySourceDef {
  return makeSource(adapter, CASES[adapter].config) as AnySourceDef;
}

describe('sourceRootUrl and sourceBaseUrls', () => {
  it.each(ADAPTER_TYPES)('%s', (adapter) => {
    const source = sourceFor(adapter);
    expect(sourceRootUrl(source, latest)).toBe(CASES[adapter].root);
    expect(sourceBaseUrls(source, latest)).toEqual(CASES[adapter].bases);
  });

  it('substitutes the version line into bases', () => {
    const docc = makeSource('docc', { base: '/swift/{prefix}api-reference/' });
    expect(sourceRootUrl(docc, v200)).toBe(`${D}/swift/v200/api-reference/`);
    const python = makeSource('gatsby', { base: '{base}api-reference/' });
    const line23 = makeLine({ id: '2.3', vars: { base: '/python-2-3/' } });
    expect(sourceBaseUrls(python, line23)).toEqual([`${D}/python-2-3/api-reference/`]);
    const legacy = makeSource('legacy-help', {
      host: 'pro.arcgis.com',
      base: '/en/pro-app/{line}/',
      books: [],
    });
    expect(sourceBaseUrls(legacy, makeLine({ id: '3.6' }))).toEqual([
      'https://pro.arcgis.com/en/pro-app/3.6/',
    ]);
  });

  it('narrows docfx-esri to sections, or to the whole site without scope and sections', () => {
    const root = 'https://doc.esri.com/en/arcgis-pro/latest/';
    expect(
      sourceBaseUrls(
        makeSource('docfx-esri', { slug: 'arcgis-pro', sections: ['help', 'get-started/'] }),
        latest,
      ),
    ).toEqual([`${root}help/`, `${root}get-started/`]);
    expect(sourceBaseUrls(makeSource('docfx-esri', { slug: 'arcgis-pro' }), latest)).toEqual([
      root,
    ]);
    expect(
      sourceBaseUrls(makeSource('docfx-esri', { slug: 'arcgis-pro', sections: [] }), latest),
    ).toEqual([root]);
  });

  it('uses the fallback when a source has nothing to derive a root from', () => {
    const empty: AnySourceDef[] = [
      makeSource('sitemap', {}),
      makeSource('static', { entries: [] }),
      makeSource('openapi', { specs: [] }),
    ];
    for (const source of empty) {
      expect(sourceRootUrl(source, latest), source.adapter).toBe('');
      expect(sourceRootUrl(source, latest, 'https://h.example/home/'), source.adapter).toBe(
        'https://h.example/home/',
      );
      expect(sourceBaseUrls(source, latest), source.adapter).toEqual([]);
    }
  });

  it('points an npm-json source without docUrl at the package on jsDelivr', () => {
    const source = makeSource('npm-json', {
      package: '@arcgis/coding-components',
      file: 'profiles.json',
      mapper: 'arcade-profiles',
    });
    expect(sourceRootUrl(source, latest)).toBe(
      'https://cdn.jsdelivr.net/npm/@arcgis/coding-components/',
    );
  });

  it('reads the first sitemap from urls when url is absent', () => {
    const source = makeSource('sitemap', { urls: ['/web-appbuilder/guide/sitemap.xml'] });
    expect(sourceRootUrl(source, latest)).toBe(`${D}/web-appbuilder/guide/`);
    expect(sourceBaseUrls(source, latest)).toEqual([`${D}/web-appbuilder/guide/`]);
  });
});

describe('bindSource', () => {
  const product = makeProduct();
  const source = makeSource('astro', { base: '/widgets/{prefix}', sitemap: 'sitemap-0.xml' });

  it('carries product, source and line and joins paths onto the root', () => {
    const bound = bindSource(product, source, v200);
    expect(bound.product).toBe(product);
    expect(bound.source).toBe(source);
    expect(bound.line).toBe(v200);
    expect(bound.url()).toBe(`${D}/widgets/v200/`);
    expect(bound.url('')).toBe(`${D}/widgets/v200/`);
    expect(bound.url('sitemap-0.xml')).toBe(`${D}/widgets/v200/sitemap-0.xml`);
    expect(bound.url('/guide/intro/')).toBe(`${D}/widgets/v200/guide/intro/`);
    expect(bound.url('https://other.example/x')).toBe('https://other.example/x');
    expect('version' in bound).toBe(false);
    expect('budget' in bound).toBe(false);
  });

  it('carries a pinned version and a budget when given', () => {
    const budget = newBudget(30, 20_000, new FakeClock());
    const bound = bindSource(product, source, latest, '5.1.0', budget);
    expect(bound.version).toBe('5.1.0');
    expect(bound.budget).toBe(budget);
  });

  it('joins after brief: and after file-like roots', () => {
    expect(
      bindSource(product, makeSource('brief', { slugs: ['ai/*'] }), latest).url('ai/overview'),
    ).toBe('brief:ai/overview');
    const spec = makeSource('openapi', { specs: ['https://h.example/api/docs-json'] });
    expect(bindSource(product, spec, latest).url('extra')).toBe(
      'https://h.example/api/docs-json/extra',
    );
  });

  it('falls back to the product homepage when the source has no root', () => {
    expect(bindSource(product, makeSource('static', { entries: [] }), latest).url()).toBe(
      product.homepage,
    );
  });
});

describe('matchUrlFilter and classifyUrl', () => {
  const filter: UrlFilter = {
    include: ['^guide/', '^tutorials/', '^release-notes'],
    exclude: ['/live/$', '^guide/internal/'],
    classify: [
      ['^tutorials/', 'tutorial'],
      ['^release-notes', 'release-notes'],
    ],
  };

  it('requires an include match when include is given and no exclude match', () => {
    expect(matchUrlFilter('guide/intro/', filter)).toBe(true);
    expect(matchUrlFilter('tutorials/first-map/', filter)).toBe(true);
    expect(matchUrlFilter('api-reference/x/', filter)).toBe(false);
    expect(matchUrlFilter('guide/intro/live/', filter)).toBe(false);
    expect(matchUrlFilter('guide/internal/notes/', filter)).toBe(false);
  });

  it('accepts everything without rules, and treats an empty include as absent', () => {
    expect(matchUrlFilter('anything/', {})).toBe(true);
    expect(matchUrlFilter('anything/', { include: [] })).toBe(true);
    expect(matchUrlFilter('anything/', { exclude: ['^any'] })).toBe(false);
  });

  it('classifies by the first matching rule, else the fallback', () => {
    expect(classifyUrl('tutorials/first-map/', filter)).toBe('tutorial');
    expect(classifyUrl('release-notes/5.1/', filter)).toBe('release-notes');
    expect(classifyUrl('guide/intro/', filter)).toBe('guide');
    expect(classifyUrl('guide/intro/', filter, 'help')).toBe('help');
    expect(classifyUrl('x/', {})).toBe('guide');
    expect(
      classifyUrl('tutorials/x/', {
        classify: [
          ['^tut', 'sample'],
          ['^tutorials/', 'tutorial'],
        ],
      }),
    ).toBe('sample');
  });

  it('throws for a pattern that is not a regular expression', () => {
    expect(() => matchUrlFilter('x', { include: ['('] })).toThrow(SyntaxError);
  });
});

describe('defaultSymbolRead', () => {
  const page = makeDocPage();
  const ctx = makeCtx();
  const src = bindSource(makeProduct(), makeSource('astro', { base: '/widgets/' }), latest);

  async function targetFor(record: Parameters<typeof makeRecord>[0]): Promise<ReadTarget> {
    const read = vi.fn(async () => page);
    const symbol = defaultSymbolRead({ read });
    const full = makeRecord(record);
    await expect(symbol(ctx, src, full, 'summary')).resolves.toBe(page);
    expect(read).toHaveBeenCalledTimes(1);
    const [calledCtx, calledSrc, target] = read.mock.calls[0] as unknown as [
      unknown,
      unknown,
      ReadTarget,
    ];
    expect(calledCtx).toBe(ctx);
    expect(calledSrc).toBe(src);
    expect(target.record).toBe(full);
    expect(target.detail).toBe('summary');
    return target;
  }

  it('reads a type page without a member selection', async () => {
    const target = await targetFor({
      ref: 'https://developers.arcgis.com/widgets/api/Widget/',
      symbol: 'Widget',
      qualified: 'Widget',
    });
    expect(target.url.href).toBe('https://developers.arcgis.com/widgets/api/Widget/');
    expect('select' in target).toBe(false);
  });

  it('selects the member when the record has a parent', async () => {
    const target = await targetFor({
      ref: 'https://developers.arcgis.com/widgets/api/Widget/#render',
      symbol: 'render',
      qualified: 'Widget.render',
      parent: 'Widget',
    });
    expect(target.url.hash).toBe('#render');
    expect(target.select).toEqual({ member: 'render' });
  });

  it('derives the member name from the qualified name when symbol is absent', async () => {
    expect(
      (await targetFor({ qualified: 'arcgis.gis.GIS.content', parent: 'arcgis.gis.GIS' })).select,
    ).toEqual({ member: 'content' });
    expect((await targetFor({ qualified: 'Map::setBasemap', parent: 'Map' })).select).toEqual({
      member: 'setBasemap',
    });
    expect('select' in (await targetFor({ parent: 'Widget' }))).toBe(false);
  });
});

describe('humanizeSlug', () => {
  it.each([
    ['get-started-with-oauth', 'Get started with oauth'],
    ['https://developers.arcgis.com/widgets/guide/add-a-layer/', 'Add a layer'],
    ['tool-reference/analysis/buffer.html', 'Buffer'],
    ['ProConcepts-Editing.html', 'ProConcepts Editing'],
    ['snake_case_name.md', 'Snake case name'],
    ['000012345', '000012345'],
    ['error-000735-value-is-required/?utm=1#fix', 'Error 000735 value is required'],
    ['How%20to%20publish', 'How to publish'],
    ['100%-broken', '100% broken'],
    ['notebook.ipynb', 'Notebook'],
    ['', ''],
    ['///', ''],
  ])('%j -> %j', (slug, title) => {
    expect(humanizeSlug(slug)).toBe(title);
  });
});
