import { describe, expect, it } from 'vitest';
import { githubRepoAdapter } from '../../../../src/adapters/reference/github/adapter.js';
import {
  codeTwin,
  mainFiles,
  sampleDirs,
  sampleOfDir,
  sampleOfFile,
  sampleOfRecord,
} from '../../../../src/adapters/reference/github/samples-metadata.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { makeRecord } from '../../../support/builders.js';
import { bound, githubCtx, githubProduct, repoFiles, type GithubConfig } from './support.js';

const tree = (...paths: string[]) => paths.map((path) => ({ path, size: 100 }));
const metadataConfig = (repo: string, extra: Partial<GithubConfig> = {}): GithubConfig => ({
  repo,
  preset: 'samples-metadata',
  ...extra,
});

/** The directory layouts of the sample repository families, each with two invented samples. */
const FAMILIES: Array<{
  family: string;
  paths: string[];
  dirs: string[];
  titles: string[];
  breadcrumbs: Array<string | undefined>;
  platforms?: Array<string | undefined>;
}> = [
  {
    family: 'Swift: Shared/Samples/<Title With Spaces>/',
    paths: [
      'README.md',
      'Shared/Samples/Add tile layer/README.md',
      'Shared/Samples/Add tile layer/README.metadata.json',
      'Shared/Samples/Add tile layer/AddTileLayerView.swift',
      'Shared/Samples/Show 3D scene/README.md',
      'Shared/Samples/Show 3D scene/README.metadata.json',
      'Shared/Supporting Files/README.md',
    ],
    dirs: ['Shared/Samples/Add tile layer', 'Shared/Samples/Show 3D scene'],
    titles: ['Add tile layer', 'Show 3D scene'],
    breadcrumbs: [undefined, undefined],
  },
  {
    family: 'Kotlin: samples/<kebab>/',
    paths: [
      'samples/add-tile-layer/README.md',
      'samples/add-tile-layer/README.metadata.json',
      'samples/add-tile-layer/src/main/java/com/example/MainActivity.kt',
      'samples/show-3d-scene/README.md',
      'samples/show-3d-scene/README.metadata.json',
    ],
    dirs: ['samples/add-tile-layer', 'samples/show-3d-scene'],
    titles: ['Add tile layer', 'Show 3d scene'],
    breadcrumbs: [undefined, undefined],
  },
  {
    family: '.NET: src/<Platform>/.../Samples/<Category>/<Pascal>/ with lower-case names',
    paths: [
      'src/MAUI/Maui.Samples/Samples/Layers/AddTileLayer/readme.md',
      'src/MAUI/Maui.Samples/Samples/Layers/AddTileLayer/readme.metadata.json',
      'src/WPF/WPF.Viewer/Samples/Layers/AddTileLayer/readme.md',
      'src/WPF/WPF.Viewer/Samples/Layers/AddTileLayer/readme.metadata.json',
      'src/WinUI/ArcGIS.WinUI.Viewer/Samples/Scene/DisplayKMLNetworkLinks/readme.md',
      'src/WinUI/ArcGIS.WinUI.Viewer/Samples/Scene/DisplayKMLNetworkLinks/readme.metadata.json',
    ],
    dirs: [
      'src/MAUI/Maui.Samples/Samples/Layers/AddTileLayer',
      'src/WPF/WPF.Viewer/Samples/Layers/AddTileLayer',
      'src/WinUI/ArcGIS.WinUI.Viewer/Samples/Scene/DisplayKMLNetworkLinks',
    ],
    titles: ['Add tile layer', 'Add tile layer', 'Display KML network links'],
    breadcrumbs: ['Layers', 'Layers', 'Scene'],
    platforms: ['maui', 'wpf', 'winui'],
  },
  {
    family: 'Qt: CppSamples/<Category>/<Pascal>/',
    paths: [
      'CppSamples/Analysis/LineOfSight/README.md',
      'CppSamples/Analysis/LineOfSight/README.metadata.json',
      'CppSamples/Maps/OpenMap/README.md',
      'CppSamples/Maps/OpenMap/README.metadata.json',
    ],
    dirs: ['CppSamples/Analysis/LineOfSight', 'CppSamples/Maps/OpenMap'],
    titles: ['Line of sight', 'Open map'],
    breadcrumbs: ['Analysis', 'Maps'],
  },
  {
    family: 'Flutter: lib/samples/<snake>/',
    paths: [
      'lib/samples/add_tile_layer/README.md',
      'lib/samples/add_tile_layer/README.metadata.json',
      'lib/samples/open_map/README.md',
      'lib/samples/open_map/README.metadata.json',
    ],
    dirs: ['lib/samples/add_tile_layer', 'lib/samples/open_map'],
    titles: ['Add tile layer', 'Open map'],
    breadcrumbs: [undefined, undefined],
  },
  {
    family: 'Java: <category>/<kebab>/',
    paths: [
      'analysis/line-of-sight/README.md',
      'analysis/line-of-sight/README.metadata.json',
      'map/open-map/README.md',
      'map/open-map/README.metadata.json',
    ],
    dirs: ['analysis/line-of-sight', 'map/open-map'],
    titles: ['Line of sight', 'Open map'],
    breadcrumbs: ['Analysis', 'Map'],
  },
  {
    family: 'Unity and Unreal Engine: few metadata files, README-only siblings',
    paths: [
      'README.md',
      'docs/README.md',
      'sample_project/Assets/SampleViewer/Samples/Routing/readme.md',
      'sample_project/Assets/SampleViewer/Samples/Routing/readme.metadata.json',
      'sample_project/Assets/SampleViewer/Samples/Geocoding/readme.md',
      'sample_project/Assets/SampleViewer/Samples/Geocoding/Geocoder.cs',
    ],
    dirs: [
      'sample_project/Assets/SampleViewer/Samples/Geocoding',
      'sample_project/Assets/SampleViewer/Samples/Routing',
    ],
    titles: ['Geocoding', 'Routing'],
    breadcrumbs: [undefined, undefined],
  },
];

