import { afterEach, describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import {
  loadPackageJson,
  loadPackageText,
  packageMeta,
} from '../../../../src/adapters/reference/npm/package-file.js';
import { resolvePackageVersion } from '../../../../src/adapters/reference/npm/resolve-version.js';
import { makeLine, makeResponse } from '../../../support/builders.js';
import {
  cdnFile,
  componentsSource,
  makeProject,
  npmCtx,
  productOf,
  removeProjects,
} from './helpers.js';

const NAME = '@arcgis/chart-widgets';
const FILE = 'dist/docs/api.json';
const URL_7_2_1 = cdnFile(NAME, '7.2.1', FILE);
const published = { name: NAME, version: '7.2.1', how: 'dist-tag' } as const;
const bound = () => bindSource(productOf(componentsSource), componentsSource, makeLine());

afterEach(removeProjects);

describe('loadPackageText', () => {
  it('fetches the pinned file and keeps the response', async () => {
    const ctx = npmCtx();
    ctx.http.on(cdnFile(NAME, '7.2.1', 'index.d.ts'), { body: 'export {};\n' });
    const file = await loadPackageText(ctx, bound(), published, 'index.d.ts');
    expect(file.text).toBe('export {};\n');
    expect(file.url).toBe(cdnFile(NAME, '7.2.1', 'index.d.ts'));
    expect(file.res?.cache).toBe('miss');
    expect(file.retrievedAt).toBeUndefined();
  });

  it('reads the installed file and stamps the time instead', async () => {
    const { projectDir } = makeProject({
      [NAME]: { version: '7.1.9', files: { 'index.d.ts': 'export {};\n' } },
    });
    const ctx = npmCtx({ projectDir });
    const pkg = await resolvePackageVersion(ctx, bound(), NAME);
    const file = await loadPackageText(ctx, bound(), pkg, 'index.d.ts');
    expect(file).toEqual({
      text: 'export {};\n',
      url: cdnFile(NAME, '7.1.9', 'index.d.ts'),
      retrievedAt: ctx.clock.iso(),
    });
    expect(ctx.http.count()).toBe(0);
  });
});

describe('loadPackageJson', () => {
  it('parses a file once and labels later reads as cached', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    const first = await loadPackageJson(ctx, bound(), published, FILE);
    expect(first.res).toMatchObject({ cache: 'miss', url: URL_7_2_1, text: '' });
    expect(first.data).toMatchObject({ name: NAME });

    const second = await loadPackageJson(ctx, bound(), published, FILE);
    expect(second.data).toBe(first.data);
    expect(second.res?.cache).toBe('hit');
    expect(ctx.http.count()).toBe(1);
    expect(ctx.cache.memoComputes).toBe(1);
  });

  it('keeps the stale label of a copy served during an outage', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    ctx.http.fail(URL_7_2_1, 503, { stale: true });
    expect((await loadPackageJson(ctx, bound(), published, FILE)).res?.cache).toBe('stale');
    expect((await loadPackageJson(ctx, bound(), published, FILE)).res?.cache).toBe('stale');
  });

  it('does not remember a failure', async () => {
    const ctx = npmCtx({ cassette: 'cem.json' });
    ctx.http.fail(URL_7_2_1, 503, { times: 1 });
    await expect(loadPackageJson(ctx, bound(), published, FILE)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect((await loadPackageJson(ctx, bound(), published, FILE)).data).toMatchObject({
      name: NAME,
    });
  });

  it('reads the installed file with a fresh timestamp on every call', async () => {
    const { projectDir } = makeProject({
      [NAME]: { version: '7.1.9', files: { [FILE]: '{"modules":[]}' } },
    });
    const ctx = npmCtx({ projectDir });
    const pkg = await resolvePackageVersion(ctx, bound(), NAME);
    const first = await loadPackageJson(ctx, bound(), pkg, FILE);
    expect(first).toEqual({
      data: { modules: [] },
      url: cdnFile(NAME, '7.1.9', FILE),
      retrievedAt: ctx.clock.iso(),
    });
    ctx.clock.advance(60_000);
    const second = await loadPackageJson(ctx, bound(), pkg, FILE);
    expect(second.retrievedAt).toBe(ctx.clock.iso());
    expect(second.retrievedAt).not.toBe(first.retrievedAt);
    expect(ctx.cache.memoComputes).toBe(1);
  });
});

describe('packageMeta', () => {
  const src = bound();
  const url = 'https://developers.arcgis.com/widgets/latest/references/x/';

  it('carries the response of fetched content', () => {
    const res = makeResponse({ url: URL_7_2_1 });
    expect(packageMeta(src, published, { url: URL_7_2_1, res }, url)).toEqual({
      url,
      product: 'widgets-sdk',
      source: 'components',
      line: 'latest',
      version: '7.2.1',
      kind: 'api',
      license: 'esri-ma',
      packageName: NAME,
      res,
    });
  });

  it('carries the read time of installed content', () => {
    const meta = packageMeta(
      src,
      published,
      { url: URL_7_2_1, retrievedAt: '2026-10-13T12:00:00.000Z' },
      url,
    );
    expect(meta.retrievedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(meta.res).toBeUndefined();
  });

  it('falls back to the product licence and the api kind', () => {
    const { license: _license, ...unlicensed } = componentsSource;
    const source = { ...unlicensed, kinds: [] };
    const meta = packageMeta(
      bindSource(productOf(source), source, makeLine()),
      published,
      { url: URL_7_2_1 },
      url,
    );
    expect(meta).toMatchObject({ license: 'esri-website-terms', kind: 'api', retrievedAt: '' });
  });
});
