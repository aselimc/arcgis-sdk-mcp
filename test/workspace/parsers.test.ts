import { describe, expect, it } from 'vitest';
import { cleanVersion, isExactSpec } from '../../src/workspace/dependency.js';
import {
  parseCsproj,
  parseGradle,
  parsePackageResolved,
  parsePubspec,
  parsePubspecLock,
  parseVersionCatalog,
} from '../../src/workspace/parsers-native.js';
import {
  parseCondaEnvironment,
  parsePackageJson,
  parsePackageLock,
  parsePyproject,
  parseRequirements,
} from '../../src/workspace/parsers-web-python.js';
import { MANIFEST_KINDS, manifestKindOf } from '../../src/workspace/signals.js';

const pairs = (found: Array<{ name: string; version: string }>) =>
  found.map((entry) => `${entry.name}@${entry.version}`);

describe('version specifications', () => {
  it.each([
    ['^5.1.0', '5.1.0'],
    ['~5.1', '5.1'],
    ['>=5.1.0 <6', '5.1.0'],
    ['>=2.4,<3', '2.4'],
    ['300.1.0+5042', '300.1.0'],
    ['5.2.0-next.145', '5.2.0-next.145'],
    ['2.5.0rc1', '2.5.0rc1'],
    ['2.4.*', '2.4'],
    ['[300.1.0]', '300.1.0'],
    ['npm:@arcgis/core@4.33.0', '4.33.0'],
    ['*', ''],
    ['latest', ''],
    ['workspace:*', ''],
    ['file:../core-5.1.0.tgz', ''],
    ['$(ArcGISVersion)', ''],
    ['', ''],
  ])('reads %j as %j', (spec, expected) => {
    expect(cleanVersion(spec)).toBe(expected);
  });

  it('tells a pin from a range', () => {
    expect(isExactSpec('5.1.0')).toBe(true);
    expect(isExactSpec('==2.4.3')).toBe(true);
    expect(isExactSpec('[300.1.0]')).toBe(true);
    expect(isExactSpec('^5.1.0')).toBe(false);
    expect(isExactSpec('>=2.4')).toBe(false);
    expect(isExactSpec('5.x')).toBe(false);
  });
});

describe('ranges', () => {
  it('keeps the specification of a range and drops it for a pin', () => {
    const found = parsePackageJson(
      JSON.stringify({
        dependencies: { a: '^5.0.4', b: '5.0.4', c: '>=5.1.0 <6', d: '*', e: '~5.1' },
      }),
    );
    expect(found.map((entry) => [entry.name, entry.version, entry.exact, entry.range])).toEqual([
      ['a', '5.0.4', false, '^5.0.4'],
      ['b', '5.0.4', true, undefined],
      ['c', '5.1.0', false, '>=5.1.0 <6'],
      ['d', '', false, undefined],
      ['e', '5.1', false, '~5.1'],
    ]);
  });

  it('writes a Python range with its operator', () => {
    const found = parseRequirements('arcgis>=2.4\narcgis-mapping==4.33.0\npandas\n');
    expect(found.map((entry) => [entry.name, entry.version, entry.range])).toEqual([
      ['arcgis', '2.4', '>=2.4'],
      ['arcgis-mapping', '4.33.0', undefined],
      ['pandas', '', undefined],
    ]);
  });
});

describe('package-lock.json', () => {
  it('reads the top-level installs of lock file versions 2 and 3', () => {
    const found = parsePackageLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app', dependencies: { '@arcgis/core': '^5.0.4' } },
          'node_modules/@arcgis/core': { version: '5.1.27' },
          'node_modules/react': { version: '19.0.0' },
          'node_modules/x/node_modules/@arcgis/core': { version: '4.33.0' },
          'node_modules/linked': { link: true },
        },
      }),
    );
    expect(found).toEqual([
      { ecosystem: 'npm', name: '@arcgis/core', version: '5.1.27', exact: true },
      { ecosystem: 'npm', name: 'react', version: '19.0.0', exact: true },
    ]);
  });

  it('reads the dependency map of lock file version 1', () => {
    const found = parsePackageLock(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: { '@esri/calcite-components': { version: '2.13.2' } },
      }),
    );
    expect(found).toEqual([
      { ecosystem: 'npm', name: '@esri/calcite-components', version: '2.13.2', exact: true },
    ]);
  });

  it('gives nothing for a file that is not a lock file', () => {
    expect(parsePackageLock('[1, 2]')).toEqual([]);
    expect(parsePackageLock('{"packages": []}')).toEqual([]);
    expect(parsePackageLock('not json')).toEqual([]);
  });
});

