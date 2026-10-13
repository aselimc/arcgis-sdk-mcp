import { afterEach, describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import {
  distTagsUrl,
  pickDistTag,
  resolvePackageVersion,
  satisfiesRequest,
  withVersionNotice,
} from '../../../../src/adapters/reference/npm/resolve-version.js';
import { makeDocPage, makeLine } from '../../../support/builders.js';
import {
  distTags,
  makeProject,
  npmCtx,
  productOf,
  removeProjects,
  resolved,
  typingsSource,
} from './helpers.js';

const NAME = '@arcgis/widget-core';
const product = productOf(typingsSource);
const bound = (version?: string, line = makeLine()) =>
  bindSource(product, typingsSource, line, version);

afterEach(removeProjects);

describe('pickDistTag', () => {
  it('takes latest', () => {
    expect(pickDistTag({ latest: '5.1.27', rc: '5.2.0-next.145', next: '6.0.0-next.6' })).toEqual({
      tag: 'latest',
      version: '5.1.27',
    });
  });

  it('takes the highest release among latest and the lts tags', () => {
    // `latest` was moved to a patch of the older line.
    expect(pickDistTag({ latest: '4.34.9', 'lts-v5.x': '5.1.27', lts: '4.30.2' })).toEqual({
      tag: 'lts-v5.x',
      version: '5.1.27',
    });
    expect(pickDistTag({ latest: '5.1.27', 'lts-v4.x': '4.34.9' })).toEqual({
      tag: 'latest',
      version: '5.1.27',
    });
  });

  it('ignores other tags, pre-releases and values that are not versions', () => {
    expect(
      pickDistTag({ latest: '5.2.0-next.1', hotfix: '9.9.9', ltsish: '8.0.0', 'lts-v4.x': 4 }),
    ).toBeUndefined();
    expect(pickDistTag({ latest: 'not-a-version' })).toBeUndefined();
    expect(pickDistTag(['5.1.27'])).toBeUndefined();
    expect(pickDistTag(null)).toBeUndefined();
  });
});

describe('satisfiesRequest', () => {
  it.each([
    ['4.33.14', '4.33.14', true],
    ['4.33.14', '4.33.13', false],
    ['4.33.14', '=4.33.14', true],
    ['4.33.14', 'v4.33', true],
    ['4.33.14', '4.33', true],
    ['4.33.14', '4', true],
    ['4.33.14', '4.33.x', true],
    ['4.33.14', '4.x', true],
    ['4.33.14', '4.3', false],
    ['4.33.14', '5', false],
    ['5.1.27', '^5.1.0', true],
    ['5.2.3', '^5.1.0', true],
    ['5.0.9', '^5.1.0', false],
    ['6.0.0', '^5.1.0', false],
    ['0.3.4', '^0.3.1', true],
    ['0.4.0', '^0.3.1', false],
    ['5.1.27', '~5.1.4', true],
    ['5.2.0', '~5.1.4', false],
    ['5.1.3', '~5.1.4', false],
    ['5.1.27', '>=4.30.0', true],
    ['4.29.0', '>=4.30.0', false],
    ['5.2.0-next.4', '5.2', false],
    ['5.2.0-next.4', '5.2.0-next.4', true],
    ['5.1.27', '>=5 <6', false],
    ['5.1.27', 'next', false],
    ['5.1.27', '', false],
    ['garbage', '5', false],
  ])('installed %s against request %s is %s', (installed, requested, expected) => {
    expect(satisfiesRequest(installed, requested)).toBe(expected);
  });
});

describe('resolvePackageVersion', () => {
  it('builds the dist-tags URL of the registry', () => {
    expect(distTagsUrl(NAME)).toBe(distTags(NAME));
  });

  it('prefers the installed copy over the registry', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const ctx = npmCtx({ cassette: 'dts.json', projectDir });
    const pkg = await resolvePackageVersion(ctx, bound(), NAME);
    expect(pkg).toMatchObject({ name: NAME, version: '7.1.9', how: 'local' });
    expect(pkg.local?.version).toBe('7.1.9');
    expect(ctx.http.count()).toBe(0);
  });

  it('uses the installed copy when it satisfies the requested version', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const ctx = npmCtx({ projectDir });
    expect(await resolvePackageVersion(ctx, bound('7.1'), NAME)).toMatchObject({ how: 'local' });
    expect(await resolvePackageVersion(ctx, bound('^7.0.0'), NAME)).toMatchObject({ how: 'local' });
    expect(ctx.http.count()).toBe(0);
  });

  it('asks for the published version when the installed copy is another one', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const ctx = npmCtx({ cassette: 'dts.json', projectDir });
    const pkg = await resolvePackageVersion(ctx, bound('6.9'), NAME);
    expect(pkg).toEqual({ name: NAME, version: '6.9.1', how: 'requested' });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([resolved(NAME, '6.9')]);
  });

  it('skips an installed copy whose version is not exact', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1' } });
    const ctx = npmCtx({ cassette: 'dts.json', projectDir });
    expect(await resolvePackageVersion(ctx, bound(), NAME)).toMatchObject({ how: 'dist-tag' });
  });

  it('strips a leading v from a requested version', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    expect(await resolvePackageVersion(ctx, bound('v6.9'), NAME)).toMatchObject({
      version: '6.9.1',
    });
  });

  it('answers VERSION_UNAVAILABLE with the versions call for a version never published', async () => {
    const ctx = npmCtx();
    ctx.http.on(resolved(NAME, '99.0.0'), { json: { type: 'npm', version: null } });
    await expect(resolvePackageVersion(ctx, bound('99.0.0'), NAME)).rejects.toMatchObject({
      code: 'VERSION_UNAVAILABLE',
      details: { next: 'arcgis_docs_get_versions({"product":"widgets-sdk"})' },
    });
  });

  it('reads the current release from the dist-tags', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const budget = newBudget(5, 1000, ctx.clock);
    const pkg = await resolvePackageVersion(ctx, { ...bound(), budget }, NAME);
    expect(pkg).toEqual({ name: NAME, version: '7.2.4', how: 'dist-tag', tag: 'latest' });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([distTags(NAME)]);
    expect(budget.used).toBe(1);
  });

  it.each(['latest', 'LATEST', ' ', 'v7', 'Version 7'])(
    'treats version "%s" as the current release when it is a tag or names the bound line',
    async (version) => {
      const ctx = npmCtx({ cassette: 'dts.json' });
      const line = makeLine({ id: 'v7', label: 'Version 7' });
      expect(await resolvePackageVersion(ctx, bound(version, line), NAME)).toMatchObject({
        version: '7.2.4',
        how: 'dist-tag',
      });
    },
  );

  it.each([503, 404, 'html', 'truncated'] as const)(
    'falls back to the CDN when the registry answers %s',
    async (fault) => {
      const ctx = npmCtx({ cassette: 'dts.json' });
      ctx.http.fail(distTags(NAME), fault);
      ctx.http.on(resolved(NAME, 'latest'), { json: { version: '7.2.4' } });
      const pkg = await resolvePackageVersion(ctx, bound(), NAME);
      expect(pkg).toEqual({ name: NAME, version: '7.2.4', how: 'cdn-latest', tag: 'latest' });
      expect(ctx.logger.messages('warn')).toHaveLength(1);
    },
  );

  it('falls back to the CDN when the dist-tags name no release', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { next: '8.0.0-next.3' } });
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: '7.2.4' } });
    expect(await resolvePackageVersion(ctx, bound(), NAME)).toMatchObject({ how: 'cdn-latest' });
  });

  it('does not contact the registry without capability registries', async () => {
    const ctx = npmCtx({ without: ['registries'] });
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: '7.2.4' } });
    expect(await resolvePackageVersion(ctx, bound(), NAME)).toMatchObject({ how: 'cdn-latest' });
    expect(ctx.http.hosts()).toEqual(['data.jsdelivr.com']);
  });

  it('reports the registry failure when the CDN fails too', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { status: 404 });
    ctx.http.on(resolved(NAME, 'latest'), { status: 503 });
    await expect(resolvePackageVersion(ctx, bound(), NAME)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { host: 'registry.npmjs.org' },
    });
  });

  it('reports the CDN failure when the registry was not asked', async () => {
    const ctx = npmCtx({ without: ['registries'] });
    ctx.http.on(resolved(NAME, 'latest'), { status: 503 });
    await expect(resolvePackageVersion(ctx, bound(), NAME)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { host: 'data.jsdelivr.com' },
    });
  });

  it('answers VERSION_UNAVAILABLE when neither rung names a release', async () => {
    const ctx = npmCtx({ without: ['registries'] });
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: null } });
    await expect(resolvePackageVersion(ctx, bound(), NAME)).rejects.toMatchObject({
      code: 'VERSION_UNAVAILABLE',
    });
  });

  it('prefers the registry failure over an empty CDN answer', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: {} });
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: null } });
    await expect(resolvePackageVersion(ctx, bound(), NAME)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false, host: 'registry.npmjs.org' },
    });
  });

  it('stops at once when the request budget is spent', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const budget = newBudget(0, 1000, ctx.clock);
    await expect(resolvePackageVersion(ctx, { ...bound(), budget }, NAME)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(ctx.http.count()).toBe(1);
  });
});

describe('withVersionNotice', () => {
  const page = makeDocPage({ notices: ['existing'] });

  it('leaves a page of the current release unchanged', () => {
    expect(withVersionNotice(page, { name: NAME, version: '7.2.4', how: 'dist-tag' })).toBe(page);
    expect(withVersionNotice(page, { name: NAME, version: '7.2.4', how: 'cdn-latest' })).toBe(page);
  });

  it('says which build an installed or requested version is', () => {
    expect(
      withVersionNotice(page, { name: NAME, version: '7.1.9', how: 'local' }).notices,
    ).toEqual([
      'existing',
      "Read from @arcgis/widget-core 7.1.9 as installed in the project's node_modules.",
    ]);
    expect(
      withVersionNotice(page, { name: NAME, version: '6.9.1', how: 'requested' }, ' More.').notices,
    ).toEqual([
      'existing',
      'Read from @arcgis/widget-core 6.9.1, the published release matching the requested version. More.',
    ]);
    expect(page.notices).toEqual(['existing']);
  });
});
