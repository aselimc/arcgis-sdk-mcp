import { describe, expect, it } from 'vitest';
import { docfxEsriAdapter } from '../../../../src/adapters/site/docfx-esri.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, replaceResponses } from '../contract.js';

const ROOT = 'https://doc.esri.com/en/widgets-pro/latest/';
const TOOLS = `${ROOT}tool-reference/`;
const PYTHON = `${ROOT}arcpy/`;
const TOOLS_TOC = `${TOOLS}toc.json`;
const SITEMAP = `${ROOT}sitemap.xml`;
const BEVEL = `${TOOLS}shaping/bevel-2.html`;
const EXPLORER = `${TOOLS}data-management/open-widget-explorer.html`;

const tools = makeSource(
  'docfx-esri',
  {
    slug: 'widgets-pro',
    scope: 'tool-reference/',
    toc: 'tool-reference/toc.json',
    symbols: 'toc',
    gpParameters: true,
  },
  {
    id: 'tools',
    title: 'Tool reference',
    kinds: ['api', 'guide'],
    floor: false,
    probe: { url: TOOLS_TOC, expect: 'json', family: 'docfx-esri', minRecords: 5 },
  },
);
const python = makeSource(
  'docfx-esri',
  { slug: 'widgets-pro', scope: 'arcpy/', symbols: 'toc' },
  {
    id: 'arcpy',
    title: 'Python reference',
    kinds: ['api', 'guide'],
    probe: { url: `${PYTHON}toc.json`, expect: 'json', family: 'docfx-esri' },
  },
);
const product = makeProduct({
  id: 'widgets-pro',
  name: 'Widgets Pro',
  homepage: ROOT,
  languages: ['python'],
  sources: [python, tools],
});

const HELP_ROOT = 'https://doc.esri.com/en/widget-server/latest/';
const help = makeSource(
  'docfx-esri',
  { slug: 'widget-server', sections: ['install', 'use/'] },
  {
    id: 'help',
    title: 'Widget Server help',
    kinds: ['help'],
    probe: { url: `${HELP_ROOT}sitemap.xml`, expect: 'xml', family: 'docfx-esri', minRecords: 2 },
  },
);
const helpProduct = makeProduct({
  id: 'widget-server',
  name: 'Widget Server',
  homepage: HELP_ROOT,
  sources: [help],
});

const proCassette = () => loadCassette('cassettes', 'site', 'help', 'docfx-pro.json');
const helpCassette = () => loadCassette('cassettes', 'site', 'help', 'docfx-help.json');
const proCtx = (): TestCtx => makeCtx({ cassette: proCassette() });
const helpCtx = (): TestCtx => makeCtx({ cassette: helpCassette() });
const boundTools = () => bindSource(product, tools, makeLine());
const withoutSiteIndex = (ctx: TestCtx): TestCtx => {
  ctx.policy = fakePolicy({
    enabled: [...ctx.config.capabilities].filter((cap) => cap !== 'site-index'),
  });
  return ctx;
};
const byRef = (records: CatalogRecord[], ref: string) =>
  records.find((record) => record.ref === ref);
