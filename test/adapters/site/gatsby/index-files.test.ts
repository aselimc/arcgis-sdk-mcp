import { describe, expect, it } from 'vitest';
import {
  bodyModeOf,
  bodyVariantOf,
  documentOf,
} from '../../../../src/adapters/site/gatsby/body.js';
import {
  mergePointers,
  noPointers,
  parsePageData,
  pointersOf,
} from '../../../../src/adapters/site/gatsby/page-data.js';
import { GatsbySession } from '../../../../src/adapters/site/gatsby/session.js';
import { loadStaticQueries, rolesOf } from '../../../../src/adapters/site/gatsby/static-queries.js';
import {
  parsePagination,
  parseStore,
  plainText,
} from '../../../../src/adapters/site/gatsby/store.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import { makeResponse } from '../../../support/builders.js';
import { D, guide, rest } from './sites.js';

const SOURCE = `${D}/widgets/static/00000000000000000000000000000000.store.json`;

function thrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('expected an exception');
}

describe('parseStore', () => {
  it('reads records and normalises their optional fields', () => {
    const records = parseStore(
      [
        {
          id: '1',
          title: ' Elevation tutorial ',
          description: '<p>Find a <b>height</b>.</p>',
          keywords: ['height', 7],
          url: '/tutorials/elevation/',
          pageType: 'Tutorial',
          breadcrumb: 'Elevation > Tutorials',
          boost: 3,
        },
        { title: 'Root', url: '/', description: null, keywords: null, pageType: ' ', boost: null },
      ],
      SOURCE,
    );
    expect(records).toEqual([
      {
        url: '/tutorials/elevation/',
        title: 'Elevation tutorial',
        description: 'Find a height.',
        keywords: ['height'],
        crumbs: ['Elevation', 'Tutorials'],
        pageType: 'Tutorial',
        boost: 3,
      },
      { url: '/', title: 'Root', keywords: [], crumbs: [] },
    ]);
  });

  it('accepts a store serialised as a JSON string and an empty store', () => {
    expect(parseStore('[{"title":"a","url":"objects/a/"}]', SOURCE)).toHaveLength(1);
    expect(parseStore([], SOURCE)).toEqual([]);
  });

  it('drops records without url or title but keeps the rest', () => {
    const records = parseStore(
      [{ title: 'No url' }, { url: '/x/' }, 'text', { title: 'Ok', url: '/ok/' }],
      SOURCE,
    );
    expect(records.map((record) => record.title)).toEqual(['Ok']);
  });

  it.each([
    ['an object', { records: [] }],
    ['a string that is not JSON', 'not json'],
    ['a string holding an object', '{"a":1}'],
    ['records that all lost their url', [{ title: 'a', path: '/a/' }]],
  ])('reports %s as a changed shape', (_label, raw) => {
    const error = thrown(() => parseStore(raw, SOURCE));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details).toMatchObject({
      url: SOURCE,
      host: 'developers.arcgis.com',
      retryable: false,
    });
  });
});

describe('parsePagination', () => {
  it('reads ordered entries with an optional section', () => {
    expect(
      parsePagination(
        [
          { title: 'A', url: '/a/' },
          { title: 'B', url: '/b/#c', section: 'A' },
          { title: 'No url' },
        ],
        SOURCE,
      ),
    ).toEqual([
      { title: 'A', url: '/a/' },
      { title: 'B', url: '/b/#c', section: 'A' },
    ]);
  });

  it('reports another shape as a typed failure', () => {
    expect(isMcpDocError(thrown(() => parsePagination({ pages: [] }, SOURCE)))).toBe(true);
    expect(isMcpDocError(thrown(() => parsePagination([{ name: 'A' }], SOURCE)))).toBe(true);
  });
});

