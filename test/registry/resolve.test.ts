import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import type { ProductResolution } from '../../src/core/ports.js';
import { desktopEnterpriseProducts } from '../../src/registry/data/desktop-enterprise.js';
import { nativeProducts } from '../../src/registry/data/native.js';
import { pythonProducts } from '../../src/registry/data/python.js';
import { webProducts } from '../../src/registry/data/web.js';
import { createResolver, plainKey, squashedKey } from '../../src/registry/resolve.js';
import { createRouter } from '../../src/registry/router.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { loadData } from './load-data.js';

type How = ProductResolution['how'];

/** The products this table is about; the resolver itself is built over everything that exists. */
const OWN = [...webProducts, ...nativeProducts, ...pythonProducts, ...desktopEnterpriseProducts];

const data = await loadData();
const route = createRouter(data.products);
// Wired as in `createRegistry`: the router supplies candidates for names that match nothing.
const resolver = createResolver(data.products, (text, n) =>
  route(text, n).map((entry) => entry.product),
);

/** `[input, product id, how]`: names a person or an agent would plausibly pass as `product`. */
const ALIASES: Array<[string, string, How]> = [
  // JavaScript
  ['javascript', 'js-maps-sdk', 'alias'],
  ['JavaScript', 'js-maps-sdk', 'alias'],
  ['  js ', 'js-maps-sdk', 'alias'],
  ['"javascript"', 'js-maps-sdk', 'alias'],
  ['jsapi', 'js-maps-sdk', 'alias'],
  ['@arcgis/core', 'js-maps-sdk', 'alias'],
  ['@arcgis/map-components', 'js-maps-sdk', 'alias'],
  ['@arcgis/charts-components', 'js-maps-sdk', 'alias'],
  ['@arcgis/coding-components', 'js-maps-sdk', 'alias'],
  ['ai-components', 'js-maps-sdk', 'alias'],
  ['arcgis-assistant', 'js-maps-sdk', 'alias'],
  ['arcgis maps sdk for javascript', 'js-maps-sdk', 'alias'],
  ['ArcGIS Maps SDK for JavaScript', 'js-maps-sdk', 'alias'],
  ['ArcGIS JS API', 'js-maps-sdk', 'alias'],
  ['JS Maps SDK', 'js-maps-sdk', 'id'],
  ['js_maps_sdk', 'js-maps-sdk', 'id'],
  // Calcite, Arcade, REST JS, Experience Builder
  ['calcite-components', 'calcite', 'alias'],
  ['@esri/calcite-components', 'calcite', 'alias'],
  ['Calcite Design System', 'calcite', 'alias'],
  ['calcite components', 'calcite', 'alias'],
  ['arcgis calcite', 'calcite', 'fuzzy'],
  ['ArcGIS Arcade', 'arcade', 'alias'],
  ['arcade language', 'arcade', 'alias'],
  ['arcgis-rest-js', 'rest-js', 'alias'],
  ['@esri/arcgis-rest-request', 'rest-js', 'alias'],
  ['@esri/arcgis-rest-portal', 'rest-js', 'alias'],
  ['Esri/arcgis-rest-js', 'rest-js', 'alias'],
  ['ArcGIS REST JS', 'rest-js', 'alias'],
  ['exb', 'experience-builder', 'alias'],
  ['jimu', 'experience-builder', 'alias'],
  ['Experience Builder', 'experience-builder', 'alias'],
  // Open-source mapping libraries and the specifications
  ['leaflet', 'esri-leaflet', 'alias'],
  ['Esri Leaflet', 'esri-leaflet', 'alias'],
  ['maplibre', 'maplibre-arcgis', 'alias'],
  ['@esri/maplibre-arcgis', 'maplibre-arcgis', 'alias'],
  ['MapLibre GL JS', 'maplibre-arcgis', 'alias'],
  ['openlayers', 'openlayers-arcgis', 'alias'],
  ['cesium', 'cesium-arcgis', 'alias'],
  ['CesiumJS', 'cesium-arcgis', 'alias'],
  ['web map specification', 'web-map-spec', 'alias'],
  ['webmap spec', 'web-map-spec', 'alias'],
  ['Web scene specification', 'web-scene-spec', 'alias'],
  // Native SDKs
  ['ios', 'swift-maps-sdk', 'alias'],
  ['swift', 'swift-maps-sdk', 'alias'],
  ['SwiftUI', 'swift-maps-sdk', 'alias'],
  ['arcgis-maps-sdk-swift', 'swift-maps-sdk', 'alias'],
  ['Esri/arcgis-maps-sdk-swift-samples', 'swift-maps-sdk', 'alias'],
  ['ArcGIS Maps SDK for Swift', 'swift-maps-sdk', 'alias'],
  ['maps sdk for swift', 'swift-maps-sdk', 'fuzzy'],
  ['android', 'kotlin-maps-sdk', 'alias'],
  ['kotlin', 'kotlin-maps-sdk', 'alias'],
  ['com.arcgismaps', 'kotlin-maps-sdk', 'alias'],
  ['arcgis-maps-kotlin', 'kotlin-maps-sdk', 'alias'],
  ['com.esri:arcgis-maps-kotlin', 'kotlin-maps-sdk', 'alias'],
  ['arcgis-maps-sdk-kotlin-samples', 'kotlin-maps-sdk', 'alias'],
  ['Kotlin Maps SDK', 'kotlin-maps-sdk', 'id'],
  ['kotlin sdk', 'kotlin-maps-sdk', 'fuzzy'],
  ['kotln-maps-sdk', 'kotlin-maps-sdk', 'fuzzy'],
  ['net', 'dotnet-maps-sdk', 'alias'],
  ['.NET', 'dotnet-maps-sdk', 'alias'],
  ['dotnet', 'dotnet-maps-sdk', 'alias'],
  ['maui', 'dotnet-maps-sdk', 'alias'],
  ['WPF', 'dotnet-maps-sdk', 'alias'],
  ['winui', 'dotnet-maps-sdk', 'alias'],
  ['esri.arcgisruntime', 'dotnet-maps-sdk', 'alias'],
  ['Esri.ArcGISRuntime', 'dotnet-maps-sdk', 'alias'],
  ['ArcGIS Maps SDK for .NET', 'dotnet-maps-sdk', 'alias'],
  ['qt', 'qt-maps-sdk', 'alias'],
  ['QML', 'qt-maps-sdk', 'alias'],
  ['ArcGIS Maps SDK for Qt', 'qt-maps-sdk', 'alias'],
  ['flutter', 'flutter-maps-sdk', 'alias'],
  ['dart', 'flutter-maps-sdk', 'alias'],
  ['arcgis_maps', 'flutter-maps-sdk', 'alias'],
  ['flutter sdk', 'flutter-maps-sdk', 'fuzzy'],
  ['java', 'java-maps-sdk', 'alias'],
  ['javafx', 'java-maps-sdk', 'alias'],
  ['com.esri.arcgisruntime', 'java-maps-sdk', 'alias'],
  ['unity', 'unity-maps-sdk', 'alias'],
  ['Unity3D', 'unity-maps-sdk', 'alias'],
  ['unreal', 'unreal-maps-sdk', 'alias'],
  ['unreal-engine', 'unreal-maps-sdk', 'alias'],
  ['Unreal Engine', 'unreal-maps-sdk', 'alias'],
  ['ue5', 'unreal-maps-sdk', 'alias'],
  ['arcgis runtime', 'runtime-100', 'alias'],
  ['ArcGIS Runtime SDK', 'runtime-100', 'alias'],
  // Python, data science, R
  ['python', 'python-api', 'alias'],
  ['ArcGIS API for Python', 'python-api', 'alias'],
  ['arcgis-python-api', 'python-api', 'alias'],
  ['arcgis.learn', 'python-api', 'alias'],
  ['arcgis.gis', 'python-api', 'alias'],
  ['arcgis-mapping', 'python-api', 'alias'],
  ['Python API', 'python-api', 'alias'],
  ['pythonapi', 'python-api', 'id'],
  ['ArcPy', 'arcpy', 'id'],
  ['geoprocessing', 'arcpy', 'alias'],
  ['gp-tools', 'arcpy', 'alias'],
  ['tool-reference', 'arcpy', 'alias'],
  ['arcpy.da', 'arcpy', 'alias'],
  ['geoanalytics', 'geoanalytics-engine', 'alias'],
  ['GeoAnalytics Engine', 'geoanalytics-engine', 'alias'],
  ['geoanalytics for fabric', 'geoanalytics-fabric', 'alias'],
  ['r', 'r-arcgis', 'alias'],
  ['r-bridge', 'r-arcgis', 'alias'],
  ['arcgislayers', 'r-arcgis', 'alias'],
  ['R-ArcGIS/arcgislayers', 'r-arcgis', 'alias'],
  // Desktop and Enterprise extensibility
  ['pro-sdk', 'arcgis-pro-sdk', 'alias'],
  ['Pro SDK', 'arcgis-pro-sdk', 'alias'],
  ['ArcGIS.Desktop', 'arcgis-pro-sdk', 'alias'],
  ['arcgis.core', 'arcgis-pro-sdk', 'alias'],
  ['ArcGIS Pro SDK for .NET', 'arcgis-pro-sdk', 'alias'],
  ['Esri/arcgis-pro-sdk-community-samples', 'arcgis-pro-sdk', 'alias'],
  ['soe', 'enterprise-sdk', 'alias'],
  ['SOI', 'enterprise-sdk', 'alias'],
  ['custom data feeds', 'enterprise-sdk', 'alias'],
  ['Enterprise SDK', 'enterprise-sdk', 'alias'],
  ['enterprise_sdk', 'enterprise-sdk', 'id'],
  ['cga', 'cityengine', 'alias'],
  ['pyprt', 'cityengine', 'alias'],
  ['City Engine', 'cityengine', 'alias'],
  ['ArcGIS CityEngine', 'cityengine', 'alias'],
  ['earth automation', 'earth-automation-api', 'alias'],
  ['autolisp', 'autocad-api', 'alias'],
  ['geoevent', 'geoevent-server', 'alias'],
  ['ArcGIS GeoEvent Server', 'geoevent-server', 'alias'],
];