describe('sample directories per repository family (samples-metadata)', () => {
  it.each(FAMILIES)('$family', async ({ paths, dirs, titles, breadcrumbs, platforms }) => {
    const repo = 'Esri/family-samples';
    expect(sampleDirs(tree(...paths), metadataConfig(repo)).map((sample) => sample.dir)).toEqual(
      dirs,
    );

    const { product, source } = githubProduct(metadataConfig(repo, { pin: 'branch' }));
    const files = Object.fromEntries(paths.map((path) => [path, 'x']));
    const ctx = githubCtx({ [repo]: { files: { '*': files } } });
    const records = await githubRepoAdapter.enumerate?.(ctx, bound(ctx, product, source));
    expect(records?.map((record) => record.title)).toEqual(titles);
    expect(records?.map((record) => record.breadcrumb)).toEqual(breadcrumbs);
    expect(records?.map((record) => record.platform)).toEqual(
      platforms ?? dirs.map(() => undefined),
    );
    expect(records?.every((record) => record.kind === 'sample')).toBe(true);
  });

  it('applies include and exclude globs of the registry', () => {
    const paths = tree(
      'Shared/Samples/A/README.md',
      'Shared/Samples/A/README.metadata.json',
      'Old/Samples/B/README.md',
      'Old/Samples/B/README.metadata.json',
      'Shared/Samples/Hidden/README.metadata.json',
    );
    const config = metadataConfig('Esri/x', {
      include: ['Shared/Samples/**'],
      exclude: ['**/Hidden/**'],
    });
    expect(sampleDirs(paths, config)).toEqual([
      {
        dir: 'Shared/Samples/A',
        readme: 'Shared/Samples/A/README.md',
        metadata: 'Shared/Samples/A/README.metadata.json',
      },
    ]);
  });
});

