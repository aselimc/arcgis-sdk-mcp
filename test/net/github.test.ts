import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import type { GithubClient } from '../../src/core/ports.js';
import { classifyLicenseText, classifySpdx } from '../../src/net/github-license.js';
import { createGithubClient } from '../../src/net/github.js';
import { DAY, FAKE_NOW, HOUR, MINUTE } from '../support/fake-clock.js';
import { FakeHttp } from '../support/fake-http.js';
import { FakeLogger } from '../support/fake-logger.js';
import { makeConfig } from '../support/builders.js';
import { MemoryCache } from '../support/memory-cache.js';
import { body, hostRow, json, makeRig, mcpError, status, type Rig } from './harness.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const REPO = 'Esri/arcgis-maps-sdk-kotlin-samples';
const HOSTS = [
  hostRow('api.github.com', { capability: 'github' }),
  hostRow('raw.githubusercontent.com', { capability: 'github' }),
];
const RESET_SECONDS = FAKE_NOW / 1000 + 30 * 60;
const RESET_ISO = new Date(RESET_SECONDS * 1000).toISOString();

function make(token?: string): Rig & { github: GithubClient } {
  const rig = makeRig({ hosts: HOSTS, config: token === undefined ? {} : { githubToken: token } });
  const github = createGithubClient({
    config: rig.config,
    http: rig.http,
    cache: rig.cache,
    logger: rig.logger,
    clock: rig.clock,
  });
  return { ...rig, github };
}

const repoJson = (license: unknown, extra: object = {}) =>
  json({ default_branch: 'main', archived: false, license, ...extra });

describe('licence classification', () => {
  it.each<[string | null | undefined, ReturnType<typeof classifySpdx>]>([
    ['Apache-2.0', 'apache-2.0'],
    ['apache-2.0', 'apache-2.0'],
    ['CC-BY-ND-4.0', 'cc-by-nd'],
    ['MIT', 'unlicensed'],
    ['GPL-3.0', 'unlicensed'],
    [null, 'unlicensed'],
    [undefined, 'unlicensed'],
    ['NOASSERTION', undefined],
    ['', undefined],
  ])('SPDX %j', (spdx, tier) => {
    expect(classifySpdx(spdx)).toBe(tier);
  });

  it.each<[string, ReturnType<typeof classifyLicenseText>]>([
    ['Apache License\n                           Version 2.0, January 2004', 'apache-2.0'],
    ['Licensed under the Apache License, Version 2.0 (the "License");', 'apache-2.0'],
    ['Creative Commons Attribution-NoDerivatives 4.0 International', 'cc-by-nd'],
    ['See https://creativecommons.org/licenses/by-nd/4.0/legalcode', 'cc-by-nd'],
    ['Use is governed by the Esri Master License Agreement.', 'esri-ma'],
    ['Use is governed by the Esri Master Agreement (E204CW).', 'esri-ma'],
    ['All rights reserved.', 'unlicensed'],
    ['', 'unlicensed'],
  ])('licence text %j', (text, tier) => {
    expect(classifyLicenseText(text)).toBe(tier);
  });
});

