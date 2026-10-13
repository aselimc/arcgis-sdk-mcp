import { describe, expect, it } from 'vitest';
import { doccAdapter, doccLocation, doccRecords } from '../../../../src/adapters/reference/docc.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/swift/';
const INDEX = `${BASE}index/index.json`;
const DOCS = `${BASE}documentation/widgets/`;
const WIDGET = `${DOCS}widget/`;
const WIDGET_DATA = `${BASE}data/documentation/widgets/widget.json`;

const source = makeSource(
  'docc',
  { base: '/widgets/api-reference/swift/' },
  {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: INDEX, expect: 'json', mustContain: 'interfaceLanguages', minRecords: 5 },
  },
);
const product = makeProduct({ sources: [source] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'docc.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('docc', () => ({
  adapter: doccAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 11,
  readRef: WIDGET,
  siteIndexFiles: [INDEX],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INDEX]: { json: { languages: { swift: [{ path: '/documentation/widgets', title: 'W' }] } } },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(INDEX, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), { [INDEX]: { json: { interfaceLanguages: { swift: [] } } } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      // The archive's host answers every unknown path with its client-rendered shell.
      arrange: (ctx) => ctx.http.fail(INDEX, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    oversizedBody: {
      arrange: (ctx) => ctx.http.fail(INDEX, 'oversized'),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    secondary5xx: { notApplicable: 'the index is a single file' },
  },
}));

describe('docc: enumerate', () => {
  it('walks the navigator tree into qualified symbols, skipping group markers and repeats', async () => {
    const ctx = ctxOf();
    const records = await doccAdapter.enumerate!(ctx, bound());

    expect(
      records.map((record) => [record.title, record.symbolKind ?? record.kind, record.parent ?? null]),
    ).toEqual([
      ['Widgets', 'module', null],
      ['Getting Started', 'guide', null],
      ['Widget', 'class', null],
      ['Widget.init', 'initializer', 'Widget'],
      ['Widget.size', 'property', 'Widget'],
      ['Widget.resize', 'method', 'Widget'],
      ['Widget.==', 'operator', 'Widget'],
      ['Widget.Shape', 'enum', 'Widget'],
      ['Widget.Shape.round', 'case', 'Widget.Shape'],
      ['View Implementations', 'api', null],
      ['Widget.padding', 'method', 'Widget'],
      ['makeWidget', 'function', null],
    ]);
    expect(ctx.http.count()).toBe(1);
  });

  it('builds public page URLs and keeps the declaration as description', async () => {
    const records = await doccAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('Widget')).toMatchObject({ ref: WIDGET, symbol: 'Widget', breadcrumb: 'Widgets' });
    expect(byTitle.get('Widget')?.description).toBeUndefined();
    expect(byTitle.get('Widget.resize')).toMatchObject({
      ref: `${WIDGET}resize(to:)/`,
      symbol: 'resize',
      qualified: 'Widget.resize',
      description: 'func resize(to: Int) -> Widget',
      breadcrumb: 'Widgets > Widget',
    });
    expect(byTitle.get('Widget.init')).toMatchObject({ symbol: 'init', ref: `${WIDGET}init(size:)/` });
    expect(byTitle.get('Widget.Shape.round')?.breadcrumb).toBe('Widgets > Widget > Widget.Shape');
    expect(byTitle.get('Getting Started')).toMatchObject({ kind: 'guide', ref: `${DOCS}gettingstarted/` });
    expect(byTitle.get('Getting Started')?.symbol).toBeUndefined();
  });

  it('honours maxDepth, which drops what a type inherits', async () => {
    const shallow = makeSource('docc', { base: '/widgets/api-reference/swift/', maxDepth: 3 }, {
      id: 'api',
      probe: source.probe,
    });
    const records = await doccAdapter.enumerate!(ctxOf(), bindSource(product, shallow, makeLine()));
    const titles = records.map((record) => record.title);

    expect(titles).toContain('Widget.resize');
    expect(titles).toContain('Widget.Shape');
    expect(titles).not.toContain('Widget.padding');
    expect(titles).not.toContain('Widget.Shape.round');
  });

  it('reads every interface language and tolerates malformed nodes', () => {
    const records = doccRecords(bound(), [
      null,
      { children: [{ path: '/documentation/widgets/gadget', title: 'Gadget' }] },
      { path: '/documentation/widgets/tour', title: 'Tour', type: 'tutorial' },
      { path: 7, title: 'No path' },
    ]);

    expect(records.map((record) => [record.title, record.kind, record.symbolKind])).toEqual([
      ['Gadget', 'api', undefined],
      ['Tour', 'tutorial', undefined],
    ]);
  });
});

