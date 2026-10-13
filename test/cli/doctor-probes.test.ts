import { describe, expect, it } from 'vitest';
import { PROBE_INTERVAL_MS, selectProbeTargets } from '../../src/cli/doctor-probes.js';
import { runDoctor } from '../../src/cli/doctor.js';
import { McpDocError } from '../../src/core/errors.js';
import type { BoundSource, Ctx, ProbeResult } from '../../src/core/ports.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { check, setup, widgets } from './doctor-setup.js';

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
    expect(report.probed).toBe('floor-sources');
    expect(progress).toEqual(['probing 1 floor sources (one per product)', 'ok widgets-sdk/guide']);
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
