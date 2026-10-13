import { describe, expect, it } from 'vitest';
import type { CatalogRecord } from '../../../src/core/types.js';
import { buildSymbolMap } from '../../../src/services/index/symbol-map.js';
import {
  MAX_AMBIGUOUS,
  displayName,
  resolveSymbol,
  type Resolution,
  type SymbolScope,
} from '../../../src/services/symbol/resolve.js';
import { makeRecord } from '../../support/builders.js';
import { JS_RECORDS, KOTLIN_RECORDS, REST_RECORDS, jsSdk } from '../support/catalogue.js';

function scope(product: string, records: CatalogRecord[], productRank = 0): SymbolScope {
  const sources = [...new Set(records.map((record) => record.source))];
  return {
    product,
    productRank,
    symbols: buildSymbolMap(records.filter((record) => record.product === product)),
    sourceRank: (record) => sources.indexOf(record.source),
  };
}

const js = scope('js-maps-sdk', JS_RECORDS);
const kotlin = scope('kotlin-maps-sdk', KOTLIN_RECORDS, 1);
const rest = scope('rest-api', REST_RECORDS, 2);

/** `found:<name>@<step>`, `ambiguous:<names>` or `none`. */
function outcome(resolution: Resolution): string {
  switch (resolution.kind) {
    case 'found':
      return `found:${displayName(resolution.winner.record)}@${resolution.winner.step}`;
    case 'ambiguous':
      return `ambiguous:${resolution.candidates.map((c) => displayName(c.record)).join(',')}`;
    case 'none':
      return resolution.knownType === undefined
        ? 'none'
        : `none:${displayName(resolution.knownType)}`;
  }
}