describe('samples-readme', () => {
  const config: GithubConfig = { repo: 'Esri/pro-samples', preset: 'samples-readme' };

  it('takes the innermost README directories that contain code', () => {
    const paths = tree(
      'README.md',
      'Framework/README.md',
      'Framework/SimpleDockpane/ReadMe.md',
      'Framework/SimpleDockpane/Module1.cs',
      'Map-Exploration/IdentifyTool/ReadMe.md',
      'Map-Exploration/IdentifyTool/IdentifyTool.cs',
      'Documentation/Guides/README.md',
      'Documentation/Guides/intro.md',
    );
    expect(sampleDirs(paths, config)).toEqual([
      { dir: 'Framework/SimpleDockpane', readme: 'Framework/SimpleDockpane/ReadMe.md' },
      { dir: 'Map-Exploration/IdentifyTool', readme: 'Map-Exploration/IdentifyTool/ReadMe.md' },
    ]);
  });

  it('enumerates the fixture repository with area breadcrumbs and directory keywords', async () => {
    const { product, source } = githubProduct(config, {}, { languages: ['csharp'] });
    const ctx = githubCtx({
      'Esri/pro-samples': { defaultBranch: 'master', files: { '*': repoFiles('samples-pro') } },
    });
    const records = await githubRepoAdapter.enumerate?.(ctx, bound(ctx, product, source));
    expect(records).toEqual([
      expect.objectContaining({
        ref: 'https://github.com/Esri/pro-samples/blob/master/Framework/SimpleDockpane/ReadMe.md',
        title: 'Simple dockpane',
        breadcrumb: 'Framework',
        keywords: ['SimpleDockpane'],
        language: 'csharp',
        locator: {
          path: 'Framework/SimpleDockpane',
          readme: 'Framework/SimpleDockpane/ReadMe.md',
        },
      }),
      expect.objectContaining({
        title: 'Identify tool',
        breadcrumb: 'Map Exploration',
        keywords: ['IdentifyTool'],
      }),
    ]);
    // The tree is the only listing; no sample file is fetched to build the catalogue.
    expect(ctx.github.count('raw')).toBe(0);
    expect(ctx.github.count('tree')).toBe(1);
  });

  it('reads a sample as README plus its main source files, nearest and best-named first', async () => {
    const { product, source } = githubProduct(config);
    const ctx = githubCtx({
      'Esri/pro-samples': { defaultBranch: 'master', files: { '*': repoFiles('samples-pro') } },
    });
    const url =
      'https://github.com/Esri/pro-samples/blob/master/Framework/SimpleDockpane/ReadMe.md';
    const page = await githubRepoAdapter.read(ctx, bound(ctx, product, source), {
      url: new URL(url),
    });
    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('source');
    const input = call?.input as RendererInputs['source'];
    expect(input.readme).toContain('## SimpleDockpane');
    expect(input.metadata).toBeUndefined();
    expect(input.files.map((file) => file.name)).toEqual([
      'Module1.cs',
      'Views/SimpleDockpaneViewModel.cs',
    ]);
    expect(input.files[1]?.ref).toBe(
      'https://github.com/Esri/pro-samples/blob/master/Framework/SimpleDockpane/Views/SimpleDockpaneViewModel.cs',
    );
    expect(page.ref).toBe(url);
    expect(page.kind).toBe('sample');
    // No metadata file is guessed for a repository family that has none.
    expect(ctx.github.calls.some((entry) => entry.path?.endsWith('.metadata.json'))).toBe(false);
  });
});

// Regression: the Unreal Engine samples repository yielded no sample at all. A game-engine
// project keeps the README of a sample with its assets and the code under the source root.
describe('samples-readme: code kept apart from the README', () => {
  const config: GithubConfig = { repo: 'Esri/engine-samples', preset: 'samples-readme' };
  const VIEWER = 'viewer_project/Content/Viewer/Samples';
  const paths = tree(
    'README.md',
    'tools/README.md',
    'templates/readme.md',
    `${VIEWER}/Geocoding/readme.md`,
    `${VIEWER}/Geocoding/Geocoding.umap`,
    `${VIEWER}/FeatureLayer/readme.md`,
    `${VIEWER}/FeatureLayer/FeatureLayer.umap`,
    `${VIEWER}/Flythrough/readme.md`,
    `${VIEWER}/Flythrough/Blueprints/Camera.uasset`,
    `${VIEWER}/Notes/readme.md`,
    'viewer_project/Source/viewer_project/Geocoding/Geocoder.cpp',
    'viewer_project/Source/viewer_project/Geocoding/Geocoder.h',
    'viewer_project/Source/viewer_project/Feature Layer/FeatureLayerQuery.cpp',
    'viewer_project/Source/viewer_project/viewer_project.cpp',
    'xr_project/Content/Samples/Tabletop/readme.md',
    'xr_project/Content/Samples/Tabletop/Tabletop.umap',
    'xr_project/Source/xr_project/Geocoding/Geocoder.cpp',
    'xr_project/Source/xr_project/Tabletop/TabletopPawn.cpp',
  );

  it('finds the code of a sample in the directory of the same name, nearest first', () => {
    expect(codeTwin(paths, `${VIEWER}/Geocoding`)).toBe(
      'viewer_project/Source/viewer_project/Geocoding',
    );
    // Spaces and letter case do not make another name.
    expect(codeTwin(paths, `${VIEWER}/FeatureLayer`)).toBe(
      'viewer_project/Source/viewer_project/Feature Layer',
    );
    expect(codeTwin(paths, 'xr_project/Content/Samples/Tabletop')).toBe(
      'xr_project/Source/xr_project/Tabletop',
    );
    expect(codeTwin(paths, `${VIEWER}/Flythrough`)).toBeUndefined();
  });

  it('does not take a directory with a README of its own for the code of another', () => {
    const both = tree('a/Geocoding/readme.md', 'b/Geocoding/readme.md', 'b/Geocoding/Main.cpp');
    expect(codeTwin(both, 'a/Geocoding')).toBeUndefined();
  });

  it('lists such samples, and the asset-only samples next to them', () => {
    expect(sampleDirs(paths, config).map((sample) => sample.dir)).toEqual([
      `${VIEWER}/FeatureLayer`,
      // Built from assets alone, in the same set of samples.
      `${VIEWER}/Flythrough`,
      `${VIEWER}/Geocoding`,
      'xr_project/Content/Samples/Tabletop',
    ]);
  });

  it('reads the sample with the code of its twin directory, named by repository path', async () => {
    const files = Object.fromEntries(paths.map((file) => [file.path, `// ${file.path}`]));
    const { product, source } = githubProduct(config, {}, { languages: ['cpp'] });
    const ctx = githubCtx({
      'Esri/engine-samples': { defaultBranch: 'main', files: { '*': files } },
    });
    const src = bound(ctx, product, source);

    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.title)).toEqual([
      'Feature layer',
      'Flythrough',
      'Geocoding',
      'Tabletop',
    ]);
    const geocoding = records[2];
    if (geocoding === undefined) throw new Error('no record');
    const page = await githubRepoAdapter.sample?.(ctx, src, geocoding);
    const input = ctx.render.calls.at(-1)?.input as RendererInputs['source'];
    expect(input.files.map((file) => file.name)).toEqual([
      'viewer_project/Source/viewer_project/Geocoding/Geocoder.cpp',
      'viewer_project/Source/viewer_project/Geocoding/Geocoder.h',
    ]);
    expect(page?.notices).toEqual([]);
  });
});

