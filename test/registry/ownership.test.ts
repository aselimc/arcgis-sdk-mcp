import { describe, expect, it } from 'vitest';
import { createOwnership } from '../../src/registry/ownership.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { loadData } from './load-data.js';

const D = 'https://developers.arcgis.com';
const PRO = 'https://doc.esri.com/en/arcgis-pro/latest';
const GH = 'https://github.com';
const RAW = 'https://raw.githubusercontent.com';

const data = await loadData();
const ownerOf = createOwnership(data.products);
const ids = new Set(data.products.map((product) => product.id));

function owner(url: string): string | undefined {
  const found = ownerOf(new URL(url));
  return found === undefined
    ? undefined
    : `${found.product.id}/${found.source.id}@${found.line.id}`;
}

/** `[URL, product/source@line]`: paths are invented, the bases are the registry's. */
const OWNERS: Array<[string, string]> = [
  // One base, three sources told apart by filters, plus the components template.
  [`${D}/javascript/latest/`, 'js-maps-sdk/guide@latest'],
  [`${D}/javascript/latest/layers/`, 'js-maps-sdk/guide@latest'],
  [`${D}/javascript/latest/tutorials/some-tutorial/`, 'js-maps-sdk/guide@latest'],
  [`${D}/javascript/latest/release-notes/`, 'js-maps-sdk/guide@latest'],
  [`${D}/javascript/latest/sample-code/`, 'js-maps-sdk/samples@latest'],
  [`${D}/javascript/latest/sample-code/some-sample/`, 'js-maps-sdk/samples@latest'],
  [`${D}/javascript/latest/references/core/layers/SomeLayer/`, 'js-maps-sdk/core@latest'],
  [
    `${D}/javascript/latest/references/core/layers/SomeLayer/#someMethod`,
    'js-maps-sdk/core@latest',
  ],
  [
    `${D}/javascript/latest/references/map-components/components/arcgis-some/`,
    'js-maps-sdk/components@latest',
  ],
  [`${GH}/Esri/jsapi-resources/blob/main/templates/some/README.md`, 'js-maps-sdk/templates@latest'],
  // Other web products.
  [`${D}/calcite-design-system/foundations/some-page/`, 'calcite/guide@latest'],
  [`${D}/calcite-design-system/components/some-component/`, 'calcite/components@latest'],
  [`${D}/arcade/guide/some-page/`, 'arcade/guide@latest'],
  [`${D}/arcade/function-reference/some_functions/#some`, 'arcade/functions@latest'],
  [`${GH}/Esri/arcade-expressions/blob/master/popup/some.md`, 'arcade/expressions@latest'],
  [`${D}/arcgis-rest-js/api-reference/arcgis-rest-request/some/`, 'rest-js/guide@latest'],
  [`${D}/experience-builder/guide/some-page/`, 'experience-builder/guide@latest'],
  [`${D}/esri-leaflet/api-reference/some-layer/`, 'esri-leaflet/guide@latest'],
  [`${D}/web-map-specification/objects/someObject/`, 'web-map-spec/spec@latest'],
  [`${D}/web-scene-specification/objects/someObject/`, 'web-scene-spec/spec@latest'],
  // Native SDKs: two lines, and reference sources below the guide base.
  [`${D}/kotlin/some-topic/`, 'kotlin-maps-sdk/guide@latest'],
  [`${D}/kotlin/v200/some-topic/`, 'kotlin-maps-sdk/guide@v200'],
  [`${D}/kotlin/api-reference/some/index.html`, 'kotlin-maps-sdk/api@latest'],
  [`${D}/kotlin/v200/api-reference/some/index.html`, 'kotlin-maps-sdk/api@v200'],
  [`${D}/kotlin/toolkit-api-reference/some/index.html`, 'kotlin-maps-sdk/toolkit-api@latest'],
  [`${D}/swift/api-reference/documentation/arcgis/some`, 'swift-maps-sdk/api@latest'],
  [`${D}/swift/v200/toolkit-api-reference/documentation/some`, 'swift-maps-sdk/toolkit-api@v200'],
  [`${D}/net/api-reference/api/net/Some.Type.html`, 'dotnet-maps-sdk/api@latest'],
  [
    'https://esri.github.io/arcgis-maps-sdk-dotnet-toolkit/api/Some.Type.html',
    'dotnet-maps-sdk/toolkit-api@latest',
  ],
  [`${D}/qt/cpp/api-reference/esri-arcgisruntime-some.html`, 'qt-maps-sdk/guide@latest'],
  [
    `${D}/flutter/api-reference/reference/arcgis_maps/Some-class.html`,
    'flutter-maps-sdk/api@latest',
  ],
  [
    `${D}/flutter/toolkit-api-reference/some/Some-class.html`,
    'flutter-maps-sdk/toolkit-api@latest',
  ],
  [`${D}/java/v200/some-topic/`, 'java-maps-sdk/guide@v200'],
  [`${D}/java/v200/api-reference/reference/com/esri/Some.html`, 'java-maps-sdk/api@v200'],
  [`${D}/unity/api-reference/gameengine/some/Type/`, 'unity-maps-sdk/guide@latest'],
  [`${D}/unreal-engine/maps/some-topic/`, 'unreal-maps-sdk/guide@latest'],
  [
    `${RAW}/Esri/arcgis-maps-sdk-swift-samples/v300.1.0/Shared/Samples/Some%20sample/README.md`,
    'swift-maps-sdk/samples@latest',
  ],
  [
    `${GH}/esri/ARCGIS-MAPS-SDK-KOTLIN-SAMPLES/tree/main/samples/some`,
    'kotlin-maps-sdk/samples@latest',
  ],
  // A tombstone's link list points into another product's guide and does not take it over.
  [`${D}/kotlin/reference/migrate-from-100-x-to-200-x/`, 'kotlin-maps-sdk/guide@latest'],
  // Python, ArcPy and the Pro documentation shared with product help.
  [`${D}/python/latest/guide/some-guide/`, 'python-api/guide@latest'],
  [`${D}/python/latest/api-reference/arcgis.some.html`, 'python-api/api@latest'],
  [`${D}/python-2-3/guide/some-guide/`, 'python-api/guide@2.3'],
  [`${D}/python-2-3/api-reference/arcgis.some.html`, 'python-api/api@2.3'],
  [`${GH}/Esri/arcgis-python-api/blob/master/samples/some.ipynb`, 'python-api/samples@latest'],
  [`${PRO}/arcpy/functions/some.html`, 'arcpy/arcpy@latest'],
  [`${PRO}/tool-reference/analysis/some.html`, 'arcpy/tools@latest'],
  ['https://pro.arcgis.com/en/pro-app/3.6/arcpy/functions/some.htm', 'arcpy/legacy@3.6'],
  [
    'https://pro.arcgis.com/en/pro-app/3.5/tool-reference/analysis/some.htm',
    'arcpy/legacy-tools@3.5',
  ],
  [
    'https://pro.arcgis.com/en/pro-app/3.6/tool-reference/spatial-analyst/some.htm',
    'arcpy/legacy-tools-extensions@3.6',
  ],
  // Link-only releases are owned too, so they answer with a link like the help does.
  ['https://pro.arcgis.com/en/pro-app/2.9/arcpy/functions/some.htm', 'arcpy/legacy@2.9'],
  [
    'https://pro.arcgis.com/en/pro-app/3.4/tool-reference/analysis/buffer.htm',
    'arcpy/legacy-tools@3.4',
  ],
  // A toolbox that later releases dropped still belongs to the tool reference.
  [
    'https://pro.arcgis.com/en/pro-app/3.0/tool-reference/no-longer-a-toolbox/some.htm',
    'arcpy/legacy-tools@3.0',
  ],
  [`${D}/geoanalytics/sql-functions/some/`, 'geoanalytics-engine/guide@latest'],
  [`${D}/geoanalytics/api-reference/geoanalytics.some.html`, 'geoanalytics-engine/api@latest'],
  [`${D}/geoanalytics-fabric/api-reference/some.html`, 'geoanalytics-fabric/api@latest'],
  [`${D}/r-bridge/layers/some-topic/`, 'r-arcgis/guide@latest'],
  ['https://r.esri.com/arcgislayers/reference/some.html', 'r-arcgis/packages@latest'],
  // Desktop and Enterprise extensibility.
  [`${GH}/Esri/arcgis-pro-sdk/wiki/ProConcepts-Some`, 'arcgis-pro-sdk/wiki@latest'],
  [`${RAW}/wiki/Esri/arcgis-pro-sdk/ProConcepts-Some.md`, 'arcgis-pro-sdk/wiki@latest'],
  [
    `${GH}/Esri/arcgis-pro-sdk-community-samples/blob/master/Map-Exploration/Some/ReadMe.md`,
    'arcgis-pro-sdk/samples@latest',
  ],
  [
    `${GH}/Esri/arcgis-pro-sdk-snippets/blob/main/some/Snippets.cs`,
    'arcgis-pro-sdk/snippets@latest',
  ],
  [`${D}/enterprise-sdk/guide/net/some-topic/`, 'enterprise-sdk/guide@latest'],
  [`${D}/enterprise-sdk/api-reference/net/ISomeType/`, 'enterprise-sdk/guide@latest'],
  [`${D}/enterprise-sdk/api-reference/java/com/esri/Some.html`, 'enterprise-sdk/java-api@latest'],
  ['https://doc.arcgis.com/en/cityengine/latest/cga/some-rule.htm', 'cityengine/help@latest'],
  ['https://esri.github.io/pyprt/apidoc/', 'cityengine/sdk@latest'],
  [`${GH}/Esri/pyprt-examples/blob/main/some.ipynb`, 'cityengine/pyprt-examples@latest'],
  [
    'https://doc.arcgis.com/en/arcgis-earth/automation-api/some.htm',
    'earth-automation-api/api@latest',
  ],
  [
    'https://doc.arcgis.com/en/arcgis-for-autocad/latest/commands-api/some.htm',
    'autocad-api/api@latest',
  ],
  [
    'https://enterprise.arcgis.com/en/geoevent/latest/ingest/some.htm',
    'geoevent-server/help@latest',
  ],
];