const symbols = (records: CatalogRecord[]) =>
  records.flatMap((record) => (record.qualified === undefined ? [] : [record.qualified]));

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
      arrange: (ctx) => replaceResponses(ctx, proCassette(), { [TOOLS_TOC]: { json: { items: [] } } }),
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
      minRecords: 4,
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

    expect(records.map((record) => [record.ref.slice(TOOLS.length), record.title, record.kind])).toEqual([
      ['main/widget-tool-reference.html', 'Widget tool reference', 'guide'],
      ['shaping/an-overview-of-the-shaping-toolbox.html', 'An overview of the Shaping toolbox', 'guide'],
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

  it('corrects a derived name from the page once it has been read (risk R5)', async () => {
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

  it('leaves pages without a call alone when the catalogue did not list them as tools', async () => {
    const ctx = proCtx();
    const page = await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(EXPLORER) });
    expect(page.kind).toBe('api');
    expect(ctx.cache.writes.derived).toBe(0);
    // Neither does a page outside the two-level toolbox layout.
    ctx.http.on(`${TOOLS}main/widget-tool-reference.html`, { body: '<main>arcpy.x.Y(a)</main>' });
    await docfxEsriAdapter.read(ctx, boundTools(), {
      url: new URL(`${TOOLS}main/sub/widget-tool-reference.html`.replace('/sub', '')),
    });
    expect(ctx.cache.writes.derived).toBe(1);
    ctx.http.on(`${TOOLS}a/b/c.html`, { body: '<main>arcpy.x.Y(a)</main>' });
    await docfxEsriAdapter.read(ctx, boundTools(), { url: new URL(`${TOOLS}a/b/c.html`) });
    expect(ctx.cache.writes.derived).toBe(1);
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
      `Sitemap ${SITEMAP} is unavailable; enumerating without it`,
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

describe('docfx-esri: Python reference', () => {
  const bound = () => bindSource(product, python, makeLine());

  it('reads the table of contents of its scope and qualifies classes and functions', async () => {
    const ctx = proCtx();
    const records = await docfxEsriAdapter.enumerate!(ctx, bound());

    expect(ctx.http.requests.map((request) => request.url)).toEqual([`${PYTHON}toc.json`, SITEMAP]);
    expect(
      records
        .filter((record) => record.qualified !== undefined)
        .map((record) => [record.qualified, record.symbolKind, record.kind, record.language]),
    ).toEqual([
      ['arcpy.ListWidgets', 'function', 'api', 'python'],
      ['arcpy.WidgetShape', 'class', 'api', 'python'],
      ['arcpy.da.WidgetCursor', 'class', 'api', 'python'],
      ['arcpy.da.Walk', 'function', 'api', 'python'],
      ['arcpy.nax.Route', 'class', 'api', 'python'],
      ['arcpy.nax.RouteShapeType', 'class', 'api', 'python'],
      ['arcpy.na.GetSolverProperties', 'function', 'api', 'python'],
      ['arcpy.gadget_kit.GadgetDraft', 'class', 'api', 'python'],
      ['arcpy.gadget_kit.MakeGadget', 'function', 'api', 'python'],
    ]);
    expect(
      records.filter((record) => record.qualified === undefined).map((record) => record.title),
    ).toEqual([
      'Widget Python reference',
      'What is WidgetPy?',
      'Widget properties',
      'What is the Data Access module',
      'Python window',
    ]);
    expect(byRef(records, `${PYTHON}data-access/walk.html`)).toMatchObject({
      symbol: 'Walk',
      breadcrumb: 'Data Access module > Functions',
    });
  });

  it('does not check Python names on pages of a source that is not a tool reference', async () => {
    const ctx = proCtx();
    const page = await docfxEsriAdapter.read(ctx, bound(), {
      url: new URL(`${PYTHON}functions/listwidgets.html`),
    });
    expect(page).toMatchObject({ kind: 'api', source: 'arcpy', product: 'widgets-pro' });
    expect(ctx.cache.reads.derived).toBe(0);
  });

  it('lists entries as plain pages when the source derives no symbols', async () => {
    const plain = makeSource('docfx-esri', { slug: 'widgets-pro', scope: 'arcpy/' }, { kinds: ['api'] });
    const src = bindSource(makeProduct({ sources: [plain] }), plain, makeLine());
    const records = await docfxEsriAdapter.enumerate!(proCtx(), src);
    expect(records).toHaveLength(14);
    // With `api` as the only kind of the source there is nothing else to call a page.
    expect(records.every((record) => record.qualified === undefined && record.kind === 'api')).toBe(
      true,
    );
  });
});

describe('docfx-esri: help books', () => {
  const bound = () => bindSource(helpProduct, help, makeLine());

  it('reads one table of contents per section, with the section as the outermost level', async () => {
    const ctx = helpCtx();
    const records = await docfxEsriAdapter.enumerate!(ctx, bound());

    expect(
      records.map((record) => [record.ref.slice(HELP_ROOT.length), record.title, record.breadcrumb]),
    ).toEqual([
      ['install/system-requirements.html', 'Before you install', 'Install'],
      ['install/supported-platforms.html', 'Supported platforms', 'Install > Before you install'],
      ['install/install-the-server.html?pivots=os-linux', 'Install the server', 'Install'],
      ['use/what-is-a-widget-server-.html', 'What is a widget server?', 'Use > Introduction'],
      ['install/upgrade-notes.html', 'Upgrade notes', undefined],
    ]);
    expect(records.every((record) => record.kind === 'help')).toBe(true);
    expect(ctx.http.requests.map((request) => request.url.slice(HELP_ROOT.length))).toEqual([
      'install/toc.json',
      'use/toc.json',
      'sitemap.xml',
    ]);
  });

  it('survives the loss of one section file', async () => {
    const ctx = helpCtx();
    ctx.http.fail(`${HELP_ROOT}use/toc.json`, 503);
    const records = await docfxEsriAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => record.title)).toEqual([
      'Before you install',
      'Supported platforms',
      'Install the server',
      'Upgrade notes',
      'What is a widget server ',
    ]);
  });

  it('finds the books through the root file when the source names neither scope nor sections', async () => {
    const whole = makeSource('docfx-esri', { slug: 'widget-server' }, { id: 'help', kinds: ['help'] });
    const src = bindSource(makeProduct({ sources: [whole] }), whole, makeLine());
    const ctx = helpCtx();
    const records = await docfxEsriAdapter.enumerate!(ctx, src);

    expect(ctx.http.requests.map((request) => request.url.slice(HELP_ROOT.length))).toEqual([
      'toc.json',
      'install/toc.json',
      'use/toc.json',
      'sitemap.xml',
    ]);
    expect(records.map((record) => [record.title, record.breadcrumb])).toEqual([
      ['Before you install', 'Install'],
      ['Supported platforms', 'Install > Before you install'],
      ['Install the server', 'Install'],
      ['What is a widget server?', 'Use > Introduction'],
      ['Upgrade notes', undefined],
      ['Back up the server', undefined],
    ]);
  });

  it('falls back to the sitemap when the root file names no book', async () => {
    const whole = makeSource('docfx-esri', { slug: 'widget-server' }, { kinds: ['help'] });
    const src = bindSource(makeProduct({ sources: [whole] }), whole, makeLine());
    const ctx = helpCtx();
    replaceResponses(ctx, helpCassette(), { [`${HELP_ROOT}toc.json`]: { json: { items: [] } } });
    expect(await docfxEsriAdapter.enumerate!(ctx, src)).toHaveLength(4);
    expect(ctx.logger.messages('warn')).toEqual([
      'The root table of contents is unavailable; enumerating without it',
    ]);
  });

  it('reads at most eight section files and leaves the rest to the sitemap', async () => {
    const sections = Array.from({ length: 11 }, (_, index) => `book-${index}`);
    const many = makeSource('docfx-esri', { slug: 'widget-server', sections }, { kinds: ['help'] });
    const src = bindSource(makeProduct({ sources: [many] }), many, makeLine());
    const ctx = makeCtx();
    ctx.http.on(/toc\.json$/, { json: { items: [{ name: 'Start', href: 'start.html' }] } });
    ctx.http.on(`${HELP_ROOT}sitemap.xml`, {
      body: `<urlset><url><loc>${HELP_ROOT}book-10/start.html</loc></url></urlset>`,
    });
    const records = await docfxEsriAdapter.enumerate!(ctx, src);
    expect(records.map((record) => record.title)).toEqual([...Array<string>(9).fill('Start')]);
    expect(ctx.http.count(/toc\.json$/)).toBe(8);
    expect(ctx.http.count()).toBeLessThanOrEqual(docfxEsriAdapter.maxEnumerateRequests);
  });

  it('reads a page as the first kind of the source unless a record says otherwise', async () => {
    const ctx = helpCtx();
    const url = new URL(`${HELP_ROOT}install/system-requirements.html`);
    expect((await docfxEsriAdapter.read(ctx, bound(), { url })).kind).toBe('help');
    const [record] = await docfxEsriAdapter.enumerate!(ctx, bound());
    const page = await docfxEsriAdapter.read(ctx, bound(), {
      url,
      record: { ...record!, kind: 'release-notes' },
    });
    expect(page.kind).toBe('release-notes');
    expect(ctx.render.calls.at(-1)?.input).toMatchObject({ familyHint: 'docfx-esri' });
  });
});

describe('docfx-esri: probe', () => {
  it('counts the pages of a table-of-contents canary', async () => {
    expect(await docfxEsriAdapter.probe(proCtx(), boundTools())).toMatchObject({
      ok: true,
      records: 15,
    });
  });

  it('probes the sitemap instead while site-index is off', async () => {
    const ctx = withoutSiteIndex(proCtx());
    expect(await docfxEsriAdapter.probe(ctx, boundTools())).toMatchObject({ ok: true, records: 8 });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([SITEMAP]);
  });

  it('runs a sitemap canary as declared', async () => {
    const result = await docfxEsriAdapter.probe(helpCtx(), bindSource(helpProduct, help, makeLine()));
    expect(result).toMatchObject({ ok: true, records: 4 });
  });

  it('reports a table of contents of another shape', async () => {
    const ctx = proCtx();
    replaceResponses(ctx, proCassette(), { [TOOLS_TOC]: { json: { entries: [] } } });
    expect(await docfxEsriAdapter.probe(ctx, boundTools())).toMatchObject({
      ok: false,
      error: 'Expected at least 5 records, found 0',
    });
    ctx.http.fail(TOOLS_TOC, 'truncated');
    expect((await docfxEsriAdapter.probe(ctx, boundTools())).ok).toBe(false);
  });
});
