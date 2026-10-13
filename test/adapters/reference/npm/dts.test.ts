import { afterEach, describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { npmDtsAdapter } from '../../../../src/adapters/reference/npm/dts.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { describeAdapterContract } from '../../../support/adapter-contract.js';
import { makeLine } from '../../../support/builders.js';
import { readFixture } from '../../../support/fixtures.js';
import {
  cdnFile,
  distTags,
  flatListing,
  makeProject,
  npmCtx,
  productOf,
  removeProjects,
  resolved,
  typingsSource,
} from './helpers.js';

const NAME = '@arcgis/widget-core';
const REFS = 'https://developers.arcgis.com/widgets/latest/references/core/';
const PANEL_REF = `${REFS}layers/PanelLayer/`;
const product = productOf(typingsSource);
const bound = (version?: string, line = makeLine()) =>
  bindSource(product, typingsSource, line, version);
const declaration = readFixture('cassettes', 'reference', 'npm', 'PanelLayer.d.ts');

afterEach(removeProjects);

describeAdapterContract('npm-dts', () => ({
  adapter: npmDtsAdapter,
  product,
  source: typingsSource,
  ctx: () => npmCtx({ cassette: 'dts.json' }),
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 3,
  readRef: PANEL_REF,
}));

describe('npm-dts enumerate', () => {
  it('lists one record per public declaration module', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const records = await npmDtsAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => record.ref)).toEqual([
      `${REFS}Gadget/`,
      `${REFS}layers/PanelLayer/`,
      `${REFS}layers/support/fieldUtils/`,
    ]);
    expect(records[1]).toEqual({
      ref: PANEL_REF,
      product: 'widgets-sdk',
      source: 'typings',
      line: 'latest',
      kind: 'api',
      title: 'PanelLayer',
      symbol: 'PanelLayer',
      qualified: '@arcgis/widget-core/layers/PanelLayer',
      symbolKind: 'class',
      breadcrumb: 'layers',
      keywords: [NAME],
      locator: { path: 'layers/PanelLayer.d.ts' },
      license: 'esri-ma',
    });
    expect(records[0]?.breadcrumb).toBeUndefined();
    expect(records[2]).toMatchObject({ symbolKind: 'module', breadcrumb: 'layers > support' });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      distTags(NAME),
      flatListing(NAME, '7.2.4'),
    ]);
  });

  it('lists the installed package without any request', async () => {
    const { projectDir } = makeProject({
      [NAME]: {
        version: '7.1.9',
        files: { 'Gadget.d.ts': '', 'layers/PanelLayer.d.ts': declaration, 'Gadget.js': '' },
      },
    });
    const ctx = npmCtx({ projectDir });
    const records = await npmDtsAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => record.title)).toEqual(['Gadget', 'PanelLayer']);
    expect(ctx.http.count()).toBe(0);
  });

  it('lists the published files when the installed copy has no declarations', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.2.4' } });
    const ctx = npmCtx({ cassette: 'dts.json', projectDir });
    expect(await npmDtsAdapter.enumerate!(ctx, bound())).toHaveLength(3);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([flatListing(NAME, '7.2.4')]);
  });

  it('lists the files of the requested version', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.on(flatListing(NAME, '6.9.1'), { json: { files: [{ name: '/Old.d.ts' }] } });
    const records = await npmDtsAdapter.enumerate!(ctx, bound('6.9'));
    expect(records.map((record) => record.ref)).toEqual([`${REFS}Old/`]);
  });

  it('survives a registry outage by asking the CDN for the current version', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.fail(distTags(NAME), 503);
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: '7.2.4' } });
    expect(await npmDtsAdapter.enumerate!(ctx, bound())).toHaveLength(3);
    expect(ctx.http.count()).toBeLessThanOrEqual(npmDtsAdapter.maxEnumerateRequests);
  });

  it('returns nothing for a package without declaration files', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(flatListing(NAME, '7.2.4'), { json: { files: [{ name: '/index.js' }] } });
    expect(await npmDtsAdapter.enumerate!(ctx, bound())).toEqual([]);
  });

  it.each([
    ['a renamed field', { json: { entries: [] } }, 'UPSTREAM_UNAVAILABLE'],
    ['a missing listing', { status: 404 }, 'DOC_NOT_FOUND'],
    [
      'HTML instead of JSON',
      { body: '<!doctype html><html><body>Not here</body></html>' },
      'DOC_NOT_FOUND',
    ],
  ])('fails with a typed error for %s', async (_name, response, code) => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(flatListing(NAME, '7.2.4'), response);
    await expect(npmDtsAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({ code });
  });

  it('fails with a typed error for an oversized listing', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.fail(flatListing(NAME, '7.2.4'), 'oversized');
    await expect(npmDtsAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false },
    });
  });
});