/** URLs that belong to no source of the products checked here. */
const UNOWNED = [
  'https://example.com/javascript/latest/',
  'https://archive.developers.arcgis.com/javascript/v5-0/',
  `${D}/`,
  `${D}/no-such-product/guide/`,
  `${D}/javascript/latest/demo-apps/some-app/`,
  `${D}/javascript/latest/api-reference/esri-Map.html`,
  `${GH}/Esri/no-such-repository-anywhere/blob/main/README.md`,
  `${GH}/Esri/arcgis-pro-sdk/issues/1`,
  'https://pro.arcgis.com/en/pro-app/2.5/arcpy/functions/some.htm',
  'https://r.esri.com/no-such-package/reference/some.html',
  'brief:ai/overview',
  'mailto:someone@example.com',
];

describe('URL ownership', () => {
  it('covers at least 40 URLs', () => {
    expect(OWNERS.length).toBeGreaterThanOrEqual(40);
  });

  it.each(OWNERS)('%s belongs to %s', (url, expected) => {
    expect(owner(url)).toBe(expected);
  });

  it.each(UNOWNED)('%s has no owner', (url) => {
    expect(owner(url)).toBeUndefined();
  });

  it('treats http like https and ignores the fragment and the query', () => {
    expect(owner('http://developers.arcgis.com/kotlin/some-topic/?utm_source=x#part')).toBe(
      'kotlin-maps-sdk/guide@latest',
    );
  });

  it('finds an owner for the root of every source that has one', () => {
    for (const product of data.products) {
      for (const source of product.sources) {
        if (source.adapter !== 'astro' && source.adapter !== 'gatsby') continue;
        if (source.config.include !== undefined) continue;
        const line = product.lines.find(
          (candidate) => candidate.current && (source.lines?.includes(candidate.id) ?? true),
        );
        if (line === undefined) continue;
        const base = source.config.base.replace(
          /\{(\w+)\}/g,
          (_, name: string) => line.vars[name] ?? '',
        );
        const url = new URL(base, D);
        expect(ownerOf(url)?.product.id, url.href).toBe(product.id);
      }
    }
  });

  // These need products of other data files.
  it.skipIf(!ids.has('arcgis-pro') || !ids.has('location-platform') || !ids.has('rest-api'))(
    'shares hosts with product help and the REST products',
    () => {
      expect(owner(`${PRO}/help/mapping/some.html`)).toBe('arcgis-pro/help@latest');
      expect(owner('https://pro.arcgis.com/en/pro-app/3.6/help/some.htm')).toBe(
        'arcgis-pro/legacy@3.6',
      );
      // A page that a product documents is not taken over by a curated link to it.
      expect(owner('https://location.arcgis.com/help/agentic-ai/')).toBe(
        'location-platform/help@latest',
      );
      expect(owner(`${D}/rest/services-reference/enterprise/some-operation/`)).toBe(
        'rest-api/services-enterprise@latest',
      );
      expect(owner('https://doc.arcgis.com/en/arcgis-earth/use/some.htm')).toBe(
        'arcgis-earth/help@latest',
      );
    },
  );
});

