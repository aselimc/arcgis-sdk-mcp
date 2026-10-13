import { describe, expect, it } from 'vitest';
import { dokkaAdapter, dokkaRecords } from '../../../../src/adapters/reference/dokka.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/kotlin/';
const INDEX = `${BASE}scripts/pages.json`;
const PACKAGE = `${BASE}widgets-kotlin/com.example.widgets/`;
const CLASS_PAGE = `${PACKAGE}-widget/index.html`;

const source = makeSource(
  'dokka',
  { base: '/widgets/api-reference/kotlin/' },
  {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: INDEX, expect: 'json', minRecords: 10 },
  },
);
const product = makeProduct({ sources: [source] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'dokka.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('dokka', () => ({
  adapter: dokkaAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 12,
  readRef: CLASS_PAGE,
  siteIndexFiles: [INDEX],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INDEX]: { json: [{ title: 'class Widget', fqn: 'com.example.Widget', url: 'a.html' }] },
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

describe('dokka: enumerate', () => {
  it('derives kind, owner and title from the declaration and the qualified name', async () => {
    const records = await dokkaAdapter.enumerate!(ctxOf(), bound());

    expect(
      records.map((record) => [record.title, record.symbolKind, record.parent ?? null]),
    ).toEqual([
      ['Widget', 'class', null],
      ['Widget.Widget', 'constructor', 'com.example.widgets.Widget'],
      ['Widget.resize', 'method', 'com.example.widgets.Widget'],
      ['Widget.size', 'property', 'com.example.widgets.Widget'],
      ['Widget.grow', 'method', 'com.example.widgets.Widget'],
      ['Widget.Builder', 'class', 'com.example.widgets.Widget'],
      ['Widget.Builder.build', 'method', 'com.example.widgets.Widget.Builder'],
      ['WidgetShape', 'enum', null],
      ['WidgetShape.Round', 'enum-entry', 'com.example.widgets.WidgetShape'],
      ['Listener', 'interface', null],
      ['createWidget', 'function', null],
      ['WidgetId', 'typealias', null],
    ]);
  });

  it('takes page URLs from the index and keeps one record per page', async () => {
    const records = await dokkaAdapter.enumerate!(ctxOf(), bound());
    const resize = records.filter((record) => record.symbol === 'resize');
    const build = records.find((record) => record.symbol === 'build');

    // Two overloads share a page; the first declaration describes it.
    expect(resize).toHaveLength(1);
    expect(resize[0]).toMatchObject({
      ref: `${PACKAGE}-widget/resize.html`,
      qualified: 'com.example.widgets.Widget.resize',
      description: 'fun resize(size: Int): Widget',
      breadcrumb: 'com.example.widgets > Widget',
    });
    expect(build).toMatchObject({
      ref: `${PACKAGE}-widget/-builder/build.html`,
      breadcrumb: 'com.example.widgets > Widget > Builder',
    });
    expect(records.find((record) => record.symbol === 'Widget' && record.parent === undefined))
      .toMatchObject({ ref: CLASS_PAGE, breadcrumb: 'com.example.widgets' });
  });

  it('marks deprecated declarations and ignores keywords inside annotations', async () => {
    const records = await dokkaAdapter.enumerate!(ctxOf(), bound());
    const grow = records.find((record) => record.symbol === 'grow');

    expect(grow?.deprecated).toBe(true);
    expect(records.filter((record) => record.deprecated === true)).toHaveLength(1);
    const [annotated] = dokkaRecords(bound(), [
      { name: '@Suppress("class") val flag: Boolean', description: 'pkg.flag', location: 'pkg/flag.html' },
    ]);
    expect(annotated).toMatchObject({ symbolKind: 'property', title: 'flag' });
  });

  it('labels an entry without a declaration keyword and without an owner as a symbol', () => {
    const records = dokkaRecords(bound(), [
      null,
      { description: 'pkg.thing', location: 'pkg/thing.html' },
      { name: 'x', description: '', location: 'pkg/x.html' },
      { name: 'class Out', description: 'pkg.Out', location: 'https://example.com/out.html' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ title: 'thing', symbolKind: 'symbol', description: 'pkg.thing' });
  });
});

describe('dokka: read and probe', () => {
  it('reads a page as HTML with the dokka family hint', async () => {
    const ctx = ctxOf();
    const page = await dokkaAdapter.read(ctx, bound(), { url: new URL(CLASS_PAGE) });

    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'html',
      input: { familyHint: 'dokka' },
      meta: { url: CLASS_PAGE, kind: 'api' },
    });
    expect(rendererOf(ctx).calls[0]?.opts).toBeUndefined();
    expect(page.sections.length).toBeGreaterThan(0);
  });

  it('reads a member on its own page without a selector', async () => {
    const ctx = ctxOf();
    ctx.http.on(`${PACKAGE}-widget/resize.html`, { body: '<main><h1>resize</h1></main>' });
    const records = await dokkaAdapter.enumerate!(ctx, bound());
    const resize = records.find((record) => record.symbol === 'resize')!;
    await dokkaAdapter.symbol!(ctx, bound(), resize, 'summary');

    expect(rendererOf(ctx).calls[0]?.opts).toEqual({ detail: 'summary' });
    expect(rendererOf(ctx).calls[0]?.meta.url).toBe(`${PACKAGE}-widget/resize.html`);
  });

  it('probes the index', async () => {
    const ctx = ctxOf();
    expect(await dokkaAdapter.probe(ctx, bound())).toMatchObject({ ok: true, records: 14 });
  });
});
