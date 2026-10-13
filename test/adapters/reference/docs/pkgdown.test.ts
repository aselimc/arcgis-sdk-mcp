import { describe, expect, it } from 'vitest';
import { pkgdownAdapter, pkgdownRecords } from '../../../../src/adapters/reference/pkgdown.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const HOST = 'https://r.esri.com/';
const WIDGETR = `${HOST}widgetr/search.json`;
const WIDGETVIZ = `${HOST}widgetviz/search.json`;
const WIDGETNEW = `${HOST}widgetnew/search.json`;
const MAKE_WIDGET = `${HOST}widgetr/reference/make_widget.html`;
const ARTICLE = `${HOST}widgetr/articles/first-widget.html`;

const source = makeSource(
  'pkgdown',
  { host: 'r.esri.com', packages: ['widgetr', 'widgetviz', 'widgetnew'] },
  {
    id: 'packages',
    title: 'R package references',
    kinds: ['api', 'guide'],
    floor: false,
    license: 'unlicensed',
    probe: { url: WIDGETR, expect: 'json' },
  },
);
const product = makeProduct({ sources: [source] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'pkgdown.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('pkgdown', () => ({
  adapter: pkgdownAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['r.esri.com'],
  minRecords: 6,
  readRef: MAKE_WIDGET,
  siteIndexFiles: [/search\.json$/],
  hasMembers: false,
  failures: {
    renamedField: {
      // One package changed its index; the others are still listed.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [WIDGETR]: { json: [{ url: 'reference/make_widget.html', heading: 'make_widget' }] },
        }),
      outcome: 'degraded',
      minRecords: 1,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(/search\.json$/, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), { [WIDGETR]: { json: [] }, [WIDGETVIZ]: { json: [] } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(/search\.json$/, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    oversizedBody: {
      arrange: (ctx) => ctx.http.fail(WIDGETR, 'oversized'),
      outcome: 'degraded',
      minRecords: 1,
    },
    secondary5xx: {
      arrange: (ctx) => ctx.http.fail(WIDGETVIZ, 503),
      outcome: 'degraded',
      minRecords: 5,
    },
  },
}));

describe('pkgdown: enumerate', () => {
  it('lists one record per page of every package that has a site', async () => {
    const ctx = ctxOf();
    const records = await pkgdownAdapter.enumerate!(ctx, bound());

    expect(
      records.map((record) => [record.ref.slice(HOST.length), record.kind, record.title]),
    ).toEqual([
      ['widgetr/', 'guide', 'Make widgets from R'],
      ['widgetr/reference/make_widget.html', 'api', 'make_widget'],
      ['widgetr/reference/resize.html', 'api', 'resize_widget'],
      ['widgetr/articles/first-widget.html', 'guide', 'Your first widget'],
      ['widgetr/news/', 'release-notes', 'widgetr 0.2.0'],
      ['widgetviz/reference/plot_widget.html', 'api', 'plot_widget'],
    ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      WIDGETR,
      WIDGETVIZ,
      WIDGETNEW,
    ]);
    expect(ctx.logger.messages('warn')).toEqual([
      'The package site widgetnew is unavailable; continuing without it',
    ]);
  });

  it('names reference topics as package::topic and keeps article headings', async () => {
    const records = await pkgdownAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('make_widget')).toMatchObject({
      symbol: 'make_widget',
      qualified: 'widgetr::make_widget',
      symbolKind: 'function',
      description: 'Create a widget',
      breadcrumb: 'widgetr > Reference',
      license: 'unlicensed',
    });
    expect(byTitle.get('make_widget')?.headings).toBeUndefined();
    expect(byTitle.get('Your first widget')).toMatchObject({
      headings: ['Prepare the data', 'Draw the widget'],
      breadcrumb: 'widgetr > Articles',
    });
    expect(byTitle.get('Make widgets from R')).toMatchObject({
      headings: ['Installation'],
      breadcrumb: 'widgetr',
    });
    expect(byTitle.get('Your first widget')?.symbol).toBeUndefined();
  });

  it('rebases absolute paths written for another host onto the package site', () => {
    const records = pkgdownRecords(bound(), 'pkg', [
      { path: 'https://elsewhere.example/site/reference/topic.html#details', title: 'Topic' },
      { path: '/site/articles/deep/guide.html', title: 'Guide' },
      { path: 'authors.html', title: 'Authors' },
      { path: 'reference/index.html', title: 'Function reference' },
      { path: 'reference/topic.html', title: '   ' },
      { path: 7, title: 'No path' },
      null,
    ]);

    expect(records.map((record) => [record.ref, record.symbol ?? null])).toEqual([
      [`${HOST}pkg/reference/topic.html`, 'topic'],
      [`${HOST}pkg/articles/deep/guide.html`, null],
      [`${HOST}pkg/reference/`, null],
    ]);
  });

  it('fails with the first package failure when no package answers', async () => {
    const ctx = ctxOf();
    ctx.http.fail(/search\.json$/, 503);
    await expect(pkgdownAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: WIDGETR },
    });
  });
});

