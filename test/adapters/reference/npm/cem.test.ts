import { afterEach, describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { npmCemAdapter } from '../../../../src/adapters/reference/npm/cem.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import type { SourceDef } from '../../../../src/core/types.js';
import { describeAdapterContract } from '../../../support/adapter-contract.js';
import { makeLine } from '../../../support/builders.js';
import { readFixture, readJsonFixture } from '../../../support/fixtures.js';
import {
  cdnFile,
  componentsSource,
  distTags,
  makeProject,
  npmCtx,
  productOf,
  removeProjects,
  resolved,
  shortTagSource,
} from './helpers.js';

const WIDGETS = '@arcgis/widget-components';
const CHARTS = '@arcgis/chart-widgets';
const GADGETS = '@esri/gadget-components';
const FILE = 'dist/docs/api.json';
const REFS = 'https://developers.arcgis.com/widgets/latest/references/';
const PANEL_REF = `${REFS}widget-components/components/arcgis-gadget-panel/`;
const CHART_REF = `${REFS}chart-widgets/components/arcgis-spark-chart/`;
const product = productOf(componentsSource);
const bindTo = (source: SourceDef<'npm-cem'>, version?: string) =>
  bindSource(productOf(source), source, makeLine(), version);
const bound = (version?: string) => bindTo(componentsSource, version);

afterEach(removeProjects);

describeAdapterContract('npm-cem', () => ({
  adapter: npmCemAdapter,
  product,
  source: componentsSource,
  ctx: () => npmCtx({ cassette: 'cem.json' }),
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 9,
  readRef: PANEL_REF,
}));

describe('npm-cem enumerate', () => {
  it('lists components and their public members across the packages', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const records = await npmCemAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => record.ref.slice(REFS.length))).toEqual([
      'widget-components/components/arcgis-gadget-panel/',
      'widget-components/components/arcgis-gadget-panel/#heading',
      'widget-components/components/arcgis-gadget-panel/#collapsed',
      'widget-components/components/arcgis-gadget-panel/#legacyMode',
      'widget-components/components/arcgis-gadget-panel/#refresh',
      'widget-components/components/arcgis-gadget-panel/#event-arcgisGadgetReady',
      'widget-components/components/arcgis-gadget-panel/#event-arcgisGadgetToggle',
      'chart-widgets/components/arcgis-spark-chart/',
      'chart-widgets/components/arcgis-spark-chart/#field',
      'chart-widgets/components/arcgis-spark-chart/#event-arcgisChartDrawn',
    ]);
    expect(ctx.http.count()).toBe(4);
  });

  it('describes a component as a symbol of kind component', async () => {
    const [component] = await npmCemAdapter.enumerate!(npmCtx({ cassette: 'cem.json' }), bound());
    expect(component).toEqual({
      ref: PANEL_REF,
      product: 'widgets-sdk',
      source: 'components',
      line: 'latest',
      kind: 'api',
      title: 'arcgis-gadget-panel',
      symbol: 'arcgis-gadget-panel',
      qualified: 'arcgis-gadget-panel',
      symbolKind: 'component',
      breadcrumb: WIDGETS,
      keywords: ['ArcgisGadgetPanel', WIDGETS],
      locator: { package: WIDGETS, tag: 'arcgis-gadget-panel' },
      description: 'Shows gadgets in a collapsible panel.',
      license: 'esri-ma',
    });
  });

  it('describes members with their owner, kind and deprecation', async () => {
    const records = await npmCemAdapter.enumerate!(npmCtx({ cassette: 'cem.json' }), bound());
    const byQualified = new Map(records.map((record) => [record.qualified, record]));
    expect(byQualified.get('arcgis-gadget-panel.heading')).toEqual({
      ref: `${PANEL_REF}#heading`,
      product: 'widgets-sdk',
      source: 'components',
      line: 'latest',
      kind: 'api',
      title: 'heading',
      symbol: 'heading',
      qualified: 'arcgis-gadget-panel.heading',
      symbolKind: 'property',
      parent: 'arcgis-gadget-panel',
      breadcrumb: `${WIDGETS} > arcgis-gadget-panel`,
      locator: { package: WIDGETS, tag: 'arcgis-gadget-panel' },
      description: 'Text shown in the panel header.',
      license: 'esri-ma',
    });
    expect(byQualified.get('arcgis-gadget-panel.refresh')).toMatchObject({ symbolKind: 'method' });
    expect(byQualified.get('arcgis-gadget-panel.arcgisGadgetReady')).toMatchObject({
      symbolKind: 'event',
      ref: `${PANEL_REF}#event-arcgisGadgetReady`,
    });
    // Deprecation comes as a field on some entries and as a doc tag on others.
    expect(byQualified.get('arcgis-gadget-panel.legacyMode')?.deprecated).toBe(true);
    expect(byQualified.get('arcgis-gadget-panel.arcgisGadgetToggle')?.deprecated).toBe(true);
    expect(byQualified.get('arcgis-gadget-panel.heading')?.deprecated).toBeUndefined();
  });

  it('leaves out private members, runtime methods, internal components and non-components', async () => {
    const records = await npmCemAdapter.enumerate!(npmCtx({ cassette: 'cem.json' }), bound());
    const names = records.map((record) => record.symbol);
    for (const hidden of [
      'internalState',
      'componentOnReady',
      'arcgis-gadget-debugger',
      'verbose',
      'GadgetRow',
      'setAssetPath',
    ]) {
      expect(names, hidden).not.toContain(hidden);
    }
  });

  it('builds URLs from the tag without its prefix when the template asks for it', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const records = await npmCemAdapter.enumerate!(ctx, bindTo(shortTagSource));
    expect(records.map((record) => record.ref)).toEqual([
      'https://developers.arcgis.com/gadget-design-system/components/button/',
      'https://developers.arcgis.com/gadget-design-system/components/button/#kind',
      'https://developers.arcgis.com/gadget-design-system/components/split-button/',
    ]);
    expect(records[0]).toMatchObject({ symbol: 'gadget-button', title: 'gadget-button' });
  });

  it('reads installed packages without any request', async () => {
    const { projectDir } = makeProject({
      [WIDGETS]: {
        version: '7.1.9',
        files: {
          [FILE]: readFixture('cassettes', 'reference', 'npm', 'widget-components.api.json'),
        },
      },
      [CHARTS]: {
        version: '7.1.9',
        files: { [FILE]: readFixture('cassettes', 'reference', 'npm', 'chart-widgets.api.json') },
      },
    });
    const ctx = npmCtx({ projectDir });
    expect(await npmCemAdapter.enumerate!(ctx, bound())).toHaveLength(10);
    expect(ctx.http.count()).toBe(0);
  });

  it.each([
    ['a missing manifest', (url: string) => ({ url, fault: 404 as const })],
    ['a server error', (url: string) => ({ url, fault: 503 as const })],
    ['HTML instead of JSON', (url: string) => ({ url, fault: 'html' as const })],
    ['a truncated manifest', (url: string) => ({ url, fault: 'truncated' as const })],
    ['an oversized manifest', (url: string) => ({ url, fault: 'oversized' as const })],
  ])('keeps the other packages when one has %s', async (_name, make) => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const { url, fault } = make(cdnFile(CHARTS, '7.2.1', FILE));
    ctx.http.fail(url, fault);
    const records = await npmCemAdapter.enumerate!(ctx, bound());
    expect(records).toHaveLength(7);
    expect(records.every((record) => record.locator?.package === WIDGETS)).toBe(true);
    expect(ctx.logger.messages('warn')).toEqual([
      `The component manifest of ${CHARTS} is unavailable; continuing without it`,
    ]);
  });

  it('keeps the other packages when one manifest lost its modules field', async () => {
    const ctx = npmCtx();
    const good = readJsonFixture('cassettes', 'reference', 'npm', 'chart-widgets.api.json');
    ctx.http.on(distTags(WIDGETS), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(WIDGETS, '7.2.4', FILE), { json: { schemaVersion: '3.0.0', mods: [] } });
    ctx.http.on(distTags(CHARTS), { json: { latest: '7.2.1' } });
    ctx.http.on(cdnFile(CHARTS, '7.2.1', FILE), { json: good });
    const records = await npmCemAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => record.locator?.package)).toEqual([CHARTS, CHARTS, CHARTS]);
  });

  it('fails with the first typed error when no package can be read', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    ctx.http.fail(/cdn\.jsdelivr\.net/, 404);
    await expect(npmCemAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { host: 'cdn.jsdelivr.net' },
    });
  });

  it('returns nothing for manifests that declare no components', async () => {
    const ctx = npmCtx();
    for (const [name, version] of [
      [WIDGETS, '7.2.4'],
      [CHARTS, '7.2.1'],
    ] as const) {
      ctx.http.on(distTags(name), { json: { latest: version } });
      ctx.http.on(cdnFile(name, version, FILE), { json: { modules: [] } });
    }
    expect(await npmCemAdapter.enumerate!(ctx, bound())).toEqual([]);
  });

  it('survives a registry outage by asking the CDN for the current versions', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    ctx.http.fail(/registry\.npmjs\.org/, 503);
    ctx.http.on(resolved(WIDGETS, 'latest'), { json: { version: '7.2.4' } });
    ctx.http.on(resolved(CHARTS, 'latest'), { json: { version: '7.2.1' } });
    expect(await npmCemAdapter.enumerate!(ctx, bound())).toHaveLength(10);
    expect(ctx.http.count()).toBeLessThanOrEqual(npmCemAdapter.maxEnumerateRequests);
  });

  it('does not hide a spent request budget behind a partial catalogue', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const budget = newBudget(1, 1000, ctx.clock);
    await expect(npmCemAdapter.enumerate!(ctx, { ...bound(), budget })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('npm-cem read', () => {
  it('renders the component a documentation URL names from its package manifest', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const page = await npmCemAdapter.read(ctx, bound(), { url: new URL(CHART_REF) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      distTags(CHARTS),
      cdnFile(CHARTS, '7.2.1', FILE),
    ]);
    const [call] = ctx.render.calls;
    expect(call?.kind).toBe('cem');
    const input = call?.input as RendererInputs['cem'];
    expect(input).toMatchObject({ tag: 'arcgis-spark-chart', packageName: CHARTS });
    expect(input.member).toBeUndefined();
    expect(input.manifest).toEqual(
      readJsonFixture('cassettes', 'reference', 'npm', 'chart-widgets.api.json'),
    );
    expect(call?.meta).toMatchObject({
      url: CHART_REF,
      version: '7.2.1',
      kind: 'api',
      license: 'esri-ma',
      packageName: CHARTS,
    });
    expect(page).toMatchObject({
      ref: CHART_REF,
      version: '7.2.1',
      attribution:
        'From @arcgis/chart-widgets 7.2.1. Copyright Esri. Licensed under the Esri Master License Agreement.',
      notices: [],
    });
  });

  it('selects the member a fragment names', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const url = new URL(`${PANEL_REF}#event-arcgisGadgetReady`);
    const page = await npmCemAdapter.read(ctx, bound(), { url, detail: 'summary' });
    expect((ctx.render.calls[0]?.input as RendererInputs['cem']).member).toBe(
      'event-arcgisGadgetReady',
    );
    expect(ctx.render.calls[0]?.opts).toEqual({
      select: { member: 'event-arcgisGadgetReady' },
      detail: 'summary',
    });
    expect(page.ref).toBe(url.href);
  });

  it('finds a component by the short form of its tag', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const url = 'https://developers.arcgis.com/gadget-design-system/components/split-button/';
    const page = await npmCemAdapter.read(ctx, bindTo(shortTagSource), { url: new URL(url) });
    expect(ctx.render.calls[0]?.input).toMatchObject({
      tag: 'gadget-split-button',
      packageName: GADGETS,
    });
    expect(page.ref).toBe(url);

    await npmCemAdapter.read(ctx, bindTo(shortTagSource), {
      url: new URL('https://developers.arcgis.com/gadget-design-system/components/gadget-button/'),
    });
    expect(ctx.render.calls[1]?.input).toMatchObject({ tag: 'gadget-button' });
    expect(ctx.render.calls[1]?.meta.url).toBe(
      'https://developers.arcgis.com/gadget-design-system/components/button/',
    );
  });

  it('searches every package when the URL template does not name one', async () => {
    const source: SourceDef<'npm-cem'> = {
      ...componentsSource,
      config: { ...componentsSource.config, docUrl: '/widgets/latest/components/{tag}/' },
    };
    const ctx = npmCtx({ cassette: 'cem.json' });
    await npmCemAdapter.read(ctx, bindTo(source), {
      url: new URL('https://developers.arcgis.com/widgets/latest/components/arcgis-spark-chart/'),
    });
    expect(ctx.render.calls[0]?.input).toMatchObject({ packageName: CHARTS });
    expect(ctx.http.count()).toBe(4);
  });

  it('uses the record that led here and parses a manifest once', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const records = await npmCemAdapter.enumerate!(ctx, bound());
    const computes = ctx.cache.memoComputes;
    const record = records.find((candidate) => candidate.qualified === 'arcgis-spark-chart.field');
    const page = await npmCemAdapter.read(ctx, bound(), {
      url: new URL('https://developers.arcgis.com/elsewhere/'),
      record: record!,
    });
    expect(ctx.render.calls[0]?.input).toMatchObject({ tag: 'arcgis-spark-chart' });
    expect(ctx.cache.memoComputes).toBe(computes);
    // Nothing was fetched for this call, so the page is labelled as cached.
    expect(page.cache).toBe('hit');
  });

  it('reads the requested version and says so', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const manifest = readJsonFixture('cassettes', 'reference', 'npm', 'chart-widgets.api.json');
    ctx.http.on(resolved(CHARTS, '6.4'), { json: { version: '6.4.8' } });
    ctx.http.on(cdnFile(CHARTS, '6.4.8', FILE), { json: manifest });
    const page = await npmCemAdapter.read(ctx, bound('6.4'), { url: new URL(CHART_REF) });
    expect(page.version).toBe('6.4.8');
    expect(page.notices).toEqual([
      'Read from @arcgis/chart-widgets 6.4.8, the published release matching the requested version.',
    ]);
  });

  it('reads an installed package without any request', async () => {
    const { projectDir } = makeProject({
      [CHARTS]: {
        version: '7.1.9',
        files: { [FILE]: readFixture('cassettes', 'reference', 'npm', 'chart-widgets.api.json') },
      },
    });
    const ctx = npmCtx({ projectDir });
    const page = await npmCemAdapter.read(ctx, bound(), { url: new URL(CHART_REF) });
    expect(ctx.http.count()).toBe(0);
    expect(page).toMatchObject({ version: '7.1.9', retrievedAt: ctx.clock.iso(), cache: 'miss' });
    expect(page.notices[0]).toContain('as installed');
  });

  it('falls back to the published manifest when the installed one is damaged', async () => {
    const { projectDir } = makeProject({
      [CHARTS]: { version: '7.2.1', files: { [FILE]: '{ "modules": [' } },
    });
    const ctx = npmCtx({ cassette: 'cem.json', projectDir });
    const page = await npmCemAdapter.read(ctx, bound(), { url: new URL(CHART_REF) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      cdnFile(CHARTS, '7.2.1', FILE),
    ]);
    expect(page.version).toBe('7.2.1');
  });

  it.each([
    [`${REFS}widget-components/components/arcgis-unknown/`, 'arcgis-unknown', 2],
    [`${REFS}other-components/components/arcgis-gadget-panel/`, 'arcgis-gadget-panel', 0],
    [`${REFS}core/layers/PanelLayer/`, `${REFS}core/layers/PanelLayer/`, 0],
  ])('answers DOC_NOT_FOUND with a search call for %s', async (url, query, requests) => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    await expect(npmCemAdapter.read(ctx, bound(), { url: new URL(url) })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: {
        url,
        next: `arcgis_docs_search(${JSON.stringify({ query, product: 'widgets-sdk' })})`,
      },
    });
    expect(ctx.http.count()).toBe(requests);
    expect(ctx.render.calls).toEqual([]);
  });

  it('fails with a typed error when the manifest has another shape', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(CHARTS), { json: { latest: '7.2.1' } });
    ctx.http.on(cdnFile(CHARTS, '7.2.1', FILE), { json: [] });
    await expect(
      npmCemAdapter.read(ctx, bound(), { url: new URL(CHART_REF) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: { retryable: false } });
  });
});