describe('plainText', () => {
  it('strips tags, decodes common entities and collapses whitespace', () => {
    expect(plainText('<p>Tom &amp; Jerry&nbsp;&lt;3 &quot;x&quot; &#39;y&#39;</p>\n')).toBe(
      'Tom & Jerry <3 "x" \'y\'',
    );
    expect(plainText('<p> </p>')).toBeUndefined();
    expect(plainText(null)).toBeUndefined();
  });

  it('cuts long text at a word boundary', () => {
    const cut = plainText('word '.repeat(100)) ?? '';
    expect(cut.length).toBeLessThanOrEqual(240);
    expect(cut.endsWith('word…')).toBe(true);
  });
});

describe('pointersOf', () => {
  it('finds navigation and search blocks by shape, whatever their key', () => {
    const pointers = pointersOf({
      mdxPage: { title: 'x' },
      whateverNav: {
        nav: {
          title: 'Guide',
          children: [{ title: 'A', url: '/a/' }],
          publicPaginationURL: '/s/p.json',
        },
      },
      lookup: { publicStoreURL: '/s/store.json', publicIndexURL: '/s/index.json' },
      siteConfig: null,
      count: 3,
    });
    expect(pointers.navTrees).toHaveLength(1);
    expect(pointers.navTrees[0]?.title).toBe('Guide');
    expect(pointers.paginationUrl).toBe('/s/p.json');
    expect(pointers.storeUrl).toBe('/s/store.json');
    expect(rolesOf(pointers)).toEqual(['nav', 'search']);
  });

  it('collects manifests, glossary terms, hierarchies and embedded stores', () => {
    const pointers = pointersOf({
      allTypedocPage: {
        nodes: [
          { title: 'A', url: '/api-reference/p/A' },
          { title: '', url: '/x' },
        ],
      },
      allMdxPage: { edges: [{ node: { title: 'thing', url: 'objects/thing/' } }, { node: null }] },
      glossaryData: { terms: [{ name: 'map' }] },
      resourceHierarchy: { childRawYaml: { raw: [{ name: 'Root', url: '/root' }] } },
      search: { index: '{}', store: '[]' },
    });
    expect(pointers.typedocNodes).toEqual([{ title: 'A', url: '/api-reference/p/A' }]);
    expect(pointers.mdxPages).toEqual([{ title: 'thing', url: 'objects/thing/' }]);
    expect(pointers.glossaryTerms).toEqual([{ name: 'map' }]);
    expect(pointers.hierarchies).toHaveLength(1);
    expect(pointers.inlineStore).toBe('[]');
    expect(rolesOf(pointers)).toEqual(['search', 'glossary']);
  });

  it('finds nothing in a document of another shape', () => {
    const pointers = pointersOf({ nav: { tree: [] }, search: { publicStoreURL: null }, x: [1] });
    expect(pointers).toEqual(noPointers());
    expect(rolesOf(pointers)).toEqual([]);
  });

  it('merges without duplicating trees or replacing first values', () => {
    const first = pointersOf({
      a: { nav: { title: 'Guide', children: [{ title: 'A', url: '/a/' }] } },
      search: { publicStoreURL: '/s/one.json' },
    });
    const second = pointersOf({
      a: { nav: { title: 'Guide', children: [{ title: 'A', url: '/a/' }] } },
      b: {
        nav: {
          title: 'API',
          children: [{ title: 'B', url: '/b/' }],
          publicPaginationURL: '/s/p.json',
        },
      },
      search: { publicStoreURL: '/s/two.json' },
      glossaryData: { terms: [{ name: 'map' }] },
    });
    mergePointers(first, second);
    expect(first.navTrees.map((tree) => tree.title)).toEqual(['Guide', 'API']);
    expect(first.storeUrl).toBe('/s/one.json');
    expect(first.paginationUrl).toBe('/s/p.json');
    expect(first.glossaryTerms).toHaveLength(1);
  });
});