describe('github: repoMeta', () => {
  it('reads branch, archive flag and licence, with the API headers and no token', async () => {
    const rig = make();
    rig.origin.on(
      `${API}/repos/${REPO}`,
      json({ default_branch: 'v.next', archived: true, license: { spdx_id: 'Apache-2.0' } }),
    );
    expect(await rig.github.repoMeta(REPO)).toEqual({
      defaultBranch: 'v.next',
      license: 'apache-2.0',
      archived: true,
    });
    const headers = rig.origin.calls[0]?.headers;
    expect(headers?.accept).toBe('application/vnd.github+json');
    expect(headers?.['x-github-api-version']).toBe('2022-11-28');
    expect(headers?.authorization).toBeUndefined();
    expect(rig.github.quota().authenticated).toBe(false);
  });

  it('remembers the answer for seven days, across client instances', async () => {
    const rig = make();
    rig.origin.on(`${API}/repos/${REPO}`, repoJson({ spdx_id: 'Apache-2.0' }));
    await rig.github.repoMeta(REPO);

    // A different HTTP client that knows nothing: the derived cache alone answers.
    const other = createGithubClient({
      config: rig.config,
      http: new FakeHttp({ clock: rig.clock }),
      cache: rig.cache,
      logger: rig.logger,
      clock: rig.clock,
    });
    rig.clock.advance(6 * DAY);
    expect((await other.repoMeta(REPO.toUpperCase())).license).toBe('apache-2.0');

    rig.clock.advance(2 * DAY);
    await rig.github.repoMeta(REPO);
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('falls back to defaults for fields the API leaves out', async () => {
    const rig = make();
    rig.origin.on(`${API}/repos/${REPO}`, json({}));
    expect(await rig.github.repoMeta(REPO)).toEqual({
      defaultBranch: 'main',
      license: 'unlicensed',
      archived: false,
    });
  });

  it.each<[string, unknown, string]>([
    ['no licence file', null, 'unlicensed'],
    ['a licence outside the known tiers', { spdx_id: 'MIT' }, 'unlicensed'],
  ])('classifies %s without a second request', async (_label, license, tier) => {
    const rig = make();
    rig.origin.on(`${API}/repos/${REPO}`, repoJson(license));
    expect((await rig.github.repoMeta(REPO)).license).toBe(tier);
    expect(rig.origin.calls).toHaveLength(1);
  });

  it('reads the licence file when GitHub could not name the licence', async () => {
    const rig = make();
    const text = 'Creative Commons Attribution-NoDerivatives 4.0 International Public License';
    rig.origin
      .on(`${API}/repos/Esri/i3s-spec`, repoJson({ spdx_id: 'NOASSERTION' }))
      .on(
        `${API}/repos/Esri/i3s-spec/license`,
        json({ encoding: 'base64', content: Buffer.from(text).toString('base64') }),
      );
    expect((await rig.github.repoMeta('Esri/i3s-spec')).license).toBe('cc-by-nd');
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('reads a licence file that is not base64, and one without content', async () => {
    const rig = make();
    rig.origin
      .on(`${API}/repos/Esri/a`, repoJson({ spdx_id: 'NOASSERTION' }))
      .on(`${API}/repos/Esri/a/license`, json({ content: 'Apache License, Version 2.0' }))
      .on(`${API}/repos/Esri/b`, repoJson({ spdx_id: 'NOASSERTION' }))
      .on(`${API}/repos/Esri/b/license`, json({}));
    expect((await rig.github.repoMeta('Esri/a')).license).toBe('apache-2.0');
    expect((await rig.github.repoMeta('Esri/b')).license).toBe('unlicensed');
  });

  it('settles on unlicensed when the licence file is missing', async () => {
    const rig = make();
    rig.origin
      .on(`${API}/repos/${REPO}`, repoJson({ spdx_id: 'NOASSERTION' }))
      .on(`${API}/repos/${REPO}/license`, status(404));
    expect((await rig.github.repoMeta(REPO)).license).toBe('unlicensed');
    expect(rig.cache.derivedKeys()).toContainEqual(['license', `github:${REPO.toLowerCase()}`]);
  });

  it('does not remember an answer that rests on a failed licence read', async () => {
    const rig = make();
    rig.origin
      .on(`${API}/repos/${REPO}`, repoJson({ spdx_id: 'NOASSERTION' }))
      .on(`${API}/repos/${REPO}/license`, status(500));
    expect((await rig.github.repoMeta(REPO)).license).toBe('unlicensed');
    expect(rig.logger.messages('warn')).toHaveLength(1);
    expect(rig.cache.derivedKeys().filter(([ns]) => ns === 'license')).toEqual([]);
  });

  it.each(['Esri', 'Esri/a/b', '../etc', 'Esri/..', 'Esri/re po', '-x/y', 'Esri/a?b'])(
    'rejects "%s" as a repository name without a request',
    async (name) => {
      const rig = make();
      for (const call of [
        () => rig.github.repoMeta(name),
        () => rig.github.tree(name, 'main'),
        () => rig.github.latestRelease(name),
        () => rig.github.raw(name, 'main', 'README.md'),
        () => rig.github.wikiRaw(name, 'Home'),
      ]) {
        expect((await mcpError(call())).code).toBe('DOC_NOT_FOUND');
      }
      expect(rig.origin.calls).toEqual([]);
    },
  );
});

describe('github: tree, raw, wiki, releases', () => {
  it('lists the files of a tree in one request and caches it for a day', async () => {
    const rig = make();
    rig.origin.on(
      `${API}/repos/${REPO}/git/trees/feature/next?recursive=1`,
      json({
        truncated: false,
        tree: [
          { path: 'README.md', type: 'blob', size: 120 },
          { path: 'samples', type: 'tree' },
          { path: 'samples/add-layer/README.md', type: 'blob' },
          { type: 'blob' },
          null,
        ],
      }),
    );
    const files = await rig.github.tree(REPO, 'feature/next');
    expect(files).toEqual([
      { path: 'README.md', size: 120 },
      { path: 'samples/add-layer/README.md' },
    ]);

    rig.clock.advance(23 * HOUR);
    await rig.github.tree(REPO, 'feature/next');
    expect(rig.origin.calls).toHaveLength(1);
  });

  it('warns about a truncated tree and tolerates a missing list', async () => {
    const rig = make();
    rig.origin.on(/git\/trees/, json({ truncated: true }));
    expect(await rig.github.tree(REPO, 'main')).toEqual([]);
    expect(rig.logger.messages('warn')).toEqual([
      'GitHub truncated the tree; some files are missing',
    ]);
  });

  it('reads raw files from the raw host, without the API headers or the token', async () => {
    const rig = make('ghp_secret');
    const url = `${RAW}/${REPO}/main/samples/add%20layer/README.md`;
    rig.origin.on(url, body('# Add layer', 'text/plain; charset=utf-8'));

    const res = await rig.github.raw(REPO, 'main', 'samples/add layer/README.md');
    expect(res).toMatchObject({ url, text: '# Add layer', cache: 'miss' });
    const headers = rig.origin.calls[0]?.headers;
    expect(headers?.authorization).toBeUndefined();
    expect(headers?.['x-github-api-version']).toBeUndefined();
  });

  it('treats a branch as volatile and a commit or a pinned tag as immutable', async () => {
    const rig = make();
    const sha = 'f'.repeat(40);
    rig.origin.on(/raw\.githubusercontent/, body('text', 'text/plain'));

    await rig.github.raw(REPO, 'main', 'a.md');
    await rig.github.raw(REPO, sha, 'a.md');
    await rig.github.raw(REPO, '300.1.0', 'a.md', { ttl: 'immutable' });
    rig.clock.advance(7 * HOUR);
    expect((await rig.github.raw(REPO, 'main', 'a.md')).cache).toBe('miss');
    rig.clock.advance(60 * DAY);
    expect((await rig.github.raw(REPO, sha, 'a.md')).cache).toBe('hit');
    expect((await rig.github.raw(REPO, '300.1.0', 'a.md')).cache).toBe('hit');
  });

  it('answers DOC_NOT_FOUND for an unknown ref or path', async () => {
    const rig = make();
    rig.origin.on(/raw\.githubusercontent/, status(404));
    expect((await mcpError(rig.github.raw(REPO, 'nope', 'README.md'))).code).toBe('DOC_NOT_FOUND');
  });

  it('accepts an HTML file as a page', async () => {
    const rig = make();
    const html = '<!doctype html><html><body><div id="viewDiv"></div></body></html>';
    rig.origin.on(`${RAW}/${REPO}/main/index.html`, body(html, 'text/plain'));
    expect((await rig.github.raw(REPO, 'main', 'index.html')).text).toBe(html);
  });

  it('reads wiki pages by name, with or without the extension', async () => {
    const rig = make();
    const url = `${RAW}/wiki/Esri/arcgis-pro-sdk/ProConcepts-Map-Authoring.md`;
    rig.origin.on(url, body('## Map authoring', 'text/plain'));
    const plain = await rig.github.wikiRaw('Esri/arcgis-pro-sdk', 'ProConcepts-Map-Authoring');
    const suffixed = await rig.github.wikiRaw(
      'Esri/arcgis-pro-sdk',
      'ProConcepts-Map-Authoring.md',
    );
    expect(plain.text).toBe('## Map authoring');
    expect(suffixed.cache).toBe('hit');
  });

  it('returns the latest release, or undefined when there is none', async () => {
    const rig = make();
    rig.origin
      .on(
        `${API}/repos/${REPO}/releases/latest`,
        json({ tag_name: '300.1.0', published_at: '2026-08-20T16:00:00Z', prerelease: false }),
      )
      .on(`${API}/repos/Esri/none/releases/latest`, status(404))
      .on(`${API}/repos/Esri/odd/releases/latest`, json({ name: 'untagged' }));
    expect(await rig.github.latestRelease(REPO)).toEqual({
      tag: '300.1.0',
      publishedAt: '2026-08-20T16:00:00Z',
    });
    expect(await rig.github.latestRelease('Esri/none')).toBeUndefined();
    expect(await rig.github.latestRelease('Esri/odd')).toBeUndefined();
  });

  it('counts its requests against the budget of the call', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, repoJson(null)).on(/raw\./, body('x', 'text/plain'));
    const budget = newBudget(12, 25_000, rig.clock);
    await rig.github.repoMeta(REPO, { budget });
    await rig.github.raw(REPO, 'main', 'a.md', { budget });
    expect(budget.used).toBe(2);

    const spent = newBudget(0, 25_000, rig.clock);
    const error = await mcpError(rig.github.tree(REPO, 'main', { budget: spent }));
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('passes the cancellation signal on', async () => {
    const rig = make();
    const controller = new AbortController();
    controller.abort();
    const error = await mcpError(rig.github.tree(REPO, 'main', { signal: controller.signal }));
    expect(error.details?.why).toBe('cancelled by the caller');
    expect(
      (await mcpError(rig.github.raw(REPO, 'main', 'a.md', { signal: controller.signal }))).code,
    ).toBe('UPSTREAM_UNAVAILABLE');
  });
});
