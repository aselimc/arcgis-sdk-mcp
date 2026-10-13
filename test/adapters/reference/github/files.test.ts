import { describe, expect, it } from 'vitest';
import { githubRepoAdapter } from '../../../../src/adapters/reference/github/adapter.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import type { FakeRepo } from '../../../support/fake-github.js';
import { bound, githubCtx, githubProduct, repoFiles, type GithubConfig } from './support.js';

const REPO = 'Esri/symbol-spec';
const docs = repoFiles('docs');
const blob = (path: string, ref = 'main') => `https://github.com/${REPO}/blob/${ref}/${path}`;

function setup(
  config: Partial<GithubConfig> = {},
  repo: FakeRepo = { files: { '*': docs } },
  source: Parameters<typeof githubProduct>[1] = {},
  maxRequests?: number,
) {
  const made = githubProduct(
    { repo: REPO, preset: 'markdown-docs', ...config },
    { id: 'spec', kinds: ['spec'], ...source },
    { name: 'Symbol model specification' },
  );
  const ctx = githubCtx({ [REPO]: repo });
  const options = maxRequests === undefined ? {} : { maxRequests };
  return { ctx, src: bound(ctx, made.product, made.source, options) };
}

describe('markdown-docs: catalogue', () => {
  it('lists Markdown and schema files with titles from their names', async () => {
    const { ctx, src } = setup();
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(
      records.map((record) => [record.ref, record.title, record.kind, record.breadcrumb]),
    ).toEqual([
      [blob('CHANGELOG.md'), 'CHANGELOG', 'release-notes', undefined],
      [blob('README.md'), 'Symbol spec', 'spec', undefined],
      [blob('docs/v3/Overview.md'), 'Overview', 'spec', 'Docs > V3'],
      [blob('docs/v3/Symbols.md'), 'Symbols', 'spec', 'Docs > V3'],
      [blob('proto/Feature.proto'), 'Feature.proto', 'spec', 'Proto'],
    ]);
    // Housekeeping files are never part of a catalogue, and no body is fetched for titles.
    expect(records.some((record) => record.ref.includes('CONTRIBUTING'))).toBe(false);
    expect(ctx.github.count('raw')).toBe(0);
  });

  it('narrows the catalogue with the include and exclude globs of the registry', async () => {
    const { ctx, src } = setup({ include: ['README.md', 'docs/**'], exclude: ['**/Overview.md'] });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.locator?.path)).toEqual([
      'README.md',
      'docs/v3/Symbols.md',
    ]);
  });

  it('names a nested README after its directory', async () => {
    const files = { 'widgets/chart-widget/README.md': '# Chart', 'widgets/README.md': '# Widgets' };
    const { ctx, src } = setup({}, { files: { '*': files } });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => [record.title, record.breadcrumb])).toEqual([
      ['Widgets', undefined],
      ['Chart widget', 'Widgets'],
    ]);
  });

  it('turns identifier headings into symbol records pointing at their sections', async () => {
    const { ctx, src } = setup({ include: ['docs/v3/*.md'], symbolsFromHeadings: 2 });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    const symbols = records.filter((record) => record.symbol !== undefined);
    expect(symbols).toEqual([
      expect.objectContaining({
        ref: `${blob('docs/v3/Symbols.md')}#sympointsymbol`,
        title: 'SYMPointSymbol',
        symbol: 'SYMPointSymbol',
        qualified: 'SYMPointSymbol',
        symbolKind: 'type',
        kind: 'spec',
        breadcrumb: 'Docs > V3 > Symbols',
        locator: { path: 'docs/v3/Symbols.md', section: 'sympointsymbol' },
      }),
      expect.objectContaining({ ref: `${blob('docs/v3/Symbols.md')}#symlinesymbol` }),
    ]);
    // "How to read these tables" is a chapter, not a type; type records are not members.
    expect(symbols.every((record) => record.parent === undefined)).toBe(true);
    expect(ctx.github.count('raw')).toBe(2);
  });

  it('marks heading symbols as API records when the source declares that kind', async () => {
    const { ctx, src } = setup(
      { include: ['docs/v3/Symbols.md'], symbolsFromHeadings: 2 },
      undefined,
      { kinds: ['spec', 'api'] },
    );
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.kind)).toEqual(['spec', 'api', 'api']);
  });

  it('indexes headings only as far as the request budget reaches', async () => {
    // Metadata and tree leave one request: Overview.md is scanned, Symbols.md is not.
    const { ctx, src } = setup(
      { include: ['docs/v3/*.md'], symbolsFromHeadings: 2 },
      undefined,
      {},
      3,
    );
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.title)).toEqual(['Overview', 'Symbols']);
    expect(ctx.github.count('raw')).toBe(1);
  });

  it('opens a heading symbol as the section of its page', async () => {
    const { ctx, src } = setup({ include: ['docs/v3/Symbols.md'], symbolsFromHeadings: 2 });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    const record = records.find((candidate) => candidate.symbol === 'SYMLineSymbol');
    if (record === undefined) throw new Error('the symbol record is missing');
    const page = await githubRepoAdapter.symbol?.(ctx, src, record, 'summary');
    expect(ctx.render.calls.at(-1)?.opts).toEqual({
      select: { section: 'symlinesymbol' },
      detail: 'summary',
    });
    expect(page?.ref).toBe(record.ref);
  });
});

