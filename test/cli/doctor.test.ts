import { describe, expect, it } from 'vitest';
import { formatDoctorReport } from '../../src/cli/doctor-format.js';
import { PROBE_INTERVAL_MS, selectProbeTargets } from '../../src/cli/doctor-probes.js';
import { runDoctor, type DoctorDeps, type DoctorReport } from '../../src/cli/doctor.js';
import { McpDocError } from '../../src/core/errors.js';
import type { BoundSource, Ctx, ProbeResult } from '../../src/core/ports.js';
import type { Product } from '../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { makeContainer, type MakeContainerOptions } from './helpers.js';

const guide = makeSource('gatsby', { base: '/widgets/' });
const api = makeSource(
  'docc',
  { base: '/widgets/api/' },
  { id: 'api', title: 'API', kinds: ['api'], floor: false },
);
const widgets = makeProduct({ sources: [guide, api] });
const helpSite = makeProduct({
  id: 'gadget-help',
  name: 'Gadget help',
  aliases: [],
  tier: 'help',
  sources: [
    makeSource('sitemap', { url: 'https://doc.arcgis.com/en/gadget/sitemap.xml' }, { id: 'help' }),
  ],
});

function setup(options: MakeContainerOptions & { products?: Product[] } = {}) {
  const gatsby = new FakeAdapter('gatsby', { probe: { ok: true, ms: 12, records: 40 } });
  const docc = new FakeAdapter('docc');
  const sitemap = new FakeAdapter('sitemap');
  const slept: number[] = [];
  const progress: string[] = [];
  const container = makeContainer({
    products: [widgets, helpSite],
    adapters: [gatsby, docc, sitemap],
    ...options,
  });
  const deps: DoctorDeps = {
    env: {},
    nodeVersion: '22.15.0',
    checkWritable: async () => undefined,
    sleep: async (ms) => void slept.push(ms),
    progress: (line) => void progress.push(line),
  };
  return { container, deps, gatsby, docc, sitemap, slept, progress };
}

const check = (report: DoctorReport, id: string) => report.checks.find((c) => c.id === id);