describe('parsePageData', () => {
  const res = makeResponse({ url: `${D}/widgets/page-data/index/page-data.json` });

  it('reads data and static query hashes', () => {
    const parsed = parsePageData(
      { result: { data: { mdxPage: {} }, pageContext: {} }, staticQueryHashes: ['1', 2, '3'] },
      res,
    );
    expect(parsed.data).toEqual({ mdxPage: {} });
    expect(parsed.staticQueryHashes).toEqual(['1', '3']);
  });

  it('tolerates a page without a query result', () => {
    const parsed = parsePageData({ result: { pageContext: {} } }, res);
    expect(parsed.data).toEqual({});
    expect(parsed.staticQueryHashes).toEqual([]);
  });

  it('reports a document without result as a changed shape', () => {
    const error = thrown(() => parsePageData({ data: {} }, res));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.retryable).toBe(false);
    expect(isMcpDocError(thrown(() => parsePageData([], res)))).toBe(true);
  });
});

describe('body variants', () => {
  it('derives the body mode from bodyFrom, else from the symbols mode', () => {
    expect(bodyModeOf({ base: '/x/' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'rest-operations' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'glossary' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'fuse-store' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'typedoc' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'openapi' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'apiref-nav' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'sphinx-pagination' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'typedoc', bodyFrom: 'html' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', bodyFrom: 'apiRef' })).toBe('apiRef');
  });

  const data = {
    openApiOperationPage: { title: '/a', operation: { operationId: 'aGet' } },
    typedocPage: { title: 'T', raw: { name: 'T' } },
    sphinxJson: { title: 'm module', html: '<section>m</section>' },
    jupyterNotebook: { title: 'Notebook', html: '<div>cells</div>' },
    apiRef: { title: 'IThing', html: '<p>thing</p>' },
    mdxPage: { title: 'thing', childMarkdownRemark: { html: '<p>spec</p>' } },
  };

  it('prefers structured bodies in auto mode', () => {
    expect(bodyVariantOf(data, 'auto')).toEqual({
      renderer: 'openapi',
      operation: { operationId: 'aGet' },
      title: '/a',
    });
    const { openApiOperationPage: _operation, ...withoutOperation } = data;
    expect(bodyVariantOf(withoutOperation, 'auto')?.renderer).toBe('typedoc');
    expect(
      bodyVariantOf({ openApiOperationPage: null, openApiSchemasPage: { schemas: [] } }, 'auto'),
    ).toEqual({ renderer: 'openapi', schemas: [], title: '' });
  });

  it('takes exactly the field an explicit mode names', () => {
    expect(bodyVariantOf(data, 'sphinxJson')).toEqual({
      renderer: 'sphinx',
      html: '<section>m</section>',
      title: 'm module',
    });
    expect(bodyVariantOf(data, 'jupyterNotebook')).toMatchObject({
      html: '<div>cells</div>',
      title: 'Notebook',
    });
    expect(bodyVariantOf(data, 'apiRef')).toMatchObject({ html: '<p>thing</p>', title: 'IThing' });
    expect(bodyVariantOf(data, 'childMarkdownRemark')).toMatchObject({
      html: '<p>spec</p>',
      title: 'thing',
    });
    expect(bodyVariantOf({ sphinxJson: data.sphinxJson }, 'apiRef')).toBeUndefined();
  });

  it('finds no body in a prose page or behind renamed fields', () => {
    expect(bodyVariantOf({ mdxPage: { title: 'Prose' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({ sphinxJson: { body: '<p>x</p>' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({ apiRef: { html: '   ' } }, 'apiRef')).toBeUndefined();
    expect(bodyVariantOf({ typedocPage: { raw: 'text' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({}, 'html')).toBeUndefined();
  });

  it('wraps a fragment into a document, escaping the title', () => {
    expect(documentOf('A <b> & c', '<p>x</p>')).toBe(
      '<!doctype html><html><head><title>A &lt;b&gt; &amp; c</title></head><body><main><h1>A &lt;b&gt; &amp; c</h1><p>x</p></main></body></html>',
    );
    expect(documentOf('T', '<h1 class="t">Own</h1>')).not.toContain('<h1>T</h1>');
    expect(documentOf('', '<p>x</p>')).toContain('<main><p>x</p></main>');
  });
});

describe('static queries', () => {
  const prefix = `${D}/rest/gadgets/`;
  const hashes = ['1000000001', '2000000002', '1000000002', '1000000003', '3000000003'];

  it('stops as soon as every wanted role is found', async () => {
    const s = rest();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 24);
    const found = await loadStaticQueries(session, prefix, hashes, ['glossary']);
    expect(found.glossaryTerms).toHaveLength(1);
    expect(ctx.http.count()).toBe(2);
  });

  it('requests nothing when nothing is wanted or no hash is listed', async () => {
    const s = rest();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 24);
    expect(rolesOf(await loadStaticQueries(session, prefix, hashes, []))).toEqual([]);
    expect(rolesOf(await loadStaticQueries(session, prefix, [], ['nav']))).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });

  it('never asks again for a hash known to hold nothing wanted', async () => {
    const s = rest();
    const ctx = s.ctx();
    const first = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(first, prefix, hashes, ['nav', 'search']);
    expect(await ctx.cache.getDerived('misc', 'gatsby-static-query-roles')).toEqual({
      '1000000001': [],
      '2000000002': ['glossary'],
      '1000000002': [],
      '1000000003': [],
      '3000000003': ['nav', 'search'],
    });

    ctx.http.resetLog();
    const second = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(second, prefix, hashes, ['glossary']);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${prefix}page-data/sq/d/2000000002.json`,
    ]);
  });

  it('does not write a hash off for one empty answer', async () => {
    const s = rest();
    const ctx = s.ctx();
    await ctx.cache.putDerived('misc', 'gatsby-static-query-roles', {
      '1000000001': ['nav'],
      broken: 'not a list',
    });
    const session = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(session, prefix, ['1000000001'], ['nav']);
    expect(await ctx.cache.getDerived('misc', 'gatsby-static-query-roles')).toMatchObject({
      '1000000001': ['nav'],
    });
  });

  it('ignores a static query without a data object', async () => {
    const s = rest();
    const ctx = s.ctx();
    ctx.http.on(`${prefix}page-data/sq/d/9.json`, { json: { errors: [] } });
    const session = new GatsbySession(ctx, s.bound(), 24);
    expect(rolesOf(await loadStaticQueries(session, prefix, ['9'], ['nav']))).toEqual([]);
  });
});

describe('GatsbySession', () => {
  it('refuses further requests once its allowance is spent', async () => {
    const s = guide();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 1);
    expect(session.remaining()).toBe(1);
    await session.xml(`${D}/widgets/sitemap-0.xml`);
    expect(session.remaining()).toBe(0);
    const [outcome] = await Promise.allSettled([session.xml(`${D}/widgets/sitemap-0.xml`)]);
    expect(outcome.status).toBe('rejected');
    expect(
      outcome.status === 'rejected' && isMcpDocError(outcome.reason) && outcome.reason.details?.why,
    ).toContain('at most 1 requests');
    expect(ctx.http.count()).toBe(1);
  });

  it('does not ask a host again after it refused', async () => {
    const s = guide();
    const ctx = s.ctx();
    ctx.http.fail(/sitemap/, 429);
    const session = new GatsbySession(ctx, s.bound(), 10);
    const first = await Promise.allSettled([session.xml(`${D}/widgets/sitemap-0.xml`)]);
    const second = await Promise.allSettled([
      session.json(`${D}/widgets/page-data/index/page-data.json`),
    ]);
    expect(first[0].status).toBe('rejected');
    expect(
      second[0].status === 'rejected' && isMcpDocError(second[0].reason) && second[0].reason.code,
    ).toBe('UPSTREAM_BLOCKED');
    expect(ctx.http.count()).toBe(1);
  });

  it('turns an upstream failure of optional work into undefined', async () => {
    const s = guide();
    const ctx = s.ctx();
    ctx.http.fail(/sitemap/, 503);
    const session = new GatsbySession(ctx, s.bound(), 10);
    expect(
      await session.optional('The sitemap', () => session.xml(`${D}/widgets/sitemap-0.xml`)),
    ).toBeUndefined();
    expect(
      ctx.logger.entries.some((entry) => entry.msg.includes('The sitemap is unavailable')),
    ).toBe(true);
  });
});
