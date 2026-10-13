import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIDENCE, createRouter } from '../../src/registry/router.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { PRODUCTS } from './registry-data.js';

const route = createRouter(PRODUCTS);
const ids = new Set(PRODUCTS.map((product) => product.id));

/** The default set of a question that names no product, and of a bare class or function name. */
const DEFAULT = ['js-maps-sdk', 'rest-api', 'developer-guide'];
const DEFAULT_SYMBOL = ['js-maps-sdk', 'python-api', 'swift-maps-sdk'];
const productsOf = (query: string, n?: number): string[] =>
  route(query, n).map((entry) => entry.product);

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
    expect(route('vector tiles', 2)).toHaveLength(2);
    expect(route('what is new', 2)).toHaveLength(2);
  });

  it.each(['', '   '])('returns nothing for the empty query %j', (query) => {
    expect(route(query)).toEqual([]);
  });

  // Regression: without a project these questions reached no product at all (0 hits), and a
  // tie among many products was answered with nothing.
  it.each(['what is new', 'arcgis', 'maps sdk', 'sdk', 'qwertyuiop', 'display a map', 'offline'])(
    'answers %j, which names no product, with the default set and says it is a default',
    (query) => {
      expect(route(query)).toEqual(
        DEFAULT.map((product) => ({ product, confidence: DEFAULT_CONFIDENCE })),
      );
    },
  );

  it('keeps the default set apart from evidence: its confidence is below every real route', () => {
    for (const [query] of TOP) {
      for (const entry of route(query, 10)) {
        expect(entry.confidence, query).toBeGreaterThan(DEFAULT_CONFIDENCE);
      }
    }
  });

  it('answers with nothing instead of the default set when the default is switched off', () => {
    const evidence = createRouter(PRODUCTS, { fallback: false });
    for (const query of ['what is new', 'maps sdk', 'qwertyuiop', 'TotallyMadeUpClassXyz']) {
      expect(evidence(query), query).toEqual([]);
    }
    expect(evidence('kotlin offline map')[0]?.product).toBe('kotlin-maps-sdk');
  });

  /** `[query, products in order]`: everyday questions asked without naming a product. */
  const EVERYDAY: Array<[string, string[]]> = [
    ['add a feature layer to a map', DEFAULT],
    ['find address', DEFAULT],
    ['basemap', DEFAULT],
    ['change basemap', DEFAULT],
    ['breaking changes', DEFAULT],
    ['get started', DEFAULT],
    ['release notes', DEFAULT],
    ['v4 34', DEFAULT],
    ['draw a polygon', ['js-maps-sdk']],
    ['legend', ['js-maps-sdk']],
    ['heatmap', ['js-maps-sdk']],
    // These went to Velocity, to OpenLayers and format specifications, and to the web map
    // specification: products that share a word with the question.
    ['time slider', ['js-maps-sdk']],
    ['how do I add a layer to a map', ['js-maps-sdk', 'openlayers-arcgis', 'i3s-spec']],
    ['create a web map', ['js-maps-sdk', 'web-map-spec', 'web-scene-spec']],
    ['3d scene', ['js-maps-sdk', 'i3s-spec', 'web-scene-spec']],
    ['migrate from 4.x to 5.x', ['js-maps-sdk']],
    ['geocode an address', ['rest-api']],
  ];

  it.each(EVERYDAY)('routes the everyday question %j to %j', (query, expected) => {
    expect(productsOf(query)).toEqual(expected);
  });

  it('puts the web SDK ahead of the protocol buffer definitions for "Buffer"', () => {
    expect(productsOf('Buffer')).toEqual(['arcpy', 'arcgis-pbf', 'knowledge-pbf']);
  });

  // Regression: "GeometryEngine" was looked up in oss-libraries, unreal-maps-sdk and
  // geoanalytics-engine, and an invented class name in arcpy and cim-spec, because the humps
  // of the name were read as words of a question.
  it.each(['GeometryEngine', 'TotallyMadeUpClassXyz', 'queryFeatures', 'some_function_name'])(
    'sends the bare identifier %j to the leading references, not to products sharing a hump',
    (query) => {
      expect(route(query)).toEqual(
        DEFAULT_SYMBOL.map((product) => ({ product, confidence: DEFAULT_CONFIDENCE })),
      );
    },
  );

  it('still routes an identifier that a product lists whole', () => {
    expect(productsOf('FeatureLayer')).toEqual(['js-maps-sdk']);
    expect(productsOf('SearchCursor')[0]).toBe('arcpy');
  });

  it('lets a product that the query names win over the prior of the web SDK', () => {
    expect(productsOf('web map specification operational layers')[0]).toBe('web-map-spec');
    expect(productsOf('kotlin offline map')[0]).toBe('kotlin-maps-sdk');
    expect(productsOf('esri leaflet basemap')[0]).toBe('esri-leaflet');
    expect(productsOf('upgrade')).not.toContain('js-maps-sdk');
    // The prior never claims that the query names the product.
    for (const [query] of EVERYDAY) {
      for (const entry of route(query)) expect(entry.confidence, query).toBeLessThan(0.95);
    }
  });

  // Regression: "download offline map area" was scoped to Field Maps (end-user help) alone.
  it('lets end-user help lead only on a word that is distinctly its own', () => {
    expect(productsOf('download offline map area')).toEqual([
      'developer-guide',
      'field-maps',
      'business-analyst',
    ]);
    expect(productsOf('field maps offline area')).toEqual(['field-maps']);
    expect(productsOf('dashboards')).toEqual(['dashboards']);
  });

  it('never routes to a link-tier product and returns known ids only', () => {
    const eligible = new Set(
      PRODUCTS.filter((product) => product.tier !== 'link').map((product) => product.id),
    );
    const words = PRODUCTS.flatMap((product) => [
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

  it('keeps Kubernetes help out of a question about clustering points on a map', () => {
    const products = productsOf('cluster points with popups');
    expect(products[0]).toBe('js-maps-sdk');
    expect(products).not.toContain('arcgis-enterprise-k8s');
    expect(productsOf('kubernetes cluster upgrade')[0]).toBe('arcgis-enterprise-k8s');
  });

  it('sends a question about OAuth flows to the guide that explains authentication', () => {
    expect(productsOf('OAuth PKCE')).toContain('developer-guide');
  });

  // Runtime 100.x is not retired yet, but it documents nothing itself: it is a card of four
  // migration guides, and a question is better answered by the SDK it points to.
  it('ranks a product that only points elsewhere far below the SDK it points to', () => {
    const routes = route('runtime sdk android 100.15', 10);
    expect(routes[0]?.product).toBe('kotlin-maps-sdk');
    const card = routes.find((entry) => entry.product === 'runtime-100');
    expect(card?.confidence ?? 0).toBeLessThan(routes[0]?.confidence ?? 0);
    // By name it is still found.
    expect(productsOf('runtime-100')).toEqual(['runtime-100']);
  });

  it('adds the AI overview product to queries about the AI components', () => {
    for (const query of ['ai components enterprise', 'arcgis-assistant setup', 'ai-components']) {
      expect(productsOf(query).slice(0, 2), query).toEqual(['js-maps-sdk', 'ai-agents']);
    }
  });
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

  // Regression: "cluster points with popups" added Kubernetes help to a search of the
  // JavaScript SDK, because `cluster` is a word of both.
  it('drops a help product that only knows some of the words the best product knows', () => {
    const sdk = makeProduct({
      id: 'charts-sdk',
      name: 'Charts SDK',
      aliases: [],
      keywords: ['cluster', 'popup'],
    });
    const cluster = makeProduct({
      id: 'cluster-help',
      name: 'Cluster administration help',
      aliases: [],
      keywords: [],
      category: 'product-help',
      tier: 'help',
    });
    const filler = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((word) =>
      makeProduct({ id: `${word}-sdk`, name: `${word} SDK`, aliases: [], keywords: [word] }),
    );
    const routed = createRouter([sdk, cluster, ...filler]);
    expect(routed('cluster popup').map((entry) => entry.product)).toEqual(['charts-sdk']);
    // The same word alone is evidence for both, and a word of its own keeps the help product.
    expect(routed('cluster').map((entry) => entry.product)).toEqual(['cluster-help', 'charts-sdk']);
    expect(routed('cluster administration popup').map((entry) => entry.product)).toContain(
      'cluster-help',
    );
  });

  it('treats a product whose every source is a curated link list like a tombstone', () => {
    const entries = [{ url: 'https://developers.arcgis.com/x/', title: 'X', kind: 'guide' as const }];
    const card = makeProduct({
      id: 'old-gadgets',
      name: 'Old Gadgets',
      aliases: [],
      keywords: ['charts'],
      status: 'deprecated',
      sources: [makeSource('static', { entries })],
    });
    const routes = createRouter([gadgets, card, widgets])('charts', 5);
    expect(routes.map((entry) => entry.product)).toEqual(['gadgets-sdk']);
    // Deprecated counts 0.6; a card counts like a retired product, 0.2. Its name still finds it.
    const named = createRouter([card, widgets], { fallback: false })('gadgets');
    expect(named.map((entry) => entry.product)).toEqual(['old-gadgets']);
    expect(named[0]?.confidence).toBeCloseTo(0.75 * 0.2, 2);
  });

  it('has no default set to offer in a registry without those products', () => {
    expect(local('qwertyuiop')).toEqual([]);
    expect(local('SomeUnknownClass')).toEqual([]);
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
