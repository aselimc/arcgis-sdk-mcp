import { describe, expect, it } from 'vitest';
import { createRouter } from '../../src/registry/router.js';
import { makeProduct } from '../support/builders.js';
import { loadData } from './load-data.js';

const data = await loadData();
const route = createRouter(data.products);
const ids = new Set(data.products.map((product) => product.id));

/** `[query, product expected first]`: the routing table of design section 9. */
const TOP: Array<[string, string]> = [
  ['kotlin offline map', 'kotlin-maps-sdk'],
  ['offline map android', 'kotlin-maps-sdk'],
  ['ios app routing', 'swift-maps-sdk'],
  ['swift 3d tiles layer', 'swift-maps-sdk'],
  ['swiftui map view', 'swift-maps-sdk'],
  ['.net maui map', 'dotnet-maps-sdk'],
  ['wpf geodatabase sync', 'dotnet-maps-sdk'],
  ['qt qml map', 'qt-maps-sdk'],
  ['flutter', 'flutter-maps-sdk'],
  ['dart graphics overlay', 'flutter-maps-sdk'],
  ['javafx map', 'java-maps-sdk'],
  ['unity', 'unity-maps-sdk'],
  ['unreal blueprint', 'unreal-maps-sdk'],
  ['javascript', 'js-maps-sdk'],
  ['how to add a feature layer in javascript', 'js-maps-sdk'],
  ['typescript react map component', 'js-maps-sdk'],
  ['FeatureLayer.queryFeatures', 'js-maps-sdk'],
  ['design system button', 'calcite'],
  ['arcade expression popup', 'arcade'],
  ['widget experience builder', 'experience-builder'],
  ['exb custom widget', 'experience-builder'],
  ['leaflet', 'esri-leaflet'],
  ['maplibre vector tiles', 'maplibre-arcgis'],
  ['cesium', 'cesium-arcgis'],
  ['python', 'python-api'],
  ['python spatially enabled dataframe', 'python-api'],
  ['geoprocessing tool buffer', 'arcpy'],
  ['SearchCursor', 'arcpy'],
  ['spark sql functions', 'geoanalytics-engine'],
  ['microsoft fabric lakehouse', 'geoanalytics-fabric'],
  ['rstudio sf package', 'r-arcgis'],
  ['pro sdk add-in dockpane', 'arcgis-pro-sdk'],
  ['c# add-in arcgis pro', 'arcgis-pro-sdk'],
  ['soe soi server extension', 'enterprise-sdk'],
  ['cga rule', 'cityengine'],
  ['autolisp', 'autocad-api'],
  ['geoevent processor', 'geoevent-server'],
];

/** `[query, product]`: a word shaped like a symbol or package decides on its own. */
const SHAPES: Array<[string, string]> = [
  ['arcpy.da.SearchCursor', 'arcpy'],
  ['arcpy.management.CopyFeatures parameters', 'arcpy'],
  ['com.arcgismaps.mapping.ArcGISMap', 'kotlin-maps-sdk'],
  ['com.esri.arcgisruntime.mapping.ArcGISMap', 'java-maps-sdk'],
  ['Esri.ArcGISRuntime.Mapping.Map', 'dotnet-maps-sdk'],
  ['Esri::ArcGISRuntime::MapQuickView', 'qt-maps-sdk'],
  ['arcgis.gis.GIS', 'python-api'],
  ['arcgis.features.FeatureLayer query', 'python-api'],
  ['ArcGIS.Desktop.Mapping.MapView', 'arcgis-pro-sdk'],
  ['ArcGIS.Core.Data.Geodatabase', 'arcgis-pro-sdk'],
  ['calcite-button', 'calcite'],
  ['<calcite-shell-panel>', 'calcite'],
  ['@esri/calcite-components', 'calcite'],
  ['arcgis-map', 'js-maps-sdk'],
  ['<arcgis-map>', 'js-maps-sdk'],
  ['arcgis-feature-table selection', 'js-maps-sdk'],
  ['esri/layers/FeatureLayer', 'js-maps-sdk'],
  ['@arcgis/core/layers/FeatureLayer', 'js-maps-sdk'],
  ['@arcgis/map-components', 'js-maps-sdk'],
  ['@esri/arcgis-rest-feature-service', 'rest-js'],
  ['jimu-core DataSourceManager', 'experience-builder'],
  ['L.esri.featureLayer', 'esri-leaflet'],
  ['arcgis_maps', 'flutter-maps-sdk'],
  ['geoanalytics.sql.functions', 'geoanalytics-engine'],
  ['ST_Buffer', 'geoanalytics-engine'],
  ['arcgislayers::arc_read', 'r-arcgis'],
  ['pyprt.ModelGenerator', 'cityengine'],
  ['$feature.name', 'arcade'],
  ['js-maps-sdk popup', 'js-maps-sdk'],
];

