import { describe, expect, it } from 'vitest';
import { docfxEsriAdapter } from '../../../../src/adapters/site/docfx-esri.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { makeDocPage, makeLine, makeRecord } from '../../../support/builders.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf, replaceResponses } from '../contract.js';
import {
  BEVEL,
  EXPLORER,
  HELP_ROOT,
  ROOT,
  SITEMAP,
  TOOLS,
  TOOLS_TOC,
  boundTools,
  byRef,
  help,
  helpCassette,
  helpCtx,
  helpProduct,
  proCassette,
  proCtx,
  product,
  symbols,
  tools,
  withoutSiteIndex,
} from './docfx-setup.js';

describeSiteAdapterContract('docfx-esri (tool reference)', () => ({
  adapter: docfxEsriAdapter,
  product,
  source: tools,
  ctx: proCtx,
  allowedHosts: ['doc.esri.com'],
  minRecords: 13,
  readRef: BEVEL,
  siteIndexFiles: [/toc\.json$/],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, proCassette(), {
          [TOOLS_TOC]: { json: { children: [{ title: 'Round Corners', url: 'shaping/r.html' }] } },
        }),
      outcome: 'degraded',
      minRecords: 4,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(TOOLS_TOC, 404),
      outcome: 'degraded',
      minRecords: 4,
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, proCassette(), { [TOOLS_TOC]: { json: { items: [] } } }),
      outcome: 'degraded',
      minRecords: 4,
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(TOOLS_TOC, 'html'),
      outcome: 'degraded',
      minRecords: 4,
    },
  },
}));

describeSiteAdapterContract('docfx-esri (help books)', () => ({
  adapter: docfxEsriAdapter,
  product: helpProduct,
  source: help,
  ctx: helpCtx,
  allowedHosts: ['doc.esri.com'],
  minRecords: 5,
  readRef: `${HELP_ROOT}install/system-requirements.html`,
  siteIndexFiles: [/toc\.json$/],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, helpCassette(), {
          [`${HELP_ROOT}install/toc.json`]: { json: { entries: [] } },
        }),
      outcome: 'degraded',
      minRecords: 3,
    },
    missingFile: {
      // Nothing of the product is left: neither a table of contents nor the sitemap.
      arrange: (ctx) => ctx.http.fail(/widget-server/, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) => {
        ctx.http.fail(/toc\.json$/, 404);
        ctx.http.fail(/sitemap\.xml$/, 'empty');
      },
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(/toc\.json$/, 'html'),
      outcome: 'degraded',
      minRecords: 3,
    },
  },
}));