describe('createOwnership', () => {
  const guide = makeSource('gatsby', { base: '/widgets/' });
  const api = makeSource('gatsby', { base: '/widgets/api/' }, { id: 'api', floor: false });
  const twin = makeSource('gatsby', { base: '/widgets/api/' }, { id: 'twin', floor: false });
  const old = makeSource(
    'gatsby',
    { base: '/widgets/{line}/' },
    { id: 'old', floor: false, lines: ['v1'] },
  );
  const widgets = makeProduct({
    lines: [makeLine({ id: 'v1', current: false }), makeLine()],
    sources: [guide, api, twin, old],
  });
  const links = makeProduct({
    id: 'links',
    aliases: [],
    sources: [
      makeSource('static', {
        entries: [
          {
            url: 'https://developers.arcgis.com/widgets/api/special/',
            title: 'Special',
            kind: 'guide',
          },
          {
            url: 'https://developers.arcgis.com/elsewhere/page/',
            title: 'Elsewhere',
            kind: 'guide',
          },
        ],
      }),
    ],
  });
  const local = createOwnership([links, widgets]);
  const find = (path: string) => {
    const found = local(new URL(path, D));
    return found === undefined
      ? undefined
      : `${found.product.id}/${found.source.id}@${found.line.id}`;
  };

  it('picks the longest prefix', () => {
    expect(find('/widgets/start/')).toBe('widgets-sdk/guide@latest');
    expect(find('/widgets/api/Thing/')).toBe('widgets-sdk/api@latest');
  });

  it('gives a tie to the earlier source and to the current line', () => {
    expect(find('/widgets/api/')).toBe('widgets-sdk/api@latest');
  });

  it('considers only the lines a source exists for', () => {
    expect(find('/widgets/v1/page/')).toBe('widgets-sdk/old@v1');
    expect(find('/widgets/latest/page/')).toBe('widgets-sdk/guide@latest');
  });

  it('lets a curated link own a page only when no other source documents it', () => {
    expect(find('/widgets/api/special/')).toBe('widgets-sdk/api@latest');
    expect(find('/elsewhere/page/')).toBe('links/guide@latest');
    expect(createOwnership([widgets, links])(new URL('/elsewhere/page/', D))?.product.id).toBe(
      'links',
    );
  });

  it('ignores sources that own no URL', () => {
    const briefs = makeProduct({
      id: 'briefs',
      aliases: [],
      sources: [makeSource('brief', { slugs: ['ai/*'] })],
    });
    expect(
      createOwnership([briefs])(new URL('https://developers.arcgis.com/widgets/')),
    ).toBeUndefined();
  });
});
