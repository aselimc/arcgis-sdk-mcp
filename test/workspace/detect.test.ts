import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/core/config.js';
import type { Product } from '../../src/core/types.js';
import { deadPackageWarning, DEAD_PACKAGES } from '../../src/workspace/dead-packages.js';
import { detectWorkspace, scanWorkspace } from '../../src/workspace/index.js';
import { buildPackageIndex } from '../../src/workspace/match.js';
import { WORKSPACE_PRODUCTS, useProjects } from './project.js';
import { makeConfig, makeProduct } from '../support/builders.js';
import { FakeLogger } from '../support/fake-logger.js';
import { fakeRegistry } from '../support/fake-registry.js';

const project = useProjects();

function deps(
  projectDir: string,
  config: Partial<Config> = {},
  products: Product[] = WORKSPACE_PRODUCTS,
) {
  return {
    config: makeConfig({ projectDir, ...config }),
    registry: fakeRegistry({ products }),
    logger: new FakeLogger(),
  };
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

describe('detectWorkspace: one project per ecosystem', () => {
  it('detects a JavaScript project and puts the primary package first', async () => {
    const root = project({
      'package.json': json({
        dependencies: { '@arcgis/map-components': '^5.1.0', '@arcgis/core': '^5.1.4', react: '19' },
        devDependencies: { '@esri/calcite-components': '5.1.2' },
      }),
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      {
        product: 'calcite',
        package: '@esri/calcite-components',
        version: '5.1.2',
        file: 'package.json',
      },
      { product: 'js-maps-sdk', package: '@arcgis/core', version: '5.1.4', file: 'package.json' },
      {
        product: 'js-maps-sdk',
        package: '@arcgis/map-components',
        version: '5.1.0',
        file: 'package.json',
      },
    ]);
  });

  it('detects Python projects from requirements, pyproject and conda files', async () => {
    const root = project({
      'requirements.txt': 'arcgis>=2.4\npandas\n',
      'services/etl/pyproject.toml': '[project]\ndependencies = ["arcgis==2.4.3"]\n',
      'environment.yml': 'dependencies:\n  - arcpy\n  - python=3.13\n',
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      // The package has no registry entry: it is found as a product id.
      { product: 'arcpy', package: 'arcpy', version: '', file: 'environment.yml' },
      // The exact pin two levels down beats the range in the root.
      {
        product: 'python-api',
        package: 'arcgis',
        version: '2.4.3',
        file: 'services/etl/pyproject.toml',
      },
    ]);
  });

  it('detects a .NET project and takes the version from central package management', async () => {
    const root = project({
      'src/App/App.csproj':
        '<Project><ItemGroup><PackageReference Include="esri.arcgisruntime" /></ItemGroup></Project>',
      'Directory.Packages.props':
        '<Project><ItemGroup><PackageVersion Include="Esri.ArcGISRuntime" Version="300.1.0" /></ItemGroup></Project>',
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      {
        product: 'dotnet-maps-sdk',
        package: 'Esri.ArcGISRuntime',
        version: '300.1.0',
        file: 'Directory.Packages.props',
      },
    ]);
  });

  it('detects a Flutter project and prefers the lock file', async () => {
    const root = project({
      'pubspec.yaml': 'dependencies:\n  arcgis_maps: ^300.0.0\n',
      'pubspec.lock': 'packages:\n  arcgis_maps:\n    version: "300.1.0+5042"\n',
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      {
        product: 'flutter-maps-sdk',
        package: 'arcgis_maps',
        version: '300.1.0',
        file: 'pubspec.lock',
      },
    ]);
  });

  it('detects an Android project from Gradle scripts and the version catalog', async () => {
    const withScript = project({
      'app/build.gradle.kts':
        'dependencies { implementation("com.esri:arcgis-maps-kotlin:300.1.0") }\n',
    });
    expect(await detectWorkspace(deps(withScript))).toEqual([
      {
        product: 'kotlin-maps-sdk',
        package: 'com.esri:arcgis-maps-kotlin',
        version: '300.1.0',
        file: 'app/build.gradle.kts',
      },
    ]);

    const withCatalog = project({
      'gradle/libs.versions.toml':
        '[versions]\narcgis = "200.8.0"\n[libraries]\nmaps = { module = "com.esri:arcgis-maps-kotlin", version.ref = "arcgis" }\n',
      'app/build.gradle': 'dependencies { implementation libs.maps }\n',
    });
    expect((await detectWorkspace(deps(withCatalog)))[0]).toMatchObject({
      version: '200.8.0',
      file: 'gradle/libs.versions.toml',
    });
  });

  it('detects a Swift project from Package.resolved inside the Xcode bundle', async () => {
    const root = project({
      'Field.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved': json({
        pins: [
          {
            identity: 'arcgis-maps-sdk-swift',
            location: 'https://github.com/Esri/arcgis-maps-sdk-swift',
            state: { version: '300.1.0' },
          },
        ],
        version: 3,
      }),
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      {
        product: 'swift-maps-sdk',
        package: 'arcgis-maps-sdk-swift',
        version: '300.1.0',
        file: 'Field.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
      },
    ]);
  });

  it('detects products through the signals the registry declares', async () => {
    const root = project({
      'Packages/manifest.json': json({
        dependencies: { 'com.esri.arcgis-maps-sdk': '2.4.0', 'com.unity.ugui': '2.0.0' },
      }),
      'Game/Game.uproject': json({ Plugins: [{ Name: 'ArcGISMapsSDK', Enabled: true }] }),
    });
    expect(await detectWorkspace(deps(root))).toEqual([
      {
        product: 'unity-maps-sdk',
        package: 'unity-maps-sdk',
        version: '2.4.0',
        file: 'Packages/manifest.json',
      },
      // The project file names the plugin but states no version.
      {
        product: 'unreal-maps-sdk',
        package: 'unreal-maps-sdk',
        version: '',
        file: 'Game/Game.uproject',
      },
    ]);
  });
});

describe('detectWorkspace: when it does not look', () => {
  const files = { 'package.json': json({ dependencies: { '@arcgis/core': '5.1.0' } }) };

  it('reads nothing in HTTP mode or with the workspace capability off', async () => {
    const root = project(files);
    expect(await detectWorkspace(deps(root, { mode: 'http' }))).toEqual([]);
    expect(
      await detectWorkspace(deps(root, { capabilities: new Set(['website'] as const) })),
    ).toEqual([]);
    expect(await detectWorkspace(deps(root))).toHaveLength(1);
  });

  it('answers with nothing for a missing directory or a project without Esri SDKs', async () => {
    const root = project({ 'package.json': json({ dependencies: { react: '19.0.0' } }) });
    expect(await detectWorkspace(deps(root))).toEqual([]);
    expect(await detectWorkspace(deps(`${root}/does-not-exist`))).toEqual([]);
  });

  it('skips dependency, build and hidden directories and anything deeper than two levels', async () => {
    const root = project({
      'node_modules/@arcgis/core/package.json': json({ dependencies: { '@arcgis/core': '4.0.0' } }),
      'dist/package.json': files['package.json'],
      '.cache/package.json': files['package.json'],
      'a/b/c/package.json': files['package.json'],
    });
    expect(await detectWorkspace(deps(root))).toEqual([]);
    const reachable = project({ 'a/b/package.json': files['package.json'] });
    expect(await detectWorkspace(deps(reachable))).toHaveLength(1);
  });

  it('survives malformed manifests and a registry pattern that does not compile', async () => {
    const root = project({
      'package.json': '{ "dependencies": { "@arcgis/core": ',
      'requirements.txt': 'arcgis==2.4.3\n',
    });
    const broken = makeProduct({
      id: 'broken',
      workspaceSignals: [{ files: ['requirements.txt'], pattern: '([unclosed' }],
    });
    const found = await detectWorkspace(deps(root, {}, [...WORKSPACE_PRODUCTS, broken]));
    expect(found).toEqual([
      { product: 'python-api', package: 'arcgis', version: '2.4.3', file: 'requirements.txt' },
    ]);
  });
});

describe('scanWorkspace: limits', () => {
  it('stops at the file limit and says so', async () => {
    const root = project({
      'a/requirements.txt': 'arcgis==2.4.1\n',
      'b/requirements.txt': 'arcgis==2.4.2\n',
      'c/requirements.txt': 'arcgis==2.4.3\n',
    });
    const environment = deps(root);
    const scan = await scanWorkspace(environment, {
      maxFiles: 2,
      maxBytes: 1024,
      maxDepth: 2,
      maxEntries: 100,
    });
    expect(scan.truncated).toBe(true);
    expect(scan.sdks).toHaveLength(1);
    expect(environment.logger.messages('warn')).toContain('workspace scan stopped at a limit');
  });

  it('does not read files above the size limit', async () => {
    const root = project({ 'requirements.txt': `arcgis==2.4.3\n${'# padding\n'.repeat(200)}` });
    const limits = { maxFiles: 10, maxBytes: 100, maxDepth: 2, maxEntries: 100 };
    expect((await scanWorkspace(deps(root), limits)).sdks).toEqual([]);
  });

  it('stops looking at directory entries at the entry limit', async () => {
    const root = project({ 'a.txt': '', 'b.txt': '', 'requirements.txt': 'arcgis==2.4.3\n' });
    const limits = { maxFiles: 10, maxBytes: 1024, maxDepth: 2, maxEntries: 2 };
    expect(await scanWorkspace(deps(root), limits)).toMatchObject({ sdks: [], truncated: true });
  });
});

describe('dead packages', () => {
  it('lists the five retired packages of the design', () => {
    expect(DEAD_PACKAGES.map((entry) => entry.name).sort()).toEqual([
      '@arcgis/ai-agents',
      '@arcgis/ai-orchestrator',
      '@arcgis/cli',
      'arcgis-js-api',
      'esri-loader',
    ]);
  });

  it('warns about each one with its replacement', async () => {
    const root = project({
      'package.json': json({
        dependencies: {
          'esri-loader': '^3.7.0',
          '@arcgis/ai-agents': '5.0.19',
          '@arcgis/core': '5.1.0',
        },
        devDependencies: { '@arcgis/cli': '*' },
      }),
    });
    const environment = deps(root);
    const scan = await scanWorkspace(environment);
    expect(scan.dead.map(deadPackageWarning)).toEqual([
      'package.json depends on esri-loader@3.7.0, which is the archived loader for the AMD build of the JavaScript SDK. Install @arcgis/core and import ES modules, or load the components from @arcgis/map-components.',
      'package.json depends on @arcgis/ai-agents@5.0.19, which was an internal dependency of @arcgis/ai-components 5.0 and was removed at 5.1. Use the components of @arcgis/ai-components.',
      'package.json depends on @arcgis/cli, which has not been published since 4.25. Start from the templates in https://github.com/Esri/jsapi-resources with a standard bundler.',
    ]);
    // A loader or tool version says nothing about the SDK version in use.
    expect(scan.sdks).toEqual([
      { product: 'js-maps-sdk', package: '@arcgis/core', version: '5.1.0', file: 'package.json' },
    ]);
    expect(environment.logger.messages('warn')).toHaveLength(3);
  });

  it('takes the SDK version from the legacy AMD package, behind the current package', async () => {
    const legacy = project({
      'package.json': json({ dependencies: { 'arcgis-js-api': '4.28.10' } }),
    });
    const scan = await scanWorkspace(deps(legacy));
    expect(scan.sdks).toEqual([
      {
        product: 'js-maps-sdk',
        package: 'arcgis-js-api',
        version: '4.28.10',
        file: 'package.json',
      },
    ]);
    expect(scan.dead).toHaveLength(1);

    const both = project({
      'package.json': json({
        dependencies: { 'arcgis-js-api': '4.28.10', '@arcgis/core': '5.1.0' },
      }),
    });
    expect((await detectWorkspace(deps(both))).map((sdk) => sdk.package)).toEqual([
      '@arcgis/core',
      'arcgis-js-api',
    ]);
  });
});

describe('package lookup', () => {
  const index = buildPackageIndex(fakeRegistry({ products: WORKSPACE_PRODUCTS }));
  const find = (ecosystem: 'npm' | 'pypi' | 'maven' | 'nuget', name: string) =>
    index.find({ ecosystem, name, version: '', exact: false })?.product.id;

  it('matches names the way each registry compares them', () => {
    expect(find('nuget', 'ESRI.ArcGISRuntime')).toBe('dotnet-maps-sdk');
    expect(find('pypi', 'ArcGIS_Mapping')).toBe('python-api');
    expect(find('maven', 'arcgis-maps-kotlin')).toBe('kotlin-maps-sdk');
    expect(find('maven', 'org.other:arcgis-maps-kotlin')).toBe('kotlin-maps-sdk');
  });

  it('keeps ecosystems apart and guesses nothing', () => {
    // An npm package that happens to be called like the Python package is not the Python API.
    expect(find('npm', 'arcgis')).toBeUndefined();
    expect(find('npm', 'react')).toBeUndefined();
    expect(find('pypi', 'arcgis-unknown-extension')).toBeUndefined();
  });

  it('accepts an alias only where the product could publish under it', () => {
    const python = makeProduct({
      id: 'python-api',
      aliases: ['arcgis', 'arcgis-learn'],
      packages: [{ registry: 'pypi', name: 'arcgis', license: 'apache-2.0' }],
    });
    const pro = makeProduct({ id: 'arcpy', aliases: ['arcgispro'], packages: [] });
    const aliases = buildPackageIndex(fakeRegistry({ products: [python, pro] }));
    const lookup = (ecosystem: 'npm' | 'pypi', name: string) =>
      aliases.find({ ecosystem, name, version: '', exact: false })?.product.id;
    expect(lookup('pypi', 'arcgis-learn')).toBe('python-api');
    expect(lookup('npm', 'arcgis-learn')).toBeUndefined();
    expect(lookup('npm', 'arcgis')).toBeUndefined();
    expect(lookup('pypi', 'arcgispro')).toBe('arcpy');
  });
});
