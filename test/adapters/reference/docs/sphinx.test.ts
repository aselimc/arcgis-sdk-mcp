import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  parseObjectsInv,
  parseSphinxSearchIndex,
} from '../../../../src/adapters/reference/objects-inv.js';
import { sphinxAdapter, sphinxRecords } from '../../../../src/adapters/reference/sphinx.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import type { Cassette } from '../../../support/fake-http.js';
import { readFixture } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/python/';
const INVENTORY = `${BASE}objects.inv`;
const SEARCH_INDEX = `${BASE}searchindex.js`;
const PAGE = `${BASE}widgets.html`;

const HEADER = [
  '# Sphinx inventory version 2',
  '# Project: widgets',
  '# Version: 2.1',
  '# The remainder of this file is compressed using zlib.',
];

/** An `objects.inv` as the gateway hands it over for `encoding: 'base64'`. */
function inventory(rows: string, header: readonly string[] = HEADER): string {
  return Buffer.concat([
    Buffer.from(`${header.join('\n')}\n`, 'utf8'),
    deflateSync(Buffer.from(rows, 'utf8')),
  ]).toString('base64');
}

const ROWS = readFixture('cassettes', 'reference', 'docs', 'sphinx-objects.txt');
const SEARCH_SCRIPT = readFixture('cassettes', 'reference', 'docs', 'sphinx-searchindex.js');
const PAGE_HTML = readFixture('cassettes', 'reference', 'docs', 'page.html');

const cassette = (): Cassette => ({
  name: 'Sphinx reference, happy path',
  interactions: [
    { url: INVENTORY, response: { contentType: 'application/octet-stream', body: inventory(ROWS) } },
    { url: SEARCH_INDEX, response: { contentType: 'application/javascript', body: SEARCH_SCRIPT } },
    { url: PAGE, response: { body: PAGE_HTML } },
  ],
});

const source = makeSource(
  'sphinx',
  { base: '/widgets/api-reference/python/' },
  {
    id: 'api',
    title: 'Python API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: INVENTORY, expect: 'text', mustContain: '# Sphinx inventory', minRecords: 10 },
  },
);
const product = makeProduct({ sources: [source] });
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('sphinx', () => ({
  adapter: sphinxAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 12,
  readRef: `${PAGE}#widgets.Widget.resize`,
  siteIndexFiles: [INVENTORY, SEARCH_INDEX],
  failures: {
    renamedField: {
      // Rows in another layout are not inventory entries; the search index still lists the site.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INVENTORY]: { body: inventory('widgets.Widget class widgets.html\n') },
        }),
      outcome: 'degraded',
      minRecords: 6,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(INVENTORY, 404),
      outcome: 'degraded',
      minRecords: 6,
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INVENTORY]: { body: inventory('') },
          [SEARCH_INDEX]: { body: 'Search.setIndex({"docnames":[],"objects":{}})' },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(INVENTORY, 'html'),
      outcome: 'degraded',
      minRecords: 6,
    },
    oversizedBody: {
      arrange: (ctx) => ctx.http.fail(INVENTORY, 'oversized'),
      outcome: 'degraded',
      minRecords: 6,
    },
    secondary5xx: {
      arrange: (ctx) => {
        ctx.http.fail(INVENTORY, 404);
        ctx.http.fail(SEARCH_INDEX, 503);
      },
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
  },
}));

