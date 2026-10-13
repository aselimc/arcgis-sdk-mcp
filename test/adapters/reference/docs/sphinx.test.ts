import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  parseObjectsInv,
  parseSphinxSearchIndex,
} from '../../../../src/adapters/reference/objects-inv.js';
import { sphinxAdapter, sphinxRecords } from '../../../../src/adapters/reference/sphinx.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import {
  makeDocPage,
  makeLine,
  makeProduct,
  makeRecord,
  makeSource,
} from '../../../support/builders.js';
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
    {
      url: INVENTORY,
      response: { contentType: 'application/octet-stream', body: inventory(ROWS) },
    },
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
      records.map((record) => [
        record.title,
        record.symbolKind ?? null,
        record.ref.slice(BASE.length),
      ]),
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
      ['make_widget', 'function'],
      ['Widget', 'class'],
      ['Widget.resize', 'method'],
      // `Widget.hidden` has no anchor, so nothing but its page could be shown for it.
      ['Polish', 'class'],
      ['Polish.run', 'method'],
      ['Widgets package', null],
      ['widgets.tools', null],
    ]);
    expect(records.find((record) => record.title === 'Widget.resize')?.ref).toBe(
      `${PAGE}#widgets.Widget.resize`,
    );
    expect(ctx.logger.messages('warn')).toHaveLength(1);
  });

  it('reports the inventory failure when the search index cannot be used either', async () => {
    const ctx = ctxOf();
    ctx.http.fail(INVENTORY, 'truncated');
    replaceResponses(
      ctx,
      { interactions: [] },
      {
        [INVENTORY]: { body: inventory(ROWS).slice(0, 200) },
        [SEARCH_INDEX]: { body: 'Search.setIndex({docnames:["widgets"]})' },
      },
    );
    await expect(sphinxAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: INVENTORY, why: 'The file is not a Sphinx inventory version 2' },
    });
  });

  const entry = (name: string, role: string, uri: string, priority = 1, domain = 'py') => ({
    name,
    domain,
    role,
    priority,
    uri,
    display: name,
  });

  it('maps directory-style inventory URIs to the published page', () => {
    const records = sphinxRecords(bound(), [
      entry('pkg.mod.Thing', 'class', 'pkg.mod/#pkg.mod.Thing'),
      entry('pkg.mod.Thing.go', 'function', 'pkg.mod/#pkg.mod.Thing.go'),
      { ...entry('index', 'doc', '', -1, 'std'), display: 'Welcome' },
      entry('away', 'function', 'https://example.com/away.html'),
      entry('constructor', 'constructor', 'pkg.mod/#constructor'),
    ]);

    expect(
      records.map((record) => [
        record.ref.slice(BASE.length),
        record.parent ?? null,
        record.symbolKind,
      ]),
    ).toEqual([
      ['pkg.mod.html#pkg.mod.Thing', null, 'class'],
      // A function named inside a class of the index is a member of that class.
      ['pkg.mod.html#pkg.mod.Thing.go', 'pkg.mod.Thing', 'function'],
      // A role that is also the name of an Object property is still just a role.
      ['pkg.mod.html#constructor', null, 'constructor'],
      ['index.html', null, undefined],
    ]);
  });

  it('records the name Sphinx shows in search where an alias shares its anchor', () => {
    const records = sphinxRecords(bound(), [
      entry('pkg.a_internal.Tool', 'class', 'pkg.html#pkg.tools.Tool', -1),
      entry('pkg.tools.Tool', 'class', 'pkg.html#pkg.tools.Tool'),
    ]);

    expect(records.map((record) => record.qualified)).toEqual(['pkg.tools.Tool']);
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
    await sphinxAdapter.symbol!(
      ctx,
      bound(),
      records.find((r) => r.title === 'Widget.size')!,
      'full',
    );

    expect(rendererOf(ctx).calls[0]).toMatchObject({
      input: { anchor: 'widgets.Widget.size' },
      opts: { select: { member: 'widgets.Widget.size' }, detail: 'full' },
    });
  });

  // Regression: on a line whose index has classes without their members, a member is asked
  // for on the page of its type by its bare name. The page documents a whole module, so the
  // first `query` on it was returned under whatever class had been asked for, and the
  // `Source:` line cited `#query`, which is no anchor of the page.
  describe('a member the index does not list', () => {
    const MODULE = `${BASE}widgets.features.toc.html`;
    const object = (id: string): string => `<dt class="sig sig-object py" id="${id}">${id}</dt>`;
    const html = [
      '<html><body><div role="main"><h1>widgets.features</h1>',
      `<dl class="py class">${object('widgets.features.Layer')}<dd>`,
      `<dl class="py method">${object('widgets.features.Layer.query')}<dd>Queries a layer.</dd></dl>`,
      '</dd></dl>',
      `<dl class="py class">${object('widgets.features.Table')}<dd>`,
      `<dl class="py method">${object('widgets.features.Table.query')}<dd>Queries a table.</dd></dl>`,
      '</dd></dl>',
      `<dl class="py class">${object('widgets.features.Collection')}<dd>No methods.</dd></dl>`,
      '</div></body></html>',
    ].join('');
    /** The record the symbol service makes for `Type.member` when the type lists no members. */
    const asked = (type: string, member: string) =>
      makeRecord({
        ref: `${MODULE}#${member}`,
        kind: 'api',
        title: member,
        symbol: member,
        qualified: `widgets.features.${type}.${member}`,
        parent: `widgets.features.${type}`,
        symbolKind: 'member',
      });
    const ctxWith = (): TestCtx => {
      const ctx = ctxOf();
      ctx.http.on(MODULE, { body: html });
      return ctx;
    };

    it('reads the member of the type that was asked for, at its real anchor', async () => {
      const ctx = ctxWith();
      const page = await sphinxAdapter.symbol!(ctx, bound(), asked('Table', 'query'), 'full');

      expect(rendererOf(ctx).calls[0]).toMatchObject({
        input: { anchor: 'widgets.features.Table.query' },
        meta: { url: `${MODULE}#widgets.features.Table.query` },
        opts: { select: { member: 'widgets.features.Table.query' }, detail: 'full' },
      });
      expect(page.ref).toBe(`${MODULE}#widgets.features.Table.query`);
    });

    it('reads the type when it does not declare the member, so that its own members answer', async () => {
      const ctx = ctxWith();
      const page = await sphinxAdapter.symbol!(ctx, bound(), asked('Collection', 'query'), 'full');

      const call = rendererOf(ctx).calls[0];
      expect(call?.input).toMatchObject({ anchor: 'widgets.features.Collection' });
      // No selector: a bare `query` would pick the method of another class.
      expect(call?.opts).toEqual({ detail: 'full' });
      expect(page.ref).toBe(`${MODULE}#widgets.features.Collection`);
    });

    it('lists only the members of the type when the page anchors neither', async () => {
      const ctx = ctxWith();
      rendererOf(ctx).when('sphinx', (rendered) => ({
        ...makeDocPage({ url: rendered.meta.url }),
        members: [
          { id: 'widgets.features.Layer.query', name: 'query', kind: 'method' },
          { id: 'widgets.features.Gone.reset', name: 'reset', kind: 'method' },
        ],
      }));
      const page = await sphinxAdapter.symbol!(ctx, bound(), asked('Gone', 'query'), 'full');

      expect(rendererOf(ctx).calls[0]?.input).toEqual({ html });
      expect(rendererOf(ctx).calls[0]?.opts).toEqual({ detail: 'full' });
      expect(page.members).toEqual([
        { id: 'widgets.features.Gone.reset', name: 'reset', kind: 'method' },
      ]);
      expect(page.ref).toBe(MODULE);
    });
  });

  it('probes the inventory as bytes, checking the marker and counting entries', async () => {
    const ctx = ctxOf();
    const result = await sphinxAdapter.probe(ctx, bound());

    expect(result).toMatchObject({ ok: true, records: 14 });
    expect(ctx.http.requests[0]).toMatchObject({ url: INVENTORY, encoding: 'base64' });
  });

  it('probes the search index when that is the canary', async () => {
    const other = {
      ...source,
      probe: { url: SEARCH_INDEX, expect: 'text' as const, minRecords: 5 },
    };
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
      priority: 0,
      uri: 'widgets.html#module-widgets',
      display: 'widgets',
    });
    expect(index?.entries.find((entry) => entry.role === 'doc')?.display).toBe('Widgets package');
  });

  it('keeps names with spaces and roles with colons', () => {
    const rows =
      'A long label std:label -1 page.html#a-long-label A long label\nx c:cpp:func 1 x.html -\n';
    const index = parseObjectsInv(
      Buffer.from(inventory(rows, [HEADER[0]!, '# Project:', '#', '#']), 'base64'),
    );

    expect(index).toEqual({
      entries: [
        {
          name: 'A long label',
          domain: 'std',
          role: 'label',
          priority: -1,
          uri: 'page.html#a-long-label',
          display: 'A long label',
        },
        { name: 'x', domain: 'c', role: 'cpp:func', priority: 1, uri: 'x.html', display: 'x' },
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
      { name: 'a', domain: 'std', role: 'doc', priority: -1, uri: 'a.html', display: 'a' },
      {
        name: 'top',
        domain: 'py',
        role: 'function',
        priority: 1,
        uri: 'a.html#top',
        display: 'top',
      },
      {
        name: 'a.f',
        domain: 'py',
        role: 'function',
        priority: 1,
        uri: 'a.html#a-f',
        display: 'a.f',
      },
    ]);
  });

  it('rejects scripts without a JSON index or without documents', () => {
    expect(parseSphinxSearchIndex('Search.setIndex({docnames:["a"]})')).toBeUndefined();
    expect(parseSphinxSearchIndex('Search.setIndex({"docnames":[]})')).toBeUndefined();
    expect(parseSphinxSearchIndex('nothing here')).toBeUndefined();
  });
});
