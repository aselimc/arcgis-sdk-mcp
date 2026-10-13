import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SymbolRequest } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import { makeDocPage, makeProduct, makeRecord } from '../../support/builders.js';
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
      {
        id: 'queryfeatures',
        name: 'queryFeatures',
        kind: 'method',
        summary: 'Runs a query against the layer.',
      },
      {
        id: 'applyedits',
        name: 'applyEdits',
        kind: 'method',
        summary: 'Sends edits to the service.',
      },
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
    markdown:
      '# FeatureLayer\n\n```ts\nexport default class FeatureLayer {}\n```\n\nFrom the typings of the package.',
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

const unavailable = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com is not responding',
  {
    why: 'timeout',
    retryable: true,
  },
);

describe('lookup: errors', () => {
  it('raises AMBIGUOUS_SYMBOL with copyable candidates', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'goTo', product: 'js-maps-sdk' }));
    expect(error.code).toBe('AMBIGUOUS_SYMBOL');
    expect(error.details?.candidates).toEqual([
      '{"symbol":"MapView.goTo","product":"js-maps-sdk"}',
      '{"symbol":"SceneView.goTo","product":"js-maps-sdk"}',
    ]);
    expect(error.details?.next).toBe(
      'arcgis_docs_lookup_symbol({"symbol":"MapView.goTo","product":"js-maps-sdk","detail":"summary"})',
    );
    expect(h.adapter('astro').count('read')).toBe(0);
  });

  it('lists at most eight candidates', async () => {
    const records = Array.from({ length: 11 }, (_, i) =>
      makeRecord({
        ref: `https://developers.arcgis.com/widgets/t${i}/`,
        kind: 'api',
        symbol: 'render',
        qualified: `Type${i}.render`,
        parent: `Type${i}`,
      }),
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
    expect(error.details?.next).toBe(
      'arcgis_docs_search({"query":"FeatureTable","product":"js-maps-sdk","kind":"api"})',
    );
    expect(error.details?.retryable).toBe(false);
  });

  it('suggests members of the type when only the member is unknown', async () => {
    const h = harness();
    const error = await failure(
      lookup(h, { symbol: 'FeatureLayer.applyChanges', product: 'js-maps-sdk' }),
    );
    expect(error.details?.why).toContain(
      'FeatureLayer is documented but no member with this name was found',
    );
    expect(error.details?.candidates).toEqual([
      'FeatureLayer.queryFeatures',
      'FeatureLayer.applyEdits',
      'FeatureLayer.featureReduction',
    ]);
    const near = await failure(
      lookup(h, { symbol: 'FeatureLayer.applyEditsNow', product: 'js-maps-sdk' }),
    );
    expect(near.details?.candidates).toEqual(['FeatureLayer.applyEdits']);
  });

  it('says when the reference index is not ready, and that a retry may work', async () => {
    const h = harness({
      config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } },
    });
    const release = h.adapter('astro').block('enumerate');
    const error = await failure(lookup(h, { symbol: 'MapView', product: 'js-maps-sdk' }));
    expect(error.code).toBe('SYMBOL_NOT_FOUND');
    expect(error.details?.why).toContain('js-maps-sdk/core');
    expect(error.details?.retryable).toBe(true);
    release();
    await h.index.idle();
    expect(
      (await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' })).record.qualified,
    ).toBe('FeatureLayer');
  });

  it('raises SYMBOL_NOT_FOUND when no product can be determined', async () => {
    const h = harness();
    const error = await failure(lookup(h, { symbol: 'zzzUnknownThing' }));
    expect(error.code).toBe('SYMBOL_NOT_FOUND');
    expect(error.details?.why).toContain('no product');
  });

  it('rejects an unknown product', async () => {
    const h = harness();
    expect((await failure(lookup(h, { symbol: 'Map', product: 'nope' }))).code).toBe(
      'UNKNOWN_PRODUCT',
    );
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
    expect(response.page.notices).toContain(
      'Read from Core typings: UPSTREAM_UNAVAILABLE: developers.arcgis.com is not responding.',
    );
  });

  it('uses the declared fallback source for a symbol only the site lists', async () => {
    const h = harness();
    h.adapter('astro').failOn('read', unavailable);
    h.adapter('npm-dts').addPage(
      makeDocPage({ url: `${CORE}/views/MapView/`, markdown: '# MapView\n\nTypings of the view.' }),
    );
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
    expect(response.page).toMatchObject({
      title: 'FeatureLayer',
      url: FL_URL,
      product: 'js-maps-sdk',
    });
    expect(response.page.notices).toContain(
      'From the index: A layer of features from a service or client-side graphics.',
    );
    expect(response.text).toContain(`Open it directly: <${FL_URL}>`);
  });
});
