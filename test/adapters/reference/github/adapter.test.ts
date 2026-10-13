import { describe, expect, it } from 'vitest';
import { githubRepoAdapter } from '../../../../src/adapters/reference/github/adapter.js';
import { githubAdapters } from '../../../../src/adapters/reference/github/index.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { describeAdapterContract } from '../../../support/adapter-contract.js';
import type { FakeRepo } from '../../../support/fake-github.js';
import {
  bound,
  githubCtx,
  githubProduct,
  repoFiles,
  wikiPages,
  type GithubConfig,
} from './support.js';

const SWIFT = 'Esri/widget-samples-swift';
const SWIFT_SAMPLE = 'Shared/Samples/Show device location';
const swiftFiles = repoFiles('samples-swift');
const release = { tag: 'v300.1.0', publishedAt: '2026-08-20T00:00:00Z' };

const blob = (repo: string, ref: string, path: string) =>
  `https://github.com/${repo}/blob/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** One contract case per preset, each over its synthetic repository. */
const PRESET_CASES: Array<{
  name: string;
  config: GithubConfig;
  repo: FakeRepo;
  minRecords: number;
  readRef: string;
}> = [
  {
    name: 'samples-metadata, pinned to the release tag',
    config: {
      repo: SWIFT,
      preset: 'samples-metadata',
      pin: 'release-tag',
      include: ['Shared/Samples/**'],
    },
    repo: { release, files: { 'v300.1.0': swiftFiles, main: swiftFiles } },
    minRecords: 2,
    readRef: blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`),
  },
  {
    name: 'samples-metadata, per-platform tree on a branch',
    config: { repo: 'Esri/widget-samples-dotnet', preset: 'samples-metadata', pin: 'branch' },
    repo: { files: { '*': repoFiles('samples-dotnet') } },
    minRecords: 2,
    readRef: blob(
      'Esri/widget-samples-dotnet',
      'main',
      'src/WPF/WPF.Viewer/Samples/Layers/AddTileLayer/readme.md',
    ),
  },
  {
    name: 'samples-readme',
    config: { repo: 'Esri/desktop-sdk-samples', preset: 'samples-readme' },
    repo: { defaultBranch: 'master', files: { '*': repoFiles('samples-pro') } },
    minRecords: 2,
    readRef: blob('Esri/desktop-sdk-samples', 'master', 'Map-Exploration/IdentifyTool/ReadMe.md'),
  },
  {
    name: 'snippets-region',
    config: { repo: 'Esri/desktop-sdk-snippets', preset: 'snippets-region' },
    repo: { files: { '*': repoFiles('snippets') } },
    minRecords: 4,
    readRef: blob(
      'Esri/desktop-sdk-snippets',
      'main',
      'SDKExamples/Content/ProSnippet/ProSnippets Content.cs',
    ),
  },
  {
    name: 'notebooks',
    config: { repo: 'Esri/widget-notebooks', preset: 'notebooks' },
    repo: { defaultBranch: 'master', files: { '*': repoFiles('notebooks') } },
    minRecords: 2,
    readRef: blob('Esri/widget-notebooks', 'master', 'samples/clean_address_data.ipynb'),
  },
  {
    name: 'markdown-docs with heading symbols',
    config: { repo: 'Esri/symbol-spec', preset: 'markdown-docs', symbolsFromHeadings: 2 },
    repo: { files: { '*': repoFiles('docs') } },
    minRecords: 6,
    readRef: blob('Esri/symbol-spec', 'main', 'docs/v3/Symbols.md'),
  },
  {
    name: 'wiki',
    config: { repo: 'Esri/desktop-sdk', preset: 'wiki' },
    repo: { defaultBranch: 'master', wiki: wikiPages() },
    minRecords: 8,
    readRef: 'https://github.com/Esri/desktop-sdk/wiki/Release-notes',
  },
];

for (const preset of PRESET_CASES) {
  describeAdapterContract(`github-repo (${preset.name})`, () => {
    const { product, source } = githubProduct(preset.config);
    return {
      adapter: githubRepoAdapter,
      product,
      source,
      ctx: () => githubCtx({ [preset.config.repo]: preset.repo }),
      allowedHosts: ['github.com'],
      minRecords: preset.minRecords,
      readRef: preset.readRef,
    };
  });
}

describe('githubAdapters', () => {
  it('returns the github-repo adapter', () => {
    expect(githubAdapters()).toEqual([githubRepoAdapter]);
    expect(githubRepoAdapter.type).toBe('github-repo');
  });
});

