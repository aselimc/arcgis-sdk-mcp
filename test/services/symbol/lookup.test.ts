import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SymbolRequest } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import {
  makeDocPage,
  makeLine,
  makeProduct,
  makeRecord,
  makeSource,
} from '../../support/builders.js';
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

describe('lookup: answers', () => {
  it('returns a type as its own documentation plus a member index', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer', product: 'javascript' });
    expect(response.record).toMatchObject({ qualified: 'FeatureLayer', source: 'core' });
    expect(response.resolvedProduct).toMatchObject({
      product: { id: 'js-maps-sdk' },
      resolvedFrom: 'javascript',
      how: 'alias',
    });
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
    const response = await lookup(h, {
      symbol: 'FeatureLayer.queryFeatures',
      product: 'js-maps-sdk',
    });
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
    const member = await lookup(h, {
      symbol: 'FeatureLayer.queryFeatures',
      product: 'js-maps-sdk',
      detail: 'signature',
    });
    expect(member.text).toBe(
      '### queryFeatures\n\n```ts\nqueryFeatures(query?: Query): Promise<FeatureSet>\n```\n\nRuns a query against the layer.',
    );
    expect(member.next).toBe(
      'arcgis_docs_lookup_symbol({"symbol":"FeatureLayer.queryFeatures","product":"js-maps-sdk","detail":"summary"})',
    );

    const type = await lookup(h, {
      symbol: 'FeatureLayer',
      product: 'js-maps-sdk',
      detail: 'signature',
    });
    expect(type.text).toBe(
      '# FeatureLayer\n\nA layer of features from a service.\n\n```ts\nclass FeatureLayer extends Layer\n```',
    );
  });

  it('returns everything for detail "full" and points at the reader when it is cut', async () => {
    const h = harness();
    const full = await lookup(h, {
      symbol: 'FeatureLayer',
      product: 'js-maps-sdk',
      detail: 'full',
    });
    expect(full.text).toContain('#### Parameters');
    expect(full.text).toContain('### applyEdits');
    expect(full.next).toBeUndefined();

    const cut = await lookup(h, {
      symbol: 'FeatureLayer',
      product: 'js-maps-sdk',
      detail: 'full',
      maxTokens: 60,
    });
    expect(cut.text).not.toContain('### applyEdits');
    // Regression: the Next of a cut lookup restarted the page from its top. It now carries
    // the cursor of the place where the text stopped, and says what was left out.
    expect(cut.text).toMatch(/_Cut at the token budget: about \d+ of \d+ tokens shown\. Not shown: .*applyEdits/);
    const next = /^arcgis_docs_read\((.*)\)$/.exec(cut.next ?? '')?.[1] ?? '{}';
    const args = JSON.parse(next) as { ref: string; view: 'full'; cursor: string };
    expect(args).toMatchObject({ ref: FL_URL, view: 'full' });
    const rest = await h.services.docs.read({ ...args, maxTokens: 6000 }, h.call());
    expect(rest.text).toContain('### applyEdits');
    const shown = cut.text.slice(0, cut.text.indexOf('\n\n_Cut at the token budget'));
    expect(`${shown}\n\n${rest.text}`).toBe(full.text);

    const summary = await lookup(h, {
      symbol: 'FeatureLayer',
      product: 'js-maps-sdk',
      maxTokens: 60,
    });
    expect(summary.next).toBe(
      'arcgis_docs_lookup_symbol({"symbol":"FeatureLayer","product":"js-maps-sdk","detail":"full"})',
    );
  });

  it('puts the header block of the page first', async () => {
    const h = harness();
    h.adapter('astro').addPage({
      ...featureLayerPage(),
      header: 'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";',
    });
    const response = await lookup(h, { symbol: 'FeatureLayer.applyEdits', product: 'js-maps-sdk' });
    expect(response.text).toBe(
      'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";\n\n### applyEdits\n\nSends edits to the service.',
    );
  });

  it('uses the adapter own symbol method when it has one', async () => {
    const h = harness({ adapters: { astro: { ownSymbol: true } } });
    await lookup(h, { symbol: 'MapView.goTo', product: 'js-maps-sdk', detail: 'full' }).catch(
      () => undefined,
    );
    expect(h.adapter('astro').calls.at(-1)).toMatchObject({
      method: 'symbol',
      detail: 'full',
      ref: `${CORE}/views/MapView/#goTo`,
    });
  });

  it('adds what it read to the body index', async () => {
    const h = harness();
    await lookup(h, { symbol: 'FeatureLayer', product: 'js-maps-sdk' });
    expect(
      h.index.queryBodies({ text: 'sends edits', products: ['js-maps-sdk'], limit: 3 })[0]?.ref,
    ).toBe(`${FL_URL}#applyedits`);
  });

  it('says so when the name was matched loosely, and lists alternates', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'featurelayr', product: 'js-maps-sdk' });
    expect(response.record.qualified).toBe('FeatureLayer');
    expect(response.page.notices).toContain('"featurelayr" was matched to FeatureLayer.');

    h.adapter('astro').addPage(
      makeDocPage({ url: `${CORE}/geometry/Point/`, markdown: '# Point\n\nA location.' }),
    );
    const point = await lookup(h, { symbol: 'Point', product: 'js-maps-sdk' });
    expect(point.alternates.map((record) => record.qualified)).toEqual(['smartMapping.Point']);
  });
});