describe('sphinx: enumerate', () => {
  it('reads the inventory as bytes and lists objects and documents', async () => {
    const ctx = ctxOf();
    const records = await sphinxAdapter.enumerate!(ctx, bound());

    expect(ctx.http.requests).toEqual([
      { method: 'GET', url: INVENTORY, expect: 'text', encoding: 'base64' },
    ]);
    expect(
      records.map((record) => [record.title, record.symbolKind ?? null, record.ref.slice(BASE.length)]),
    ).toEqual([
      ['widgets', 'module', 'widgets.html#module-widgets'],
      ['make_widget', 'function', 'widgets.html#widgets.make_widget'],
      ['Widget', 'class', 'widgets.html#widgets.Widget'],
      ['Widget.resize', 'method', 'widgets.html#widgets.Widget.resize'],
      ['Widget.size', 'property', 'widgets.html#widgets.Widget.size'],
      ['Widget.from_json', 'method', 'widgets.html#widgets.Widget.from_json'],
      ['Polish', 'class', 'widgets.tools.html#widgets.tools.Polish'],
      ['Polish.run', 'method', 'widgets.tools.html#widgets.tools.Polish.run'],
      ['Polish.Result', 'attribute', 'widgets.tools.html#widgets.tools.Polish.Result'],
      ['PolishError', 'exception', 'widgets.tools.html#widgets.tools.PolishError'],
      ['Widgets package', null, 'widgets.html'],
      ['widgets.tools', null, 'widgets.tools.html'],
    ]);
  });

  it('qualifies members with their class and leaves module-level objects without a parent', async () => {
    const records = await sphinxAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('Polish.run')).toMatchObject({
      symbol: 'run',
      qualified: 'widgets.tools.Polish.run',
      parent: 'widgets.tools.Polish',
      breadcrumb: 'widgets.tools > Polish',
    });
    expect(byTitle.get('make_widget')).toMatchObject({
      qualified: 'widgets.make_widget',
      breadcrumb: 'widgets',
    });
    expect(byTitle.get('make_widget')?.parent).toBeUndefined();
    expect(byTitle.get('Widgets package')?.symbol).toBeUndefined();
  });

  it('falls back to the search index when the inventory is damaged', async () => {
    const ctx = ctxOf();
    ctx.http.fail(INVENTORY, 'truncated');
    const records = await sphinxAdapter.enumerate!(ctx, bound());

    expect(ctx.http.requests.map((request) => request.url)).toEqual([INVENTORY, SEARCH_INDEX]);
    expect(records.map((record) => [record.title, record.symbolKind ?? null])).toEqual([
      ['Widgets package', null],
      ['widgets.tools', null],
      ['make_widget', 'function'],
      ['Widget', 'class'],
      ['Widget.resize', 'method'],
      // `Widget.hidden` has no anchor, so its ref is the page, which the document already has.
      ['Polish', 'class'],
      ['Polish.run', 'method'],
    ]);
    expect(records.find((record) => record.title === 'Widget.resize')?.ref).toBe(
      `${PAGE}#widgets.Widget.resize`,
    );
    expect(ctx.logger.messages('warn')).toHaveLength(1);
  });

  it('reports the inventory failure when the search index cannot be used either', async () => {
    const ctx = ctxOf();
    ctx.http.fail(INVENTORY, 'truncated');
    replaceResponses(ctx, { interactions: [] }, {
      [INVENTORY]: { body: inventory(ROWS).slice(0, 200) },
      [SEARCH_INDEX]: { body: 'Search.setIndex({docnames:["widgets"]})' },
    });
    await expect(sphinxAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: INVENTORY, why: 'The file is not a Sphinx inventory version 2' },
    });
  });

  it('maps directory-style inventory URIs to the published page', () => {
    const records = sphinxRecords(bound(), [
      { name: 'pkg.mod.Thing', domain: 'py', role: 'class', uri: 'pkg.mod/#pkg.mod.Thing', display: 'x' },
      { name: 'pkg.mod.Thing.go', domain: 'py', role: 'function', uri: 'pkg.mod/#pkg.mod.Thing.go', display: 'x' },
      { name: 'index', domain: 'std', role: 'doc', uri: '', display: 'Welcome' },
      { name: 'away', domain: 'py', role: 'function', uri: 'https://example.com/away.html', display: 'x' },
    ]);

    expect(records.map((record) => [record.ref.slice(BASE.length), record.parent ?? null])).toEqual([
      ['pkg.mod.html#pkg.mod.Thing', null],
      // A function named inside a class of the index is a member of that class.
      ['pkg.mod.html#pkg.mod.Thing.go', 'pkg.mod.Thing'],
      ['index.html', null],
    ]);
  });
});

describe('sphinx: read, symbol and probe', () => {
  it('passes the anchor of the URL to the sphinx renderer', async () => {
    const ctx = ctxOf();
    const page = await sphinxAdapter.read(ctx, bound(), {
      url: new URL(`${PAGE}#widgets.Widget.resize`),
      detail: 'signature',
    });

    expect(ctx.http.requests.map((request) => request.url)).toEqual([PAGE]);
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'sphinx',
      input: { html: PAGE_HTML, anchor: 'widgets.Widget.resize' },
      meta: { url: `${PAGE}#widgets.Widget.resize`, kind: 'api' },
      opts: { detail: 'signature' },
    });
    expect(page.ref).toBe(`${PAGE}#widgets.Widget.resize`);
  });

  it('renders the whole page when the URL has no anchor', async () => {
    const ctx = ctxOf();
    await sphinxAdapter.read(ctx, bound(), { url: new URL(PAGE) });
    expect(rendererOf(ctx).calls[0]?.input).toEqual({ html: PAGE_HTML });
  });

  it('reads a symbol record at its anchor', async () => {
    const ctx = ctxOf();
    const records = await sphinxAdapter.enumerate!(ctx, bound());
    await sphinxAdapter.symbol!(ctx, bound(), records.find((r) => r.title === 'Widget.size')!, 'full');

    expect(rendererOf(ctx).calls[0]).toMatchObject({
      input: { anchor: 'widgets.Widget.size' },
      opts: { select: { member: 'widgets.Widget.size' }, detail: 'full' },
    });
  });

  it('probes the inventory as bytes, checking the marker and counting entries', async () => {
    const ctx = ctxOf();
    const result = await sphinxAdapter.probe(ctx, bound());

    expect(result).toMatchObject({ ok: true, records: 14 });
    expect(ctx.http.requests[0]).toMatchObject({ url: INVENTORY, encoding: 'base64' });
  });

  it('probes the search index when that is the canary', async () => {
    const other = { ...source, probe: { url: SEARCH_INDEX, expect: 'text' as const, minRecords: 5 } };
    const ctx = ctxOf();
    const result = await sphinxAdapter.probe(ctx, bindSource(product, other, makeLine()));

    expect(result).toMatchObject({ ok: true, records: 8 });
    expect(ctx.http.requests[0]?.encoding).toBeUndefined();
  });
});