describe('npm-cem owns and symbol', () => {
  it('claims component pages of its packages only', () => {
    const src = bound();
    expect(npmCemAdapter.owns!(new URL(PANEL_REF), src)).toBe(true);
    expect(npmCemAdapter.owns!(new URL(`${PANEL_REF}#heading`), src)).toBe(true);
    expect(npmCemAdapter.owns!(new URL(`${REFS}other-components/components/arcgis-x/`), src)).toBe(
      false,
    );
    expect(npmCemAdapter.owns!(new URL(`${REFS}core/layers/PanelLayer/`), src)).toBe(false);
  });

  it('selects the member of a member record', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const records = await npmCemAdapter.enumerate!(ctx, bound());
    const event = records.find((record) => record.symbolKind === 'event');
    await npmCemAdapter.symbol!(ctx, bound(), event!, 'signature');
    expect(ctx.render.calls[0]?.input).toMatchObject({
      tag: 'arcgis-gadget-panel',
      member: 'arcgisGadgetReady',
    });
    expect(ctx.render.calls[0]?.meta.url).toBe(`${PANEL_REF}#event-arcgisGadgetReady`);

    await npmCemAdapter.symbol!(ctx, bound(), records[0]!, 'summary');
    expect(ctx.render.calls[1]?.opts).toEqual({ detail: 'summary' });
  });
});