describe('docc: read', () => {
  it('fetches the render JSON of a page and hands it to the docc renderer', async () => {
    const ctx = ctxOf();
    const page = await doccAdapter.read(ctx, bound(), {
      url: new URL(`${DOCS}Widget/#overview`),
      detail: 'summary',
    });
    const [call] = rendererOf(ctx).calls;

    expect(ctx.http.requests.map((request) => request.url)).toEqual([WIDGET_DATA]);
    expect(call).toMatchObject({
      kind: 'docc',
      input: { json: { kind: 'symbol', metadata: { title: 'Widget' } } },
      meta: { url: `${WIDGET}#overview`, kind: 'api' },
      opts: { detail: 'summary' },
    });
    expect(page.ref).toBe(`${WIDGET}#overview`);
    expect(page.url).toBe(WIDGET);
  });

  it('accepts the data URL itself and classifies an article as a guide', async () => {
    const ctx = ctxOf();
    await doccAdapter.read(ctx, bound(), {
      url: new URL(`${BASE}data/documentation/widgets/gettingstarted.json`),
    });

    expect(rendererOf(ctx).calls[0]?.meta).toMatchObject({
      url: `${DOCS}gettingstarted/`,
      kind: 'guide',
    });
  });

  it('reads a symbol record without a selector, keeping the record kind', async () => {
    const ctx = ctxOf();
    const records = await doccAdapter.enumerate!(ctx, bound());
    await doccAdapter.symbol!(ctx, bound(), records.find((r) => r.title === 'Widget')!, 'signature');

    expect(rendererOf(ctx).calls[0]?.opts).toEqual({ detail: 'signature' });
    expect(rendererOf(ctx).calls[0]?.meta.kind).toBe('api');
  });

  it.each([BASE, `${BASE}index/index.json`, 'https://developers.arcgis.com/other/documentation/x/'])(
    'answers %s with DOC_NOT_FOUND and a search to try',
    async (url) => {
      const ctx = ctxOf();
      await expect(doccAdapter.read(ctx, bound(), { url: new URL(url) })).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        details: { next: 'arcgis_docs_search({"query":"API reference","product":"widgets-sdk"})' },
      });
      expect(ctx.http.count()).toBe(0);
    },
  );

  it('maps public and data URLs onto each other', () => {
    expect(doccLocation(bound(), new URL(`${WIDGET}init(size:)/?language=swift#discussion`))).toEqual({
      page: `${WIDGET}init(size:)/`,
      data: `${BASE}data/documentation/widgets/widget/init(size:).json`,
    });
    expect(doccLocation(bound(), new URL(`${BASE}tutorials/widgets/first-steps`))).toEqual({
      page: `${BASE}tutorials/widgets/first-steps/`,
      data: `${BASE}data/tutorials/widgets/first-steps.json`,
    });
  });
});

describe('docc: probe', () => {
  it('counts the pages of the navigator tree', async () => {
    expect(await doccAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 13 });
  });

  it('falls back to the default count for other JSON', async () => {
    const data = { ...source, probe: { url: WIDGET_DATA, expect: 'json' as const } };
    const result = await doccAdapter.probe(ctxOf(), bindSource(product, data, makeLine()));
    expect(result).toMatchObject({ ok: true, records: 5 });
  });
});
