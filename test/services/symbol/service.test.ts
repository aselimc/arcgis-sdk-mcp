import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SymbolRequest } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import { makeDocPage, makeLine, makeProduct, makeRecord, makeSource } from '../../support/builders.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

const CORE = 'https://developers.arcgis.com/javascript/latest/references/core';
const FL_URL = `${CORE}/layers/FeatureLayer/`;

const featureLayerPage = (): DocPage =>
  makeDocPage({
    url: FL_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    markdown: [
      '# FeatureLayer',
      '',
      'A layer of features from a service.',
      '',
      '```ts',
      'class FeatureLayer extends Layer',
      '```',
      '',
      'More prose about feature layers that a signature does not need.',
      '',
      '## Methods',
      '',
      '### queryFeatures',
      '',
      '```ts',
      'queryFeatures(query?: Query): Promise<FeatureSet>',
      '```',
      '',
      'Runs a query against the layer.',
      '',
      '#### Parameters',
      '',
      '- `query`: what to ask for.',
      '',
      '### applyEdits',
      '',
      'Sends edits to the service.',
    ].join('\n'),
    members: [
      { id: 'queryfeatures', name: 'queryFeatures', kind: 'method', summary: 'Runs a query against the layer.' },
      { id: 'applyedits', name: 'applyEdits', kind: 'method', summary: 'Sends edits to the service.' },
    ],
  });

const typingsPage = (): DocPage =>
  makeDocPage({
    url: FL_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'typings',
    version: '4.33.2',
    license: 'esri-ma',
    markdown: '# FeatureLayer\n\n```ts\nexport default class FeatureLayer {}\n```\n\nFrom the typings of the package.',
  });

function harness(options: HarnessOptions = {}): Harness {
  const h = makeHarness(options);
  h.adapter('astro').addPage(featureLayerPage());
  h.adapter('npm-dts').addPage(typingsPage());
  return h;
}

const lookup = (h: Harness, request: Partial<SymbolRequest> & { symbol: string }) =>
  h.services.symbols.lookup({ detail: 'summary', maxTokens: 3000, ...request }, h.call());

const failure = async (promise: Promise<unknown>): Promise<McpDocError> => {
  const caught: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof McpDocError)) throw new Error('expected a McpDocError');
  return caught;
};

const unavailable = new McpDocError('UPSTREAM_UNAVAILABLE', 'developers.arcgis.com is not responding', {
  why: 'timeout',
  retryable: true,
});