describe('manifest table', () => {
  it.each([
    ['package.json', 'package.json'],
    ['apps/web/package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['requirements-dev.txt', 'requirements.txt'],
    ['pyproject.toml', 'pyproject.toml'],
    ['env/environment.yaml', 'environment.yml'],
    ['src/App/App.csproj', 'csproj'],
    ['Directory.Packages.props', 'csproj'],
    ['pubspec.yaml', 'pubspec.yaml'],
    ['pubspec.lock', 'pubspec.lock'],
    ['app/build.gradle.kts', 'gradle'],
    ['build.gradle', 'gradle'],
    ['gradle/libs.versions.toml', 'libs.versions.toml'],
    ['App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved', 'Package.resolved'],
  ])('reads %s as %s', (path, id) => {
    expect(manifestKindOf(path)?.id).toBe(id);
  });

  it('knows no other files and never throws on garbage', () => {
    expect(manifestKindOf('README.md')).toBeUndefined();
    expect(manifestKindOf('yarn.lock')).toBeUndefined();
    for (const kind of MANIFEST_KINDS) {
      expect(kind.parse('\u0000 not { a manifest ]] <<')).toEqual([]);
      expect(kind.parse('')).toEqual([]);
    }
  });
});

describe('package.json', () => {
  it('reads all four dependency maps', () => {
    const found = parsePackageJson(
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { '@arcgis/core': '^5.1.0', react: '19.0.0' },
        devDependencies: { '@esri/calcite-components': '~5.1.2' },
        peerDependencies: { '@arcgis/map-components': 'workspace:*' },
        optionalDependencies: { 'esri-loader': '3.7.0' },
        scripts: { build: 'vite build' },
      }),
    );
    expect(pairs(found)).toEqual([
      '@arcgis/core@5.1.0',
      'react@19.0.0',
      '@esri/calcite-components@5.1.2',
      '@arcgis/map-components@',
      'esri-loader@3.7.0',
    ]);
    expect(found.every((entry) => entry.ecosystem === 'npm')).toBe(true);
    expect(found.map((entry) => entry.exact)).toEqual([false, true, false, false, true]);
  });

  it('ignores a manifest that is not an object', () => {
    expect(parsePackageJson('[]')).toEqual([]);
    expect(parsePackageJson('"text"')).toEqual([]);
    expect(parsePackageJson('{"dependencies": ["x"], "devDependencies": {"a": 1}}')).toEqual([]);
  });
});

describe('Python manifests', () => {
  it('reads requirements files and skips options, comments and URLs', () => {
    const found = parseRequirements(
      [
        '# pinned for the notebook server',
        '-r base.txt',
        '--index-url https://example.org/simple',
        'arcgis==2.4.3',
        'arcgis-mapping[notebook] >= 5.0  # maps',
        'pandas',
        'numpy~=2.3 ; python_version >= "3.11"',
        'git+https://github.com/Esri/arcgis-python-api.git',
        '',
      ].join('\r\n'),
    );
    expect(pairs(found)).toEqual(['arcgis@2.4.3', 'arcgis-mapping@5.0', 'pandas@', 'numpy@2.3']);
    expect(found[0]).toEqual({ ecosystem: 'pypi', name: 'arcgis', version: '2.4.3', exact: true });
    expect(found[1]?.exact).toBe(false);
  });

  it('reads PEP 621 arrays, optional dependencies and dependency groups of pyproject.toml', () => {
    const found = parsePyproject(
      [
        '[project]',
        'name = "arcgis-tools"',
        'version = "0.1.0"',
        'keywords = ["arcgis", "gis"]',
        'dependencies = [',
        '  "arcgis>=2.4",',
        "  'requests',",
        ']',
        '',
        '[project.optional-dependencies]',
        'maps = ["arcgis-mapping==5.0.0"]',
        '',
        '[dependency-groups]',
        'dev = ["pytest>=8"]',
        '',
        '[tool.ruff]',
        'select = ["E501"]',
      ].join('\n'),
    );
    // The project's own name and its keywords are not dependencies.
    expect(pairs(found)).toEqual(['arcgis@2.4', 'requests@', 'arcgis-mapping@5.0.0', 'pytest@8']);
  });

  it('reads Poetry tables of pyproject.toml', () => {
    const found = parsePyproject(
      [
        '[tool.poetry.dependencies]',
        'python = "^3.11"',
        'arcgis = "^2.4"',
        'arcgis-mapping = { version = "5.0.0", extras = ["x"] }',
        'local = { path = "../local" }',
        '[tool.poetry.group.dev.dependencies]',
        'pytest = "8.3.0"',
      ].join('\n'),
    );
    expect(pairs(found)).toEqual(['arcgis@2.4', 'arcgis-mapping@5.0.0', 'local@', 'pytest@8.3.0']);
  });

  it('reads conda environments including the nested pip list', () => {
    const found = parseCondaEnvironment(
      [
        'name: gis',
        'channels:',
        '  - esri',
        '  - conda-forge',
        'dependencies:',
        '  - python=3.13',
        '  - esri::arcgis=2.4.3=py313_1',
        '  - arcpy',
        '  - "numpy>=2"',
        '  - pip:',
        '      - arcgis-mapping==5.0.0',
        'prefix: /opt/conda',
      ].join('\n'),
    );
    // Channel names above the dependencies block are not packages.
    expect(pairs(found)).toEqual([
      'python@3.13',
      'arcgis@2.4.3',
      'arcpy@',
      'numpy@2',
      'arcgis-mapping@5.0.0',
    ]);
  });
});