describe('npm-dts read', () => {
  it('reads the declaration file a documentation URL names, pinned to the current version', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const page = await npmDtsAdapter.read(ctx, bound(), { url: new URL(PANEL_REF) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      distTags(NAME),
      cdnFile(NAME, '7.2.4', 'layers/PanelLayer.d.ts'),
    ]);
    const [call] = ctx.render.calls;
    expect(call?.kind).toBe('dts');
    expect(call?.input).toEqual({
      source: declaration,
      modulePath: 'layers/PanelLayer.d.ts',
      packageName: NAME,
    });
    expect(call?.meta).toMatchObject({
      url: PANEL_REF,
      product: 'widgets-sdk',
      source: 'typings',
      line: 'latest',
      version: '7.2.4',
      kind: 'api',
      license: 'esri-ma',
      packageName: NAME,
    });
    expect(call?.opts).toBeUndefined();
    expect(page).toMatchObject({
      ref: PANEL_REF,
      version: '7.2.4',
      attribution:
        'From @arcgis/widget-core 7.2.4. Copyright Esri. Licensed under the Esri Master License Agreement.',
      notices: [],
    });
  });

  it('selects the member a fragment or a selector names and passes the detail on', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const page = await npmDtsAdapter.read(ctx, bound(), {
      url: new URL(`${PANEL_REF.slice(0, -1)}#refresh`),
      detail: 'signature',
    });
    expect((ctx.render.calls[0]?.input as RendererInputs['dts']).member).toBe('refresh');
    expect(ctx.render.calls[0]?.opts).toEqual({
      select: { member: 'refresh' },
      detail: 'signature',
    });
    expect(page.ref).toBe(`${PANEL_REF}#refresh`);

    await npmDtsAdapter.read(ctx, bound(), {
      url: new URL(`${PANEL_REF}#refresh`),
      select: { section: 'methods' },
    });
    expect((ctx.render.calls[1]?.input as RendererInputs['dts']).member).toBeUndefined();
    expect(ctx.render.calls[1]?.opts).toEqual({ select: { section: 'methods' } });
  });

  it('reads the requested version and says so', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const page = await npmDtsAdapter.read(ctx, bound('6.9'), { url: new URL(PANEL_REF) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      resolved(NAME, '6.9'),
      cdnFile(NAME, '6.9.1', 'layers/PanelLayer.d.ts'),
    ]);
    expect(page.version).toBe('6.9.1');
    expect(page.notices).toEqual([
      'Read from @arcgis/widget-core 6.9.1, the published release matching the requested version. The linked page documents the current release.',
    ]);
  });

  it('works on a link-only line, which only the website sources cannot serve', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const line = makeLine({ id: 'v6', label: '6.x', current: false, access: 'link-only' });
    const page = await npmDtsAdapter.read(ctx, bound('6.9', line), { url: new URL(PANEL_REF) });
    expect(page).toMatchObject({ line: 'v6', version: '6.9.1' });
  });

  it('reads the installed copy without any request and stamps the read time', async () => {
    const { projectDir } = makeProject({
      [NAME]: { version: '7.1.9', files: { 'layers/PanelLayer.d.ts': declaration } },
    });
    const ctx = npmCtx({ projectDir });
    const page = await npmDtsAdapter.read(ctx, bound(), { url: new URL(PANEL_REF) });
    expect(ctx.http.count()).toBe(0);
    expect(ctx.render.calls[0]?.meta).toMatchObject({
      version: '7.1.9',
      retrievedAt: ctx.clock.iso(),
    });
    expect(ctx.render.calls[0]?.meta.res).toBeUndefined();
    expect(page.version).toBe('7.1.9');
    expect(page.notices[0]).toContain("7.1.9 as installed in the project's node_modules");
  });

  it('fetches a file the installed copy lacks, at the installed version', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.2.4' } });
    const ctx = npmCtx({ cassette: 'dts.json', projectDir });
    await npmDtsAdapter.read(ctx, bound(), { url: new URL(PANEL_REF) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      cdnFile(NAME, '7.2.4', 'layers/PanelLayer.d.ts'),
    ]);
  });

  it('prefers the file of the record that led here', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const [, record] = await npmDtsAdapter.enumerate!(ctx, bound());
    await npmDtsAdapter.read(ctx, bound(), {
      url: new URL('https://developers.arcgis.com/elsewhere/'),
      record: record!,
    });
    expect(ctx.http.requests.at(-1)?.url).toBe(cdnFile(NAME, '7.2.4', 'layers/PanelLayer.d.ts'));
  });

  it.each([
    'https://developers.arcgis.com/widgets/latest/guide/',
    'https://developers.arcgis.com/widgets/latest/references/core/',
    `${REFS}layers/Panel%20Layer/`,
  ])('answers DOC_NOT_FOUND with a search call for %s', async (url) => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    await expect(npmDtsAdapter.read(ctx, bound(), { url: new URL(url) })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: {
        host: 'developers.arcgis.com',
        next: 'arcgis_docs_search({"query":"@arcgis/widget-core","product":"widgets-sdk"})',
      },
    });
    expect(ctx.http.count()).toBe(0);
  });

  it('rejects a record whose path leaves the package', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const [record] = await npmDtsAdapter.enumerate!(ctx, bound());
    const forged = { ...record!, locator: { path: '../other/secret.d.ts' } };
    await expect(
      npmDtsAdapter.read(ctx, bound(), { url: new URL(PANEL_REF), record: forged }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
  });

  it('passes on DOC_NOT_FOUND for a module the version does not have', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.on(cdnFile(NAME, '7.2.4', 'Missing.d.ts'), { status: 404 });
    await expect(
      npmDtsAdapter.read(ctx, bound(), { url: new URL(`${REFS}Missing/`) }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND', details: { host: 'cdn.jsdelivr.net' } });
  });

  it('labels a stale copy served during an outage', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.fail(/cdn\.jsdelivr\.net/, 503, { stale: true });
    const page = await npmDtsAdapter.read(ctx, bound(), { url: new URL(PANEL_REF) });
    expect(page.cache).toBe('stale');
  });
});

describe('npm-dts symbol', () => {
  it('reads the type of a type record and the member of a member record', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const [, record] = await npmDtsAdapter.enumerate!(ctx, bound());
    await npmDtsAdapter.symbol!(ctx, bound(), record!, 'summary');
    expect(ctx.render.calls[0]?.opts).toEqual({ detail: 'summary' });

    const member = {
      ...record!,
      ref: `${PANEL_REF}#refresh`,
      symbol: 'refresh',
      qualified: 'PanelLayer.refresh',
      parent: 'PanelLayer',
    };
    await npmDtsAdapter.symbol!(ctx, bound(), member, 'signature');
    expect(ctx.render.calls[1]?.opts).toEqual({
      select: { member: 'refresh' },
      detail: 'signature',
    });
    expect(ctx.render.calls[1]?.meta.url).toBe(`${PANEL_REF}#refresh`);
  });
});