describe('samples-metadata: reading a sample', () => {
  const config: GithubConfig = {
    repo: SWIFT,
    preset: 'samples-metadata',
    pin: 'release-tag',
    tagTemplate: 'v{version}',
    include: ['Shared/Samples/**'],
  };
  const setup = (repo: FakeRepo, version?: string, maxRequests?: number) => {
    const { product, source } = githubProduct(config);
    const ctx = githubCtx({ [SWIFT]: repo });
    const options = {
      ...(version === undefined ? {} : { version }),
      ...(maxRequests === undefined ? {} : { maxRequests }),
    };
    return { ctx, src: bound(ctx, product, source, options) };
  };
  const tagged: FakeRepo = { release, files: { 'v300.1.0': swiftFiles, main: swiftFiles } };

  it('enumerates samples at the release tag from the tree alone', async () => {
    const { ctx, src } = setup(tagged);
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.ref)).toEqual([
      blob(SWIFT, 'v300.1.0', 'Shared/Samples/Add tile layer/README.md'),
      blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`),
    ]);
    expect(records[1]).toMatchObject({
      title: 'Show device location',
      kind: 'sample',
      language: 'swift',
      license: 'apache-2.0',
      locator: {
        path: SWIFT_SAMPLE,
        readme: `${SWIFT_SAMPLE}/README.md`,
        metadata: `${SWIFT_SAMPLE}/README.metadata.json`,
      },
    });
    expect(ctx.github.calls.map((call) => call.method)).toEqual([
      'repoMeta',
      'latestRelease',
      'tree',
    ]);
  });

  it('renders README, metadata and the snippet files the metadata lists', async () => {
    const { ctx, src } = setup(tagged);
    const url = blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`);
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(url) });

    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('source');
    const input = call?.input as RendererInputs['source'];
    expect(input.readme).toContain('# Show device location');
    expect(input.metadata).toMatchObject({
      title: 'Show device location',
      relevant_apis: ['LocationTracker', 'WidgetMapView'],
    });
    expect(input.files).toEqual([
      {
        name: 'ShowDeviceLocationView.swift',
        text: swiftFiles[`${SWIFT_SAMPLE}/ShowDeviceLocationView.swift`],
        ref: blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/ShowDeviceLocationView.swift`),
      },
      expect.objectContaining({ name: 'ShowDeviceLocationView.Model.swift' }),
    ]);
    expect(call?.meta).toMatchObject({
      url,
      kind: 'sample',
      version: '300.1.0',
      license: 'apache-2.0',
    });
    expect(page).toMatchObject({ ref: url, version: '300.1.0', notices: [] });
    // The metadata names the files, so the tree (an API call) is not needed to read a sample.
    expect(ctx.github.count('tree')).toBe(0);
  });

  it('reads the same sample from its metadata file, its directory and its raw URL', async () => {
    const urls = [
      blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.metadata.json`),
      `https://github.com/${SWIFT}/tree/v300.1.0/Shared/Samples/Show%20device%20location`,
      `https://raw.githubusercontent.com/${SWIFT}/v300.1.0/Shared/Samples/Show%20device%20location/README.md`,
    ];
    for (const url of urls) {
      const { ctx, src } = setup(tagged);
      await githubRepoAdapter.read(ctx, src, { url: new URL(url) });
      const input = ctx.render.calls.at(-1)?.input as RendererInputs['source'];
      expect(input.files, url).toHaveLength(2);
      expect(input.metadata, url).toBeDefined();
      // Whichever file was named, the README is fetched when it exists.
      expect(input.readme, url).toContain('# Show device location');
    }
  });

  it('reads the version the caller asks for, whatever ref the record carries', async () => {
    const older = {
      ...swiftFiles,
      [`${SWIFT_SAMPLE}/README.md`]: '# Show device location (200.8)',
    };
    const { ctx, src } = setup(
      { release, files: { 'v300.1.0': swiftFiles, 'v200.8.0': older } },
      '200.8',
    );
    const record = ((await githubRepoAdapter.enumerate?.(ctx, src)) ?? []).find(
      (candidate) => candidate.title === 'Show device location',
    );
    expect(record?.ref).toBe(blob(SWIFT, 'v200.8.0', `${SWIFT_SAMPLE}/README.md`));

    const fromLatest = blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`);
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(fromLatest) });
    expect((ctx.render.calls.at(-1)?.input as RendererInputs['source']).readme).toBe(
      '# Show device location (200.8)',
    );
    expect(page).toMatchObject({
      ref: blob(SWIFT, 'v200.8.0', `${SWIFT_SAMPLE}/README.md`),
      version: '200.8.0',
    });
  });

  it('falls back to the branch when the release tag does not exist', async () => {
    const { ctx, src } = setup({ release, files: { main: swiftFiles } });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records[0]?.ref).toContain('/blob/main/');
    expect(
      ctx.github.calls.filter((call) => call.method === 'tree').map((call) => call.ref),
    ).toEqual(['v300.1.0', 'main']);

    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`)),
    });
    expect(page.ref).toBe(blob(SWIFT, 'main', `${SWIFT_SAMPLE}/README.md`));
    expect(page.version).toBeUndefined();
    expect(page.notices).toEqual([
      `Tag v300.1.0 was not found in ${SWIFT}; showing branch main instead.`,
    ]);
    // Every file of the sample comes from the branch the README was found on.
    const refs = ctx.github.calls.filter((call) => call.method === 'raw').map((call) => call.ref);
    expect(refs.slice(2).every((ref) => ref === 'main')).toBe(true);
  });

  it('returns the README alone when metadata is missing or unreadable', async () => {
    const { [`${SWIFT_SAMPLE}/README.metadata.json`]: _dropped, ...withoutMetadata } = swiftFiles;
    for (const files of [
      withoutMetadata,
      { ...swiftFiles, [`${SWIFT_SAMPLE}/README.metadata.json`]: '[1, 2' },
      { ...swiftFiles, [`${SWIFT_SAMPLE}/README.metadata.json`]: '["not", "an", "object"]' },
    ]) {
      const { ctx, src } = setup({ release, files: { '*': files } });
      await githubRepoAdapter.read(ctx, src, {
        url: new URL(blob(SWIFT, 'main', `${SWIFT_SAMPLE}/README.md`)),
      });
      const input = ctx.render.calls.at(-1)?.input as RendererInputs['source'];
      expect(input.metadata).toBeUndefined();
      expect(input.readme).toContain('# Show device location');
      // Without a snippet list the directory's own source files are taken from the tree.
      expect(input.files.map((file) => file.name)).toEqual([
        'ShowDeviceLocationView.Model.swift',
        'ShowDeviceLocationView.swift',
      ]);
    }
  });

  it('reads a sample that has only a metadata file', async () => {
    const { [`${SWIFT_SAMPLE}/README.md`]: _dropped, ...withoutReadme } = swiftFiles;
    const { ctx, src } = setup({ release, files: { '*': withoutReadme } });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    const record = records.find((candidate) => candidate.title === 'Show device location');
    expect(record?.ref).toBe(blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.metadata.json`));

    const viaReadme = await githubRepoAdapter.read(ctx, src, {
      url: new URL(blob(SWIFT, 'main', `${SWIFT_SAMPLE}/README.md`)),
    });
    const input = ctx.render.calls.at(-1)?.input as RendererInputs['source'];
    expect(input.readme).toBeUndefined();
    expect(input.metadata).toMatchObject({ category: 'Location' });
    expect(viaReadme.ref).toBe(blob(SWIFT, 'main', `${SWIFT_SAMPLE}/README.metadata.json`));
  });

  it('links the files it could not fetch instead of failing', async () => {
    const { [`${SWIFT_SAMPLE}/ShowDeviceLocationView.Model.swift`]: _dropped, ...partial } =
      swiftFiles;
    const { ctx, src } = setup({ release, files: { '*': partial } });
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(blob(SWIFT, 'main', `${SWIFT_SAMPLE}/README.md`)),
    });
    expect((ctx.render.calls.at(-1)?.input as RendererInputs['source']).files).toHaveLength(1);
    expect(page.notices).toEqual([
      `1 more source file(s) are at https://github.com/${SWIFT}/tree/main/Shared/Samples/Show%20device%20location.`,
    ]);
  });

  it('spends no more than the request budget on source files', async () => {
    // Repository metadata, README and metadata file leave one request for the two snippets.
    const { ctx, src } = setup(tagged, undefined, 4);
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(blob(SWIFT, 'v300.1.0', `${SWIFT_SAMPLE}/README.md`)),
    });
    expect((ctx.render.calls.at(-1)?.input as RendererInputs['source']).files).toHaveLength(1);
    expect(page.notices[0]).toMatch(/^1 more source file/);
    expect(src.budget?.used).toBe(4);
  });

  it('opens a sample through its record', async () => {
    const { ctx, src } = setup(tagged);
    const [record] = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    if (record === undefined) throw new Error('no sample record');
    const page = await githubRepoAdapter.sample?.(ctx, src, record);
    expect(page?.ref).toBe(record.ref);
    expect(ctx.render.calls.at(-1)?.opts).toBeUndefined();
  });

  it('treats the README of the repository as a document, not as a sample', async () => {
    const { ctx, src } = setup(tagged);
    await githubRepoAdapter.read(ctx, src, { url: new URL(blob(SWIFT, 'main', 'README.md')) });
    expect(ctx.render.calls.at(-1)?.kind).toBe('markdown');
  });
});
