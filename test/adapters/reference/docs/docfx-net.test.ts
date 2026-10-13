import { describe, expect, it } from 'vitest';
import {
  docfxNetAdapter,
  tocKinds,
  xrefRecords,
} from '../../../../src/adapters/reference/docfx-net.js';
import { parseXrefmap } from '../../../../src/adapters/reference/xrefmap.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette, readFixture } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/net/';
const NET = `${BASE}net.xrefmap.yml`;
const NETWIN = `${BASE}netwin.xrefmap.yml`;
const NET_TOC = `${BASE}api/net/toc.json`;
const NETWIN_TOC = `${BASE}api/netwin/toc.json`;
const PAGES = `${BASE}api/net/Example.Widgets/`;
const WIDGET = `${PAGES}Example.Widgets.Widget.html`;
const EMPTY_XREFMAP = '### YamlMime:XRefMap\nsorted: true\nreferences: []\n';

const source = makeSource(
  'docfx-net',
  { base: '/widgets/api-reference/net/', xrefmaps: ['net.xrefmap.yml', 'netwin.xrefmap.yml'] },
  {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: NET, expect: 'yaml', minRecords: 10, mustContain: 'uid:' },
  },
);
const product = makeProduct({ sources: [source] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'docfx-net.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('docfx-net', () => ({
  adapter: docfxNetAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 13,
  readRef: WIDGET,
  siteIndexFiles: [NET, NETWIN, NET_TOC, NETWIN_TOC],
  failures: {
    renamedField: {
      // Without `href` no entry of the first API set points anywhere; the second set still does.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [NET]: { body: 'references:\n- uid: Example.Widgets.Widget\n  link: api/net/W.html\n' },
        }),
      outcome: 'degraded',
      minRecords: 3,
    },
    missingFile: {
      arrange: (ctx) => {
        ctx.http.fail(NET, 404);
        ctx.http.fail(NETWIN, 404);
      },
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      // The root xrefmap of a multi-platform site is exactly this file.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [NET]: { body: EMPTY_XREFMAP },
          [NETWIN]: { body: EMPTY_XREFMAP },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      // The table of contents is the JSON file of this source; types lose their exact kind.
      arrange: (ctx) => ctx.http.fail(/toc\.json$/, 'html'),
      outcome: 'degraded',
      minRecords: 13,
    },
    oversizedBody: {
      arrange: (ctx) => ctx.http.fail(NET, 'oversized'),
      outcome: 'degraded',
      minRecords: 3,
    },
    secondary5xx: {
      arrange: (ctx) => ctx.http.fail(NETWIN, 503),
      outcome: 'degraded',
      minRecords: 11,
    },
  },
}));

