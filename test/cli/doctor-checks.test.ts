import { describe, expect, it } from 'vitest';
import { formatDoctorReport } from '../../src/cli/doctor-format.js';
import { runDoctor } from '../../src/cli/doctor.js';
import { McpDocError } from '../../src/core/errors.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { check, setup } from './doctor-setup.js';

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