describe('sample lookups', () => {
  it('derives the sibling file from the letter case of the given one', () => {
    const config = metadataConfig('Esri/x');
    expect(sampleOfFile('a/b/README.md', config)).toEqual({
      dir: 'a/b',
      readme: 'a/b/README.md',
      metadata: 'a/b/README.metadata.json',
    });
    expect(sampleOfFile('a/b/readme.md', config)).toEqual({
      dir: 'a/b',
      readme: 'a/b/readme.md',
      metadata: 'a/b/readme.metadata.json',
    });
    expect(sampleOfFile('a/readme.metadata.json', config)).toEqual({
      dir: 'a',
      readme: 'a/readme.md',
      metadata: 'a/readme.metadata.json',
    });
    expect(sampleOfFile('README.metadata.json', config)?.readme).toBe('README.md');
    expect(sampleOfFile('a/b/Main.swift', config)).toBeUndefined();
    expect(sampleOfFile('a/ReadMe.md', { repo: 'Esri/x', preset: 'samples-readme' })).toEqual({
      dir: 'a',
      readme: 'a/ReadMe.md',
    });
  });

  it('reads the sample of a record from its locator', () => {
    expect(sampleOfRecord(undefined)).toBeUndefined();
    expect(sampleOfRecord(makeRecord())).toBeUndefined();
    expect(sampleOfRecord(makeRecord({ locator: { path: 'a' } }))).toBeUndefined();
    expect(
      sampleOfRecord(
        makeRecord({ locator: { path: 'a', readme: 'a/R.md', metadata: 'a/m.json' } }),
      ),
    ).toEqual({ dir: 'a', readme: 'a/R.md', metadata: 'a/m.json' });
    expect(sampleOfRecord(makeRecord({ locator: { path: 'a', metadata: 'a/m.json' } }))).toEqual({
      dir: 'a',
      metadata: 'a/m.json',
    });
  });

  it('finds the sample of a directory in a tree', () => {
    const paths = tree('a/ReadMe.md', 'a/readme.metadata.json', 'a/x.cs', 'b/x.cs', 'c/README.md');
    expect(sampleOfDir(paths, 'a')).toEqual({
      dir: 'a',
      readme: 'a/ReadMe.md',
      metadata: 'a/readme.metadata.json',
    });
    expect(sampleOfDir(paths, 'b')).toBeUndefined();
    expect(sampleOfDir(paths, 'c')).toEqual({ dir: 'c', readme: 'c/README.md' });
  });

  it('skips build output, generated code and oversized files when picking main files', () => {
    const paths = [
      { path: 's/Sample/Sub/Deep.cs', size: 10 },
      { path: 's/Sample/Sample.xaml.cs', size: 10 },
      { path: 's/Sample/App.cs', size: 10 },
      { path: 's/Sample/obj/Debug/Temp.cs', size: 10 },
      { path: 's/Sample/Properties/AssemblyInfo.cs', size: 10 },
      { path: 's/Sample/Sample.g.cs', size: 10 },
      { path: 's/Sample/Data.cs', size: 900_000 },
      { path: 's/Sample/logo.png', size: 10 },
      { path: 's/Sample/NoSize.cs' },
      { path: 's/Other/Other.cs', size: 10 },
    ];
    expect(mainFiles(paths, 's/Sample')).toEqual([
      's/Sample/Sample.xaml.cs',
      's/Sample/App.cs',
      's/Sample/NoSize.cs',
      's/Sample/Sub/Deep.cs',
    ]);
    expect(mainFiles(paths, '')).toContain('s/Other/Other.cs');
  });
});