describe('.NET project files', () => {
  it('reads PackageReference and PackageVersion items in every spelling', () => {
    const found = parseCsproj(
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <ItemGroup>',
        '    <PackageReference Include="Esri.ArcGISRuntime.WPF" Version="300.1.0" />',
        '    <PackageReference Include="Esri.ArcGISRuntime">',
        '      <Version>300.1.0</Version>',
        '    </PackageReference>',
        '    <PackageReference Include="Managed.Centrally" />',
        '    <PackageVersion Include="Esri.ArcGISRuntime.Toolkit" Version="[300.1.0]" />',
        '    <PackageReference Update="Overridden" VersionOverride="2.0.0" Version="1.0.0" />',
        '    <PackageReference Include="FromProperty" Version="$(ArcGISVersion)" />',
        '  </ItemGroup>',
        '</Project>',
      ].join('\n'),
    );
    expect(pairs(found)).toEqual([
      'Esri.ArcGISRuntime.WPF@300.1.0',
      'Esri.ArcGISRuntime@300.1.0',
      'Managed.Centrally@',
      'Esri.ArcGISRuntime.Toolkit@300.1.0',
      'Overridden@2.0.0',
      'FromProperty@',
    ]);
    expect(found[0]?.ecosystem).toBe('nuget');
  });
});

describe('Flutter manifests', () => {
  it('reads pubspec.yaml dependency maps, including nested version keys', () => {
    const found = parsePubspec(
      [
        'name: field_app',
        'version: 1.0.0+1',
        'environment:',
        "  sdk: '>=3.4.0 <4.0.0'",
        'dependencies:',
        '  flutter:',
        '    sdk: flutter',
        '  arcgis_maps: ^300.1.0 # maps',
        '  arcgis_maps_toolkit:',
        '    hosted: https://pub.dev',
        '    version: "^300.1.0"',
        'dev_dependencies:',
        '  flutter_lints: 5.0.0',
      ].join('\n'),
    );
    expect(pairs(found)).toEqual([
      'flutter@',
      'arcgis_maps@300.1.0',
      'arcgis_maps_toolkit@300.1.0',
      'flutter_lints@5.0.0',
    ]);
  });

  it('reads resolved versions from pubspec.lock', () => {
    const found = parsePubspecLock(
      [
        'packages:',
        '  arcgis_maps:',
        '    dependency: "direct main"',
        '    description:',
        '      name: arcgis_maps',
        '      url: "https://pub.dev"',
        '    source: hosted',
        '    version: "300.1.0+5042"',
        '  async:',
        '    dependency: transitive',
        '    version: "2.11.0"',
        'sdks:',
        '  dart: ">=3.4.0 <4.0.0"',
      ].join('\n'),
    );
    expect(found).toEqual([
      { ecosystem: 'pub', name: 'arcgis_maps', version: '300.1.0', exact: true },
      { ecosystem: 'pub', name: 'async', version: '2.11.0', exact: true },
    ]);
  });
});

