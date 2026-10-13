import { describe, expect, it } from 'vitest';
import { isMcpDocError, type ErrorCode } from '../../src/core/errors.js';
import { makeDocPage, makeHost, makeResponse } from './builders.js';
import { FakeGithub } from './fake-github.js';
import { fakePolicy, permissiveHost } from './fake-policy.js';
import { FakeRenderer } from './fake-render.js';

async function codeOf(run: () => unknown): Promise<ErrorCode | 'no error' | 'other error'> {
  try {
    await run();
    return 'no error';
  } catch (error) {
    return isMcpDocError(error) ? error.code : 'other error';
  }
}

describe('FakeGithub', () => {
  const github = () =>
    new FakeGithub({
      'Esri/example': {
        defaultBranch: 'master',
        files: {
          '*': { 'README.md': '# Example', 'docs/a.md': 'A' },
          'v1.0.0': { 'README.md': '# Example 1.0' },
        },
        wiki: { Home: '# Wiki home' },
        release: { tag: 'v1.0.0', publishedAt: '2026-09-01T00:00:00Z' },
      },
      'Esri/bare': {},
    });

  it('serves metadata, trees, raw files, wiki pages and releases', async () => {
    const gh = github();
    expect(await gh.repoMeta('Esri/example')).toEqual({
      defaultBranch: 'master',
      license: 'apache-2.0',
      archived: false,
    });
    expect(await gh.repoMeta('Esri/bare')).toMatchObject({ defaultBranch: 'main' });
    expect(await gh.tree('Esri/example', 'master')).toEqual([
      { path: 'README.md', size: 9 },
      { path: 'docs/a.md', size: 1 },
    ]);
    expect((await gh.raw('Esri/example', 'v1.0.0', 'README.md')).text).toBe('# Example 1.0');
    expect((await gh.raw('Esri/example', 'master', 'docs/a.md')).url).toBe(
      'https://raw.githubusercontent.com/Esri/example/master/docs/a.md',
    );
    expect((await gh.wikiRaw('Esri/example', 'Home.md')).text).toBe('# Wiki home');
    expect(await gh.latestRelease('Esri/example')).toEqual({
      tag: 'v1.0.0',
      publishedAt: '2026-09-01T00:00:00Z',
    });
    expect(await gh.latestRelease('Esri/bare')).toBeUndefined();
    expect(gh.count()).toBe(8);
    expect(gh.count('raw')).toBe(2);
    expect(gh.calls[2]).toEqual({ method: 'tree', repo: 'Esri/example', ref: 'master' });
  });

  it('answers DOC_NOT_FOUND for unknown repos, refs, paths and wiki pages', async () => {
    const gh = github();
    expect(await codeOf(() => gh.repoMeta('Esri/missing'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.raw('Esri/example', 'v1.0.0', 'docs/a.md'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.tree('Esri/bare', 'main'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.wikiRaw('Esri/example', 'Missing'))).toBe('DOC_NOT_FOUND');
  });

  it('rate-limits the API but not raw content once the quota is exhausted', async () => {
    const gh = github().exhaustQuota('2026-10-13T13:00:00Z');
    expect(gh.quota()).toEqual({
      authenticated: false,
      remaining: 0,
      resetAt: '2026-10-13T13:00:00Z',
    });
    expect(await codeOf(() => gh.repoMeta('Esri/example'))).toBe('RATE_LIMITED_GITHUB');
    expect(await codeOf(() => gh.tree('Esri/example', 'master'))).toBe('RATE_LIMITED_GITHUB');
    expect(await codeOf(() => gh.latestRelease('Esri/example'))).toBe('RATE_LIMITED_GITHUB');
    expect((await gh.raw('Esri/example', 'master', 'README.md')).status).toBe(200);

    gh.restoreQuota({ authenticated: true });
    expect(gh.quota()).toEqual({ authenticated: true, remaining: 5000 });
    await gh.repoMeta('Esri/example');
    expect(gh.quota().remaining).toBe(4999);
    expect(gh.restoreQuota({ remaining: 3 }).quota().remaining).toBe(3);
    expect(new FakeGithub().addRepo('Esri/x', {}).restoreQuota().quota().remaining).toBe(60);
  });
});

describe('fakePolicy', () => {
  const url = (text: string): URL => new URL(text);

  it('allows any https host under website when no host table is given', () => {
    const policy = fakePolicy();
    expect(policy.check(url('https://anything.example/x'))).toEqual({
      host: permissiveHost('anything.example'),
      capability: 'website',
    });
    expect(policy.enabled('website')).toBe(true);
    expect(policy.enabled('site-search')).toBe(false);
    expect(policy.checked).toEqual(['https://anything.example/x']);
    expect(policy.summary()).toMatchObject({ preset: 'test', offline: false });
    expect(policy.summary().disabled).toEqual(['site-search', 'lifecycle-api']);
  });

  it('applies allow-list, link-only and capability decisions with a host table', async () => {
    const policy = fakePolicy({
      enabled: ['website'],
      offline: true,
      hosts: [
        makeHost(),
        makeHost({ host: 'archive.developers.arcgis.com', capability: null }),
        makeHost({ host: 'cdn.jsdelivr.net', capability: 'package-cdn' }),
      ],
    });
    expect(policy.check(url('https://developers.arcgis.com/x')).capability).toBe('website');
    expect(await codeOf(() => policy.check(url('https://evil.example/x')))).toBe(
      'HOST_NOT_ALLOWED',
    );
    expect(await codeOf(() => policy.check(url('http://developers.arcgis.com/x')))).toBe(
      'HOST_NOT_ALLOWED',
    );
    expect(await codeOf(() => policy.check(url('https://archive.developers.arcgis.com/x')))).toBe(
      'LINK_ONLY',
    );
    expect(await codeOf(() => policy.check(url('https://cdn.jsdelivr.net/npm/x')))).toBe(
      'SOURCE_DISABLED',
    );
    expect(policy.summary()).toMatchObject({ enabled: ['website'], offline: true });
  });
});

describe('FakeRenderer', () => {
  const meta = {
    url: 'https://developers.arcgis.com/widgets/a/',
    kind: 'guide',
    license: 'esri-website-terms',
  } as const;

  it('renders markdown into sections and copies metadata from meta', () => {
    const renderer = new FakeRenderer();
    const res = makeResponse({
      cache: 'stale',
      aliasChain: ['https://developers.arcgis.com/old/'],
    });
    const page = renderer.render(
      'markdown',
      { markdown: '# Title\n\nBody\n\n## Part\n\nMore' },
      { ...meta, product: 'widgets-sdk', source: 'guide', line: 'latest', version: '5.1', res },
      { detail: 'summary' },
    );
    expect(page).toMatchObject({
      ref: meta.url,
      title: 'Title',
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      version: '5.1',
      cache: 'stale',
      redirectedFrom: ['https://developers.arcgis.com/old/'],
    });
    expect(page.sections.map((section) => section.id)).toEqual(['title', 'part']);
    expect(page.attribution).toContain('cached, stale');
    expect(page.diagnostics).toMatchObject({
      family: 'structured',
      renderer: 'markdown',
      redirectHops: 1,
    });
    expect(renderer.calls[0]).toMatchObject({ kind: 'markdown', opts: { detail: 'summary' } });
  });

  it('reduces html to text and names the renderer for structured kinds', () => {
    const renderer = new FakeRenderer();
    renderer.family = 'gatsby';
    const html = renderer.render('html', { html: '<main><h1>Hello</h1><p>World</p></main>' }, meta);
    expect(html.sections[0]?.markdown).toBe('Hello World');
    expect(html.diagnostics.family).toBe('gatsby');
    expect(html).not.toHaveProperty('product');
    expect(renderer.calls[0]).not.toHaveProperty('opts');
    expect(renderer.render('docc', { json: {} }, meta).title).toBe('Rendered by docc');
    expect(renderer.detectFamily()).toBe('gatsby');
  });

  it('returns canned pages and per-kind handlers', () => {
    const canned = makeDocPage({ title: 'Canned' });
    const handled = makeDocPage({ title: 'Handled' });
    const renderer = new FakeRenderer().when('cem', () => handled);
    expect(renderer.render('cem', { manifest: {}, tag: 'x-y', packageName: 'p' }, meta)).toBe(
      handled,
    );
    expect(
      renderer.returns(canned).render('cem', { manifest: {}, tag: 'x-y', packageName: 'p' }, meta),
    ).toBe(canned);
    expect(renderer.calls).toHaveLength(2);
  });

  it('detects a meta-refresh stub', () => {
    const renderer = new FakeRenderer();
    expect(
      renderer.detectMetaRefresh(
        '<html><head><meta http-equiv="refresh" content="0; url=../new/"></head></html>',
        'https://doc.arcgis.com/en/x/old/',
      ),
    ).toBe('https://doc.arcgis.com/en/x/new/');
    expect(
      renderer.detectMetaRefresh('<html><body>page</body></html>', 'https://h.example/'),
    ).toBeUndefined();
  });
});