describe('docfx-esri: tool reference', () => {
  it('lists the table of contents first, then the pages only the sitemap knows', async () => {
    const ctx = proCtx();
    const records = await docfxEsriAdapter.enumerate!(ctx, boundTools());

    expect(
      records.map((record) => [record.ref.slice(TOOLS.length), record.title, record.kind]),
    ).toEqual([
      ['main/widget-tool-reference.html', 'Widget tool reference', 'guide'],
      [
        'shaping/an-overview-of-the-shaping-toolbox.html',
        'An overview of the Shaping toolbox',
        'guide',
      ],
      ['shaping/shaping-toolbox-history.html', 'Shaping toolbox history', 'guide'],
      ['shaping/round-corners.html', 'Round Corners', 'api'],
      ['shaping/split-widget-at-seam.html', 'Split Widget at Seam', 'api'],
      ['shaping/bevel-edges.html', 'Bevel Edges (multiple)', 'api'],
      ['shaping/bevel-2.html', 'Wide Bevel', 'api'],
      ['shaping/how-bevel-edges-works.html', 'How Bevel Edges Works', 'guide'],
      ['data-management/count-widgets.html', 'Count Widgets', 'api'],
      ['data-management/eighty-twenty-sorting.html', '80-20 Sorting', 'api'],
      ['data-management/open-widget-explorer.html', 'Open Widget Explorer', 'api'],
      [
        'tool-errors-and-warnings/000001-010000/tool-errors-and-warnings-000001.html',
        '000001: The widget is not round',
        'guide',
      ],
      // Listed by the sitemap only, under its release number: rewritten to `latest`, slug title.
      ['shaping/retired-chamfer-tool.html', 'Retired chamfer tool', 'guide'],
    ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([TOOLS_TOC, SITEMAP]);
  });

  it('derives the Python name of each tool from its toolbox directory and title', async () => {
    const records = await docfxEsriAdapter.enumerate!(proCtx(), boundTools());

    expect(symbols(records)).toEqual([
      'arcpy.shaping.RoundCorners',
      'arcpy.shaping.SplitWidgetAtSeam',
      'arcpy.shaping.BevelEdges',
      'arcpy.shaping.WideBevel',
      'arcpy.management.CountWidgets',
      'arcpy.management.EightyTwentySorting',
      'arcpy.management.OpenWidgetExplorer',
    ]);
    expect(byRef(records, `${TOOLS}data-management/count-widgets.html`)).toEqual({
      ref: `${TOOLS}data-management/count-widgets.html`,
      product: 'widgets-pro',
      source: 'tools',
      line: 'latest',
      kind: 'api',
      title: 'Count Widgets',
      breadcrumb: 'Geoprocessing tools > Data Management toolbox',
      symbol: 'CountWidgets',
      qualified: 'arcpy.management.CountWidgets',
      symbolKind: 'tool',
      keywords: ['CountWidgets_management', 'data-management'],
      language: 'python',
      license: 'esri-website-terms',
    });
    // Tools are pages of their own, not members of a type.
    expect(records.every((record) => record.parent === undefined)).toBe(true);
    expect(byRef(records, BEVEL)?.breadcrumb).toBe(
      'Geoprocessing tools > Shaping toolbox > Edges toolset',
    );
  });

  it('corrects a derived name from the page once it has been read', async () => {
    const ctx = proCtx();
    const before = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    const record = byRef(before, BEVEL)!;
    expect(record.qualified).toBe('arcpy.shaping.WideBevel');

    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(BEVEL), record });
    expect(page.notices).toEqual([
      'The catalogue listed this tool as arcpy.shaping.WideBevel; the page documents arcpy.shape.Bevel2.',
    ]);

    const after = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    expect(byRef(after, BEVEL)).toMatchObject({
      symbol: 'Bevel2',
      qualified: 'arcpy.shape.Bevel2',
      keywords: ['Bevel2_shape', 'shaping'],
    });
    // The page also taught the alias of its toolbox, which the other tools of it now use.
    expect(symbols(after).slice(0, 3)).toEqual([
      'arcpy.shape.RoundCorners',
      'arcpy.shape.SplitWidgetAtSeam',
      'arcpy.shape.BevelEdges',
    ]);
    expect(byRef(after, `${TOOLS}data-management/count-widgets.html`)?.qualified).toBe(
      'arcpy.management.CountWidgets',
    );

    // Reading it again by its corrected record changes nothing and says nothing.
    const writes = ctx.cache.writes.derived;
    const again = await docfxEsriAdapter.read(ctx, boundTools(), {
      url: new URL(BEVEL),
      record: byRef(after, BEVEL)!,
    });
    expect(again.notices).toEqual([]);
    expect(ctx.cache.writes.derived).toBe(writes);
  });

  it('records the name of a tool page read by URL, without a notice', async () => {
    const ctx = proCtx();
    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(`${BEVEL}#usage`) });
    expect(page.notices).toEqual([]);
    expect(page.ref).toBe(`${BEVEL}#usage`);
    const records = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    expect(byRef(records, BEVEL)?.qualified).toBe('arcpy.shape.Bevel2');
  });

  it('drops the symbol of a listed tool whose page documents no Python call', async () => {
    const ctx = proCtx();
    const before = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    const record = byRef(before, EXPLORER)!;

    // A slice of the page proves nothing: the syntax line may be elsewhere.
    const slice = await docfxEsriAdapter.read(ctx, boundTools(), {
      url: new URL(EXPLORER),
      record,
      select: { section: 'steps' },
    });
    expect(slice.notices).toEqual([]);
    expect(ctx.cache.writes.derived).toBe(0);

    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(EXPLORER), record });
    expect(page.notices).toEqual([
      'The catalogue listed this page as arcpy.management.OpenWidgetExplorer, but it documents no Python call.',
    ]);
    const after = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    expect(byRef(after, EXPLORER)).toMatchObject({ kind: 'guide', title: 'Open Widget Explorer' });
    expect(byRef(after, EXPLORER)?.qualified).toBeUndefined();
  });

  it('records nothing for a page without a call that was not listed as a tool, or outside the toolbox layout', async () => {
    const ctx = proCtx();
    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(EXPLORER) });
    expect(page.kind).toBe('api');
    ctx.http.on(`${TOOLS}a/b/c.html`, { body: '<main>arcpy.x.Y(a)</main>' });
    await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(`${TOOLS}a/b/c.html`) });
    expect(ctx.cache.writes.derived).toBe(0);
  });

  it('still returns the page when the name cannot be recorded', async () => {
    const ctx = proCtx();
    ctx.cache.putDerived = () => Promise.reject(new Error('disk full'));
    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(BEVEL) });
    expect(page.sections.length).toBeGreaterThan(0);
    expect(ctx.logger.messages('warn')).toEqual([
      'The Python name of a tool page could not be recorded',
    ]);
  });

  // Regression: the tools of a toolbox that is used as `from arcpy.<alias> import *` write
  // their call without the module. Such a page was taken for a topic: a lookup printed "it
  // documents no Python call" above the call, stored that verdict, and the next catalogue
  // no longer had the tool.
  describe('a tool page that writes its call without the module', () => {
    const TILT = `${TOOLS}surface-analyst/tilt.html`;
    const record = makeRecord({
      ref: TILT,
      product: 'widgets-pro',
      source: 'tools',
      kind: 'api',
      title: 'Tilt',
      symbol: 'Tilt',
      qualified: 'arcpy.surfaceanalyst.Tilt',
      symbolKind: 'tool',
    });
    const tiltPage = (call: string): string =>
      [
        '# Tilt (Surface Analyst Tools)',
        '',
        '## Summary',
        '',
        'Finds the tilt of each cell of a widget surface.',
        '',
        '## Parameters',
        '',
        ...(call === '' ? [] : ['```python', call, '```', '']),
        '**`in_surface`** — _Raster Layer_, required',
        '',
        '## Code sample',
        '',
        '```python',
        'from arcpy.surfaceanalyst import *',
        'out = Tilt("heights", 0.3)',
        'arcpy.management.CountWidgets(out)',
        '```',
      ].join('\n');
    /** A context whose renderer answers the page with the given Markdown as its conversion. */
    const ctxWith = (markdown: string): TestCtx => {
      const ctx = proCtx();
      ctx.http.on(TILT, { body: '<main><h1>Tilt</h1></main>' });
      rendererOf(ctx).when('html', (rendered) =>
        makeDocPage({ markdown, url: rendered.meta.url, kind: rendered.meta.kind }),
      );
      return ctx;
    };

    it('takes the unqualified syntax line for the call, in the toolbox of the page', async () => {
      const ctx = ctxWith(tiltPage('Tilt(in_surface, {z_factor})'));
      const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(TILT), record });

      expect(page.notices).toEqual([]);
      // What was learnt is the tool's own name, never "this page is not a tool".
      const stored = await ctx.cache.getDerived<{ names: Record<string, string | null> }>(
        'symbols',
        'docfx-esri/tool-names/v2/widgets-pro/tool-reference/latest',
      );
      expect(stored?.names).toEqual({ 'surface-analyst/tilt.html': 'arcpy.surfaceanalyst.Tilt' });
    });

    it('never drops a page with parameters from the index, whatever its syntax line looks like', async () => {
      const ctx = ctxWith(tiltPage('').replace('arcpy.management.CountWidgets(out)', 'print(out)'));
      const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(TILT), record });

      expect(page.notices).toEqual([]);
      expect(ctx.cache.writes.derived).toBe(0);
    });

    it('leaves the verdicts of the earlier rule behind', async () => {
      const ctx = proCtx();
      // What a lookup of such a tool had stored before: the page "documents no Python call".
      await ctx.cache.putDerived(
        'symbols',
        'docfx-esri/tool-names/widgets-pro/tool-reference/latest',
        {
          aliases: {},
          names: { 'shaping/bevel-2.html': null },
        },
      );
      const records = await docfxEsriAdapter.enumerate!(ctx, boundTools());
      expect(byRef(records, BEVEL)).toMatchObject({ symbolKind: 'tool', kind: 'api' });
    });
  });

  it('falls back to the sitemap with slug titles while site-index is off', async () => {
    const ctx = withoutSiteIndex(proCtx());
    const records = await docfxEsriAdapter.enumerate!(ctx, boundTools());
    expect(records.map((record) => [record.title, record.kind, record.qualified])).toEqual([
      ['Widget tool reference', 'guide', undefined],
      ['Round corners', 'guide', undefined],
      ['Bevel 2', 'guide', undefined],
      ['Retired chamfer tool', 'guide', undefined],
    ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([SITEMAP]);
  });

  it('keeps the table of contents when the sitemap is unavailable', async () => {
    const ctx = proCtx();
    ctx.http.fail(SITEMAP, 503);
    expect(await docfxEsriAdapter.enumerate!(ctx, boundTools())).toHaveLength(12);
    expect(ctx.logger.messages('warn')).toEqual([
      `Sitemap ${SITEMAP} is unavailable; continuing without it`,
    ]);
  });

  it('fails with the first error when neither listing answers', async () => {
    const ctx = proCtx();
    ctx.http.fail(TOOLS_TOC, 'truncated');
    ctx.http.fail(SITEMAP, 404);
    await expect(docfxEsriAdapter.enumerate!(ctx, boundTools())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: TOOLS_TOC },
    });
  });

  it('is a typed failure when the listings name no page of the source', async () => {
    const ctx = makeCtx();
    ctx.http.on(TOOLS_TOC, { json: { items: [{ name: 'Elsewhere', href: '../help/a.html' }] } });
    ctx.http.on(SITEMAP, { body: `<urlset><url><loc>${ROOT}help/a.html</loc></url></urlset>` });
    await expect(docfxEsriAdapter.enumerate!(ctx, boundTools())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      message: `${TOOLS_TOC} is not a readable table of contents`,
      details: { why: 'It lists no page of this source', retryable: false },
    });

    const quiet = withoutSiteIndex(makeCtx());
    quiet.http.on(SITEMAP, { body: `<urlset><url><loc>${ROOT}help/a.html</loc></url></urlset>` });
    await expect(docfxEsriAdapter.enumerate!(quiet, boundTools())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'No page of Tool reference could be listed',
      details: { url: ROOT },
    });
  });

  it('rejects rather than list part of a source when the request budget runs out', async () => {
    const ctx = proCtx();
    const src = bindSource(product, tools, makeLine(), undefined, newBudget(1, 60_000, ctx.clock));
    await expect(docfxEsriAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('does not list a link-only line', async () => {
    const ctx = proCtx();
    const src = bindSource(product, tools, makeLine({ access: 'link-only' }));
    await expect(docfxEsriAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { url: ROOT },
    });
    expect(ctx.http.count()).toBe(0);
  });
});
