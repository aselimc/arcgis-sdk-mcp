import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { CatalogRecord, DocPage } from '../../../src/core/types.js';
import {
  baseTypes,
  declaredElsewhere,
  inheritedNotice,
} from '../../../src/services/symbol/inherited.js';
import { makeDocPage, makeRecord } from '../../support/builders.js';
import { makeHarness, type Harness } from '../support/harness.js';

const CORE = 'https://developers.arcgis.com/javascript/latest/references/core';
const GRAPHICS_URL = `${CORE}/layers/GraphicsLayer/`;
const MAP_VIEW_URL = `${CORE}/views/MapView/`;
const SCENE_VIEW_URL = `${CORE}/views/SceneView/`;

/** A type page whose member list links an inherited member to the type that declares it. */
const graphicsLayerPage = (links: readonly string[]): DocPage =>
  makeDocPage({
    url: GRAPHICS_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    markdown: [
      '# GraphicsLayer',
      '',
      'A layer holding client-side graphics.',
      '',
      '## Members inherited from other types',
      '',
      ...links.map((link) => `- [goTo](${link})`),
    ].join('\n'),
  });

const mapViewPage = (): DocPage =>
  makeDocPage({
    url: MAP_VIEW_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    markdown: [
      '# MapView',
      '',
      'A two-dimensional view.',
      '',
      '### goTo',
      '',
      '```ts',
      'goTo(target: Target): Promise<void>',
      '```',
      '',
      'Moves the view to the target.',
    ].join('\n'),
    members: [{ id: 'goto', name: 'goTo', kind: 'method', summary: 'Moves the view.' }],
  });

function harness(links: readonly string[]): Harness {
  const h = makeHarness();
  h.adapter('astro').addPage(graphicsLayerPage(links)).addPage(mapViewPage());
  return h;
}

const lookup = (h: Harness, symbol: string) =>
  h.services.symbols.lookup(
    { symbol, product: 'js-maps-sdk', detail: 'summary', maxTokens: 3000 },
    h.call(),
  );

// Regression: `ArcGISMap.loadStatus` (Kotlin) and `Map.LoadAsync` (.NET) answered
// SYMBOL_NOT_FOUND with members of unrelated types, because a reference indexes an inherited
// member only under the type that declares it.
describe('lookup: inherited members', () => {
  it('answers with the declaration the page of the type links to, and says so', async () => {
    const h = harness([`${MAP_VIEW_URL}#goTo`]);
    const response = await lookup(h, 'GraphicsLayer.goTo');
    expect(response.record.qualified).toBe('MapView.goTo');
    expect(response.text).toContain('Moves the view to the target.');
    expect(response.page.notices).toContain(
      'GraphicsLayer inherits goTo from MapView; this is the documentation of MapView.goTo.',
    );
  });

  it('matches the member name without regard to case', async () => {
    const h = harness([`${MAP_VIEW_URL}#goTo`]);
    expect((await lookup(h, 'GraphicsLayer.goto')).record.qualified).toBe('MapView.goTo');
  });

  it('stays SYMBOL_NOT_FOUND when the page links to no declaration of that name', async () => {
    const h = harness([`${CORE}/views/View/#goTo`]);
    const error: unknown = await lookup(h, 'GraphicsLayer.goTo').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpDocError);
    expect((error as McpDocError).code).toBe('SYMBOL_NOT_FOUND');
    expect((error as McpDocError).details?.candidates).toEqual(['MapView.goTo', 'SceneView.goTo']);
  });

  it('does not guess between two declarations the page links to', async () => {
    const h = harness([`${MAP_VIEW_URL}#goTo`, `${SCENE_VIEW_URL}#goTo`]);
    const error: unknown = await lookup(h, 'GraphicsLayer.goTo').catch((caught: unknown) => caught);
    expect((error as McpDocError).code).toBe('SYMBOL_NOT_FOUND');
  });

  it('reads the page of the type once, and no other, when no type has a member of that name', async () => {
    const h = harness([`${MAP_VIEW_URL}#goTo`]);
    const error: unknown = await lookup(h, 'FeatureLayer.noSuchMember').catch((e: unknown) => e);
    expect((error as McpDocError).code).toBe('SYMBOL_NOT_FOUND');
    // The page of the type is where an inherited member would be documented.
    expect(h.adapter('astro').count('read')).toBe(1);
  });
});