/** `[input, product id, source id]` for the scope form. */
const SCOPES: Array<[string, string, string]> = [
  ['js-maps-sdk/samples', 'js-maps-sdk', 'samples'],
  ['javascript/core', 'js-maps-sdk', 'core'],
  ['@arcgis/core/typings', 'js-maps-sdk', 'typings'],
  ['JS Maps SDK/Components', 'js-maps-sdk', 'components'],
  ['arcpy/tools', 'arcpy', 'tools'],
  ['geoprocessing/legacy', 'arcpy', 'legacy'],
  ['python-api/api', 'python-api', 'api'],
  ['calcite/components', 'calcite', 'components'],
  ['swift/toolkit-api', 'swift-maps-sdk', 'toolkit-api'],
  ['kotlin-maps-sdk/api', 'kotlin-maps-sdk', 'api'],
  ['cityengine/pyprt-examples', 'cityengine', 'pyprt-examples'],
  ['pro-sdk/snippets', 'arcgis-pro-sdk', 'snippets'],
  ['enterprise-sdk/java_api', 'enterprise-sdk', 'java-api'],
];

function failure(input: string): McpDocError {
  try {
    resolver.resolve(input);
  } catch (error) {
    if (error instanceof McpDocError) return error;
    throw error;
  }
  throw new Error(`"${input}" resolved`);
}