describe('notebooks: catalogue', () => {
  it('lists notebooks with ordering prefixes removed from titles and breadcrumbs', async () => {
    const made = githubProduct({ repo: 'Esri/widget-notebooks', preset: 'notebooks' });
    const files = {
      ...repoFiles('notebooks'),
      'guide/.ipynb_checkpoints/connect-to-a-portal-checkpoint.ipynb': '{}',
    };
    const ctx = githubCtx({ 'Esri/widget-notebooks': { files: { '*': files } } });
    const records =
      (await githubRepoAdapter.enumerate?.(ctx, bound(ctx, made.product, made.source))) ?? [];
    expect(records.map((record) => [record.title, record.breadcrumb, record.kind])).toEqual([
      ['Connect to a portal', 'Guide > Getting started', 'sample'],
      ['Clean address data', 'Samples', 'sample'],
    ]);
  });
});

describe('reading files and directories', () => {
  it('passes Markdown through the markdown renderer with the selector of the request', async () => {
    const { ctx, src } = setup();
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`${blob('docs/v3/Symbols.md')}#symlinesymbol`),
      select: { section: 'symlinesymbol' },
      detail: 'full',
    });
    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('markdown');
    expect((call?.input as RendererInputs['markdown']).markdown).toBe(docs['docs/v3/Symbols.md']);
    expect(call?.opts).toEqual({ select: { section: 'symlinesymbol' }, detail: 'full' });
    expect(page).toMatchObject({
      ref: `${blob('docs/v3/Symbols.md')}#symlinesymbol`,
      url: blob('docs/v3/Symbols.md'),
      kind: 'spec',
      product: src.product.id,
      source: 'spec',
      line: 'latest',
    });
  });

  it('returns CC BY-ND content verbatim and names the specification in the source line', async () => {
    const { ctx, src } = setup({}, undefined, { license: 'cc-by-nd' });
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(blob('README.md')) });
    const call = ctx.render.calls.at(-1);
    expect(call?.opts).toEqual({ verbatim: true });
    expect(call?.meta).toMatchObject({
      license: 'cc-by-nd',
      specName: 'Symbol model specification',
    });
    expect(page.license).toBe('cc-by-nd');
    expect(page.attribution).toContain('Symbol model specification');
  });

  it('uses the licence GitHub reports for the repository', async () => {
    const { ctx, src } = setup({}, { license: 'unlicensed', files: { '*': docs } });
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(blob('README.md')) });
    expect(page.license).toBe('unlicensed');
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.every((record) => record.license === 'unlicensed')).toBe(true);
  });

  it('classifies a change log as release notes unless the record says otherwise', async () => {
    const { ctx, src } = setup();
    const url = new URL(blob('CHANGELOG.md'));
    expect((await githubRepoAdapter.read(ctx, src, { url })).kind).toBe('release-notes');
    const [record] = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    if (record === undefined) throw new Error('no record');
    const viaRecord = await githubRepoAdapter.read(ctx, src, {
      url,
      record: { ...record, kind: 'guide' },
    });
    expect(viaRecord.kind).toBe('guide');
  });

  it('renders a schema file as source and a notebook through the notebook renderer', async () => {
    const { ctx, src } = setup(
      {},
      {
        files: {
          '*': {
            ...docs,
            'nb/demo.ipynb': '{"cells":[],"nbformat":4}',
            'nb/broken.ipynb': '{"cells":',
          },
        },
      },
    );
    await githubRepoAdapter.read(ctx, src, { url: new URL(blob('proto/Feature.proto')) });
    const source = ctx.render.calls.at(-1);
    expect(source?.kind).toBe('source');
    expect((source?.input as RendererInputs['source']).files).toEqual([
      {
        name: 'Feature.proto',
        text: docs['proto/Feature.proto'],
        ref: blob('proto/Feature.proto'),
      },
    ]);

    await githubRepoAdapter.read(ctx, src, { url: new URL(blob('nb/demo.ipynb')) });
    const notebook = ctx.render.calls.at(-1);
    expect(notebook?.kind).toBe('notebook');
    expect((notebook?.input as RendererInputs['notebook']).ipynb).toEqual({
      cells: [],
      nbformat: 4,
    });

    await expect(
      githubRepoAdapter.read(ctx, src, { url: new URL(blob('nb/broken.ipynb')) }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: blob('nb/broken.ipynb'), host: 'github.com', retryable: false },
    });
  });

  it('refuses binary files without requesting them', async () => {
    const { ctx, src } = setup();
    await expect(
      githubRepoAdapter.read(ctx, src, { url: new URL(blob('docs/diagram.png')) }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND', details: { host: 'github.com' } });
    expect(ctx.github.count('raw')).toBe(0);
  });

  it('reads the repository root and a directory as their README', async () => {
    const files = { ...docs, 'docs/v3/readme.md': '# Version 3' };
    const { ctx, src } = setup({}, { files: { '*': files } });
    const root = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`https://github.com/${REPO}`),
    });
    expect(root.ref).toBe(blob('README.md'));
    const dir = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`https://github.com/${REPO}/tree/main/docs/v3/`),
    });
    expect(dir.ref).toBe(blob('docs/v3/readme.md'));
    const bareRef = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`https://github.com/${REPO}/tree/main`),
    });
    expect(bareRef.ref).toBe(blob('README.md'));
  });

  it('explains a directory without a README and a directory that does not exist', async () => {
    const { ctx, src } = setup();
    await expect(
      githubRepoAdapter.read(ctx, src, {
        url: new URL(`https://github.com/${REPO}/tree/main/proto`),
      }),
    ).rejects.toThrow('proto has no README');
    await expect(
      githubRepoAdapter.read(ctx, src, {
        url: new URL(`https://github.com/${REPO}/tree/main/nope`),
      }),
    ).rejects.toThrow(`${REPO} has no directory "nope"`);
  });

  it('rejects URLs of other repositories and of pages that are not content', async () => {
    const { ctx, src } = setup();
    for (const url of [
      'https://github.com/Esri/other-repo/blob/main/README.md',
      `https://github.com/${REPO}/issues/12`,
      'https://developers.arcgis.com/widgets/',
    ]) {
      await expect(githubRepoAdapter.read(ctx, src, { url: new URL(url) })).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        details: { url },
      });
    }
    expect(ctx.github.calls).toEqual([]);
  });

  it('reports a missing file as DOC_NOT_FOUND', async () => {
    const { ctx, src } = setup();
    await expect(
      githubRepoAdapter.read(ctx, src, { url: new URL(blob('docs/v3/Missing.md')) }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
  });

  it('notes an archived repository on every page', async () => {
    const { ctx, src } = setup({}, { archived: true, files: { '*': docs } });
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(blob('README.md')) });
    expect(page.notices).toEqual([`The repository ${REPO} is archived and no longer updated.`]);
  });

  it('counts every GitHub call against the budget of the source', async () => {
    const { ctx, src } = setup({}, undefined, {}, 5);
    await githubRepoAdapter.read(ctx, src, { url: new URL(blob('README.md')) });
    expect(src.budget?.used).toBe(2);
    expect(ctx.github.calls.map((call) => call.method)).toEqual(['repoMeta', 'raw']);
  });
});