describe('runDoctor: probes', () => {
  it('probes the floor source of each developer product and passes', async () => {
    const { container, deps, gatsby, docc, sitemap, progress } = setup();
    const report = await runDoctor(container, { tier: 'developer' }, deps);

    expect(report.exitCode).toBe(0);
    expect(report.failedFloors).toEqual([]);
    expect(report.probes).toEqual([
      {
        product: 'widgets-sdk',
        source: 'guide',
        adapter: 'gatsby',
        tier: 'developer',
        floor: true,
        url: 'https://developers.arcgis.com/widgets/',
        status: 'ok',
        ms: 12,
        records: 40,
      },
    ]);
    expect(gatsby.count('probe')).toBe(1);
    expect(docc.count('probe') + sitemap.count('probe')).toBe(0);
    expect(report.checks.map((c) => c.id)).toEqual([
      'config',
      'policy',
      'cache',
      'proxy',
      'adapters',
      'github',
      'hosts',
    ]);
    expect(progress).toEqual(['probing 1 sources', 'ok widgets-sdk/guide']);
  });

  it('includes help products with --tier all', async () => {
    const { container, deps } = setup();
    const report = await runDoctor(container, { tier: 'all' }, deps);
    expect(report.probes.map((p) => `${p.product}/${p.source}`)).toEqual([
      'widgets-sdk/guide',
      'gadget-help/help',
    ]);
  });

  it('exits 1 when a floor source of a developer product fails', async () => {
    const { container, deps, gatsby } = setup();
    gatsby.failOn(
      'probe',
      new McpDocError('UPSTREAM_UNAVAILABLE', 'developers.arcgis.com did not answer'),
    );
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(report.exitCode).toBe(1);
    expect(report.failedFloors).toEqual(['widgets-sdk/guide']);
    expect(report.probes[0]).toMatchObject({
      status: 'fail',
      reason: 'UPSTREAM_UNAVAILABLE: developers.arcgis.com did not answer',
    });
  });

  it('reports a probe that answers ok: false as failed, with its error', async () => {
    const { container, deps } = setup({
      adapters: [
        new FakeAdapter('gatsby', { probe: { ok: false, ms: 3, error: 'only 2 records' } }),
        new FakeAdapter('docc'),
      ],
    });
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(report.probes[0]).toMatchObject({ status: 'fail', reason: 'only 2 records', ms: 3 });
    expect(report.exitCode).toBe(1);
  });

  it('does not fail the run for a help product or a non-floor source', async () => {
    const { container, deps, docc, sitemap } = setup();
    sitemap.failOn('probe', new Error('socket hang up'));
    const all = await runDoctor(container, { tier: 'all' }, deps);
    expect(all.probes[1]).toMatchObject({ status: 'fail', reason: 'socket hang up' });
    expect(all.exitCode).toBe(0);

    docc.failOn('probe', new McpDocError('DOC_NOT_FOUND', 'index.json is gone'));
    const one = await runDoctor(container, { tier: 'developer', product: 'widgets-sdk' }, deps);
    expect(one.probes.map((p) => [p.source, p.status])).toEqual([
      ['guide', 'ok'],
      ['api', 'fail'],
    ]);
    expect(one.exitCode).toBe(0);
  });

  it('probes one source for the scope form product/source', async () => {
    const { container, deps, gatsby, docc } = setup();
    const report = await runDoctor(container, { tier: 'developer', product: 'widgets/api' }, deps);
    expect(report.probes.map((p) => p.source)).toEqual(['api']);
    expect(gatsby.count()).toBe(0);
    expect(docc.count('probe')).toBe(1);
  });

  it('throws UNKNOWN_PRODUCT for a product that does not resolve', async () => {
    const { container, deps } = setup();
    await expect(
      runDoctor(container, { tier: 'developer', product: 'gizmos' }, deps),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' });
  });

  it('skips a source whose capability is off and names the setting', async () => {
    const { container, deps, gatsby } = setup({ config: { capabilities: new Set(['github']) } });
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(report.probes[0]).toMatchObject({
      status: 'skip',
      reason: 'capability "website" is off (ARCGIS_DOCS_SOURCES=+website)',
    });
    expect(gatsby.count()).toBe(0);
    expect(report.exitCode).toBe(0);
  });

  it('skips every probe in offline mode and flags the policy', async () => {
    const { container, deps, gatsby, slept } = setup({ config: { offline: true } });
    const report = await runDoctor(container, { tier: 'all' }, deps);
    expect(report.probes.every((p) => p.status === 'skip')).toBe(true);
    expect(report.probes[0]?.reason).toContain('offline');
    expect(check(report, 'policy')).toMatchObject({ status: 'warn' });
    expect(gatsby.count()).toBe(0);
    expect(slept).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it('skips website sources of a link-only line', async () => {
    const product = makeProduct({ lines: [makeLine({ access: 'link-only', id: 'v1' })] });
    const { container, deps } = setup({ products: [product] });
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(report.probes[0]).toMatchObject({ status: 'skip', reason: 'line v1 is link-only' });
  });

  it('treats SOURCE_DISABLED and LINK_ONLY from the gateway as skipped', async () => {
    const { container, deps, gatsby } = setup();
    gatsby.failOn('probe', new McpDocError('SOURCE_DISABLED', 'needs capability "site-index"'));
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(report.probes[0]).toMatchObject({ status: 'skip' });
    expect(report.exitCode).toBe(0);
  });

  it('probes a source on a line it exists for when the current line is not one', async () => {
    const legacy = makeSource('gatsby', { base: '/widgets/v1/' }, { lines: ['v1'] });
    const product = makeProduct({
      lines: [makeLine(), makeLine({ id: 'v1', label: '1.x', current: false })],
      sources: [legacy],
    });
    const { container, deps, gatsby } = setup({ products: [product] });
    await runDoctor(container, { tier: 'developer' }, deps);
    expect(gatsby.calls).toEqual([expect.objectContaining({ method: 'probe', line: 'v1' })]);

    const nowhere = makeProduct({ sources: [{ ...legacy, lines: ['v9'] }] });
    expect(selectProbeTargets(fakeRegistry({ products: [nowhere] }), { tier: 'all' })).toEqual([]);
  });

  it('gives each probe a budget of two requests and paces by requests spent', async () => {
    const budgets: Array<BoundSource['budget']> = [];
    class Spending extends FakeAdapter<'gatsby'> {
      override async probe(ctx: Ctx, src: BoundSource<'gatsby'>): Promise<ProbeResult> {
        budgets.push(src.budget === undefined ? undefined : { ...src.budget });
        if (src.budget !== undefined) src.budget.used += 2;
        return super.probe(ctx, src);
      }
    }
    const second = makeProduct({ id: 'gears-sdk', name: 'Gears', aliases: [] });
    const third = makeProduct({ id: 'cogs-sdk', name: 'Cogs', aliases: [] });
    const { container, deps, slept } = setup({
      products: [widgets, second, third],
      adapters: [new Spending('gatsby')],
    });
    await runDoctor(container, { tier: 'developer' }, deps);
    expect(budgets).toHaveLength(3);
    expect(budgets[0]).toMatchObject({ maxRequests: 2, used: 0 });
    // No wait before the first probe; afterwards one interval per request just spent.
    expect(slept).toEqual([2 * PROBE_INTERVAL_MS, 2 * PROBE_INTERVAL_MS]);
  });

  it('waits one interval after a probe that was answered from the cache', async () => {
    const second = makeProduct({ id: 'gears-sdk', name: 'Gears', aliases: [] });
    const { container, deps, slept } = setup({ products: [widgets, second] });
    await runDoctor(container, { tier: 'developer' }, deps);
    expect(slept).toEqual([PROBE_INTERVAL_MS]);
  });
});

describe('runDoctor: local checks', () => {
  it('fails when the registry names an adapter the build lacks', async () => {
    const { container, deps } = setup({ adapters: [new FakeAdapter('gatsby')] });
    const report = await runDoctor(container, { tier: 'all' }, deps);
    expect(check(report, 'adapters')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('docc, sitemap') as string,
    });
    expect(report.probes[1]).toMatchObject({
      status: 'fail',
      reason: expect.stringContaining('sitemap') as string,
    });
    expect(report.exitCode).toBe(1);
  });

  it('fails when the cache directory is not writable', async () => {
    const { container, deps } = setup();
    const report = await runDoctor(
      container,
      { tier: 'developer' },
      { ...deps, checkWritable: async () => 'EACCES: permission denied' },
    );
    expect(check(report, 'cache')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('not writable: EACCES') as string,
      detail: expect.arrayContaining([
        'set ARCGIS_DOCS_CACHE_DIR to a writable directory',
      ]) as string[],
    });
    expect(report.exitCode).toBe(1);
  });

  it('fails when the cache cannot be read at all', async () => {
    const { container, deps } = setup();
    container.ctx.cache.info = async () => {
      throw new Error('ENOTDIR');
    };
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(check(report, 'cache')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('ENOTDIR') as string,
    });
  });

  it('fails on a Node.js release older than the supported one', async () => {
    const { container, deps } = setup();
    const report = await runDoctor(
      container,
      { tier: 'developer' },
      { ...deps, nodeVersion: '22.11.0' },
    );
    expect(check(report, 'config')).toMatchObject({ status: 'fail' });
    expect(report.exitCode).toBe(1);
    const fine = await runDoctor(
      container,
      { tier: 'developer' },
      { ...deps, nodeVersion: '24.1.0' },
    );
    expect(check(fine, 'config')).toMatchObject({ status: 'ok' });
  });

  it('is quiet about proxies when none is configured', async () => {
    const { container, deps } = setup();
    const report = await runDoctor(
      container,
      { tier: 'developer' },
      { ...deps, env: { NO_PROXY: 'localhost' } },
    );
    expect(check(report, 'proxy')).toMatchObject({ status: 'ok', detail: ['NO_PROXY=localhost'] });
  });

  it('explains how to make fetch use a proxy, without printing its credentials', async () => {
    const { container, deps } = setup();
    const env = { HTTPS_PROXY: 'http://alice:s3cret@proxy.corp.example:8080' };
    const report = await runDoctor(container, { tier: 'developer' }, { ...deps, env });
    const proxy = check(report, 'proxy');
    expect(proxy?.status).toBe('warn');
    expect(proxy?.detail.join('\n')).toContain('NODE_USE_ENV_PROXY=1');
    expect(proxy?.detail[0]).toBe('HTTPS_PROXY=http://***@proxy.corp.example:8080');
    expect(JSON.stringify(report)).not.toContain('s3cret');
    expect(report.exitCode).toBe(0);
  });

  it('accepts a proxy when NODE_USE_ENV_PROXY is on', async () => {
    const { container, deps } = setup();
    const env = { https_proxy: 'http://proxy.example:3128', NODE_USE_ENV_PROXY: '1' };
    const report = await runDoctor(container, { tier: 'developer' }, { ...deps, env });
    expect(check(report, 'proxy')).toMatchObject({ status: 'ok' });
  });

  it('reports the GitHub quota and how to raise it', async () => {
    const { container, deps } = setup();
    const anonymous = await runDoctor(container, { tier: 'developer' }, deps);
    expect(check(anonymous, 'github')).toMatchObject({
      status: 'warn',
      detail: expect.arrayContaining([expect.stringContaining('GITHUB_TOKEN')]) as string[],
    });

    container.ctx.github.restoreQuota({ authenticated: true });
    const signedIn = await runDoctor(container, { tier: 'developer' }, deps);
    expect(check(signedIn, 'github')).toMatchObject({
      status: 'ok',
      summary: expect.stringContaining('5000 requests remaining') as string,
    });

    container.ctx.github.exhaustQuota('2026-10-13T12:00:00.000Z');
    const spent = await runDoctor(container, { tier: 'developer' }, deps);
    expect(check(spent, 'github')).toMatchObject({
      status: 'warn',
      detail: expect.arrayContaining(['quota resets at 2026-10-13T12:00:00.000Z']) as string[],
    });
  });

  it('lists hosts whose circuit breaker is open', async () => {
    const { container, deps } = setup();
    container.ctx.http.setBreaker('developers.arcgis.com', 'closed');
    container.ctx.http.setBreaker('doc.esri.com', 'open', 'HTTP 503');
    const report = await runDoctor(container, { tier: 'developer' }, deps);
    expect(check(report, 'hosts')).toMatchObject({
      status: 'warn',
      summary: '1 of 2 contacted hosts are failing',
      detail: ['doc.esri.com: breaker open (HTTP 503)'],
    });
    expect(report.exitCode).toBe(0);
  });
});