describe('docfx-net: enumerate', () => {
  it('lists namespaces, types and members, skipping overload groups and foreign references', async () => {
    const ctx = ctxOf();
    const records = await docfxNetAdapter.enumerate!(ctx, bound());

    expect(
      records.map((record) => [record.title, record.symbolKind, record.parent ?? null]),
    ).toEqual([
      ['Example.Widgets', 'namespace', null],
      ['Widget', 'class', null],
      ['Widget.Widget(int)', 'constructor', 'Example.Widgets.Widget'],
      ['Widget.ResizeAsync(int)', 'method', 'Example.Widgets.Widget'],
      ['Widget.ResizeAsync(int, int)', 'method', 'Example.Widgets.Widget'],
      ['Widget.Size', 'property', 'Example.Widgets.Widget'],
      ['Widget.Resized', 'event', 'Example.Widgets.Widget'],
      ['Widget.Label', 'field', 'Example.Widgets.Widget'],
      ['Widget.Shape', 'enum', 'Example.Widgets.Widget'],
      ['WidgetList<T>', 'class', null],
      ['WidgetList<T>.Add(T)', 'method', 'Example.Widgets.WidgetList'],
      ['WidgetView', 'class', null],
      ['WidgetView.Widget', 'property', 'Example.Widgets.UI.WidgetView'],
    ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      NET,
      NET_TOC,
      NETWIN,
      NETWIN_TOC,
    ]);
  });

  it('writes qualified names as in code and keeps the uid as locator', async () => {
    const records = await docfxNetAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('Widget.ResizeAsync(int, int)')).toMatchObject({
      ref: `${PAGES}Example.Widgets.Widget.ResizeAsync.html#Example_Widgets_Widget_ResizeAsync_System_Int32_System_Int32_`,
      symbol: 'ResizeAsync',
      qualified: 'Example.Widgets.Widget.ResizeAsync',
      breadcrumb: 'Example.Widgets.Widget',
      locator: { uid: 'Example.Widgets.Widget.ResizeAsync(System.Int32,System.Int32)' },
    });
    expect(byTitle.get('Widget.Widget(int)')).toMatchObject({
      symbol: 'Widget',
      qualified: 'Example.Widgets.Widget.Widget',
    });
    expect(byTitle.get('WidgetList<T>')).toMatchObject({
      symbol: 'WidgetList',
      qualified: 'Example.Widgets.WidgetList',
      breadcrumb: 'Example.Widgets',
    });
    expect(byTitle.get('WidgetList<T>.Add(T)')).toMatchObject({
      symbol: 'Add',
      qualified: 'Example.Widgets.WidgetList.Add',
    });
    expect(byTitle.get('Widget.Label')?.ref).toBe(
      `${PAGES}Example.Widgets.Widget.Label.html#Example_Widgets_Widget_Label`,
    );
  });

  it('takes from a later API set only what the first one lacks, tagged with the set', async () => {
    const records = await docfxNetAdapter.enumerate!(ctxOf(), bound());
    const widgets = records.filter((record) => record.qualified === 'Example.Widgets.Widget');
    const view = records.find((record) => record.symbol === 'WidgetView');

    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ ref: WIDGET });
    expect(widgets[0]?.platform).toBeUndefined();
    expect(view).toMatchObject({
      ref: `${BASE}api/netwin/Example.Widgets.UI/Example.Widgets.UI.WidgetView.html`,
      platform: 'netwin',
    });
  });

  it('lists types as kind "type" when the table of contents is unavailable', async () => {
    const ctx = ctxOf();
    ctx.http.fail(/toc\.json$/, 404);
    const records = await docfxNetAdapter.enumerate!(ctx, bound());

    expect(records.find((record) => record.title === 'Widget')?.symbolKind).toBe('type');
    expect(records.find((record) => record.title === 'Widget.Shape')?.symbolKind).toBe('type');
    expect(records).toHaveLength(13);
  });

  it('never accepts an xrefmap without references as the catalogue', async () => {
    const single = makeSource(
      'docfx-net',
      { base: '/widgets/api-reference/net/', xrefmaps: ['xrefmap.yml'] },
      {
        id: 'api',
        probe: source.probe,
      },
    );
    const ctx = makeCtx();
    ctx.http.on(`${BASE}xrefmap.yml`, { body: EMPTY_XREFMAP });
    await expect(
      docfxNetAdapter.enumerate!(ctx, bindSource(product, single, makeLine())),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: {
        url: `${BASE}xrefmap.yml`,
        why: 'The xrefmap has no references',
        retryable: false,
      },
    });
    expect(ctx.http.count()).toBe(1);
  });

  it('reads at most three API sets and says so', async () => {
    const many = makeSource(
      'docfx-net',
      { base: '/widgets/api-reference/net/', xrefmaps: ['a.yml', 'b.yml', 'c.yml', 'd.yml'] },
      { id: 'api', probe: source.probe },
    );
    const ctx = makeCtx();
    ctx.http.on(/\.yml$/, (req) => ({
      body: `references:\n- uid: Ns.${req.url.slice(-5, -4)}\n  href: ${req.url.slice(-5, -4)}.html\n  commentId: T:Ns.X\n`,
    }));
    ctx.http.on(/toc\.json$/, { json: {} });
    const records = await docfxNetAdapter.enumerate!(ctx, bindSource(product, many, makeLine()));

    expect(records.map((record) => record.ref)).toEqual([
      `${BASE}a.html`,
      `${BASE}b.html`,
      `${BASE}c.html`,
    ]);
    expect(ctx.http.count()).toBeLessThanOrEqual(docfxNetAdapter.maxEnumerateRequests);
    expect(ctx.logger.messages('warn')).toContain(
      'More xrefmaps are configured than one enumeration reads',
    );
  });
});

