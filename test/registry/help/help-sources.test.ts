import { describe, expect, it } from 'vitest';
import type { Entry } from '../../../scripts/data/help-registry.schema.js';
import {
  basePath,
  bookList,
  compareVersionsDesc,
  docfxSource,
  legacyHelpSource,
  officialName,
  versionLine,
} from '../../../scripts/data/help-registry.sources.js';

/** An invented research entry in the shape of a doc.arcgis.com product. */
function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'doc-widgets',
    name: 'ArcGIS Widgets (user help)',
    host: 'doc.arcgis.com',
    base_url: 'https://doc.arcgis.com/en/widgets/latest/',
    url_slug: 'widgets',
    search: { site: 'arcgis_doc_col', product: ['widgets'] },
    other_versions_on_host: [],
    books: [
      { path: 'get-started', pages: 12, toc_script: '/en/widgets/latest/get-started/1.js' },
      { path: 'use', pages: 30, toc_script: null },
    ],
    pages_en: 42,
    status: 'active',
    scope: 'full',
    ...overrides,
  };
}

describe('compareVersionsDesc', () => {
  it('orders version numbers newest first, part by part', () => {
    const versions = ['10.9', '11.0', '10.9.1', '12.0', '10.10', '2.6', '3.0'];
    expect(versions.sort(compareVersionsDesc)).toEqual([
      '12.0',
      '11.0',
      '10.10',
      '10.9.1',
      '10.9',
      '3.0',
      '2.6',
    ]);
    expect(compareVersionsDesc('11.5', '11.5')).toBe(0);
  });
});

describe('officialName', () => {
  it('drops a trailing note in parentheses and nothing else', () => {
    expect(officialName('ArcGIS Urban (old numbered versions; current on doc.esri.com)')).toBe(
      'ArcGIS Urban',
    );
    expect(officialName('ArcGIS (classic) Viewer')).toBe('ArcGIS (classic) Viewer');
    expect(officialName('Site Scan for ArcGIS')).toBe('Site Scan for ArcGIS');
  });
});

describe('versionLine', () => {
  it('is a non-current line whose id is the version', () => {
    expect(versionLine('3.6', 'live', 'Pro ')).toEqual({
      id: '3.6',
      label: 'Pro 3.6',
      current: false,
      access: 'live',
      vars: {},
    });
    expect(versionLine('10.3', 'link-only').label).toBe('10.3');
  });
});

describe('basePath and bookList', () => {
  it('turn the version placeholder of the research into the line placeholder', () => {
    const versioned = makeEntry({
      host: 'enterprise.arcgis.com',
      base_url: 'https://enterprise.arcgis.com/en/widgets/<version>/',
    });
    expect(basePath(versioned)).toBe('/en/widgets/{line}/');
    expect(basePath(makeEntry())).toBe('/en/widgets/latest/');
  });

  it('reject a base URL on another host and books that are not a list', () => {
    expect(() => basePath(makeEntry({ base_url: 'https://example.com/en/widgets/' }))).toThrow(
      /is not on doc\.arcgis\.com/,
    );
    expect(() => bookList(makeEntry({ books: { '3.6': {} } }))).toThrow(/books is not a list/);
  });
});

describe('docfxSource', () => {
  const entry = makeEntry({ host: 'doc.esri.com', url_slug: 'arcgis-widgets', pages_en: 81 });

  it('describes a complete product with its page count and half of it as the probe floor', () => {
    expect(docfxSource(entry, 'ArcGIS Widgets', ['get-started', 'use'], true)).toEqual({
      id: 'help',
      title: 'ArcGIS Widgets help',
      kinds: ['help'],
      adapter: 'docfx-esri',
      config: { slug: 'arcgis-widgets', sections: ['get-started', 'use'] },
      capability: 'website',
      floor: true,
      pagesApprox: 81,
      probe: {
        url: 'https://doc.esri.com/en/arcgis-widgets/latest/sitemap.xml',
        expect: 'xml',
        family: 'docfx-esri',
        minRecords: 40,
      },
    });
  });

  it('states no count when books are left out or the research has none', () => {
    const scoped = docfxSource(entry, 'ArcGIS Widgets', ['use'], false);
    expect(scoped.pagesApprox).toBeUndefined();
    expect(scoped.probe.minRecords).toBeUndefined();
    const uncounted = docfxSource({ ...entry, pages_en: null }, 'ArcGIS Widgets', ['use'], true);
    expect(uncounted.pagesApprox).toBeUndefined();
    expect(uncounted.probe.minRecords).toBeUndefined();
  });
});