describe('Sphinx index readers', () => {
  it('reads the header and expands the shorthands of inventory rows', () => {
    const index = parseObjectsInv(Buffer.from(inventory(ROWS), 'base64'));

    expect(index?.project).toBe('widgets');
    expect(index?.version).toBe('2.1');
    expect(index?.entries).toHaveLength(14);
    expect(index?.entries[0]).toEqual({
      name: 'widgets',
      domain: 'py',
      role: 'module',
      uri: 'widgets.html#module-widgets',
      display: 'widgets',
    });
    expect(index?.entries.find((entry) => entry.role === 'doc')?.display).toBe('Widgets package');
  });

  it('keeps names with spaces and roles with colons', () => {
    const rows = 'A long label std:label -1 page.html#a-long-label A long label\nx c:cpp:func 1 x.html -\n';
    const index = parseObjectsInv(Buffer.from(inventory(rows, [HEADER[0]!, '# Project:', '#', '#']), 'base64'));

    expect(index).toEqual({
      entries: [
        { name: 'A long label', domain: 'std', role: 'label', uri: 'page.html#a-long-label', display: 'A long label' },
        { name: 'x', domain: 'c', role: 'cpp:func', uri: 'x.html', display: 'x' },
      ],
    });
  });

  it('rejects other inventory versions, short files and damaged bodies', () => {
    const version1 = inventory(ROWS, ['# Sphinx inventory version 1', ...HEADER.slice(1)]);
    expect(parseObjectsInv(Buffer.from(version1, 'base64'))).toBeUndefined();
    expect(parseObjectsInv(Buffer.from('# Sphinx inventory version 2\n', 'utf8'))).toBeUndefined();
    expect(parseObjectsInv(Buffer.from(`${HEADER.join('\n')}\nnot zlib`, 'utf8'))).toBeUndefined();
  });

  it('reads both layouts of the search index objects', () => {
    const listForm = parseSphinxSearchIndex(SEARCH_SCRIPT);
    const mapForm = parseSphinxSearchIndex(
      'Search.setIndex({"docnames":["a"],"titles":[""],"objects":{"":{"top":[0,0,1,""]},"a":{"f":[0,0,1,"a-f"],"g":7}},"objtypes":{"0":"py:function"}})',
    );

    expect(listForm?.entries.map((entry) => `${entry.domain}:${entry.role} ${entry.uri}`)).toEqual([
      'std:doc widgets.html',
      'std:doc widgets.tools.html',
      'py:function widgets.html#widgets.make_widget',
      'py:class widgets.html#widgets.Widget',
      'py:method widgets.html#widgets.Widget.resize',
      // An anchor of "-" means the object has none.
      'py:method widgets.html',
      'py:class widgets.tools.html#widgets.tools.Polish',
      'py:method widgets.tools.html#widgets.tools.Polish.run',
    ]);
    expect(mapForm?.entries).toEqual([
      { name: 'a', domain: 'std', role: 'doc', uri: 'a.html', display: 'a' },
      { name: 'top', domain: 'py', role: 'function', uri: 'a.html#top', display: 'top' },
      { name: 'a.f', domain: 'py', role: 'function', uri: 'a.html#a-f', display: 'a.f' },
    ]);
  });

  it('rejects scripts without a JSON index or without documents', () => {
    expect(parseSphinxSearchIndex('Search.setIndex({docnames:["a"]})')).toBeUndefined();
    expect(parseSphinxSearchIndex('Search.setIndex({"docnames":[]})')).toBeUndefined();
    expect(parseSphinxSearchIndex('nothing here')).toBeUndefined();
  });
});