// Regression (the README's own example): `FeatureLayer.featureReduction`, `MapView.when`,
// `Map.add` and `Graphic.clone` answered SYMBOL_NOT_FOUND. The JavaScript reference indexes
// an inherited member under the mixin that declares it, the class page documents it in full
// ("Inherited from: FeatureReductionLayer"), and that page was only read for sources that
// index no members at all.
describe('lookup: an inherited member that the page of the type documents', () => {
  const LAYER_URL = `${CORE}/layers/TideLayer/`;
  const tideLayer = makeRecord({
    ref: LAYER_URL,
    product: 'js-maps-sdk',
    source: 'core',
    kind: 'api',
    title: 'TideLayer',
    symbol: 'TideLayer',
    qualified: 'TideLayer',
    symbolKind: 'class',
  });
  const ownMember = makeRecord({
    ref: `${LAYER_URL}#refresh`,
    product: 'js-maps-sdk',
    source: 'core',
    kind: 'api',
    title: 'refresh',
    symbol: 'refresh',
    qualified: 'TideLayer.refresh',
    parent: 'TideLayer',
    symbolKind: 'method',
  });
  // 250 other types declare `when`: too many to tell which one the page means by its links.
  const elsewhere = Array.from({ length: 250 }, (_, i) =>
    makeRecord({
      ref: `${CORE}/mixins/Mixin${i}/#when`,
      product: 'js-maps-sdk',
      source: 'core',
      kind: 'api',
      title: 'when',
      symbol: 'when',
      qualified: `Mixin${i}.when`,
      parent: `Mixin${i}`,
      symbolKind: 'method',
    }),
  );
  const page = makeDocPage({
    url: LAYER_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    markdown: [
      '# TideLayer',
      'A layer of tide gauges.',
      '### refresh',
      'Fetches the gauges again.',
      '### when',
      '```ts\nwhen(callback?: Function): Promise<this>\n```',
      'Resolves when the layer is ready.',
      'Inherited from: [PromiseMixin](https://developers.arcgis.com/javascript/latest/references/core/mixins/PromiseMixin/)',
    ].join('\n\n'),
    members: [
      { id: 'refresh', name: 'refresh', kind: 'method' },
      { id: 'when', name: 'when', kind: 'method', inheritedFrom: 'PromiseMixin' },
    ],
  });

  it('answers from the page of the type and names where the member comes from', async () => {
    const h = makeHarness({
      records: [tideLayer, ownMember, ...elsewhere],
      adapters: { astro: { slices: true } },
    });
    h.adapter('astro').addPage(page);
    const response = await lookup(h, 'TideLayer.when');
    expect(response.record.qualified).toBe('TideLayer.when');
    expect(response.text).toContain('when(callback?: Function): Promise<this>');
    expect(response.text).not.toContain('Fetches the gauges again.');
    expect(response.page.notices).toContain('TideLayer inherits when from PromiseMixin.');
  });

  it('does not take the placeholder of an unreadable page for the member', async () => {
    const h = makeHarness({ records: [tideLayer, ownMember] });
    const error: unknown = await lookup(h, 'TideLayer.when').catch((e: unknown) => e);
    expect((error as McpDocError).code).toBe('SYMBOL_NOT_FOUND');
  });
});

