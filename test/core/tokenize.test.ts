import { describe, expect, it } from 'vitest';
import { isSymbolShaped, normalizeSymbol, tokenize } from '../../src/core/tokenize.js';

describe('tokenize', () => {
  it('lower-cases and splits on everything that is not a letter, digit or underscore', () => {
    expect(tokenize('Cluster points, with pop-ups!')).toEqual([
      'cluster',
      'points',
      'with',
      'pop',
      'ups',
    ]);
  });

  it('emits camelCase and PascalCase parts after the whole identifier', () => {
    expect(tokenize('FeatureLayer.queryFeatures')).toEqual([
      'featurelayer',
      'feature',
      'layer',
      'queryfeatures',
      'query',
      'features',
    ]);
  });

  it('emits snake_case parts after the whole identifier', () => {
    expect(tokenize('SEARCH_CURSOR')).toEqual(['search_cursor', 'search', 'cursor']);
    expect(tokenize('in_features')).toEqual(['in_features', 'in', 'features']);
  });

  it('keeps acronyms and digit acronyms together', () => {
    expect(tokenize('OGC3DTilesLayer')).toEqual(['ogc3dtileslayer', 'ogc', '3d', 'tiles', 'layer']);
    expect(tokenize('GeoJSONLayer')).toEqual(['geojsonlayer', 'geo', 'json', 'layer']);
    expect(tokenize('WGS84')).toEqual(['wgs84', 'wgs', '84']);
  });

  it('does not repeat a word that has a single part and drops one-character parts', () => {
    expect(tokenize('map')).toEqual(['map']);
    expect(tokenize('Map')).toEqual(['map']);
    expect(tokenize('aB')).toEqual(['ab']);
  });

  it('handles custom-element names, qualified Python names and non-ASCII letters', () => {
    expect(tokenize('arcgis-map')).toEqual(['arcgis', 'map']);
    expect(tokenize('arcpy.da.SearchCursor')).toEqual([
      'arcpy',
      'da',
      'searchcursor',
      'search',
      'cursor',
    ]);
    expect(tokenize('Überblick über Karten')).toEqual(['überblick', 'über', 'karten']);
  });

  it('gives [] for text without word characters', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' -- ... ')).toEqual([]);
  });

  it('tokenizes a query and an index entry onto shared terms', () => {
    const indexed = new Set(tokenize('FeatureLayer.queryFeatures'));
    for (const term of tokenize('query features')) expect(indexed).toContain(term);
  });
});

describe('normalizeSymbol', () => {
  it.each([
    ['FeatureLayer', ['FeatureLayer']],
    ['FeatureLayer.queryFeatures', ['FeatureLayer', 'queryFeatures']],
    ['FeatureLayer.queryFeatures()', ['FeatureLayer', 'queryFeatures']],
    ['FeatureLayer.queryFeatures(query, { signal })', ['FeatureLayer', 'queryFeatures']],
    ['new FeatureLayer().queryFeatures(q)', ['FeatureLayer', 'queryFeatures']],
    ['new FeatureLayer({ url })', ['FeatureLayer']],
    ['FeatureLayer#queryFeatures', ['FeatureLayer', 'queryFeatures']],
    ['ArcGISMap::setBasemap', ['ArcGISMap', 'setBasemap']],
    ['esri/layers/FeatureLayer', ['layers', 'FeatureLayer']],
    ['@arcgis/core/layers/FeatureLayer.js', ['layers', 'FeatureLayer']],
    ['@arcgis/core/layers/FeatureLayer.d.ts', ['layers', 'FeatureLayer']],
    ['arcgis.gis.GIS.content', ['arcgis', 'gis', 'GIS', 'content']],
    ['arcpy.analysis.Buffer(in_features, out)', ['arcpy', 'analysis', 'Buffer']],
    ['com.arcgismaps.mapping.ArcGISMap', ['com', 'arcgismaps', 'mapping', 'ArcGISMap']],
    ['arcgis-map.goTo', ['arcgis-map', 'goTo']],
    ['<arcgis-map>', ['arcgis-map']],
    ['<calcite-button />', ['calcite-button']],
    ['/applyEdits', ['applyEdits']],
    ['List<Feature>', ['List']],
    ['Map<string, List<Feature>>.get', ['Map', 'get']],
    ['f(g(x)).then', ['f', 'then']],
    ['  queryFeatures (', ['queryFeatures']],
  ])('%s -> %j', (input, parts) => {
    const result = normalizeSymbol(input);
    expect(result.parts).toEqual(parts);
    expect(result.simple).toBe(parts.at(-1));
  });

  it('gives empty parts for input with nothing left', () => {
    expect(normalizeSymbol('')).toEqual({ parts: [], simple: '' });
    expect(normalizeSymbol(' () ')).toEqual({ parts: [], simple: '' });
    expect(normalizeSymbol('..')).toEqual({ parts: [], simple: '' });
  });
});

describe('isSymbolShaped', () => {
  it.each([
    'FeatureLayer',
    'queryFeatures',
    'FeatureLayer.queryFeatures',
    'FeatureLayer#queryFeatures',
    'ArcGISMap::setBasemap',
    'arcpy.da.SearchCursor',
    'arcgis.gis.GIS',
    'com.arcgismaps.mapping.ArcGISMap',
    'calcite-button',
    'arcgis-map',
    'arcgis-feature-table',
    '<arcgis-map>',
    'applyEdits()',
    'new FeatureLayer',
    'new FeatureLayer()',
    'buffer(geometry, 10)',
    'List<Feature>',
    '/applyEdits',
    'in_features',
    'SEARCH_CURSOR',
    '@arcgis/core/layers/FeatureLayer.js',
    'OGC3DTilesLayer',
  ])('%s is symbol-shaped', (query) => {
    expect(isSymbolShaped(query)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'cluster points with popups',
    'applyEdits attachments',
    'OAuth PKCE',
    'offline',
    'OAuth',
    'PKCE',
    'popup',
    '5.1',
    '300.1.0',
    '4x-to-5x',
    'new features in 5.1',
    'new stuff',
    'buffer (geodesic)',
    'what is FeatureLayer?',
    'web-map',
    'élan vital',
    'a + b',
    '()',
  ])('%j is not symbol-shaped', (query) => {
    expect(isSymbolShaped(query)).toBe(false);
  });
});
