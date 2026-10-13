/**
 * Registry data: developer-tier tombstones (design section 4.5). They are hidden unless
 * `include_legacy` is set and are down-ranked in search; their job is to name the successor
 * when an agent asks for a retired product.
 *
 * Two of them still have developer pages online, which stay readable; the other two have no
 * sources at all (their hosts are link-only or the pages are gone).
 */
import type { Product, VersionLine } from '../../core/types.js';
import { D } from './builders.js';
import { helpDeveloperLinks } from './help.generated.js';

const VERIFIED_ON = '2026-10-13';

const LIVE: VersionLine = {
  id: 'latest',
  label: 'Final release',
  current: true,
  access: 'live',
  vars: {},
};
/** Nothing of the product is fetched: every answer is a link. */
const LINK_ONLY: VersionLine = { ...LIVE, access: 'link-only' };

/** Fields shared by the four tombstones. */
const TOMBSTONE = {
  tier: 'developer',
  status: 'retired',
  packages: [],
  repos: [],
  oracles: [],
  related: [],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
} satisfies Partial<Product>;

/** The retired end-user help of a tombstone, taken from the help import (design section 4.6). */
function helpLink(id: string): Product['startHere'] {
  const link = helpDeveloperLinks[id];
  return link === undefined ? [] : [link];
}

const WAB_SITEMAPS = [
  '/web-appbuilder/guide/sitemap.xml',
  '/web-appbuilder/api-reference/sitemap.xml',
  '/web-appbuilder/sample-code/sitemap.xml',
];
/** Pages listed by the three sitemaps on 2026-10-13: 181 + 69 + 17. */
const WAB_PAGES = 267;
const APPSTUDIO_PAGES = 332;

const webAppBuilder: Product = {
  ...TOMBSTONE,
  id: 'web-appbuilder',
  name: 'ArcGIS Web AppBuilder (Developer Edition)',
  aliases: ['wab', 'web-app-builder', 'webappbuilder'],
  category: 'web',
  statusNote: 'Retired; build new apps with ArcGIS Experience Builder.',
  successor: 'experience-builder',
  summary:
    'Retired framework for custom widgets and themes on the 3.x JavaScript API. Pages remain readable for maintaining existing apps.',
  keywords: ['widget', 'theme', 'dojo', 'jimu.js', 'custom widget', 'migration'],
  languages: ['javascript'],
  homepage: `${D}/web-appbuilder/`,
  lines: [LIVE],
  sources: [
    {
      // Three static sub-sites, each with its own sitemap.xml and no index files. Filter
      // patterns are relative to each sitemap's directory, so they cannot tell the three
      // apart: pages are classified by the extractor, not by a `classify` rule.
      id: 'guide',
      title: 'Guide, API reference and sample code (retired)',
      kinds: ['guide', 'api', 'sample'],
      adapter: 'sitemap',
      config: { urls: WAB_SITEMAPS, titleFrom: 'slug' },
      capability: 'website',
      floor: true,
      pagesApprox: WAB_PAGES,
      probe: { url: `${D}${WAB_SITEMAPS[0]}`, expect: 'xml', minRecords: 90 },
    },
  ],
  esearch: { index: 'developers_arcgis_v1', products: ['web-appbuilder'] },
  startHere: [
    { title: 'Products and APIs not to start new work on', ref: 'brief:legacy/do-not-use' },
    ...helpLink('web-appbuilder'),
  ],
  pitfalls: [
    'Web AppBuilder widgets use the 3.x JavaScript API and Dojo; nothing here applies to Experience Builder widgets (React, jimu).',
  ],
};

