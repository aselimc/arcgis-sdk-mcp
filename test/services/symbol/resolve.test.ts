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

  // Regression: Arcade has `Intersects` for geometries and for feature sets, on two pages of
  // one source. They were merged as "twins", so the second was never mentioned.
  describe('same-named declarations on different pages of one source', () => {
    const namesake = (page: string, extra: Partial<CatalogRecord> = {}): CatalogRecord =>
      makeRecord({
        ref: `https://d/fn/${page}/#overlaps`,
        source: 'functions',
        symbol: 'Overlaps',
        qualified: 'Overlaps',
        ...extra,
      });

    it('answers with the first and lists the other as an alternate, not as a twin', () => {
      const resolution = resolveSymbol('Overlaps', [
        scope('widgets-sdk', [namesake('geometry'), namesake('featureset')]),
      ]);
      expect(outcome(resolution)).toBe('found:Overlaps@qualified');
      if (resolution.kind !== 'found') return;
      expect(resolution.winner.record.ref).toBe('https://d/fn/geometry/#overlaps');
      expect(resolution.winner.twins).toEqual([]);
      expect(resolution.alternates.map((c) => c.record.ref)).toEqual([
        'https://d/fn/featureset/#overlaps',
      ]);
    });

    it('keeps overloads on one page, and the same page in another source, as twins', () => {
      const resolution = resolveSymbol('Overlaps', [
        scope('widgets-sdk', [
          namesake('geometry'),
          namesake('geometry', { ref: 'https://d/fn/geometry/#overlaps-1' }),
          namesake('other', { source: 'typings' }),
        ]),
      ]);
      expect(resolution.kind === 'found' ? resolution.winner.twins.map((t) => t.ref) : []).toEqual([
        'https://d/fn/geometry/#overlaps-1',
        'https://d/fn/other/#overlaps',
      ]);
      expect(resolution.kind === 'found' ? resolution.alternates : undefined).toEqual([]);
    });

    it('names each rival once when the name is ambiguous for another reason', () => {
      const rival = makeRecord({
        ref: 'https://d/fn/text/#overlaps',
        source: 'functions',
        symbol: 'Overlaps',
        qualified: 'text.Overlaps',
      });
      const resolution = resolveSymbol('Overlaps', [
        scope('widgets-sdk', [
          namesake('geometry', { qualified: 'geo.Overlaps' }),
          namesake('featureset', { qualified: 'geo.Overlaps' }),
          rival,
        ]),
      ]);
      expect(outcome(resolution)).toBe('ambiguous:geo.Overlaps,text.Overlaps');
    });
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
      // A misspelt owner is a guess, and the answer says so ("was matched to").
      ['TideLayr.queryBerths', 'found:pkg/TideLayer.queryBerths@case-insensitive'],
      ['TideLayr.queryBerthz', 'found:pkg/TideLayer.queryBerths@fuzzy'],
      // The owner as written behind another module path is still that owner.
      ['layers/TideLayer.queryBerths', 'found:pkg/TideLayer.queryBerths@simple'],
      // Regression: an exact name on a slash-qualified record was classed as a loose match
      // and got a "was matched to" note.
      ['TideLayer.queryBerths', 'found:pkg/TideLayer.queryBerths@simple'],
      ['pkg.TideLayer.queryBerths', 'found:pkg/TideLayer.queryBerths@simple'],
      ['pkg/TideLayer', 'found:pkg/TideLayer@simple'],
    ])('%s -> %s', (input, expected) => {
      expect(outcome(resolveSymbol(input, [widgets]))).toBe(expected);
    });

    it('stays ambiguous when the written type resembles none of the owners', () => {
      expect(resolveSymbol('Unrelated.queryBerths', [widgets]).kind).toBe('ambiguous');
    });
  });

  // Regression: `@arcgis/core/widgets/LayerList`, the Next call the server itself printed,
  // read `widgets` as the class `Widgets` and `LayerList` as a member it does not have.
  describe('a module path with a directory that is a class name but for its case', () => {
    const type = (qualified: string, symbolKind = 'class'): CatalogRecord =>
      makeRecord({
        ref: `https://d/${qualified}/`,
        symbol: qualified.split('/').at(-1) ?? qualified,
        qualified,
        symbolKind,
      });
    const records = [
      type('@pkg/core/webdoc/Widgets'),
      type('@pkg/core/widgets/LayerList'),
      type('@pkg/core/geometry/Point'),
      type('@pkg/core/portal/jsonTypes/Point', 'type'),
      type('@pkg/core/geometry/Geometry'),
      makeRecord({
        ref: 'https://d/mixin/#when',
        symbol: 'when',
        qualified: '@pkg/core/mixins/Promised.when',
        parent: '@pkg/core/mixins/Promised',
        symbolKind: 'method',
      }),
    ];
    const pkg = scope('widgets-sdk', records);

    it.each([
      ['widgets/LayerList', 'found:@pkg/core/widgets/LayerList@simple'],
      ['@pkg/core/widgets/LayerList', 'found:@pkg/core/widgets/LayerList@simple'],
      ['geometry/Point', 'found:@pkg/core/geometry/Point@simple'],
      // An inherited member behind a type written without its capitals still names the type.
      ['geometry.when', 'none:@pkg/core/geometry/Geometry'],
      // No such module: the type is found, and the answer admits that the path was a guess.
      ['nowhere/Widgets', 'found:@pkg/core/webdoc/Widgets@case-insensitive'],
    ])('%s -> %s', (input, expected) => {
      expect(outcome(resolveSymbol(input, [pkg]))).toBe(expected);
    });

    // Regression: `Point`, `Extent` and `Color` were AMBIGUOUS_SYMBOL because a type alias
    // of the same name tied with the class.
    it('answers with the class when a type alias shares its name, and lists the alias', () => {
      const resolution = resolveSymbol('Point', [pkg]);
      expect(outcome(resolution)).toBe('found:@pkg/core/geometry/Point@simple');
      expect(
        resolution.kind === 'found' ? resolution.alternates.map((c) => c.record.qualified) : [],
      ).toEqual(['@pkg/core/portal/jsonTypes/Point']);
    });
  });

  // Regression: `MapTool` of the Pro SDK said "4 symbols equally well" and listed the two
  // constructors, which rank after the two types; and the public type tied with a namesake
  // in an `Internal` namespace.
  it('lists only what ties, and prefers a public type to an internal namesake', () => {
    const tool = (namespace: string): CatalogRecord[] => [
      makeRecord({
        ref: `https://d/${namespace}/`,
        symbol: 'DockTool',
        qualified: `${namespace}.DockTool`,
        symbolKind: 'type',
      }),
      makeRecord({
        ref: `https://d/${namespace}/#ctor`,
        symbol: 'DockTool',
        qualified: `${namespace}.DockTool.DockTool`,
        parent: `${namespace}.DockTool`,
        symbolKind: 'constructor',
      }),
    ];
    const tied = scope('widgets-sdk', [...tool('Harbour.Mapping'), ...tool('Harbour.Editing')]);
    const ambiguous = resolveSymbol('DockTool', [tied]);
    expect(ambiguous.kind === 'ambiguous' ? ambiguous.candidates.map((c) => displayName(c.record)) : [])
      .toEqual(['Harbour.Mapping.DockTool', 'Harbour.Editing.DockTool']);

    const mixed = scope('widgets-sdk', [...tool('Harbour.Internal.Editing'), ...tool('Harbour.Mapping')]);
    expect(outcome(resolveSymbol('DockTool', [mixed]))).toBe('found:Harbour.Mapping.DockTool@simple');
  });

  // Regression: `esriConfig.apiKey` was ambiguous between eight types with an `apiKey`, and
  // `arcgis.gis.Folder.add` and `gis.content.add` were answered with another class's `add`.
  describe('a qualifier that is not the qualified name of the owner', () => {
    const member = (owner: string, name: string): CatalogRecord =>
      makeRecord({
        ref: `https://d/${owner}/#${name}`,
        symbol: name,
        qualified: `${owner}.${name}`,
        parent: owner,
        symbolKind: 'method',
      });
    const records = [
      makeRecord({ ref: 'https://d/gis/', symbol: 'gis', qualified: 'tides.gis', symbolKind: 'module' }),
      member('tides.gis._impl._content.Folder', 'add'),
      member('tides.gis.ContentManager', 'add'),
      member('tides.gis.SharingManager', 'add'),
      member('tides.gis.UserManager', 'search'),
      member('tides.gis.ContentManager', 'search'),
      member('@pkg/core/config/Config', 'apiKey'),
      member('@pkg/components/tide-directions', 'apiKey'),
      member('@pkg/core/layers/TileLayer', 'apiKey'),
    ];
    const tides = scope('widgets-sdk', records);

    it.each([
      ['tides.gis.Folder.add', 'found:tides.gis._impl._content.Folder.add@simple'],
      ['Folder.add', 'found:tides.gis._impl._content.Folder.add@simple'],
      ['gis.content.add', 'found:tides.gis.ContentManager.add@case-insensitive'],
      ['gis.users.search', 'found:tides.gis.UserManager.search@case-insensitive'],
      ['esriConfig.apiKey', 'found:@pkg/core/config/Config.apiKey@case-insensitive'],
    ])('%s -> %s', (input, expected) => {
      expect(outcome(resolveSymbol(input, [tides]))).toBe(expected);
    });

    it('does not pick a member for an owner that matches none', () => {
      const resolution = resolveSymbol('tides.gis.Nope.add', [tides]);
      expect(resolution.kind).toBe('ambiguous');
      expect(resolution.kind === 'ambiguous' ? resolution.candidates : []).toHaveLength(3);
    });
  });

  // Regression: `generateToken` in rest-api silently answered with the ArcGIS Server
  // operation because its source is listed first; operations of different services are peers.
  describe('REST operations of the same name in several sources', () => {
    const operation = (source: string, qualified: string | undefined, breadcrumb: string) =>
      makeRecord({
        ref: `https://d/${source}/issue-token/`,
        product: 'rest-api',
        source,
        symbol: 'issueToken',
        ...(qualified === undefined ? {} : { qualified }),
        symbolKind: 'operation',
        breadcrumb,
      });
    const records = [
      operation('server', 'ServerRoot.issueToken', 'Server Root'),
      operation('portal', undefined, 'Portal Root'),
    ];
    const services = scope('rest-api', records);

    it('is ambiguous by the bare name', () => {
      expect(resolveSymbol('issueToken', [services]).kind).toBe('ambiguous');
    });

    it('is decided by the owner, which for a record without one is its place in the navigation', () => {
      expect(outcome(resolveSymbol('ServerRoot.issueToken', [services]))).toBe(
        'found:ServerRoot.issueToken@qualified',
      );
      const portal = resolveSymbol('PortalRoot.issueToken', [services]);
      expect(portal.kind === 'found' ? portal.winner.record.source : '').toBe('portal');
      expect(resolveSymbol('Nope.issueToken', [services]).kind).toBe('ambiguous');
    });

    // Regression: `search` of the portal answered with the search of one group's content
    // and listed the root search ("Search") only as an alternate.
    it('answers with the plainest of same-named operations of one service', () => {
      const search = (slug: string, title: string) =>
        makeRecord({
          ref: `https://d/portal/${slug}/`,
          product: 'rest-api',
          source: 'portal',
          symbol: 'search',
          symbolKind: 'operation',
          title,
        });
      const portal = scope('rest-api', [
        search('group-content-search', '/search: Group Content Search'),
        search('search', '/search: Search'),
      ]);
      const found = resolveSymbol('search', [portal]);
      expect(found.kind).toBe('found');
      if (found.kind !== 'found') return;
      expect(found.winner.record.ref).toBe('https://d/portal/search/');
      expect(found.alternates.map((alternate) => alternate.record.ref)).toEqual([
        'https://d/portal/group-content-search/',
      ]);
    });
  });

  it('names a record without a qualified name by its symbol', () => {
    expect(displayName(makeRecord({ symbol: 'arcgis-map' }))).toBe('arcgis-map');
    expect(displayName(makeRecord())).toBe('');
  });
});
