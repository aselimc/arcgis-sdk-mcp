import { describe, expect, it } from 'vitest';
import type { TtlClass } from '../../src/core/types.js';
import {
  REMOTE_SEARCH_EMPTY_TTL_MS,
  STALE_IF_ERROR_MS,
  TTL_CLASSES,
  TTL_MS,
  defaultTtlClass,
  freshness,
  freshnessAt,
  revalidates,
  staleIfErrorMs,
} from '../../src/cache/ttl.js';
import { DAY, FAKE_NOW, HOUR } from '../support/fake-clock.js';

/** The TTL table of design section 6.2, written out. */
const TABLE: Array<[ttl: TtlClass, fresh: number, staleAfterFetch: number, revalidated: boolean]> =
  [
    ['immutable', 365 * DAY, 365 * DAY, false],
    ['page', DAY, 30 * DAY, true],
    ['index', DAY, 30 * DAY, true],
    ['volatile', 6 * HOUR, 30 * DAY, true],
    ['github-meta', 7 * DAY, 30 * DAY, true],
    ['spec', 7 * DAY, 30 * DAY, true],
    ['remote-search', DAY, DAY, false],
    ['negative', HOUR, 30 * DAY, false],
  ];

describe('TTL table', () => {
  it('covers every class', () => {
    expect(TABLE.map(([ttl]) => ttl).sort()).toEqual([...TTL_CLASSES].sort());
  });

  it.each(TABLE)('%s', (ttl, fresh, staleAfterFetch, revalidated) => {
    expect(TTL_MS[ttl]).toBe(fresh);
    expect(freshness(ttl, FAKE_NOW)).toEqual({
      freshUntil: FAKE_NOW + fresh,
      staleUntil: FAKE_NOW + staleAfterFetch,
    });
    expect(revalidates(ttl)).toBe(revalidated);
  });

  it('keeps a stale-if-error window of 30 days for everything but remote search', () => {
    expect(STALE_IF_ERROR_MS).toBe(30 * DAY);
    for (const ttl of TTL_CLASSES) {
      expect(staleIfErrorMs(ttl)).toBe(ttl === 'remote-search' ? 0 : 30 * DAY);
    }
  });

  it('never ends the stale window before the fresh one', () => {
    for (const ttl of TTL_CLASSES) {
      const window = freshness(ttl, FAKE_NOW);
      expect(window.staleUntil).toBeGreaterThanOrEqual(window.freshUntil);
    }
  });

  it('asks an empty remote search again after one hour', () => {
    expect(REMOTE_SEARCH_EMPTY_TTL_MS).toBe(HOUR);
    expect(freshness('remote-search', FAKE_NOW, { empty: true })).toEqual({
      freshUntil: FAKE_NOW + HOUR,
      staleUntil: FAKE_NOW + HOUR,
    });
    // The flag means nothing for other classes.
    expect(freshness('page', FAKE_NOW, { empty: true })).toEqual(freshness('page', FAKE_NOW));
  });
});

describe('freshnessAt', () => {
  const window = freshness('page', FAKE_NOW);

  it.each([
    [0, 'fresh'],
    [DAY - 1, 'fresh'],
    [DAY, 'stale'],
    [30 * DAY - 1, 'stale'],
    [30 * DAY, 'expired'],
    [400 * DAY, 'expired'],
  ] as const)('a page %d ms after the fetch is %s', (age, expected) => {
    expect(freshnessAt(window, FAKE_NOW + age)).toBe(expected);
  });

  it('never calls a remote search result stale', () => {
    const search = freshness('remote-search', FAKE_NOW);
    expect(freshnessAt(search, FAKE_NOW + DAY - 1)).toBe('fresh');
    expect(freshnessAt(search, FAKE_NOW + DAY)).toBe('expired');
  });
});