describe('product resolution', () => {
  it('covers at least 120 names beyond the ids', () => {
    expect(ALIASES.length + SCOPES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(ALIASES.map(([input]) => input)).size).toBe(ALIASES.length);
  });

  it.each(OWN.map((product) => product.id))('resolves the id %s', (id) => {
    expect(resolver.resolve(id)).toMatchObject({ product: { id }, resolvedFrom: id, how: 'id' });
    expect(resolver.resolve(id).source).toBeUndefined();
  });

  it.each(ALIASES)('resolves %j to %s (%s)', (input, id, how) => {
    const resolution = resolver.resolve(input);
    expect({ id: resolution.product.id, how: resolution.how }).toEqual({ id, how });
    expect(resolution.resolvedFrom).toBe(input);
  });

  it.each(SCOPES)('resolves the scope %j to %s / %s', (input, id, source) => {
    const resolution = resolver.resolve(input);
    expect(resolution.how).toBe('scope');
    expect(resolution.product.id).toBe(id);
    expect(resolution.source?.id).toBe(source);
  });

  it('resolves every alias in the data to its own product', () => {
    for (const product of data.products) {
      for (const alias of product.aliases) {
        expect(resolver.resolve(alias).product.id, alias).toBe(product.id);
      }
      expect(resolver.exact(product.name)?.id ?? product.id, product.name).toBe(product.id);
    }
  });

  it('answers UNKNOWN_PRODUCT with the nearest ids and a list call', () => {
    const error = failure('kotlin-mapz-sdkk-xyz');
    expect(error.code).toBe('UNKNOWN_PRODUCT');
    expect(error.message).toBe('No product matches "kotlin-mapz-sdkk-xyz"');
    expect(error.details?.next).toBe('arcgis_docs_list_products({"query":"kotlin-mapz-sdkk-xyz"})');
    expect(error.details?.candidates?.length).toBeLessThanOrEqual(5);

    const near = failure('javascript-sdk-thing');
    expect(near.details?.candidates).toContain('js-maps-sdk');
  });

  it.each(['', '   ', '""', 'maps sdk', 'arcgis', 'zzz', 'sdk'])(
    'does not guess for %j',
    (input) => {
      expect(failure(input).code).toBe('UNKNOWN_PRODUCT');
    },
  );

  it('names the sections of the product when only the part after the slash is wrong', () => {
    const error = failure('js-maps-sdk/sample');
    expect(error.code).toBe('UNKNOWN_PRODUCT');
    expect(error.message).toBe('js-maps-sdk has no section "js-maps-sdk/sample"');
    expect(error.details?.candidates?.[0]).toBe('js-maps-sdk/samples');
    expect(error.details?.candidates).toHaveLength(5);
    expect(error.details?.next).toBe('arcgis_docs_list_products({"product":"js-maps-sdk"})');
  });
});

