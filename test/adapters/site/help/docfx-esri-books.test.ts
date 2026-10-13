import { describe, expect, it } from 'vitest';
import { docfxEsriAdapter } from '../../../../src/adapters/site/docfx-esri.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import { makeCtx } from '../../../support/make-ctx.js';
import { replaceResponses } from '../contract.js';
import {
  HELP_ROOT,
  PYTHON,
  SITEMAP,
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
  python,
  withoutSiteIndex,
} from './docfx-setup.js';

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
    const plain = makeSource(
      'docfx-esri',
      { slug: 'widgets-pro', scope: 'arcpy/' },
      { kinds: ['api'] },
    );
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
      records.map((record) => [
        record.ref.slice(HELP_ROOT.length),
        record.title,
        record.breadcrumb,
      ]),
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
      'What is a widget server',
    ]);
  });

  it('finds the books through the root file when the source names neither scope nor sections', async () => {
    const whole = makeSource(
      'docfx-esri',
      { slug: 'widget-server' },
      { id: 'help', kinds: ['help'] },
    );
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
    const render = new FakeRenderer();
    const ctx = helpCtx(render);
    const url = new URL(`${HELP_ROOT}install/system-requirements.html`);
    expect((await docfxEsriAdapter.read(ctx, bound(), { url })).kind).toBe('help');
    const [record] = await docfxEsriAdapter.enumerate!(ctx, bound());
    const page = await docfxEsriAdapter.read(ctx, bound(), {
      url,
      record: { ...record!, kind: 'release-notes' },
    });
    expect(page.kind).toBe('release-notes');
    expect(render.calls.at(-1)?.input).toMatchObject({ familyHint: 'docfx-esri' });
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
    const result = await docfxEsriAdapter.probe(
      helpCtx(),
      bindSource(helpProduct, help, makeLine()),
    );
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