describe('legacyHelpSource', () => {
  it('describes an unversioned help tree with eager enumeration', () => {
    const entry = makeEntry();
    const source = legacyHelpSource({
      id: 'help',
      title: 'ArcGIS Widgets help',
      entry,
      books: bookList(entry),
      floor: true,
    });
    expect(source).toEqual({
      id: 'help',
      title: 'ArcGIS Widgets help',
      kinds: ['help'],
      adapter: 'legacy-help',
      config: {
        host: 'doc.arcgis.com',
        base: '/en/widgets/latest/',
        books: [
          { path: 'get-started', tocScript: '/en/widgets/latest/get-started/1.js' },
          { path: 'use' },
        ],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 42,
      probe: {
        url: 'https://doc.arcgis.com/en/widgets/latest/get-started/flisting.htm',
        expect: 'html',
        family: 'legacy-help',
        minChars: 200,
        mustContain: '.htm',
      },
    });
  });

  it('describes a versioned tree as on demand and probes the sampled version', () => {
    const entry = makeEntry({
      host: 'enterprise.arcgis.com',
      base_url: 'https://enterprise.arcgis.com/en/widgets/<version>/',
      books: [{ path: 'use', pages: null }],
      books_sampled_at: '11.4',
    });
    const source = legacyHelpSource({
      id: 'legacy',
      title: 'Earlier versions',
      entry,
      books: bookList(entry),
      versions: ['11.5', '11.4', '11.3'],
      liveVersions: ['11.5', '11.4'],
    });
    expect(source.config).toEqual({
      host: 'enterprise.arcgis.com',
      base: '/en/widgets/{line}/',
      books: [{ path: 'use' }],
      lines: ['11.5', '11.4'],
      enumerate: 'on-demand',
    });
    expect(source.lines).toEqual(['11.5', '11.4', '11.3']);
    expect(source.floor).toBeUndefined();
    // One book has no page count, so the total is unknown.
    expect(source.pagesApprox).toBeUndefined();
    expect(source.probe.url).toBe('https://enterprise.arcgis.com/en/widgets/11.4/use/flisting.htm');
  });

  it('probes the newest fetched version when the research sampled none', () => {
    const entry = makeEntry({ base_url: 'https://doc.arcgis.com/en/widgets/<version>/' });
    const source = legacyHelpSource({
      id: 'legacy',
      title: 'Earlier versions',
      entry,
      books: bookList(entry),
      versions: ['3.6', '3.5'],
    });
    expect(source.probe.url).toBe('https://doc.arcgis.com/en/widgets/3.6/get-started/flisting.htm');
    expect(source.config.lines).toEqual(['3.6', '3.5']);
  });

  it('rejects a source without books and a mismatch between base and versions', () => {
    const entry = makeEntry();
    const spec = { id: 'help', title: 'Help', entry };
    expect(() => legacyHelpSource({ ...spec, books: [] })).toThrow(/has no books/);
    expect(() => legacyHelpSource({ ...spec, books: bookList(entry), versions: ['11.5'] })).toThrow(
      /versioned base/,
    );
    const versioned = makeEntry({ base_url: 'https://doc.arcgis.com/en/widgets/<version>/' });
    expect(() =>
      legacyHelpSource({ ...spec, entry: versioned, books: bookList(versioned) }),
    ).toThrow(/versioned base/);
  });
});