describe('pkgdown: read', () => {
  it('reads the Markdown twin of a page where the site publishes them', async () => {
    const ctx = ctxOf();
    const page = await pkgdownAdapter.read(ctx, bound(), {
      url: new URL(`${MAKE_WIDGET}#arguments`),
      select: { section: 'arguments' },
    });

    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${HOST}widgetr/llms.txt`,
      `${HOST}widgetr/reference/make_widget.md`,
    ]);
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'markdown',
      meta: { url: `${MAKE_WIDGET}#arguments`, kind: 'api', license: 'unlicensed' },
      opts: { select: { section: 'arguments' } },
    });
    expect(page.ref).toBe(`${MAKE_WIDGET}#arguments`);
    expect(page.sections.map((section) => section.id)).toEqual(['create-a-widget', 'arguments']);
  });

  it('asks only once per package whether it has Markdown twins', async () => {
    const ctx = ctxOf();
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(MAKE_WIDGET) });
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(MAKE_WIDGET) });
    expect(ctx.http.count(`${HOST}widgetr/llms.txt`)).toBe(1);
  });

  it('reads the HTML page when a page has no twin', async () => {
    const ctx = ctxOf();
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(ARTICLE) });

    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${HOST}widgetr/llms.txt`,
      `${HOST}widgetr/articles/first-widget.md`,
      ARTICLE,
    ]);
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'html',
      meta: { url: ARTICLE, kind: 'guide' },
    });
  });

  it('reads HTML only on a site without Markdown twins', async () => {
    const ctx = ctxOf();
    const url = `${HOST}widgetviz/reference/plot_widget.html`;
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(url) });
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(url) });

    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${HOST}widgetviz/llms.txt`,
      url,
      url,
    ]);
  });

  it('still reads the page when the check for twins fails upstream', async () => {
    const ctx = ctxOf();
    ctx.http.fail(`${HOST}widgetr/llms.txt`, 503, { times: 1 });
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(ARTICLE) });
    expect(rendererOf(ctx).calls[0]?.kind).toBe('html');
    // The failed check is not remembered.
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(MAKE_WIDGET) });
    expect(rendererOf(ctx).calls[1]?.kind).toBe('markdown');
  });

  it('does not hide a failing page behind the HTML fallback', async () => {
    const ctx = ctxOf();
    ctx.http.fail(`${HOST}widgetr/reference/make_widget.md`, 503);
    await expect(
      pkgdownAdapter.read(ctx, bound(), { url: new URL(MAKE_WIDGET) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('reads the record kind of a symbol record and a directory page as HTML', async () => {
    const ctx = ctxOf();
    ctx.http.on(`${HOST}widgetr/news/`, { body: '<main><h1>Changelog</h1></main>' });
    const records = await pkgdownAdapter.enumerate!(ctx, bound());
    ctx.http.resetLog();
    await pkgdownAdapter.symbol!(
      ctx,
      bound(),
      records.find((r) => r.title === 'make_widget')!,
      'summary',
    );
    await pkgdownAdapter.read(ctx, bound(), { url: new URL(`${HOST}widgetr/news/`) });
    const calls = rendererOf(ctx).calls;

    expect(calls[0]).toMatchObject({
      kind: 'markdown',
      meta: { kind: 'api' },
      opts: { detail: 'summary' },
    });
    expect(calls[1]).toMatchObject({ kind: 'html', meta: { kind: 'release-notes' } });
    expect(ctx.http.count(`${HOST}widgetr/news/`)).toBe(1);
  });
});

describe('pkgdown: probe', () => {
  it('counts the rows of the canary index', async () => {
    expect(await pkgdownAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 10 });
  });
});
