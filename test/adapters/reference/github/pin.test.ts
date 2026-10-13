import { describe, expect, it } from 'vitest';
import {
  atRef,
  chooseRef,
  exactVersion,
  isImmutableRef,
  openRepo,
  openScope,
  openScopeAt,
  tagFor,
  versionOfTag,
} from '../../../../src/adapters/reference/github/pin.js';
import { McpDocError } from '../../../../src/core/errors.js';
import { bound, githubCtx, githubProduct, lineOf } from './support.js';

const REPO = 'Esri/widget-samples';
const files = { 'README.md': '# Widget samples' };

describe('version and tag helpers', () => {
  it.each([
    ['300.1', '300.1.0'],
    ['300.1.0', '300.1.0'],
    ['v200.8.3', '200.8.3'],
    ['300.1.0.5042', '300.1.0.5042'],
    [' 4.33 ', '4.33.0'],
  ])('reads %s as the exact version %s', (input, expected) => {
    expect(exactVersion(input)).toBe(expected);
  });

  it.each(['300', 'latest', '200.x', '', '1.2.3.4.5'])(
    'finds no single release in "%s"',
    (input) => {
      expect(exactVersion(input)).toBeUndefined();
    },
  );

  it('builds a tag from a template and reads the version back', () => {
    expect(tagFor('300.1.0')).toBe('v300.1.0');
    expect(tagFor('300.1.0', '{version}')).toBe('300.1.0');
    expect(tagFor('1.21', 'release-{version}-final')).toBe('release-1.21-final');
    expect(versionOfTag('v300.1.0')).toBe('300.1.0');
    expect(versionOfTag('release-1.21-final', 'release-{version}-final')).toBe('1.21');
    // A tag that does not follow the template is still a version once the prefix is gone.
    expect(versionOfTag('v2.3.0', 'sdk-{version}')).toBe('2.3.0');
    expect(versionOfTag('300.1.0.5042')).toBe('300.1.0.5042');
  });

  it('tells movable refs from immutable ones', () => {
    expect(isImmutableRef('v300.1.0')).toBe(true);
    expect(isImmutableRef('3.6.0.59527')).toBe(true);
    expect(isImmutableRef('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(isImmutableRef('main')).toBe(false);
    expect(isImmutableRef('v.next')).toBe(false);
    expect(isImmutableRef('1.21-beta')).toBe(false);
  });
});

describe('openRepo', () => {
  it('takes the default branch and licence GitHub reports', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'samples-metadata' });
    const ctx = githubCtx({
      [REPO]: { defaultBranch: 'develop', license: 'unlicensed', files: { '*': files } },
    });
    const scope = await openRepo(ctx, bound(ctx, product, source));
    expect(scope).toMatchObject({
      repo: REPO,
      defaultBranch: 'develop',
      ref: 'develop',
      license: 'unlicensed',
      pinned: false,
      notices: [],
    });
  });

  it('never relaxes a CC BY-ND tier from the registry', async () => {
    const { product, source } = githubProduct(
      { repo: REPO, preset: 'markdown-docs' },
      { license: 'cc-by-nd' },
    );
    const ctx = githubCtx({ [REPO]: { license: 'unlicensed', files: { '*': files } } });
    expect((await openRepo(ctx, bound(ctx, product, source))).license).toBe('cc-by-nd');
  });

  it('falls back to the product default tier when the source declares none', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'markdown-docs' });
    delete source.license;
    const ctx = githubCtx({});
    ctx.github.outage();
    const scope = await openRepo(ctx, bound(ctx, product, source));
    expect(scope.license).toBe(product.licenseTier);
  });

  it('uses the registry hints when the API quota is spent', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'samples-metadata' });
    const hinted = {
      ...product,
      repos: [
        {
          repo: 'esri/WIDGET-samples',
          role: 'samples' as const,
          license: 'apache-2.0' as const,
          defaultBranch: 'master',
        },
      ],
    };
    const ctx = githubCtx({ [REPO]: { defaultBranch: 'develop', license: 'unlicensed' } });
    ctx.github.exhaustQuota('2026-10-13T13:00:00Z');
    const scope = await openRepo(ctx, bound(ctx, hinted, source));
    expect(scope).toMatchObject({ defaultBranch: 'master', ref: 'master', license: 'apache-2.0' });
    expect(ctx.logger.entries.some((entry) => entry.level === 'debug')).toBe(true);
  });

  it('assumes main for a repository the product does not list', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'samples-metadata' });
    const ctx = githubCtx({});
    const scope = await openRepo(ctx, bound(ctx, { ...product, repos: [] }, source));
    expect(scope.defaultBranch).toBe('main');
  });

  it('notes an archived repository', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'markdown-docs' });
    const ctx = githubCtx({ [REPO]: { archived: true } });
    const scope = await openRepo(ctx, bound(ctx, product, source));
    expect(scope.notices).toEqual([`The repository ${REPO} is archived and no longer updated.`]);
  });

  it('does not hide a defect behind the hints', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'markdown-docs' });
    const ctx = githubCtx({});
    ctx.github.repoMeta = () => Promise.reject(new TypeError('boom'));
    await expect(openRepo(ctx, bound(ctx, product, source))).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});