describe('GitHub API quota', () => {
  const RESET = '2026-10-13T13:00:00.000Z';

  it('answers RATE_LIMITED_GITHUB when a catalogue cannot be listed', async () => {
    const { ctx, src } = setup();
    ctx.github.exhaustQuota(RESET);
    const failure = githubRepoAdapter.enumerate?.(ctx, src);
    await expect(failure).rejects.toMatchObject({
      code: 'RATE_LIMITED_GITHUB',
      details: { host: 'api.github.com', retryable: false },
    });
    await expect(failure).rejects.toMatchObject({
      details: {
        why: expect.stringContaining(RESET) as string,
        next: expect.stringContaining('GITHUB_TOKEN') as string,
      },
    });
  });

  it('still reads files, which need the raw host only', async () => {
    const { ctx, src } = setup({}, { license: 'unlicensed', files: { '*': docs } });
    ctx.github.exhaustQuota(RESET);
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(blob('docs/v3/Symbols.md')),
    });
    expect(page.sections.length).toBeGreaterThan(0);
    // The licence could not be checked, so the registry tier of the source applies.
    expect(page.license).toBe('apache-2.0');
  });

  it('reads the conventional README of a directory when it cannot be listed', async () => {
    const { ctx, src } = setup();
    ctx.github.exhaustQuota(RESET);
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`https://github.com/${REPO}`),
    });
    expect(page.ref).toBe(blob('README.md'));
    await expect(
      githubRepoAdapter.read(ctx, src, {
        url: new URL(`https://github.com/${REPO}/tree/main/proto`),
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED_GITHUB' });
  });

  it('returns a sample without its file list rather than failing', async () => {
    const repo = 'Esri/desktop-sdk-samples';
    const made = githubProduct({ repo, preset: 'samples-readme' });
    const ctx = githubCtx({ [repo]: { files: { '*': repoFiles('samples-pro') } } });
    ctx.github.exhaustQuota(RESET);
    const page = await githubRepoAdapter.read(ctx, bound(ctx, made.product, made.source), {
      url: new URL(`https://github.com/${repo}/blob/main/Framework/SimpleDockpane/ReadMe.md`),
    });
    expect((ctx.render.calls.at(-1)?.input as RendererInputs['source']).files).toEqual([]);
    expect(page.notices).toEqual([
      `The source files could not be listed; browse them at https://github.com/${repo}/tree/main/Framework/SimpleDockpane.`,
    ]);
  });

  it('reports the quota error from a probe as a failed canary', async () => {
    const { ctx, src } = setup();
    ctx.github.exhaustQuota(RESET);
    const result = await githubRepoAdapter.probe(ctx, src);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^RATE_LIMITED_GITHUB: .*quota.*\(.*resets at/);
  });
});

