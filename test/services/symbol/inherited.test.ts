import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { CatalogRecord, DocPage } from '../../../src/core/types.js';
import { declaredElsewhere, inheritedNotice } from '../../../src/services/symbol/inherited.js';
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

  it('does not read the page of the type when no other type has a member of that name', async () => {
    const h = harness([`${MAP_VIEW_URL}#goTo`]);
    await lookup(h, 'FeatureLayer.noSuchMember').catch(() => undefined);
    expect(h.adapter('astro').count('read')).toBe(0);
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

  it('words the notice with both types', () => {
    expect(inheritedNotice('a.Map', 'load', 'a.Loadable')).toBe(
      'a.Map inherits load from a.Loadable; this is the documentation of a.Loadable.load.',
    );
  });
});
