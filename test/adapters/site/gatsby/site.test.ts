import { describe, expect, it } from 'vitest';
import {
  flattenNav,
  hierarchyTreeOf,
  navTreeOf,
} from '../../../../src/adapters/site/gatsby/nav.js';
import {
  ownsPage,
  pageDataUrl,
  pageKey,
  prefixCandidates,
  relativeTo,
  resolveSiteUrl,
  sitePrefixPath,
  staticQueryUrl,
  type GatsbySite,
} from '../../../../src/adapters/site/gatsby/site.js';
import { D } from './sites.js';

const python: GatsbySite = {
  base: `${D}/pylib/latest/api-reference/`,
  prefix: `${D}/pylib/latest/`,
};
const geocode: GatsbySite = { base: `${D}/rest/geocode/`, prefix: `${D}/rest/geocode/` };

describe('prefixCandidates', () => {
  it('lists the base and up to two parents, never the root of another site', () => {
    expect(prefixCandidates(`${D}/pylib/latest/api-reference/`)).toEqual([
      `${D}/pylib/latest/api-reference/`,
      `${D}/pylib/latest/`,
      `${D}/pylib/`,
    ]);
    expect(prefixCandidates(`${D}/rest/geocode/`)).toEqual([`${D}/rest/geocode/`, `${D}/rest/`]);
    expect(prefixCandidates(`${D}/rest/`)).toEqual([`${D}/rest/`]);
    expect(prefixCandidates(`${D}/a/b/c/d/`)).toEqual([
      `${D}/a/b/c/d/`,
      `${D}/a/b/c/`,
      `${D}/a/b/`,
    ]);
  });

  it('accepts the host root when the base is the root', () => {
    expect(prefixCandidates('https://location.arcgis.com/')).toEqual([
      'https://location.arcgis.com/',
    ]);
  });
});

describe('pageKey', () => {
  it('adds the trailing slash pages are published with', () => {
    expect(pageKey(`${D}/toolkit-js/api-reference/pkg/DEFAULT_TIMEOUT`)).toBe(
      `${D}/toolkit-js/api-reference/pkg/DEFAULT_TIMEOUT/`,
    );
    expect(pageKey(`${D}/widgets/get-started/`)).toBe(`${D}/widgets/get-started/`);
    expect(pageKey(`${D}/widgets/release-notes-2.4`)).toBe(`${D}/widgets/release-notes-2.4/`);
  });

  it('leaves files alone and drops query, fragment and plain http', () => {
    expect(pageKey(`${D}/pylib/latest/api-reference/pylib.gis.toc.html#x`)).toBe(
      `${D}/pylib/latest/api-reference/pylib.gis.toc.html`,
    );
    expect(pageKey('http://developers.arcgis.com/widgets/a/?q=1#b')).toBe(`${D}/widgets/a/`);
  });
});

describe('page-data and static query URLs', () => {
  it('puts the site prefix before page-data', () => {
    expect(pageDataUrl(geocode.prefix, `${D}/rest/geocode/find-address-candidates/`)).toBe(
      `${D}/rest/geocode/page-data/find-address-candidates/page-data.json`,
    );
    expect(pageDataUrl(python.prefix, `${D}/pylib/latest/api-reference/pylib.gis.toc.html`)).toBe(
      `${D}/pylib/latest/page-data/api-reference/pylib.gis.toc.html/page-data.json`,
    );
  });

  it('uses index for the root page and refuses pages of another site', () => {
    expect(pageDataUrl(geocode.prefix, geocode.prefix)).toBe(
      `${D}/rest/geocode/page-data/index/page-data.json`,
    );
    expect(pageDataUrl(geocode.prefix, `${D}/rest/routing/`)).toBeUndefined();
  });

  it('builds static query URLs and the prefix path for renderers', () => {
    expect(staticQueryUrl(geocode.prefix, '2884218525')).toBe(
      `${D}/rest/geocode/page-data/sq/d/2884218525.json`,
    );
    expect(sitePrefixPath(`${D}/rest/`)).toBe('/rest');
    expect(sitePrefixPath('https://location.arcgis.com/')).toBe('');
  });
});

describe('relativeTo and ownsPage', () => {
  it('returns the path below a root without query or fragment', () => {
    expect(relativeTo(python.prefix, `${python.base}x.html#y`)).toBe('api-reference/x.html');
    expect(relativeTo(python.base, `${D}/pylib/latest/guide/`)).toBeUndefined();
  });

  it('applies the base and the URL filter', () => {
    expect(ownsPage(python, {}, `${python.base}x.html`)).toBe(true);
    expect(ownsPage(python, {}, `${python.prefix}guide/`)).toBe(false);
    expect(
      ownsPage(geocode, { exclude: ['^api-reference/'] }, `${geocode.base}api-reference/a/`),
    ).toBe(false);
    expect(ownsPage(geocode, { include: ['^help/'] }, `${geocode.base}help/a/`)).toBe(true);
  });
});