describe('Gradle manifests', () => {
  it('reads coordinates from Kotlin and Groovy build scripts and resolves version variables', () => {
    const found = parseGradle(
      [
        'val arcgisVersion = "300.1.0"',
        'dependencies {',
        '    implementation("com.esri:arcgis-maps-kotlin:$arcgisVersion")',
        '    implementation(platform("com.esri:arcgis-maps-kotlin-toolkit-bom:${arcgisVersion}"))',
        '    implementation("com.esri:arcgis-maps-kotlin-toolkit-geoview-compose")',
        "    implementation 'com.esri.arcgisruntime:arcgis-java:200.6.0'",
        '    implementation("androidx.core:core-ktx:1.13.1@aar")',
        '    implementation(project(":shared"))',
        '    implementation("com.esri:unknown:$missing")',
        '}',
      ].join('\n'),
    );
    expect(pairs(found)).toEqual([
      'com.esri:arcgis-maps-kotlin@300.1.0',
      'com.esri:arcgis-maps-kotlin-toolkit-bom@300.1.0',
      'com.esri:arcgis-maps-kotlin-toolkit-geoview-compose@',
      'com.esri.arcgisruntime:arcgis-java@200.6.0',
      'androidx.core:core-ktx@1.13.1',
      'com.esri:unknown@',
    ]);
    expect(found[0]?.ecosystem).toBe('maven');
  });

  it('resolves variables declared through ext and extra', () => {
    expect(
      pairs(
        parseGradle(
          `ext.arcgisVersion = '200.8.0'\nimplementation "com.esri:arcgis-maps-kotlin:$arcgisVersion"`,
        ),
      ),
    ).toEqual(['com.esri:arcgis-maps-kotlin@200.8.0']);
    expect(
      pairs(
        parseGradle(
          `extra["arcgis"] = "300.0.0"\nimplementation("com.esri:arcgis-maps-kotlin:\${rootProject.extra.arcgis}")`,
        ),
      ),
    ).toEqual(['com.esri:arcgis-maps-kotlin@300.0.0']);
  });

  it('reads every library form of a version catalog', () => {
    const found = parseVersionCatalog(
      [
        '[versions]',
        'arcgis = "300.1.0"',
        'kotlin = "2.1.0"',
        '',
        '[libraries]',
        'arcgis-maps = { module = "com.esri:arcgis-maps-kotlin", version.ref = "arcgis" }',
        'arcgis-bom = { group = "com.esri", name = "arcgis-maps-kotlin-toolkit-bom", version.ref = "arcgis" }',
        'inline = { module = "org.example:inline", version = "1.2.3" }',
        'short = "org.example:short:4.5.6"',
        'unversioned = { module = "org.example:managed-by-bom" }',
        '',
        '[plugins]',
        'android = { id = "com.android.application", version = "8.7.0" }',
      ].join('\n'),
    );
    expect(pairs(found)).toEqual([
      'com.esri:arcgis-maps-kotlin@300.1.0',
      'com.esri:arcgis-maps-kotlin-toolkit-bom@300.1.0',
      'org.example:inline@1.2.3',
      'org.example:short@4.5.6',
      'org.example:managed-by-bom@',
    ]);
  });
});

describe('Package.resolved', () => {
  it('reads pins of the current format', () => {
    const found = parsePackageResolved(
      JSON.stringify({
        originHash: 'abc',
        pins: [
          {
            identity: 'arcgis-maps-sdk-swift',
            kind: 'remoteSourceControl',
            location: 'https://github.com/Esri/arcgis-maps-sdk-swift',
            state: { revision: 'deadbeef', version: '300.1.0' },
          },
          {
            identity: 'swift-collections',
            location: 'https://github.com/apple/swift-collections.git',
            state: { branch: 'main', revision: 'cafe' },
          },
        ],
        version: 3,
      }),
    );
    expect(found).toEqual([
      { ecosystem: 'swiftpm', name: 'arcgis-maps-sdk-swift', version: '300.1.0', exact: true },
      { ecosystem: 'swiftpm', name: 'swift-collections', version: '', exact: false },
    ]);
  });

  it('reads pins of the first format, taking the identity from the repository URL', () => {
    const found = parsePackageResolved(
      JSON.stringify({
        object: {
          pins: [
            {
              package: 'ArcGIS',
              repositoryURL: 'https://github.com/Esri/arcgis-maps-sdk-swift.git',
              state: { version: '200.8.0' },
            },
            null,
            { state: {} },
          ],
        },
        version: 1,
      }),
    );
    expect(pairs(found)).toEqual(['arcgis-maps-sdk-swift@200.8.0']);
  });
});