describe('lookup: answers', () => {
  it('returns a type as its own documentation plus a member index', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'javascript' });
    expect(response.record).toMatchObject({ qualified: 'FeatureLayer', source: 'core' });
    expect(response.resolvedProduct).toMatchObject({ product: { id: 'js-maps-sdk' }, resolvedFrom: 'javascript', how: 'alias' });
    expect(response.text).toContain('A layer of features from a service.');
    expect(response.text).toContain('## Members\n\n**method** (2)');
    expect(response.text).toContain('- `queryFeatures` (method): Runs a query against the layer.');
    expect(response.text).not.toContain('#### Parameters');
    expect(response.alternates).toEqual([]);
    expect(response.next).toBeUndefined();
    expect(response.page).toMatchObject({ product: 'js-maps-sdk', source: 'core', line: 'latest' });
  });

  it('returns one member, asking the adapter for it', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer.queryFeatures', product: 'js-maps-sdk' });
    expect(response.record.qualified).toBe('FeatureLayer.queryFeatures');
    expect(response.text).toBe(
      [
        '### queryFeatures',
        '```ts\nqueryFeatures(query?: Query): Promise<FeatureSet>\n```',
        'Runs a query against the layer.',
        '#### Parameters',
        '- `query`: what to ask for.',
      ].join('\n\n'),
    );
    expect(h.adapter('astro').calls.at(-1)?.target).toMatchObject({
      select: { member: 'queryFeatures' },
      detail: 'summary',
      record: { qualified: 'FeatureLayer.queryFeatures' },
    });
  });

  it('trims to the declaration and one line for detail "signature"', async () => {
    const h = harness();
    const member = await lookup(h, { symbol: 'FeatureLayer.queryFeatures', product: 'js-maps-sdk', detail: 'signature' });
    expect(member.text).toBe(
      '### queryFeatures\n\n```ts\nqueryFeatures(query?: Query): Promise<FeatureSet>\n```\n\nRuns a query against the layer.',
    );
    expect(member.next).toBe(
      'arcgis_docs_lookup_symbol({"symbol":"FeatureLayer.queryFeatures","product":"js-maps-sdk","detail":"summary"})',
    );

    const type = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk', detail: 'signature' });
    expect(type.text).toBe(
      '# FeatureLayer\n\nA layer of features from a service.\n\n```ts\nclass FeatureLayer extends Layer\n```',
    );
  });

  it('returns everything for detail "full" and points at the reader when it is cut', async () => {
    const h = harness();
    const full = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk', detail: 'full' });
    expect(full.text).toContain('#### Parameters');
    expect(full.text).toContain('### applyEdits');
    expect(full.next).toBeUndefined();

    const cut = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk', detail: 'full', maxTokens: 60 });
    expect(cut.text).not.toContain('### applyEdits');
    expect(cut.next).toBe(`arcgis_docs_read({"ref":"${FL_URL}","view":"full"})`);

    const summary = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk', maxTokens: 60 });
    expect(summary.next).toBe('arcgis_docs_lookup_symbol({"symbol":"FeatureLayer","product":"js-maps-sdk","detail":"full"})');
  });

  it('puts the header block of the page first', async () => {
    const h = harness();
    h.adapter('astro').addPage({ ...featureLayerPage(), header: 'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";' });
    const response = await lookup(h, { symbol: 'FeatureLayer.applyEdits', product: 'js-maps-sdk' });
    expect(response.text).toBe(
      'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";\n\n### applyEdits\n\nSends edits to the service.',
    );
  });

  it('uses the adapter own symbol method when it has one', async () => {
    const h = harness({ adapters: { astro: { ownSymbol: true } } });
    await lookup(h, { symbol: 'MapView.goTo', product: 'js-maps-sdk', detail: 'full' }).catch(() => undefined);
    expect(h.adapter('astro').calls.at(-1)).toMatchObject({ method: 'symbol', detail: 'full', ref: `${CORE}/views/MapView/#goTo` });
  });

  it('adds what it read to the body index', async () => {
    const h = harness();
    await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' });
    expect(h.index.queryBodies({ text: 'sends edits', products: ['js-maps-sdk'], limit: 3 })[0]?.ref).toBe(`${FL_URL}#applyedits`);
  });

  it('says so when the name was matched loosely, and lists alternates', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'featurelayr', product: 'js-maps-sdk' });
    expect(response.record.qualified).toBe('FeatureLayer');
    expect(response.page.notices).toContain('"featurelayr" was matched to FeatureLayer.');

    h.adapter('astro').addPage(makeDocPage({ url: `${CORE}/geometry/Point/`, markdown: '# Point\n\nA location.' }));
    const point = await lookup(h, { symbol: 'Point', product: 'js-maps-sdk' });
    expect(point.alternates.map((record) => record.qualified)).toEqual(['smartMapping.Point']);
  });
});

