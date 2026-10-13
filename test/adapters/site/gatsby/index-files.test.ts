import { describe, expect, it } from 'vitest';
import {
  mergePointers,
  noPointers,
  parsePageData,
  pointersOf,
} from '../../../../src/adapters/site/gatsby/page-data.js';
import { rolesOf } from '../../../../src/adapters/site/gatsby/static-queries.js';
import {
  parsePagination,
  parseStore,
  plainText,
} from '../../../../src/adapters/site/gatsby/store.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import { makeResponse } from '../../../support/builders.js';
import { D } from './sites.js';

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
