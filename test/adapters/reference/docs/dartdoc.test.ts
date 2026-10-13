import { describe, expect, it } from 'vitest';
import { dartdocAdapter, dartdocRecords } from '../../../../src/adapters/reference/dartdoc.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/reference/';
const INDEX = `${BASE}index.json`;
const CLASS_PAGE = `${BASE}widgets_sdk/Widget-class.html`;

const source = makeSource(
  'dartdoc',
  { base: '/widgets/{prefix}api-reference/reference/', index: 'index.json' },
  {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: INDEX, expect: 'json', minRecords: 5 },
  },
);
const latest = makeLine({ vars: { prefix: '' } });
const product = makeProduct({ sources: [source], lines: [latest] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'dartdoc.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, latest);

describeReferenceContract('dartdoc', () => ({
  adapter: dartdocAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 9,
  readRef: CLASS_PAGE,
  siteIndexFiles: [INDEX],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INDEX]: { json: [{ title: 'Widget', url: 'widgets_sdk/Widget-class.html' }] },
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
      arrange: (ctx) => replaceResponses(ctx, cassette(), { [INDEX]: { json: [] } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
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

describe('dartdoc: enumerate', () => {
  it('lists libraries, types and members with the names used in Dart code', async () => {
    const ctx = ctxOf();
    const records = await dartdocAdapter.enumerate!(ctx, bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(records.map((record) => record.title)).toEqual([
      'widgets_sdk',
      'Widget',
      'Widget.new',
      'Widget.fromJson',
      'Widget.size',
      'Widget.resize',
      'WidgetShape',
      'WidgetShape.round',
      'createWidget',
    ]);
    expect(byTitle.get('widgets_sdk')).toMatchObject({
      ref: `${BASE}widgets_sdk/`,
      symbolKind: 'library',
      qualified: 'widgets_sdk',
    });
    expect(byTitle.get('Widget')).toMatchObject({
      ref: CLASS_PAGE,
      symbol: 'Widget',
      qualified: 'widgets_sdk.Widget',
      symbolKind: 'class',
      breadcrumb: 'widgets_sdk',
      description: 'A widget holds parts.',
    });
    expect(byTitle.get('Widget')?.parent).toBeUndefined();
    // The index repeats the type name for constructors; the qualified name does not.
    expect(byTitle.get('Widget.fromJson')).toMatchObject({
      symbol: 'fromJson',
      qualified: 'widgets_sdk.Widget.fromJson',
      parent: 'widgets_sdk.Widget',
      symbolKind: 'constructor',
      breadcrumb: 'widgets_sdk > Widget',
    });
    expect(byTitle.get('Widget.resize')).toMatchObject({
      ref: `${BASE}widgets_sdk/Widget/resize.html`,
      symbolKind: 'method',
      description: 'Changes the size.',
    });
    expect(byTitle.get('WidgetShape.round')).toMatchObject({
      ref: `${BASE}widgets_sdk/WidgetShape.html#round`,
      parent: 'widgets_sdk.WidgetShape',
      symbolKind: 'constant',
    });
    expect(byTitle.get('createWidget')).toMatchObject({ symbolKind: 'function' });
    expect(byTitle.get('createWidget')?.parent).toBeUndefined();
    expect(ctx.http.count()).toBe(1);
  });

  it('resolves the index under the version line of the source', async () => {
    const v200 = makeLine({ id: 'v200', label: '200.x', current: false, vars: { prefix: 'v200/' } });
    const ctx = makeCtx();
    const url = 'https://developers.arcgis.com/widgets/v200/api-reference/reference/index.json';
    ctx.http.on(url, { json: [{ name: 'Old', qualifiedName: 'lib.Old', href: 'lib/Old.html', kind: 3 }] });
    const records = await dartdocAdapter.enumerate!(ctx, bindSource(product, source, v200));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ref: 'https://developers.arcgis.com/widgets/v200/api-reference/reference/lib/Old.html',
      line: 'v200',
      symbolKind: 'class',
    });
  });

  it('keeps entries of unknown kind and tolerates malformed ones', () => {
    const records = dartdocRecords(bound(), [
      null,
      'text',
      { name: 'Topic', href: 'topics/Topic-topic.html', kind: 18 },
      { name: 'x', qualifiedName: 'lib.Mix.x', href: 'lib/Mix/x.html', enclosedBy: { name: 'Mix', kind: 11 } },
      { name: '', href: 'lib/empty.html' },
    ]);

    expect(records.map((record) => [record.title, record.symbolKind, record.parent])).toEqual([
      ['Topic', 'symbol', undefined],
      ['Mix.x', 'symbol', 'lib.Mix'],
    ]);
  });

  it('fails when the index is not a list', async () => {
    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), { [INDEX]: { json: { entries: [] } } });
    await expect(dartdocAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: INDEX, retryable: false },
    });
  });
});

describe('dartdoc: read, symbol and probe', () => {
  it('reads a page as HTML with the dartdoc family hint', async () => {
    const ctx = ctxOf();
    const page = await dartdocAdapter.read(ctx, bound(), {
      url: new URL(CLASS_PAGE),
      select: { member: 'resize' },
      detail: 'summary',
    });
    const [call] = rendererOf(ctx).calls;

    expect(call).toMatchObject({
      kind: 'html',
      input: { familyHint: 'dartdoc' },
      meta: { url: CLASS_PAGE, kind: 'api', product: 'widgets-sdk', source: 'api', line: 'latest' },
      opts: { select: { member: 'resize' }, detail: 'summary' },
    });
    expect(page.ref).toBe(CLASS_PAGE);
    expect(page.attribution).toContain(CLASS_PAGE);
  });

  it('selects a member that shares its page by the anchor of its ref', async () => {
    const ctx = ctxOf();
    const records = await dartdocAdapter.enumerate!(ctx, bound());
    const round = records.find((record) => record.title === 'WidgetShape.round')!;
    const type = records.find((record) => record.title === 'Widget')!;
    await dartdocAdapter.symbol!(ctx, bound(), round, 'signature');
    await dartdocAdapter.symbol!(ctx, bound(), type, 'full');
    const [member, whole] = rendererOf(ctx).calls;

    expect(member?.meta.url).toBe(`${BASE}widgets_sdk/WidgetShape.html#round`);
    expect(member?.opts).toEqual({ select: { member: 'round' }, detail: 'signature' });
    expect(whole?.opts).toEqual({ detail: 'full' });
  });

  it('reports the page a redirect led to as the ref', async () => {
    const ctx = makeCtx();
    const moved = `${BASE}widgets_sdk/Widget-class.html`;
    ctx.http.on(`${BASE}widgets_sdk/Widget.html`, {
      body: '<html><body><main><h1>Widget</h1></main></body></html>',
      finalUrl: moved,
      aliasChain: [`${BASE}widgets_sdk/Widget.html`],
    });
    const page = await dartdocAdapter.read(ctx, bound(), {
      url: new URL(`${BASE}widgets_sdk/Widget.html#size`),
    });

    expect(page.ref).toBe(`${moved}#size`);
    expect(page.redirectedFrom).toEqual([`${BASE}widgets_sdk/Widget.html`]);
  });

  it('probes the index and counts its entries', async () => {
    const ctx = ctxOf();
    const result = await dartdocAdapter.probe(ctx, bound());

    expect(result).toMatchObject({ ok: true, records: 12 });
    expect(ctx.http.count()).toBe(1);
  });

  it('fails the probe when the index is smaller than the registry expects', async () => {
    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), { [INDEX]: { json: [{ name: 'only' }] } });
    const result = await dartdocAdapter.probe(ctx, bound());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Expected at least 5 records, found 1');
  });

  it('checks length, marker and family of a page canary', async () => {
    const page = { ...source, probe: { url: 'widgets_sdk/Widget-class.html', expect: 'html' as const } };
    const probeWith = async (probe: Partial<typeof source.probe>) => {
      const ctx = ctxOf();
      rendererOf(ctx).family = 'dartdoc';
      const src = bindSource(product, { ...page, probe: { ...page.probe, ...probe } }, latest);
      return dartdocAdapter.probe(ctx, src);
    };

    expect(await probeWith({ family: 'dartdoc', mustContain: 'Widget' })).toMatchObject({
      ok: true,
      family: 'dartdoc',
    });
    expect((await probeWith({ family: 'dokka' })).error).toBe(
      'Expected page family dokka, detected dartdoc',
    );
    expect((await probeWith({ mustContain: 'Gadget' })).error).toBe(
      'The response does not contain "Gadget"',
    );
    expect((await probeWith({ minChars: 100_000 })).error).toMatch(/^Expected at least 100000 char/);
  });
});
