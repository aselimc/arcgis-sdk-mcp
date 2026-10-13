import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import {
  fetchPackageJson,
  fetchPackageText,
  isExactVersion,
  jsdelivrFileUrl,
  listPackageFiles,
  resolveSpecifier,
} from '../../../../src/adapters/reference/npm/jsdelivr.js';
import { makeLine } from '../../../support/builders.js';
import { cdnFile, flatListing, npmCtx, productOf, resolved, typingsSource } from './helpers.js';

const NAME = '@arcgis/widget-core';
const bound = () => bindSource(productOf(typingsSource), typingsSource, makeLine());

describe('pinned URLs', () => {
  it.each([
    ['5.1.27', true],
    ['5.2.0-next.145', true],
    ['2.8.1-hotfix.0', true],
    ['5.1', false],
    ['^5.1.0', false],
    ['latest', false],
    ['5.1.27/../x', false],
  ])('isExactVersion(%s) is %s', (version, expected) => {
    expect(isExactVersion(version)).toBe(expected);
  });

  it('builds the URL of one file at one version', () => {
    expect(jsdelivrFileUrl(NAME, '7.2.4', '/layers/PanelLayer.d.ts')).toBe(
      'https://cdn.jsdelivr.net/npm/@arcgis/widget-core@7.2.4/layers/PanelLayer.d.ts',
    );
    expect(jsdelivrFileUrl(NAME, '7.2.4', 'docs/read me.json')).toBe(
      'https://cdn.jsdelivr.net/npm/@arcgis/widget-core@7.2.4/docs/read%20me.json',
    );
  });

  it('refuses a range or a tag: a moving URL is never requested', () => {
    expect(() => jsdelivrFileUrl(NAME, 'latest', 'a.d.ts')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    expect(() => jsdelivrFileUrl(NAME, '7.2', 'a.d.ts')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
  });
});

describe('file reads', () => {
  it('fetches text as an immutable file under the call budget', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const budget = newBudget(5, 1000, ctx.clock);
    const res = await fetchPackageText(
      ctx,
      { ...bound(), budget },
      NAME,
      '7.2.4',
      'layers/PanelLayer.d.ts',
    );
    expect(res.text).toContain('export default class PanelLayer');
    expect(ctx.http.requests).toEqual([
      { method: 'GET', url: cdnFile(NAME, '7.2.4', 'layers/PanelLayer.d.ts'), expect: 'text' },
    ]);
    expect(budget.used).toBe(1);
  });

  it('fetches and parses JSON with the index size cap', async () => {
    const ctx = npmCtx();
    const url = cdnFile(NAME, '7.2.4', 'docs/api.json');
    let maxBytes: number | undefined;
    ctx.http.on(url, (req) => {
      maxBytes = req.maxBytes;
      return { json: { modules: [] } };
    });
    const { data } = await fetchPackageJson(ctx, bound(), NAME, '7.2.4', 'docs/api.json');
    expect(data).toEqual({ modules: [] });
    expect(maxBytes).toBe(ctx.config.limits.indexMaxBytes);
  });

  it('reports a truncated JSON file as a retryable upstream failure', async () => {
    const ctx = npmCtx();
    const url = cdnFile(NAME, '7.2.4', 'docs/api.json');
    ctx.http.on(url, { json: { modules: [{ path: 'a' }] } }).fail(url, 'truncated');
    await expect(fetchPackageJson(ctx, bound(), NAME, '7.2.4', 'docs/api.json')).rejects.toMatchObject(
      { code: 'UPSTREAM_UNAVAILABLE', details: { retryable: true } },
    );
  });
});

describe('listPackageFiles', () => {
  it('returns paths relative to the package root', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const files = await listPackageFiles(ctx, bound(), NAME, '7.2.4');
    expect(files).toHaveLength(9);
    expect(files).toContainEqual({ path: 'layers/PanelLayer.d.ts', size: 1480 });
    expect(files.every((file) => !file.path.startsWith('/'))).toBe(true);
    expect(ctx.http.count()).toBe(1);
  });

  it('skips entries without a usable name', async () => {
    const ctx = npmCtx();
    ctx.http.on(flatListing(NAME, '7.2.4'), {
      json: { files: [{ name: '/a.d.ts' }, { name: '/' }, { hash: 'x' }, 'text', null] },
    });
    expect(await listPackageFiles(ctx, bound(), NAME, '7.2.4')).toEqual([{ path: 'a.d.ts' }]);
  });

  it('fails without retry when the listing has no files array', async () => {
    const ctx = npmCtx();
    ctx.http.on(flatListing(NAME, '7.2.4'), { json: { entries: [] } });
    await expect(listPackageFiles(ctx, bound(), NAME, '7.2.4')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false, host: 'data.jsdelivr.com' },
    });
  });

  it('does not ask for the files of a range', async () => {
    const ctx = npmCtx();
    await expect(listPackageFiles(ctx, bound(), NAME, '7')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(ctx.http.count()).toBe(0);
  });
});

describe('resolveSpecifier', () => {
  it('resolves a partial version to the release it matches', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    expect(await resolveSpecifier(ctx, bound(), NAME, '6.9')).toBe('6.9.1');
  });

  it('encodes ranges', async () => {
    const ctx = npmCtx();
    ctx.http.on(resolved(NAME, '^7.2.0'), { json: { version: '7.2.4' } });
    expect(await resolveSpecifier(ctx, bound(), NAME, '^7.2.0')).toBe('7.2.4');
    expect(ctx.http.requests[0]?.url).toContain('specifier=%5E7.2.0');
  });

  it('answers undefined when nothing matches', async () => {
    const ctx = npmCtx();
    ctx.http.on(resolved(NAME, '99'), { json: { type: 'npm', version: null, links: {} } });
    expect(await resolveSpecifier(ctx, bound(), NAME, '99')).toBeUndefined();
  });

  it('fails without retry when the answer has no version field', async () => {
    const ctx = npmCtx();
    ctx.http.on(resolved(NAME, '7'), { json: { resolved: '7.2.4' } });
    await expect(resolveSpecifier(ctx, bound(), NAME, '7')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false },
    });
  });
});