describe('lookup: scope and versions', () => {
  it('finds the product from the symbol when none is given', async () => {
    const h = harness();
    const response = await lookup(h, { symbol: 'FeatureLayer.applyEdits' });
    expect(response.record.product).toBe('js-maps-sdk');
    expect(response.resolvedProduct).toMatchObject({
      product: { id: 'js-maps-sdk' },
      how: 'fuzzy',
    });
  });

  it('uses the SDK of the project and the site reference when it is on the current line', async () => {
    const h = harness({
      workspace: [
        { product: 'js-maps-sdk', package: '@arcgis/core', version: '5.0.1', file: 'package.json' },
      ],
    });
    const response = await lookup(h, { symbol: 'FeatureLayer' });
    expect(response.record.source).toBe('core');
    expect(response.page.notices).toContain('Version 5.0.1 was detected in the project.');
    expect(h.adapter('astro').calls.at(-1)?.version).toBe('5.0.1');
  });

  it('reads versioned packages first when a version is asked for', async () => {
    const h = harness();
    const response = await lookup(h, {
      symbol: 'FeatureLayer',
      product: 'js-maps-sdk',
      version: '4.33',
    });
    expect(response.record.source).toBe('typings');
    expect(response.page).toMatchObject({ source: 'typings', version: '4.33.2' });
    expect(h.adapter('npm-dts').calls.at(-1)).toMatchObject({
      method: 'read',
      version: '4.33',
      line: 'latest',
    });
    expect(h.adapter('astro').count('read')).toBe(0);
  });

  // Regression: `FeatureLayer.queryFeatures` with a version answered from the website (the
  // current release), or not at all, because package typings list modules and no members.
  describe('a member of a type that only the versioned typings can answer for', () => {
    const typingsWithMembers = (): DocPage =>
      makeDocPage({
        url: FL_URL,
        kind: 'api',
        product: 'js-maps-sdk',
        source: 'typings',
        version: '4.33.2',
        license: 'esri-ma',
        markdown:
          '### queryFeatures\n\n```ts\nqueryFeatures(query?: Query): Promise<FeatureSet>;\n```\n\nAs declared in 4.33.',
        members: [{ id: 'queryFeatures', name: 'queryFeatures', kind: 'method' }],
      });

    it('reads the member out of the typings of the requested version', async () => {
      const h = harness();
      h.adapter('npm-dts').addPage(typingsWithMembers());
      const response = await lookup(h, {
        symbol: 'FeatureLayer.queryFeatures',
        product: 'js-maps-sdk',
        version: '4.33',
      });
      expect(response.record).toMatchObject({
        source: 'typings',
        qualified: 'FeatureLayer.queryFeatures',
        parent: 'FeatureLayer',
      });
      expect(response.page).toMatchObject({ source: 'typings', version: '4.33.2' });
      expect(response.text).toContain('As declared in 4.33.');
      expect(h.adapter('npm-dts').calls.at(-1)?.target).toMatchObject({
        select: { member: 'queryFeatures' },
      });
      expect(h.adapter('astro').count('read')).toBe(0);
    });

    it('answers from the website, and says so, when the typings do not have the member', async () => {
      const h = harness();
      const response = await lookup(h, {
        symbol: 'FeatureLayer.queryFeatures',
        product: 'js-maps-sdk',
        version: '4.33',
      });
      expect(response.record.source).toBe('core');
      expect(response.page.notices).toContain(
        'Version 4.33 of this member could not be read from the package; this is the documentation of the current release.',
      );
    });

    it('finds a member of a type that is indexed without members', async () => {
      const product = makeProduct({
        sources: [
          makeSource(
            'npm-dts',
            { package: '@x/widgets', docUrl: '/widgets/{path}/' },
            { id: 'typings', kinds: ['api'], capability: 'package-cdn' },
          ),
        ],
      });
      const ref = 'https://developers.arcgis.com/widgets/Gadget/';
      const h = makeHarness({
        products: [product],
        records: [
          makeRecord({
            ref,
            source: 'typings',
            kind: 'api',
            title: 'Gadget',
            symbol: 'Gadget',
            qualified: '@x/widgets/Gadget',
          }),
        ],
      });
      h.adapter('npm-dts').addPage(
        makeDocPage({
          url: ref,
          markdown: '### spin\n\n```ts\nspin(turns: number): void;\n```',
          members: [
            { id: 'spin', name: 'spin', kind: 'method' },
            { id: 'spinUp', name: 'spinUp', kind: 'method' },
          ],
        }),
      );
      const found = await lookup(h, { symbol: 'Gadget.spin', product: 'widgets-sdk' });
      expect(found.record.qualified).toBe('@x/widgets/Gadget.spin');
      expect(found.text).toContain('spin(turns: number): void;');

      const missing = await failure(lookup(h, { symbol: 'Gadget.spinn', product: 'widgets-sdk' }));
      expect(missing.code).toBe('SYMBOL_NOT_FOUND');
      expect(missing.details?.candidates).toEqual([
        '@x/widgets/Gadget.spin',
        '@x/widgets/Gadget.spinUp',
      ]);
    });
  });

  it('rejects a version no source can answer for', async () => {
    const h = harness();
    const error = await failure(
      lookup(h, { symbol: 'ArcGISMap', product: 'rest-api', version: '9.9' }),
    );
    expect(error.code).toBe('VERSION_UNAVAILABLE');
  });

  it('uses the line of the requested version and never the website sources of a link-only line', async () => {
    const archived = makeLine({ id: 'v4', label: '4.x', current: false, access: 'link-only' });
    const product = makeProduct({
      lines: [makeLine(), archived],
      sources: [
        makeSource('astro', { base: '/widgets/' }, { id: 'site', kinds: ['api'] }),
        makeSource(
          'npm-dts',
          { package: '@x/widgets', docUrl: '/widgets/{path}/' },
          { id: 'typings', kinds: ['api'], floor: false, capability: 'package-cdn' },
        ),
      ],
    });
    const ref = 'https://developers.arcgis.com/widgets/Gadget/';
    const record = (source: string, line: string) =>
      makeRecord({
        ref,
        source,
        line,
        kind: 'api',
        title: 'Gadget',
        symbol: 'Gadget',
        qualified: 'Gadget',
      });
    const h = makeHarness({
      products: [product],
      records: [record('site', 'latest'), record('site', 'v4'), record('typings', 'v4')],
    });
    h.adapter('npm-dts').addPage(makeDocPage({ url: ref, markdown: '# Gadget\n\nFrom typings.' }));
    const response = await lookup(h, { symbol: 'Gadget', product: 'widgets-sdk', version: 'v4' });
    expect(response.page.source).toBe('typings');
    expect(h.adapter('npm-dts').calls.at(-1)).toMatchObject({
      method: 'read',
      line: 'v4',
      version: 'v4',
    });
    expect(h.adapter('astro').count()).toBe(0);
  });
});
