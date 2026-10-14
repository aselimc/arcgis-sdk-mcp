import { describe, expect, it } from 'vitest';
import type { Product, WorkspaceSdk } from '../../src/core/types.js';
import { projectLine, productsNamedIn, resolveScope } from '../../src/services/scope.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { makeCtx } from '../support/make-ctx.js';

const sdk = (product: string, version = '1.0.0'): WorkspaceSdk => ({
  product,
  package: product,
  version,
  file: 'package.json',
});

const guide = makeSource('gatsby', { base: '/x/' }, { id: 'guide', kinds: ['guide'] });
const samples = makeSource('gatsby', { base: '/x/s/' }, { id: 'samples', kinds: ['sample'] });

/** A web SDK with samples, the component library that is installed next to it, and bystanders. */
const tides = makeProduct({
  id: 'tides-sdk',
  name: 'Tides SDK',
  aliases: ['tides'],
  keywords: ['gauge', 'harbour'],
  related: ['formula'],
  sources: [guide, samples],
});
const widgets = makeProduct({
  id: 'widget-kit',
  name: 'Widget Kit',
  aliases: [],
  keywords: ['button', 'cluster'],
  sources: [guide],
});
// Its keywords are single common words: the router picks it for "expression" and "engine".
const formula = makeProduct({
  id: 'formula',
  name: 'Formula',
  aliases: [],
  keywords: ['expression', 'engine', 'cluster'],
  sources: [guide],
});
const fieldNotes = makeProduct({
  id: 'field-notes',
  name: 'ArcGIS Field Notes',
  aliases: [],
  keywords: [],
  tier: 'help',
  sources: [guide],
});
const hoarder = makeProduct({
  id: 'oss-tools',
  name: 'Open tools',
  aliases: [],
  keywords: ['field', 'notes', 'deep', 'link', 'scheme'],
  sources: [guide],
});
const PRODUCTS: Product[] = [tides, widgets, formula, fieldNotes, hoarder];

function ctxWith(workspace: WorkspaceSdk[], products: Product[] = PRODUCTS) {
  return makeCtx({ registry: fakeRegistry({ products }), workspace });
}

const ids = (list: Array<{ product: Product }>): string[] => list.map((entry) => entry.product.id);

// Regression: in a project with @arcgis/core and Calcite (the standard pairing), the scope
// was the project only when exactly one SDK was detected. With two, any router guess
// replaced them: find_samples searched `i3s-spec`, lookup_symbol three unrelated products.
describe('resolveScope: the project outranks a router guess', () => {
  const twoSdks = [sdk('tides-sdk'), sdk('widget-kit')];

  it('takes the detected SDKs, the one the query is about first', async () => {
    const scope = await resolveScope(ctxWith(twoSdks), { query: 'cluster gauges', max: 3 });
    expect(scope.origin).toBe('workspace');
    expect(ids(scope.resolutions).sort()).toEqual(['tides-sdk', 'widget-kit']);
    expect(scope.resolutions[0]?.resolvedFrom).toBe('project');
  });

  it('does not let a word of a symbol route away from the project', async () => {
    const scope = await resolveScope(ctxWith(twoSdks), {
      query: 'PopupTemplate.expressionInfos',
      max: 3,
    });
    expect(scope.origin).toBe('workspace');
    expect(ids(scope.resolutions).sort()).toEqual(['tides-sdk', 'widget-kit']);
    // The guess and the products related to the project's are what a miss falls back on.
    expect(ids(scope.fallbacks)).toEqual(['formula']);
  });

  it('gives a call that takes one product the first detected one that is eligible', async () => {
    const hasSamples = (product: Product): boolean =>
      product.sources.some((source) => source.kinds.includes('sample'));
    const scope = await resolveScope(ctxWith([sdk('widget-kit'), sdk('tides-sdk')]), {
      query: 'cluster',
      max: 1,
      eligible: hasSamples,
    });
    expect(ids(scope.resolutions)).toEqual(['tides-sdk']);
  });

  // Regression: an unscoped find_samples went to the best product by name although that
  // product has no samples ("3D tiles layer" to a format specification).
  it('routes past products that are not eligible, and drops the filter when none is', async () => {
    const hasSamples = (product: Product): boolean =>
      product.sources.some((source) => source.kinds.includes('sample'));
    const routed = await resolveScope(ctxWith([]), {
      query: 'cluster gauge',
      max: 1,
      eligible: hasSamples,
    });
    expect(ids(routed.resolutions)).toEqual(['tides-sdk']);
    const none = await resolveScope(ctxWith([], [widgets, formula]), {
      query: 'cluster',
      max: 1,
      eligible: hasSamples,
    });
    expect(none.resolutions).toHaveLength(1);
  });

  it('still honours a `product` argument and reports no fallbacks for it', async () => {
    const scope = await resolveScope(ctxWith(twoSdks), { product: 'formula', query: 'x', max: 3 });
    expect(scope).toMatchObject({ origin: 'argument', fallbacks: [] });
    expect(ids(scope.resolutions)).toEqual(['formula']);
  });

  it('answers without a project as before: the clear guess for a name, else the likely products', async () => {
    const named = await resolveScope(ctxWith([]), { query: 'Formula.expression', max: 3 });
    expect(named.origin).toBe('query');
    expect(ids(named.resolutions)).toEqual(['formula']);
    const routed = await resolveScope(ctxWith([]), { query: 'cluster buttons', max: 3 });
    expect(routed.origin).toBe('router');
    expect(ids(routed.resolutions)).toContain('widget-kit');
    expect((await resolveScope(ctxWith([]), { query: 'zzzz', max: 3 })).origin).toBe('none');
  });
});