describe('createResolver', () => {
  const widgets = makeProduct({
    packages: [
      { registry: 'npm', name: '@acme/widgets', license: 'apache-2.0', primary: true },
      { registry: 'npm', name: '@acme/shared', license: 'apache-2.0' },
    ],
  });
  const gadgets = makeProduct({
    id: 'gadgets-sdk',
    name: 'Gadgets SDK',
    aliases: ['gadgets', 'shiny things'],
    packages: [{ registry: 'npm', name: '@acme/shared', license: 'apache-2.0' }],
    repos: [{ repo: 'Esri/gadgets', role: 'source', license: 'apache-2.0', defaultBranch: 'main' }],
    sources: [makeSource('gatsby', { base: '/gadgets/' }, { id: 'guide' })],
  });
  const local = createResolver([widgets, gadgets], () => ['gadgets-sdk', 'widgets-sdk']);

  it('leaves a package that two products list to neither of them', () => {
    expect(local.resolve('@acme/widgets').product.id).toBe('widgets-sdk');
    expect(() => local.resolve('@acme/shared')).toThrow(McpDocError);
    expect(local.exact('@acme/shared')).toBeUndefined();
  });

  it('keeps a name ambiguous however many products share it, and suggests nothing by default', () => {
    const third = makeProduct({
      id: 'third-sdk',
      name: 'Third',
      aliases: [],
      packages: [{ registry: 'npm', name: '@acme/shared', license: 'apache-2.0' }],
    });
    const bare = createResolver([widgets, gadgets, third]);
    expect(bare.exact('@acme/shared')).toBeUndefined();
    try {
      bare.resolve('qqqqqqqq');
      expect.unreachable();
    } catch (error) {
      expect((error as McpDocError).details?.candidates).toEqual([]);
    }
  });

  it('lets an explicit alias win over a derived name', () => {
    const claimed = makeProduct({ id: 'claimed-sdk', name: 'Claimed', aliases: ['@acme/shared'] });
    const resolver3 = createResolver([widgets, gadgets, claimed]);
    expect(resolver3.resolve('@acme/shared')).toMatchObject({
      product: { id: 'claimed-sdk' },
      how: 'alias',
    });
  });

  it('accepts a repository by full or bare name', () => {
    expect(local.resolve('Esri/gadgets').product.id).toBe('gadgets-sdk');
    expect(local.resolve('esri/GADGETS').how).toBe('alias');
  });

  it('accepts a misspelling only when one product is clearly nearest', () => {
    expect(local.resolve('gadgets-sdc')).toMatchObject({
      product: { id: 'gadgets-sdk' },
      how: 'fuzzy',
    });
    // One edit from `gadgets-sdk` and one from `widgets-sdk`: no margin at all.
    expect(() => local.resolve('wadgets-sdk')).toThrow(McpDocError);
    // Names shorter than five characters are never corrected.
    expect(() => local.resolve('gadg')).toThrow(McpDocError);
  });

  it('accepts words that only one product has, and the brand prefix as optional', () => {
    expect(local.resolve('shiny')).toMatchObject({ product: { id: 'gadgets-sdk' }, how: 'fuzzy' });
    expect(local.resolve('ArcGIS Gadgets')).toMatchObject({ how: 'fuzzy' });
    expect(() => local.resolve('sdk')).toThrow(McpDocError);
  });

  it('fills the candidates from the suggestions when nothing is close in spelling', () => {
    try {
      local.resolve('qqqqqqqq');
      expect.unreachable();
    } catch (error) {
      expect((error as McpDocError).details?.candidates).toEqual(['gadgets-sdk', 'widgets-sdk']);
    }
  });

  it('normalises names', () => {
    expect(plainKey('  "JS   Maps SDK" ')).toBe('js maps sdk');
    expect(squashedKey('JS_Maps-SDK')).toBe('jsmapssdk');
    expect(squashedKey('@arcgis/core')).toBe('arcgiscore');
  });
});