describe('resolveSymbol: the resolution table', () => {
  it.each([
    // exact
    ['FeatureLayer', 'found:FeatureLayer@qualified'],
    ['FeatureLayer.queryFeatures', 'found:FeatureLayer.queryFeatures@qualified'],
    ['rest.support.Query', 'found:rest.support.Query@qualified'],
    ['Query', 'found:rest.support.Query@simple'],
    ['support.Query', 'found:rest.support.Query@simple'],
    ['queryFeatures', 'found:FeatureLayer.queryFeatures@simple'],
    // how agents write names
    ['new FeatureLayer()', 'found:FeatureLayer@qualified'],
    ['FeatureLayer.queryFeatures(query)', 'found:FeatureLayer.queryFeatures@qualified'],
    ['FeatureLayer#applyEdits', 'found:FeatureLayer.applyEdits@qualified'],
    ['FeatureLayer::applyEdits', 'found:FeatureLayer.applyEdits@qualified'],
    ['esri/layers/FeatureLayer', 'found:FeatureLayer@qualified'],
    ['@arcgis/core/views/MapView.js', 'found:MapView@qualified'],
    ['views.mapview', 'found:MapView@case-insensitive'],
    ['MapView.goTo<T>()', 'found:MapView.goTo@qualified'],
    // Type.member through a type known by a longer or differently qualified name
    ['Query.where', 'none:rest.support.Query'],
    ['support.Query.where', 'none:rest.support.Query'],
    // case
    ['featurelayer', 'found:FeatureLayer@case-insensitive'],
    ['FEATURELAYER.QUERYFEATURES', 'found:FeatureLayer.queryFeatures@case-insensitive'],
    ['mapview.goto', 'found:MapView.goTo@case-insensitive'],
    // fuzzy
    ['FeatureLayr', 'found:FeatureLayer@fuzzy'],
    ['GraphicLayer', 'found:GraphicsLayer@fuzzy'],
    ['FeatureLayer.queryFeaturs', 'found:FeatureLayer.queryFeatures@fuzzy'],
    ['FeatureLayer.aplyEdit', 'found:FeatureLayer.applyEdits@fuzzy'],
    // ambiguous
    ['goTo', 'ambiguous:MapView.goTo,SceneView.goTo'],
    ['Point', 'found:Point@qualified'],
    ['Feature', 'found:FeatureLayer@fuzzy'],
    ['MapVie', 'found:MapView@fuzzy'],
    // not found
    ['FeatureLayer.nothingLikeThis', 'none:FeatureLayer'],
    ['TotallyUnknownThing', 'none'],
    ['()', 'none'],
  ])('%s -> %s', (input, expected) => {
    expect(outcome(resolveSymbol(input, [js]))).toBe(expected);
  });

  it('prefers a type to a member of the same name, listing the member as an alternate', () => {
    const records = [
      makeRecord({
        ref: 'https://d/a/',
        symbol: 'extent',
        qualified: 'View.extent',
        parent: 'View',
        symbolKind: 'property',
      }),
      makeRecord({
        ref: 'https://d/b/',
        symbol: 'extent',
        qualified: 'extent',
        symbolKind: 'function',
      }),
      makeRecord({
        ref: 'https://d/c/',
        symbol: 'extent',
        qualified: 'Layer.extent',
        parent: 'Layer',
        symbolKind: 'property',
      }),
    ];
    const resolution = resolveSymbol('extent', [scope('widgets-sdk', records)]);
    expect(resolution).toMatchObject({
      kind: 'found',
      winner: { record: { qualified: 'extent' } },
    });
    // The exact qualified name wins outright; the same-named members are alternates.
    expect(
      resolution.kind === 'found' ? resolution.alternates.map((c) => c.record.qualified) : [],
    ).toEqual(['View.extent', 'Layer.extent']);

    const loose = records.map((record) =>
      record.parent === undefined ? { ...record, qualified: 'util.extent' } : record,
    );
    const typeFirst = resolveSymbol('extent', [scope('widgets-sdk', loose)]);
    expect(outcome(typeFirst)).toBe('found:util.extent@simple');
    expect(
      typeFirst.kind === 'found' ? typeFirst.alternates.map((c) => c.record.qualified) : [],
    ).toEqual(['View.extent', 'Layer.extent']);
  });

  it('lists less exact readings as alternates, and is ambiguous between equal ones', () => {
    const point = resolveSymbol('Point', [js]);
    expect(point.kind === 'found' ? point.alternates.map((c) => c.record.qualified) : []).toEqual([
      'smartMapping.Point',
    ]);

    const twins = [
      makeRecord({ ref: 'https://d/a/', symbol: 'Thing', qualified: 'a.Thing' }),
      makeRecord({ ref: 'https://d/b/', symbol: 'Thing', qualified: 'b.Thing' }),
    ];
    expect(outcome(resolveSymbol('Thing', [scope('widgets-sdk', twins)]))).toBe(
      'ambiguous:a.Thing,b.Thing',
    );
    expect(outcome(resolveSymbol('b.Thing', [scope('widgets-sdk', twins)]))).toBe(
      'found:b.Thing@qualified',
    );
  });

  it('prefers the earlier product, then the earlier source (core package first)', () => {
    const acrossProducts = resolveSymbol('FeatureLayer', [js, kotlin]);
    expect(outcome(acrossProducts)).toBe('found:FeatureLayer@qualified');
    expect(acrossProducts.kind === 'found' ? acrossProducts.winner.record.product : '').toBe(
      'js-maps-sdk',
    );

    const simpleNames = resolveSymbol('applyEdits', [rest, js]);
    expect(simpleNames.kind === 'found' ? simpleNames.winner.record.product : '').toBe('rest-api');
    expect(
      simpleNames.kind === 'found' ? simpleNames.alternates.map((c) => c.record.product) : [],
    ).toEqual(['js-maps-sdk']);

    const core = makeRecord({
      ref: 'https://d/core/Map/',
      source: 'core',
      symbol: 'Map',
      qualified: 'esri.Map',
    });
    const extra = makeRecord({
      ref: 'https://d/extra/Map/',
      source: 'extra',
      symbol: 'Map',
      qualified: 'extra.Map',
    });
    expect(outcome(resolveSymbol('Map', [scope('widgets-sdk', [core, extra])]))).toBe(
      'found:esri.Map@simple',
    );
    expect(outcome(resolveSymbol('Map', [scope('widgets-sdk', [extra, core])]))).toBe(
      'found:extra.Map@simple',
    );
  });

  it('merges the same symbol seen through two sources and keeps the other as a twin', () => {
    const resolution = resolveSymbol('FeatureLayer', [js]);
    expect(resolution.kind === 'found' ? resolution.winner.record.source : '').toBe('core');
    expect(
      resolution.kind === 'found' ? resolution.winner.twins.map((twin) => twin.source) : [],
    ).toEqual(['typings']);
    expect(resolution.kind === 'found' ? resolution.alternates : undefined).toEqual([]);
  });

  it('lets the caller reorder sources, for versioned packages', () => {
    const typingsFirst: SymbolScope = {
      ...js,
      sourceRank: (record) =>
        record.source === 'typings' ? -1 : jsSdk.sources.findIndex((s) => s.id === record.source),
    };
    const resolution = resolveSymbol('FeatureLayer', [typingsFirst]);
    expect(resolution.kind === 'found' ? resolution.winner.record.source : '').toBe('typings');
    expect(
      resolution.kind === 'found' ? resolution.winner.twins.map((twin) => twin.source) : [],
    ).toEqual(['core']);
  });

  it('does not treat a prefix that many names share as a match', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeRecord({
        ref: `https://d/${i}/`,
        symbol: `Layer${String.fromCharCode(65 + i)}Kind`,
        qualified: `Layer${String.fromCharCode(65 + i)}Kind`,
      }),
    );
    const resolution = resolveSymbol('Layer', [scope('widgets-sdk', many)]);
    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.kind === 'ambiguous' ? resolution.candidates.length : 0).toBe(MAX_AMBIGUOUS);
  });

  it('finds a member through a type matched without case', () => {
    expect(outcome(resolveSymbol('featurelayer.applyEdits', [js]))).toBe(
      'found:FeatureLayer.applyEdits@case-insensitive',
    );
  });

  // Regression: with a member that many types share, a misspelt or module-qualified type
  // was ignored and the answer was an ambiguity between unrelated types.
  describe('a written type that is not a known type', () => {
    const owners = ['PierLayer', 'HarbourLayer', 'TideLayer', 'QuayLayer', 'BuoyLayer'];
    const records = owners.flatMap((owner) => [
      makeRecord({
        ref: `https://d/${owner}/`,
        symbol: owner,
        qualified: `pkg/${owner}`,
        symbolKind: 'class',
      }),
      makeRecord({
        ref: `https://d/${owner}/#queryBerths`,
        symbol: 'queryBerths',
        qualified: `pkg/${owner}.queryBerths`,
        parent: `pkg/${owner}`,
        symbolKind: 'method',
      }),
    ]);
    const widgets = scope('widgets-sdk', records);

    it.each([
      ['TideLayr.queryBerths', 'found:pkg/TideLayer.queryBerths@simple'],
      ['TideLayr.queryBerthz', 'found:pkg/TideLayer.queryBerths@fuzzy'],
      ['layers/TideLayer.queryBerths', 'found:pkg/TideLayer.queryBerths@simple'],
    ])('%s -> %s', (input, expected) => {
      expect(outcome(resolveSymbol(input, [widgets]))).toBe(expected);
    });

    it('stays ambiguous when the written type resembles none of the owners', () => {
      expect(resolveSymbol('Unrelated.queryBerths', [widgets]).kind).toBe('ambiguous');
    });
  });

  it('names a record without a qualified name by its symbol', () => {
    expect(displayName(makeRecord({ symbol: 'arcgis-map' }))).toBe('arcgis-map');
    expect(displayName(makeRecord())).toBe('');
  });
});