describe('lookup: scope and versions', () => {
  it('finds the product from the symbol when none is given', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer.applyEdits' });
    expect(response.record.product).toBe('js-maps-sdk');
    expect(response.resolvedProduct).toMatchObject({ product: { id: 'js-maps-sdk' }, how: 'fuzzy' });
  });

  it('uses the SDK of the project and the site reference when it is on the current line', async () => {
    const h = harness({ workspace: [{ product: 'js-maps-sdk', package: '@arcgis/core', version: '5.0.1', file: 'package.json' }] });
    const response = await lookup(h, { symbol: 'FeatureLayer' });
    expect(response.record.source).toBe('core');
    expect(response.page.notices).toContain('Version 5.0.1 was detected in the project.');
    expect(h.adapter('astro').calls.at(-1)?.version).toBe('5.0.1');
  });

  it('reads versioned packages first when a version is asked for', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk', version: '4.33' });
    expect(response.record.source).toBe('typings');
    expect(response.page).toMatchObject({ source: 'typings', version: '4.33.2' });
    expect(h.adapter('npm-dts').calls.at(-1)).toMatchObject({ method: 'read', version: '4.33', line: 'latest' });
    expect(h.adapter('astro').count('read')).toBe(0);
  });

  it('rejects a version no source can answer for', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'ArcGISMap', product: 'rest-api', version: '9.9' }));
    expect(error.code).toBe('VERSION_UNAVAILABLE');
  });

  it('uses the line of the requested version and never the website sources of a link-only line', async () => {
    const archived = makeLine({ id: 'v4', label: '4.x', current: false, access: 'link-only' });
    const product = makeProduct({
      lines: [makeLine(), archived],
      sources: [
        makeSource('astro', { base: '/widgets/' }, { id: 'site', kinds: ['api'] }),
        makeSource('npm-dts', { package: '@x/widgets', docUrl: '/widgets/{path}/' }, { id: 'typings', kinds: ['api'], floor: false, capability: 'package-cdn' }),
      ],
    });
    const ref = 'https://developers.arcgis.com/widgets/Gadget/';
    const record = (source: string, line: string) => makeRecord({ ref, source, line, kind: 'api', title: 'Gadget', symbol: 'Gadget', qualified: 'Gadget' });
    const h = makeHarness({ products: [product], records: [record('site', 'latest'), record('site', 'v4'), record('typings', 'v4')] });
    h.adapter('npm-dts').addPage(makeDocPage({ url: ref, markdown: '# Gadget\n\nFrom typings.' }));
    const response = await lookup(h, { symbol: 'Gadget', product: 'widgets-sdk', version: 'v4' });
    expect(response.page.source).toBe('typings');
    expect(h.adapter('npm-dts').calls.at(-1)).toMatchObject({ method: 'read', line: 'v4', version: 'v4' });
    expect(h.adapter('astro').count()).toBe(0);
  });
});