describe('docfx-net: read, symbol and probe', () => {
  it('reads a page with the docfx-net family hint', async () => {
    const ctx = ctxOf();
    await docfxNetAdapter.read(ctx, bound(), { url: new URL(WIDGET) });
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'html',
      input: { familyHint: 'docfx-net' },
      meta: { url: WIDGET },
    });
  });

  it('selects one overload on a member page by its anchor', async () => {
    const ctx = ctxOf();
    const records = await docfxNetAdapter.enumerate!(ctx, bound());
    const overload = records.find((record) => record.title === 'Widget.ResizeAsync(int)')!;
    await docfxNetAdapter.symbol!(ctx, bound(), overload, 'summary');

    expect(rendererOf(ctx).calls[0]?.opts).toEqual({
      select: { member: 'Example_Widgets_Widget_ResizeAsync_System_Int32_' },
      detail: 'summary',
    });
  });

  it('probes an xrefmap and counts its references', async () => {
    expect(await docfxNetAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 14 });
  });
});

describe('xrefmap reader', () => {
  const NET_YAML = readFixture('cassettes', 'reference', 'docs', 'docfx-net.xrefmap.yml');

  it('reads the scalar keys of every reference, whatever their quoting', () => {
    const entries = parseXrefmap(NET_YAML);

    expect(entries).toHaveLength(14);
    expect(entries[2]).toEqual({
      uid: 'Example.Widgets.Widget.#ctor(System.Int32)',
      name: 'Widget(int)',
      href: 'api/net/Example.Widgets/Example.Widgets.Widget.-ctor.html#Example_Widgets_Widget__ctor_System_Int32_',
      commentId: 'M:Example.Widgets.Widget.#ctor(System.Int32)',
      fullName: 'Example.Widgets.Widget.Widget(int)',
      nameWithType: 'Widget.Widget(int)',
    });
    expect(entries.find((entry) => entry.uid.endsWith('.Label'))).toMatchObject({
      name: 'Label',
      href: 'api/net/Example.Widgets/Example.Widgets.Widget.Label.html#Example_Widgets_Widget_Label',
      nameWithType: 'Widget.Label',
    });
    expect(entries.at(-1)).toEqual({
      uid: 'Example.Widgets.NoPage',
      name: 'NoPage',
      commentId: 'T:Example.Widgets.NoPage',
    });
  });

  it('handles Windows line endings, escapes and files without references', () => {
    const yaml = [
      'references:',
      "- uid: 'It''s'",
      '  name: "Say \\"hi\\""',
      '  href: "broken \\q escape"',
      '  fullName:',
      '- uid:',
      '  name: Orphan',
      '- uid: Last',
    ].join('\r\n');

    expect(parseXrefmap(yaml)).toEqual([
      { uid: "It's", name: 'Say "hi"', href: 'broken \\q escape' },
      { uid: 'Last' },
    ]);
    expect(parseXrefmap(EMPTY_XREFMAP)).toEqual([]);
    expect(parseXrefmap('')).toEqual([]);
  });
});

describe('docfx-net record builders', () => {
  it('collects the kind of every topic of a table of contents', () => {
    const kinds = tocKinds([
      { topicUid: 'A', type: 'Namespace', items: [{ topicUid: 'A.B', type: 'Struct' }, null, 'x'] },
      { topicUid: 'C' },
      { type: 'Class' },
    ]);
    expect([...kinds]).toEqual([
      ['A', 'namespace'],
      ['A.B', 'struct'],
    ]);
  });

  it('keeps entries without a documentation id as plain pages of the reference', () => {
    const records = xrefRecords(bound(), [
      { uid: 'guide.intro', name: 'Introduction', href: 'concepts/intro.html' },
      { uid: 'Global', name: 'Global()', href: 'api/Global.html', commentId: 'M:Global' },
    ]);

    expect(records[0]).toMatchObject({ title: 'Introduction', locator: { uid: 'guide.intro' } });
    expect(records[0]?.symbol).toBeUndefined();
    expect(records[0]?.qualified).toBeUndefined();
    // A member without a containing type cannot name a parent.
    expect(records[1]).toMatchObject({
      symbol: 'Global',
      qualified: 'Global',
      symbolKind: 'method',
    });
    expect(records[1]?.parent).toBeUndefined();
  });
});