describe('declaredElsewhere', () => {
  const candidate = (ref: string, source = 'core'): CatalogRecord =>
    makeRecord({ ref, source, symbol: 'load', qualified: 'Base.load', parent: 'Base' });
  const page = makeDocPage({
    markdown: '# Thing\n\nInherited: [load](https://example.test/api/base/load.html)',
  });

  it('finds the linked candidate and ignores the others', () => {
    const linked = candidate('https://example.test/api/base/load.html');
    expect(
      declaredElsewhere(page, [candidate('https://example.test/api/other/load.html'), linked]),
    ).toBe(linked);
  });

  it('treats one declaration indexed by two sources as one answer', () => {
    const first = candidate('https://example.test/api/base/load.html');
    const twin = candidate('https://example.test/api/base/load.html', 'typings');
    expect(declaredElsewhere(page, [first, twin])).toBe(first);
  });

  it('does not match a ref that is only a prefix of a link', () => {
    expect(declaredElsewhere(page, [candidate('https://example.test/api/base/load')])).toBe(
      undefined,
    );
  });

  it('finds nothing on a page that could not be read', () => {
    const linkOnly = {
      ...page,
      degraded: { level: 'link-only' as const, reason: 'upstream failing' },
    };
    expect(
      declaredElsewhere(linkOnly, [candidate('https://example.test/api/base/load.html')]),
    ).toBe(undefined);
  });

  // javadoc names inherited members in a sentence, without a link to each declaration.
  describe('a page that states what is inherited', () => {
    const member = (parent: string, symbol = 'getDepth'): CatalogRecord =>
      makeRecord({
        ref: `https://example.test/api/${parent}.html#${symbol}()`,
        symbol,
        qualified: `${parent}.${symbol}`,
        parent,
      });
    const stated = makeDocPage({
      markdown: [
        '# Class Berth',
        'A place at the quay. See also `Pier.getDepth`.',
        '**Methods inherited from class com.example.harbour.Mooring:** `getDepth, getLength, release`',
        '**Methods inherited from class java.lang.Object:** `equals, hashCode`',
      ].join('\n\n'),
    });

    it('finds the member in the list of the type it names', () => {
      const declared = member('com.example.harbour.Mooring');
      expect(declaredElsewhere(stated, [member('com.example.harbour.Pier'), declared])).toBe(
        declared,
      );
    });

    it('accepts the simple name of the declaring type', () => {
      const short = makeDocPage({
        markdown: '# Berth\n\nMethods inherited from class Mooring: getDepth, release',
      });
      const declared = member('com.example.harbour.Mooring');
      expect(declaredElsewhere(short, [declared])).toBe(declared);
    });

    it('needs the whole member name and the whole type name', () => {
      // `getDepthAt` is another member, `MooringBuoy` another type.
      expect(declaredElsewhere(stated, [member('com.example.harbour.Mooring', 'getDep')])).toBe(
        undefined,
      );
      expect(declaredElsewhere(stated, [member('com.example.harbour.MooringBuoy')])).toBe(
        undefined,
      );
      // A mention outside an "inherited from" statement is not one.
      expect(declaredElsewhere(stated, [member('com.example.harbour.Pier')])).toBe(undefined);
    });
  });

  it('words the notice with both types', () => {
    expect(inheritedNotice('a.Map', 'load', 'a.Loadable')).toBe(
      'a.Map inherits load from a.Loadable; this is the documentation of a.Loadable.load.',
    );
  });
});