describe('formatDoctorReport', () => {
  it('prints checks, probes and an ok verdict', async () => {
    const { container, deps } = setup();
    const text = formatDoctorReport(await runDoctor(container, { tier: 'all' }, deps));
    expect(text).toContain('[ok]   config: arcgis-sdk-mcp 0.0.0-test, Node 22.15.0, stdio mode');
    expect(text).toContain('       project directory: /project');
    expect(text).toContain('Sources probed: 2 ok, 0 failed, 0 skipped');
    expect(text).toContain('[ok]   widgets-sdk/guide (gatsby, floor, 40 records, 12 ms)');
    expect(text.endsWith('Result: ok\n')).toBe(true);
  });

  it('prints the reason and URL of a failed probe and names the failed floors', async () => {
    const { container, deps, gatsby } = setup();
    gatsby.failOn('probe', new McpDocError('UPSTREAM_BLOCKED', 'HTTP 403'));
    const text = formatDoctorReport(await runDoctor(container, { tier: 'developer' }, deps));
    expect(text).toContain('[fail] widgets-sdk/guide (gatsby, floor)');
    expect(text).toContain('       UPSTREAM_BLOCKED: HTTP 403');
    expect(text).toContain('       https://developers.arcgis.com/widgets/');
    expect(text).toContain('Result: failed. Floor sources not reachable: widgets-sdk/guide');
  });

  it('names the failing checks when no floor source failed', async () => {
    const { container, deps } = setup();
    const report = await runDoctor(
      container,
      { tier: 'developer' },
      { ...deps, checkWritable: async () => 'read-only file system' },
    );
    expect(formatDoctorReport(report)).toContain('Result: failed. Failing checks: cache');
  });
});