describe('probe', () => {
  it('checks the repository with one request', async () => {
    const { ctx, src } = setup();
    expect(await githubRepoAdapter.probe(ctx, src)).toEqual({ ok: true, ms: 0 });
    expect(ctx.github.calls.map((call) => call.method)).toEqual(['repoMeta']);
  });

  it('also checks the home page of a wiki against the declared minimum size', async () => {
    const made = githubProduct(
      { repo: 'Esri/desktop-sdk', preset: 'wiki' },
      {
        probe: {
          url: 'https://api.github.com/repos/Esri/desktop-sdk',
          expect: 'json',
          minChars: 50,
        },
      },
    );
    const ok = githubCtx({ 'Esri/desktop-sdk': { wiki: { Home: 'x'.repeat(80) } } });
    expect(await githubRepoAdapter.probe(ok, bound(ok, made.product, made.source))).toEqual({
      ok: true,
      chars: 80,
      ms: 0,
    });
    const small = githubCtx({ 'Esri/desktop-sdk': { wiki: { Home: 'stub' } } });
    expect(await githubRepoAdapter.probe(small, bound(small, made.product, made.source))).toEqual({
      ok: false,
      chars: 4,
      error: 'Expected at least 50 characters, found 4',
      ms: 0,
    });
  });

  it('fails for a repository that does not exist', async () => {
    const { ctx, src } = setup({}, undefined);
    const gone = githubCtx({});
    const result = await githubRepoAdapter.probe(gone, src);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/^DOC_NOT_FOUND: /);
    expect(ctx.github.calls).toEqual([]);
  });
});

describe('owns', () => {
  const owns = (config: Partial<GithubConfig>, url: string): boolean => {
    const { src } = setup(config);
    return githubRepoAdapter.owns?.(new URL(url), src) ?? false;
  };

  it('claims files, directories and wiki pages of its repository on both hosts', () => {
    expect(owns({}, blob('docs/v3/Symbols.md'))).toBe(true);
    expect(owns({}, `https://github.com/esri/SYMBOL-SPEC/tree/main/docs`)).toBe(true);
    expect(owns({}, `https://github.com/${REPO}`)).toBe(true);
    expect(owns({}, `https://github.com/${REPO}/wiki/Home`)).toBe(true);
    expect(owns({}, `https://raw.githubusercontent.com/${REPO}/main/proto/Feature.proto`)).toBe(
      true,
    );
  });

  it('does not claim other repositories or non-content pages', () => {
    expect(owns({}, 'https://github.com/Esri/other/blob/main/README.md')).toBe(false);
    expect(owns({}, `https://github.com/${REPO}/pull/3`)).toBe(false);
    expect(owns({}, 'https://developers.arcgis.com/widgets/')).toBe(false);
  });

  it('leaves excluded paths, and for a wiki source non-Markdown files, to another source', () => {
    expect(owns({ exclude: ['json/**'] }, blob('json/list.json'))).toBe(false);
    expect(owns({ exclude: ['json/**'] }, blob('docs/list.json'))).toBe(true);
    expect(owns({ preset: 'wiki' }, blob('References/Api.XML', 'master'))).toBe(false);
    expect(owns({ preset: 'wiki' }, blob('README.md', 'master'))).toBe(true);
  });
});