const appStudio: Product = {
  ...TOMBSTONE,
  id: 'appstudio',
  name: 'ArcGIS AppStudio',
  aliases: ['arcgis-appstudio', 'appstudio-qml', 'appframework'],
  category: 'native',
  statusNote: 'Retired 2025-02-01.',
  summary:
    'Retired toolkit for building cross-platform native apps with QML. Pages remain readable for maintaining existing apps.',
  keywords: ['qml', 'app framework', 'appstudio player', 'cross-platform', 'migration'],
  languages: ['qml', 'javascript'],
  homepage: `${D}/appstudio/`,
  repos: [
    {
      repo: 'Esri/arcgis-appstudio-samples',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'v5.5',
    },
  ],
  lines: [LIVE],
  sources: [
    {
      id: 'guide',
      title: 'Guide and API reference (retired)',
      kinds: ['guide', 'api', 'tutorial'],
      adapter: 'gatsby',
      config: {
        base: '/appstudio/',
        classify: [
          ['^api-reference/', 'api'],
          ['^tutorials/', 'tutorial'],
        ],
      },
      capability: 'website',
      floor: true,
      pagesApprox: APPSTUDIO_PAGES,
      probe: {
        url: `${D}/appstudio/sitemap-0.xml`,
        expect: 'xml',
        minRecords: Math.floor(APPSTUDIO_PAGES / 2),
        family: 'gatsby',
      },
    },
  ],
  oracles: [{ type: 'static', options: { retirement: '2025-02-01' }, provides: ['lifecycle'] }],
  esearch: { index: 'developers_arcgis_v1', products: ['appstudio'] },
  startHere: [
    { title: 'Products and APIs not to start new work on', ref: 'brief:legacy/do-not-use' },
    ...helpLink('appstudio'),
  ],
  pitfalls: [
    'There is no drop-in successor: new native apps use one of the ArcGIS Maps SDKs (read brief:products/which-sdk).',
  ],
  related: ['qt-maps-sdk', 'flutter-maps-sdk'],
};

const jsApi3x: Product = {
  ...TOMBSTONE,
  id: 'js-api-3x',
  name: 'ArcGIS API for JavaScript 3.x',
  aliases: ['jsapi3', 'arcgis-js-api-3', 'javascript-3x', 'esri-dojo'],
  category: 'web',
  statusNote: 'Retired 2024-07-01; its documentation is no longer hosted.',
  successor: 'js-maps-sdk',
  summary:
    'Retired Dojo-based JavaScript API (esri/map, AMD only). Its pages now redirect to the current ArcGIS Maps SDK for JavaScript.',
  keywords: ['dojo', 'amd', 'esri/map', 'legacy widgets', 'migration', '3.x'],
  languages: ['javascript'],
  // Every 3.x path redirects here.
  homepage: `${D}/javascript/latest/`,
  lines: [LINK_ONLY],
  sources: [],
  oracles: [{ type: 'static', options: { retirement: '2024-07-01' }, provides: ['lifecycle'] }],
  startHere: [
    { title: 'Products and APIs not to start new work on', ref: 'brief:legacy/do-not-use' },
    { title: 'ArcGIS Maps SDK for JavaScript (successor)', ref: `${D}/javascript/latest/` },
  ],
  pitfalls: [
    'Code that requires "esri/map" or other 3.x modules cannot be mixed with the current SDK: it has to be rewritten, not upgraded.',
  ],
};

const arcObjects: Product = {
  ...TOMBSTONE,
  id: 'arcobjects-arcmap',
  name: 'ArcObjects SDK and ArcMap',
  aliases: ['arcobjects', 'arcmap', 'arcgis-desktop', 'arcobjects-sdk'],
  category: 'desktop-enterprise',
  statusNote: 'ArcMap and the ArcObjects SDK are retired; extend ArcGIS Pro instead.',
  successor: 'arcgis-pro-sdk',
  summary:
    'Retired COM-based SDK for ArcMap and ArcGIS Engine. Its help host is never fetched: answers are links only.',
  keywords: ['arcobjects', 'arcmap', 'com', 'arcgis engine', 'add-in', 'migration'],
  languages: ['csharp', 'vbnet', 'cpp'],
  // desktop.arcgis.com is a link-only host (robots Disallow: /).
  homepage: 'https://desktop.arcgis.com/en/arcobjects/latest/',
  lines: [LINK_ONLY],
  sources: [],
  startHere: [
    { title: 'Products and APIs not to start new work on', ref: 'brief:legacy/do-not-use' },
  ],
  pitfalls: [
    'ArcObjects types have no one-to-one equivalent in the Pro SDK: look up the Pro SDK concept, not the old interface name.',
    'Server object extensions written with ArcObjects are covered by enterprise-sdk, which still documents the Java and .NET ArcObjects API for ArcGIS Server.',
  ],
  related: ['enterprise-sdk', 'arcpy'],
};

/** Developer-tier tombstones (design section 4.5), four ids. */
export const legacyProducts: readonly Product[] = [webAppBuilder, appStudio, jsApi3x, arcObjects];