describe('lookup: errors', () => {
  it('raises AMBIGUOUS_SYMBOL with copyable candidates', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'goTo', product: 'js-maps-sdk' }));
    expect(error.code).toBe('AMBIGUOUS_SYMBOL');
    expect(error.details?.candidates).toEqual([
      '{"symbol":"MapView.goTo","product":"js-maps-sdk"}',
      '{"symbol":"SceneView.goTo","product":"js-maps-sdk"}',
    ]);
    expect(error.details?.next).toBe('arcgis_docs_lookup_symbol({"symbol":"MapView.goTo","product":"js-maps-sdk","detail":"summary"})');
    expect(h.adapter('astro').count('read')).toBe(0);
  });

  it('lists at most eight candidates', async () => {
    const records = Array.from({ length: 11 }, (_, i) =>
      makeRecord({ ref: `https://developers.arcgis.com/widgets/t${i}/`, kind: 'api', symbol: 'render', qualified: `Type${i}.render`, parent: `Type${i}` }),
    );
    const h = makeHarness({ products: [makeProduct()], records });
    const error = await failure(lookup(h, { symbol: 'render', product: 'widgets-sdk' }));
    expect(error.details?.candidates).toHaveLength(8);
  });

  it('raises SYMBOL_NOT_FOUND with nearby names, a search to try, and the caveat', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'FeatureTable', product: 'js-maps-sdk' }));
    expect(error.code).toBe('SYMBOL_NOT_FOUND');
    expect(error.details?.why).toContain('This does not prove it does not exist');
    expect(error.details?.candidates?.length).toBeGreaterThan(0);
    expect(error.details?.candidates?.length).toBeLessThanOrEqual(5);
    expect(error.details?.candidates).toContain('FeatureLayer');
    expect(error.details?.next).toBe('arcgis_docs_search({"query":"FeatureTable","product":"js-maps-sdk","kind":"api"})');
    expect(error.details?.retryable).toBe(false);
  });

  it('suggests members of the type when only the member is unknown', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'FeatureLayer.applyChanges', product: 'js-maps-sdk' }));
    expect(error.details?.why).toContain('FeatureLayer is documented but no member with this name was found');
    expect(error.details?.candidates).toEqual([
      'FeatureLayer.queryFeatures',
      'FeatureLayer.applyEdits',
      'FeatureLayer.featureReduction',
    ]);
    const near = await failure(lookup(h, { symbol: 'FeatureLayer.applyEditsNow', product: 'js-maps-sdk' }));
    expect(near.details?.candidates).toEqual(['FeatureLayer.applyEdits']);
  });

  it('says when the reference index is not ready, and that a retry may work', async () => {
    const h = harness({ config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } } });
    const release = h.adapter('astro').block('enumerate');
    const error = await failure(lookup(h, { symbol: 'MapView', product: 'js-maps-sdk' }));
    expect(error.code).toBe('SYMBOL_NOT_FOUND');
    expect(error.details?.why).toContain('js-maps-sdk/core');
    expect(error.details?.retryable).toBe(true);
    release();
    await h.index.idle();
    expect((await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' })).record.qualified).toBe('FeatureLayer');
  });

  it('raises SYMBOL_NOT_FOUND when no product can be determined', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'zzzUnknownThing' }));
    expect(error.code).toBe('SYMBOL_NOT_FOUND');
    expect(error.details?.why).toContain('no product');
  });

  it('rejects an unknown product', async () => {
    const h = harness();
    expect((await failure(lookup(h, { symbol: 'Map', product: 'nope' }))).code).toBe('UNKNOWN_PRODUCT');
  });
});

describe('lookup: content ladder', () => {
  it('reads the same symbol from another source when the first fails', async () => {
    const h = harness();
    h.adapter('astro').failOn('read', unavailable);
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' });
    expect(response.record.source).toBe('core');
    expect(response.page.source).toBe('typings');
    expect(response.text).toContain('From the typings of the package.');
    expect(response.page.notices).toContain('Read from Core typings: UPSTREAM_UNAVAILABLE: developers.arcgis.com is not responding.');
  });

  it('uses the declared fallback source for a symbol only the site lists', async () => {
    const h = harness();
    h.adapter('astro').failOn('read', unavailable);
    h.adapter('npm-dts').addPage(makeDocPage({ url: `${CORE}/views/MapView/`, markdown: '# MapView\n\nTypings of the view.' }));
    const response = await lookup(h, { symbol: 'MapView', product: 'js-maps-sdk' });
    expect(response.text).toContain('Typings of the view.');
    expect(response.page.source).toBe('typings');
  });

  it('skips a source whose capability is off', async () => {
    const h = harness({ enabled: ['package-cdn'] });
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' });
    expect(response.page.source).toBe('typings');
    expect(h.adapter('astro').count()).toBe(0);
  });

  it.each([
    ['an unreachable upstream', unavailable],
    ['a refusing upstream', new McpDocError('UPSTREAM_BLOCKED', 'refused', { retryable: false })],
    ['a page that has gone', new McpDocError('DOC_NOT_FOUND', 'gone')],
    ['an adapter crash', new TypeError('boom')],
  ])('answers with the link and what the index knows after %s', async (_name, error) => {
    const h = harness();
    h.adapter('astro').failOn('read', error);
    h.adapter('npm-dts').failOn('read', error);
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' });
    expect(response.page.degraded?.level).toBe('link-only');
    expect(response.page).toMatchObject({ title: 'FeatureLayer', url: FL_URL, product: 'js-maps-sdk' });
    expect(response.page.notices).toContain('From the index: A layer of features from a service or client-side graphics.');
    expect(response.text).toContain(`Open it directly: <${FL_URL}>`);
  });
});