// Regression: `MapQuickView::setViewpointAsync` (Qt) and
// `ServiceFeatureTable.queryFeatureCount` (Swift) answered SYMBOL_NOT_FOUND: QDoc and DocC
// pages neither link nor list inherited members, they only name the base types.
describe('lookup: a member declared on a base type the page names', () => {
  const FEATURE_URL = `${CORE}/layers/FeatureLayer/`;
  const typePage = (url: string, title: string, body: readonly string[]): DocPage =>
    makeDocPage({
      url,
      kind: 'api',
      product: 'js-maps-sdk',
      source: 'core',
      markdown: [`# ${title}`, '', ...body].join('\n'),
    });
  const sceneViewPage = (): DocPage => ({
    ...mapViewPage(),
    url: SCENE_VIEW_URL,
    ref: SCENE_VIEW_URL,
    title: 'SceneView',
  });

  it('follows a direct base type', async () => {
    const h = makeHarness();
    h.adapter('astro')
      .addPage(
        typePage(GRAPHICS_URL, 'GraphicsLayer', [
          `- **Inherits:** [Thing](${CORE}/Thing/) and [MapView](${MAP_VIEW_URL})`,
        ]),
      )
      .addPage(mapViewPage());
    const response = await lookup(h, 'GraphicsLayer.goTo');
    expect(response.record.qualified).toBe('MapView.goTo');
    expect(response.page.notices).toContain(
      'GraphicsLayer inherits goTo from MapView; this is the documentation of MapView.goTo.',
    );
  });

  it('walks up through a base type that does not declare the member itself', async () => {
    const h = makeHarness();
    h.adapter('astro')
      .addPage(
        typePage(GRAPHICS_URL, 'GraphicsLayer', [
          '### Inherits From',
          '',
          // DocC: a declaration keyword in the label and no trailing slash in the link.
          `- [\`class FeatureLayer\`](${FEATURE_URL.replace(/\/$/, '')})`,
          '',
          '### Conforms To',
          '',
          `- [\`protocol MapView\`](${MAP_VIEW_URL})`,
        ]),
      )
      .addPage(typePage(FEATURE_URL, 'FeatureLayer', [`Inherits: [SceneView](${SCENE_VIEW_URL})`]))
      .addPage(sceneViewPage());
    const response = await lookup(h, 'GraphicsLayer.goTo');
    expect(response.record.qualified).toBe('SceneView.goTo');
  });

  it('stays SYMBOL_NOT_FOUND when no base type declares the member', async () => {
    const h = makeHarness();
    h.adapter('astro')
      .addPage(
        typePage(GRAPHICS_URL, 'GraphicsLayer', [`- **Inherits:** [FeatureLayer](${FEATURE_URL})`]),
      )
      .addPage(typePage(FEATURE_URL, 'FeatureLayer', ['A layer of features.']));
    const error: unknown = await lookup(h, 'GraphicsLayer.goTo').catch((caught: unknown) => caught);
    expect((error as McpDocError).code).toBe('SYMBOL_NOT_FOUND');
  });
});

describe('baseTypes', () => {
  const page = (...blocks: string[]): DocPage =>
    makeDocPage({ markdown: ['# Buoy', ...blocks].join('\n\n') });

  it('reads the links of a line that says what the type inherits', () => {
    expect(
      baseTypes(
        page(
          '- **Inherits:** [a::Marker](https://example.test/api/marker.html#details) and [Floating](https://example.test/api/floating.html)',
        ),
      ),
    ).toEqual([
      { name: 'a::Marker', ref: 'https://example.test/api/marker.html' },
      { name: 'Floating', ref: 'https://example.test/api/floating.html' },
    ]);
  });

  it('reads the list under a heading that says so, and no other list', () => {
    expect(
      baseTypes(
        page(
          '### Inherits From',
          '- [`class Marker`](https://example.test/api/marker/)',
          '### Conforms To',
          '- [`protocol Loadable`](https://example.test/api/loadable/)',
        ),
      ),
    ).toEqual([{ name: 'Marker', ref: 'https://example.test/api/marker' }]);
  });

  it('is not misled by a link target, a member list or an unreadable page', () => {
    expect(baseTypes(page('See [the guide](https://example.test/inheritance/extends/).'))).toEqual(
      [],
    );
    expect(
      baseTypes(page('Methods inherited from [Marker](https://example.test/api/marker/): `sink`')),
    ).toEqual([]);
    const unread = {
      ...page('Inherits: [Marker](https://example.test/api/marker/)'),
      degraded: { level: 'link-only' as const, reason: 'upstream failing' },
    };
    expect(baseTypes(unread)).toEqual([]);
  });
});