describe('resolveSiteUrl', () => {
  it('resolves paths relative to the prefix, with or without a leading slash', () => {
    expect(resolveSiteUrl(geocode, '/find-address-candidates/')).toBe(
      `${D}/rest/geocode/find-address-candidates/`,
    );
    expect(resolveSiteUrl(geocode, 'objects/sceneLayer/')).toBe(
      `${D}/rest/geocode/objects/sceneLayer/`,
    );
    expect(resolveSiteUrl(geocode, '/')).toBe(`${D}/rest/geocode/`);
  });

  it('recognises paths that already include the prefix and keeps fragments', () => {
    expect(
      resolveSiteUrl(python, '/pylib/latest/api-reference/pylib.gis.toc.html#pylib.gis.GIS'),
    ).toBe(`${D}/pylib/latest/api-reference/pylib.gis.toc.html#pylib.gis.GIS`);
    expect(resolveSiteUrl(python, '/api-reference/pylib.geocoding.html#geocode')).toBe(
      `${D}/pylib/latest/api-reference/pylib.geocoding.html#geocode`,
    );
  });

  it('normalises the page part', () => {
    expect(resolveSiteUrl(geocode, '/api-reference/pkg/Thing')).toBe(
      `${D}/rest/geocode/api-reference/pkg/Thing/`,
    );
    expect(resolveSiteUrl(geocode, '/a/b#c')).toBe(`${D}/rest/geocode/a/b/#c`);
  });

  it('maps the DEVSITE placeholder to the developers site and keeps full URLs', () => {
    expect(resolveSiteUrl(geocode, '/DEVSITE/documentation/glossary/token/')).toBe(
      `${D}/documentation/glossary/token/`,
    );
    expect(resolveSiteUrl(geocode, 'DEVSITE/rest/routing/')).toBe(`${D}/rest/routing/`);
    expect(resolveSiteUrl(geocode, 'https://example.org/a')).toBe('https://example.org/a/');
  });

  it('rejects placeholders, empty values and non-strings', () => {
    expect(resolveSiteUrl(geocode, '/__undefined/')).toBeUndefined();
    expect(resolveSiteUrl(geocode, '  ')).toBeUndefined();
    expect(resolveSiteUrl(geocode, null)).toBeUndefined();
    expect(resolveSiteUrl(geocode, 42)).toBeUndefined();
    expect(resolveSiteUrl(geocode, 'https://')).toBeUndefined();
  });
});

describe('navigation trees', () => {
  const tree = navTreeOf({
    title: 'Guide',
    type: 'root',
    children: [
      { title: 'Overview', url: '/', type: 'page' },
      {
        title: 'Layers',
        type: 'folder',
        url: '',
        children: [
          { title: 'Feature layers', url: '/layers/feature/', type: 'page' },
          { title: '', url: '/layers/untitled/', type: 'page' },
          { title: 'Deep', children: [{ title: 'Leaf', url: '/layers/deep/leaf/' }] },
        ],
      },
      { title: 'Line', url: '/__undefined/', type: 'divider' },
      { title: 'Overview again', url: '/', type: 'page' },
      'not a node',
      { title: 'Elsewhere', url: '/DEVSITE/documentation/', type: 'page' },
    ],
  });

  it('reads a root with children and rejects other shapes', () => {
    expect(tree?.title).toBe('Guide');
    expect(navTreeOf({ title: 'Guide' })).toBeUndefined();
    expect(navTreeOf(null)).toBeUndefined();
    expect(navTreeOf({ children: 'none' })).toBeUndefined();
  });

  it('gives the same key to the same tree and another key to another tree', () => {
    const again = navTreeOf({ title: 'Guide', children: tree?.children ?? [] });
    const other = navTreeOf({ title: 'API', children: tree?.children ?? [] });
    expect(again?.key).toBe(tree?.key);
    expect(other?.key).not.toBe(tree?.key);
  });

  it('flattens pages in order with their ancestors, skipping what is not a page', () => {
    if (tree === undefined) throw new Error('the tree must parse');
    expect(flattenNav(geocode, tree)).toEqual([
      { url: `${D}/rest/geocode/`, title: 'Overview', crumbs: [], root: 'Guide' },
      {
        url: `${D}/rest/geocode/layers/feature/`,
        title: 'Feature layers',
        crumbs: ['Layers'],
        root: 'Guide',
      },
      {
        url: `${D}/rest/geocode/layers/deep/leaf/`,
        title: 'Leaf',
        crumbs: ['Layers', 'Deep'],
        root: 'Guide',
      },
      { url: `${D}/documentation/`, title: 'Elsewhere', crumbs: [], root: 'Guide' },
    ]);
  });

  it('reads a resource hierarchy by its name fields', () => {
    const hierarchy = hierarchyTreeOf([
      { name: 'Root', url: '/root', children: [{ name: 'Users', url: '/users' }] },
    ]);
    if (hierarchy === undefined) throw new Error('the hierarchy must parse');
    expect(flattenNav(geocode, hierarchy)).toEqual([
      { url: `${D}/rest/geocode/root/`, title: 'Root', crumbs: [], root: '' },
      { url: `${D}/rest/geocode/users/`, title: 'Users', crumbs: ['Root'], root: '' },
    ]);
    expect(hierarchyTreeOf({ name: 'Root' })).toBeUndefined();
    expect(hierarchyTreeOf([])).toBeUndefined();
  });
});