describe('chooseRef', () => {
  const release = { tag: 'v300.1.0', publishedAt: '2026-08-20T00:00:00Z' };
  const pinnedSource = () =>
    githubProduct({
      repo: REPO,
      preset: 'samples-metadata',
      pin: 'release-tag',
      tagTemplate: 'v{version}',
    });

  it('pins the current line to the latest release', async () => {
    const { product, source } = pinnedSource();
    const ctx = githubCtx({ [REPO]: { release, files: { '*': files } } });
    const scope = await openScope(ctx, bound(ctx, product, source));
    expect(scope).toMatchObject({ ref: 'v300.1.0', pinned: true, version: '300.1.0' });
    expect(ctx.github.count('latestRelease')).toBe(1);
  });

  it('pins a requested version without asking for the latest release', async () => {
    const { product, source } = pinnedSource();
    const ctx = githubCtx({ [REPO]: { release, files: { '*': files } } });
    const scope = await openScope(ctx, bound(ctx, product, source, { version: '200.8' }));
    expect(scope).toMatchObject({ ref: 'v200.8.0', pinned: true, version: '200.8.0' });
    expect(ctx.github.count('latestRelease')).toBe(0);
  });

  it('pins a requested major version only when the latest release belongs to it', async () => {
    const { product, source } = pinnedSource();
    const ctx = githubCtx({ [REPO]: { release, files: { '*': files } } });
    const same = await openScope(ctx, bound(ctx, product, source, { version: '300' }));
    expect(same).toMatchObject({ ref: 'v300.1.0', pinned: true });
    const other = await openScope(ctx, bound(ctx, product, source, { version: '200' }));
    expect(other).toMatchObject({ ref: 'main', pinned: false });
    expect(other.version).toBeUndefined();
  });

  it('reads the branch for a non-current line whose release is unknown, and says so', async () => {
    const { product, source } = pinnedSource();
    const ctx = githubCtx({ [REPO]: { release, files: { '*': files } } });
    const lts = lineOf(product, 'v200');
    const scope = await openScope(ctx, bound(ctx, product, source, { line: lts }));
    expect(scope).toMatchObject({ ref: 'main', pinned: false });
    expect(scope.notices).toEqual([
      `No release tag of ${REPO} is known for 200.x LTS; showing branch main.`,
    ]);
  });

  it('reads the default branch for pin "branch" and never asks for releases', async () => {
    const { product, source } = githubProduct({
      repo: REPO,
      preset: 'samples-metadata',
      pin: 'branch',
    });
    const ctx = githubCtx({ [REPO]: { defaultBranch: 'develop', release, files: { '*': files } } });
    const scope = await openScope(ctx, bound(ctx, product, source, { version: '300.1.0' }));
    expect(scope).toMatchObject({ ref: 'develop', pinned: false });
    expect(ctx.github.count('latestRelease')).toBe(0);
  });

  it('reads the branch when the repository has no release or the lookup fails', async () => {
    const { product, source } = pinnedSource();
    const none = githubCtx({ [REPO]: { files: { '*': files } } });
    expect(await openScope(none, bound(none, product, source))).toMatchObject({
      ref: 'main',
      pinned: false,
    });

    const limited = githubCtx({ [REPO]: { release, files: { '*': files } } });
    limited.github.exhaustQuota('2026-10-13T13:00:00Z');
    expect(await openScope(limited, bound(limited, product, source))).toMatchObject({
      ref: 'main',
      pinned: false,
    });
  });

  it('rethrows a defect of the release lookup', async () => {
    const { product, source } = pinnedSource();
    const ctx = githubCtx({ [REPO]: { release } });
    ctx.github.latestRelease = () => Promise.reject(new RangeError('boom'));
    const src = bound(ctx, product, source);
    await expect(chooseRef(ctx, src, await openRepo(ctx, src))).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('honours a ref fixed in the registry', async () => {
    const fixed = githubProduct({
      repo: REPO,
      preset: 'markdown-docs',
      ref: 'gh-pages',
      pin: 'release-tag',
    });
    const ctx = githubCtx({ [REPO]: { release } });
    expect(await openScope(ctx, bound(ctx, fixed.product, fixed.source))).toMatchObject({
      ref: 'gh-pages',
      pinned: false,
    });
    const tagged = githubProduct({ repo: REPO, preset: 'markdown-docs', ref: 'v1.4.0' });
    expect(await openScope(ctx, bound(ctx, tagged.product, tagged.source))).toMatchObject({
      ref: 'v1.4.0',
      pinned: true,
    });
  });
});

describe('openScopeAt', () => {
  it('reads at the ref of the URL and recognises a release tag', async () => {
    const { product, source } = githubProduct({
      repo: REPO,
      preset: 'samples-metadata',
      pin: 'branch',
    });
    const ctx = githubCtx({ [REPO]: {} });
    const src = bound(ctx, product, source);
    expect(await openScopeAt(ctx, src, 'feature-x')).toMatchObject({
      ref: 'feature-x',
      pinned: false,
    });
    expect(await openScopeAt(ctx, src, 'v300.1.0')).toMatchObject({
      ref: 'v300.1.0',
      pinned: true,
      version: '300.1.0',
    });
    expect(ctx.github.count('latestRelease')).toBe(0);
  });

  it('prefers the requested version over the ref of the URL where tags are reliable', async () => {
    const { product, source } = githubProduct({
      repo: REPO,
      preset: 'samples-metadata',
      pin: 'release-tag',
    });
    const ctx = githubCtx({ [REPO]: {} });
    const src = bound(ctx, product, source, { version: '200.8.0' });
    const fromTag = await openScopeAt(ctx, src, 'v300.1.0');
    expect(fromTag).toMatchObject({ ref: 'v200.8.0', version: '200.8.0', defaultBranch: 'main' });
    // A branch in the URL becomes the fallback instead of the default branch.
    const fromBranch = await openScopeAt(ctx, src, 'v.next');
    expect(fromBranch).toMatchObject({ ref: 'v200.8.0', defaultBranch: 'v.next' });
  });
});

describe('atRef', () => {
  const setup = async (tagExists: boolean) => {
    const { product, source } = githubProduct({
      repo: REPO,
      preset: 'samples-metadata',
      pin: 'release-tag',
    });
    const ctx = githubCtx({
      [REPO]: { files: tagExists ? { 'v300.1.0': files, main: files } : { main: files } },
    });
    const src = bound(ctx, product, source, { version: '300.1' });
    return { ctx, src, scope: await openScope(ctx, src) };
  };

  it('reads at the tag and asks for an immutable cache entry', async () => {
    const { ctx, src, scope } = await setup(true);
    const seen: Array<string | undefined> = [];
    const res = await atRef(ctx, src, scope, (ref, opts) => {
      seen.push(opts.ttl);
      return ctx.github.raw(REPO, ref, 'README.md', opts);
    });
    expect(res.url).toContain('/v300.1.0/README.md');
    expect(seen).toEqual(['immutable']);
    expect(scope.notices).toEqual([]);
  });

  it('falls back to the branch when the tag does not exist', async () => {
    const { ctx, src, scope } = await setup(false);
    const seen: Array<string | undefined> = [];
    const res = await atRef(ctx, src, scope, (ref, opts) => {
      seen.push(opts.ttl);
      return ctx.github.raw(REPO, ref, 'README.md', opts);
    });
    expect(res.url).toContain('/main/README.md');
    // The branch can move, so the second request must not be cached for good.
    expect(seen).toEqual(['immutable', undefined]);
    expect(scope).toMatchObject({ ref: 'main', pinned: false });
    expect(scope.version).toBeUndefined();
    expect(scope.notices).toEqual([
      `Tag v300.1.0 was not found in ${REPO}; showing branch main instead.`,
    ]);
    expect(ctx.logger.entries.at(-1)).toMatchObject({ level: 'info' });
  });

  it('keeps the first error when the path is missing on the branch too', async () => {
    const { ctx, src, scope } = await setup(false);
    const failure = atRef(ctx, src, scope, (ref, opts) =>
      ctx.github.raw(REPO, ref, 'nope.md', opts),
    );
    await expect(failure).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
    await expect(failure).rejects.toThrow(/v300\.1\.0/);
    expect(scope).toMatchObject({ ref: 'v300.1.0', pinned: true });
  });

  it('does not retry failures other than a missing ref', async () => {
    const { ctx, src, scope } = await setup(true);
    let calls = 0;
    const failure = atRef(ctx, src, scope, () => {
      calls += 1;
      return Promise.reject(new McpDocError('UPSTREAM_UNAVAILABLE', 'down', { retryable: true }));
    });
    await expect(failure).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(calls).toBe(1);
  });

  it('does not retry a missing file on a branch', async () => {
    const { product, source } = githubProduct({ repo: REPO, preset: 'markdown-docs' });
    const ctx = githubCtx({ [REPO]: { files: { main: files } } });
    const src = bound(ctx, product, source);
    const scope = await openScope(ctx, src);
    await expect(
      atRef(ctx, src, scope, (ref, opts) => ctx.github.raw(REPO, ref, 'nope.md', opts)),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
    expect(ctx.github.count('raw')).toBe(1);
  });
});