describe('defaultTtlClass', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const cases: Array<[url: string, expect: Parameters<typeof defaultTtlClass>[1], ttl: TtlClass]> =
    [
      // jsDelivr: only an exact version is immutable.
      ['https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@1.2.3/index.d.ts', 'text', 'immutable'],
      [
        'https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@5.0.0-next.12/api.json',
        'json',
        'immutable',
      ],
      ['https://cdn.jsdelivr.net/npm/esri-leaflet@3.0.0/package.json', 'json', 'immutable'],
      ['https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@latest/index.d.ts', 'text', 'volatile'],
      ['https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@1/index.d.ts', 'text', 'volatile'],
      ['https://cdn.jsdelivr.net/npm/@arcgis/widget-kit/index.d.ts', 'text', 'volatile'],
      ['https://data.jsdelivr.com/v1/packages/npm/@arcgis/widget-kit@1.2.3', 'json', 'immutable'],
      ['https://data.jsdelivr.com/v1/packages/npm/@arcgis/widget-kit', 'json', 'volatile'],
      // GitHub raw: a commit or refs/tags is immutable, a bare ref may be a branch.
      [`https://raw.githubusercontent.com/Esri/widget-kit/${sha}/README.md`, 'text', 'immutable'],
      [
        'https://raw.githubusercontent.com/Esri/widget-kit/refs/tags/v1.2.3/README.md',
        'text',
        'immutable',
      ],
      [
        'https://raw.githubusercontent.com/Esri/widget-kit/refs/heads/main/README.md',
        'text',
        'volatile',
      ],
      ['https://raw.githubusercontent.com/Esri/widget-kit/main/README.md', 'text', 'volatile'],
      ['https://raw.githubusercontent.com/Esri/widget-kit/v1.2.3/README.md', 'text', 'volatile'],
      ['https://raw.githubusercontent.com/wiki/Esri/widget-kit/Home.md', 'text', 'volatile'],
      ['https://raw.githubusercontent.com/Esri', 'text', 'volatile'],
      // GitHub API.
      ['https://api.github.com/repos/Esri/widget-kit', 'json', 'github-meta'],
      ['https://api.github.com/repos/Esri/widget-kit/license', 'json', 'github-meta'],
      ['https://api.github.com/repos/Esri/widget-kit/releases/latest', 'json', 'volatile'],
      [
        'https://api.github.com/repos/Esri/widget-kit/git/trees/main?recursive=1',
        'json',
        'volatile',
      ],
      [
        `https://api.github.com/repos/Esri/widget-kit/git/trees/${sha}?recursive=1`,
        'json',
        'immutable',
      ],
      // Registries and oracles.
      ['https://registry.npmjs.org/@arcgis/widget-kit', 'json', 'volatile'],
      ['https://pypi.org/pypi/widgetpy/json', 'json', 'volatile'],
      ['https://api.nuget.org/v3-flatcontainer/esri.widgets/index.json', 'json', 'volatile'],
      ['https://pub.dev/api/packages/widget_maps', 'json', 'volatile'],
      ['https://www.arcgis.com/sharing/rest?f=json', 'json', 'volatile'],
      ['https://plc-api.esri.com/api/PLC?category=widgets', 'json', 'volatile'],
      // Remote search.
      ['https://esearchapi.esri.com/search', 'json', 'remote-search'],
      // OpenAPI documents.
      ['https://hub.arcgis.com/api/v3/docs-json', 'json', 'spec'],
      ['https://hub.arcgis.com/api/v3/definition/swagger-ui-init.js', 'text', 'spec'],
      ['https://sitescan-api.arcgis.com/api/v2/apidocs.json', 'json', 'spec'],
      ['https://developers.arcgis.com/rest/widgets/openapi.json', 'json', 'spec'],
      ['https://developers.arcgis.com/rest/widgets/swagger.yaml', 'yaml', 'spec'],
      // Documentation hosts: structured bodies are index files, the rest are pages.
      ['https://developers.arcgis.com/widgets/sitemap-0.xml', 'xml', 'index'],
      ['https://developers.arcgis.com/widgets/search-index.json', 'json', 'index'],
      ['https://doc.esri.com/en/widget-server/latest/xrefmap.yml', 'yaml', 'index'],
      ['https://developers.arcgis.com/widgets/get-started/', 'html', 'page'],
      ['https://esri.github.io/widget-kit/objects.inv', 'text', 'page'],
      // Without `expect`, the extension decides.
      ['https://developers.arcgis.com/widgets/get-started/', undefined, 'page'],
      ['https://developers.arcgis.com/widgets/page.htm', undefined, 'page'],
      ['https://developers.arcgis.com/widgets/sitemap', undefined, 'index'],
      ['https://developers.arcgis.com/widgets/sitemap-index.xml', undefined, 'index'],
      ['https://developers.arcgis.com/widgets/toc.json', undefined, 'index'],
      ['https://esri.github.io/widget-kit/objects.inv', undefined, 'index'],
      ['https://esri.github.io/widget-kit/searchindex.js', undefined, 'index'],
      ['https://doc.esri.com/en/widget-server/latest/xrefmap.yaml', undefined, 'index'],
    ];

  it.each(cases)('%s (%s) is %s', (url, expected, ttl) => {
    expect(defaultTtlClass(new URL(url), expected)).toBe(ttl);
  });
});