describe('query routing', () => {
  it.each(TOP)('routes %j to %s first', (query, expected) => {
    const routes = route(query);
    expect(routes[0]?.product).toBe(expected);
    expect(routes.length).toBeLessThanOrEqual(3);
  });

  it.each(SHAPES)('routes the shape %j to %s alone', (query, expected) => {
    expect(route(query)).toEqual([{ product: expected, confidence: 0.95 }]);
  });

  it('orders by confidence and keeps confidences between 0 and 1', () => {
    for (const [query] of TOP) {
      const confidences = route(query, 10).map((entry) => entry.confidence);
      expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
      for (const confidence of confidences) {
        expect(confidence).toBeGreaterThan(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('honours the limit', () => {
    expect(route('python', 1)).toHaveLength(1);
    expect(route('python', 0)).toEqual([]);
    expect(route('how to add a feature layer in javascript', 2)).toHaveLength(2);
  });

  it.each(['', '   ', 'what is new', 'arcgis', 'maps sdk', 'sdk', 'qwertyuiop'])(
    'returns nothing for %j, which names no product',
    (query) => {
      expect(route(query)).toEqual([]);
    },
  );

  it('never routes to a link-tier product and returns known ids only', () => {
    const eligible = new Set(
      data.products.filter((product) => product.tier !== 'link').map((product) => product.id),
    );
    const words = data.products.flatMap((product) => [
      product.id,
      product.name,
      ...product.keywords,
    ]);
    for (const query of words) {
      for (const entry of route(query, 5)) {
        expect(ids.has(entry.product)).toBe(true);
        expect(eligible.has(entry.product), `${query} -> ${entry.product}`).toBe(true);
      }
    }
  });

  it('ranks a retired product far below a live one on the same evidence', () => {
    const routes = route('runtime sdk android 100.15', 10);
    const tombstone = routes.find((entry) => entry.product === 'runtime-100');
    expect(routes[0]?.product).toBe('kotlin-maps-sdk');
    if (tombstone !== undefined) expect(tombstone.confidence).toBeLessThan(routes[0]!.confidence);
  });

  it.skipIf(!ids.has('ai-agents'))(
    'adds the AI overview product to queries about the AI components',
    () => {
      for (const query of ['ai components enterprise', 'arcgis-assistant setup', 'ai-components']) {
        expect(
          route(query)
            .slice(0, 2)
            .map((entry) => entry.product),
          query,
        ).toEqual(['js-maps-sdk', 'ai-agents']);
      }
    },
  );
});

describe('createRouter', () => {
  const widgets = makeProduct({ keywords: ['dashboard', 'add-in'] });
  const gadgets = makeProduct({
    id: 'gadgets-sdk',
    name: 'Gadgets SDK',
    aliases: ['gadgets'],
    keywords: ['dashboard', 'charts'],
    languages: ['python'],
  });
  const retired = makeProduct({
    id: 'gizmos-sdk',
    name: 'Gizmos SDK',
    aliases: ['gizmos'],
    keywords: ['charts'],
    status: 'retired',
  });
  const linked = makeProduct({
    id: 'arcgis-linked',
    name: 'Linked',
    aliases: ['linked'],
    keywords: ['spreadsheet'],
    tier: 'link',
  });
  const help = makeProduct({
    id: 'gadgets-help',
    name: 'Gadgets help',
    aliases: [],
    keywords: ['charts'],
    category: 'product-help',
    tier: 'help',
  });
  const local = createRouter([widgets, gadgets, retired, linked, help]);

  it('weights a name above a keyword, and plural and singular alike', () => {
    expect(local('gadget dashboards')[0]?.product).toBe('gadgets-sdk');
    expect(local('dashboards').map((entry) => entry.product)).toEqual([
      'widgets-sdk',
      'gadgets-sdk',
    ]);
    expect(local('widget')[0]).toEqual({ product: 'widgets-sdk', confidence: 1 });
  });

  it('matches a hyphenated compound although its halves are stop words', () => {
    expect(local('how do I build an add-in')[0]?.product).toBe('widgets-sdk');
    expect(local('addins')[0]?.product).toBe('widgets-sdk');
  });

  it('applies the status and tier multipliers', () => {
    const routes = local('charts', 5);
    expect(routes.map((entry) => entry.product)).toEqual(['gadgets-sdk', 'gadgets-help']);
    expect(routes[1]!.confidence).toBeCloseTo(routes[0]!.confidence * 0.85, 2);
    expect(local('gizmos')).toEqual([{ product: 'gizmos-sdk', confidence: 0.2 }]);
  });

  it('skips link-tier products, also when the query is their id', () => {
    expect(local('spreadsheet')).toEqual([]);
    expect(local('linked')).toEqual([]);
    // Without the name table this id would look like a JavaScript element name.
    expect(local('arcgis-linked dashboard').map((entry) => entry.product)).not.toContain(
      'arcgis-linked',
    );
  });

  it('ignores shapes whose product is not in the registry', () => {
    expect(local('arcpy.da.SearchCursor')).toEqual([]);
    expect(local('calcite-button')).toEqual([]);
  });

  it('routes a name with punctuation straight to its product', () => {
    expect(local('widgets-sdk charts')).toEqual([{ product: 'widgets-sdk', confidence: 0.95 }]);
  });
});