// Regression: "Field Maps URL scheme deep link" was routed to three products that list
// "field" and "maps" as keywords, and not to the product of that name.
describe('resolveScope: a product named by a phrase', () => {
  it('finds products whose name of two or more words is in the query', () => {
    const ctx = ctxWith([]);
    expect(productsNamedIn(ctx, 'Field Notes deep link scheme').map((p) => p.id)).toEqual([
      'field-notes',
    ]);
    expect(productsNamedIn(ctx, 'take notes in the field')).toEqual([]);
    // One-word names are the router's business: a single common word names nothing.
    expect(productsNamedIn(ctx, 'formula for tides')).toEqual([]);
  });

  it('puts the named product first, ahead of the project and of the router', async () => {
    const scope = await resolveScope(ctxWith([sdk('tides-sdk')]), {
      query: 'Field Notes deep link scheme',
      max: 3,
    });
    expect(scope.origin).toBe('query');
    expect(ids(scope.resolutions).slice(0, 2)).toEqual(['field-notes', 'tides-sdk']);
  });
});

// Regression: in a project on 200.x, lookup_symbol answered from the 200.x reference while
// search and find_samples answered from 300.x without a word.
describe('projectLine', () => {
  const native = makeProduct({
    id: 'native-sdk',
    lines: [
      makeLine({ id: 'latest', label: '300.x' }),
      makeLine({ id: 'v200', label: '200.x LTS', current: false }),
      makeLine({ id: 'v100', label: '100.x', current: false, access: 'link-only' }),
    ],
  });
  const ctx = makeCtx({ registry: fakeRegistry({ products: [native] }) });

  it('is the current line without a project version, or with one that fits no line', () => {
    expect(projectLine(ctx, native, [])).toMatchObject({ line: { id: 'latest' }, pinned: false });
    expect(projectLine(ctx, native, [sdk('native-sdk', '7.7')])).toMatchObject({
      line: { id: 'latest' },
      pinned: false,
      unreadable: false,
    });
  });

  it('is the line of the project when its pages can be read', () => {
    expect(projectLine(ctx, native, [sdk('native-sdk', 'v200')])).toMatchObject({
      line: { id: 'v200' },
      version: 'v200',
      pinned: true,
    });
  });

  it('stays on the current line, and says why, for a line that is never fetched', () => {
    expect(projectLine(ctx, native, [sdk('native-sdk', 'v100')])).toMatchObject({
      line: { id: 'latest' },
      pinned: false,
      unreadable: true,
    });
  });
});
