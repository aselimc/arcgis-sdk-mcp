/**
 * Registry data: native Maps SDKs and game engines (design section 4.2).
 *
 * The five current native SDKs are built the same way: an Astro guide site with two
 * documentation lines (`latest` = 300.x, `v200` = 200.x LTS, selected by `{prefix}` in the
 * base), an API reference in the toolchain's own format, and a samples repository.
 */
import { DEVELOPERS_ORIGIN as D } from '../../core/names.js';
import type {
  AdapterConfigMap,
  AnySourceDef,
  OracleSpec,
  PackageRef,
  Probe,
  Product,
  RepoRef,
  SourceDef,
  VersionLine,
  WorkspaceSignal,
} from '../../core/types.js';

const VERIFIED_ON = '2026-10-13';

const LINE_300: VersionLine = {
  id: 'latest',
  label: '300.x',
  current: true,
  access: 'live',
  vars: { prefix: '' },
};

const LINE_200: VersionLine = {
  id: 'v200',
  label: '200.x LTS',
  current: false,
  access: 'live',
  vars: { prefix: 'v200/' },
};

type SearchIndex = NonNullable<AdapterConfigMap['astro']['searchIndexes']>[number];

const GUIDE_INDEX: SearchIndex = { url: '__starship-mdx/search/mdxPages.json', role: 'guide' };
const SAMPLE_INDEX: SearchIndex = { url: 'sample-code-search.json', role: 'sample' };

/**
 * The Astro guide site of a native SDK. `slug` is its first path segment and `pages` the
 * number of guide and sample pages its search indexes list.
 */
function guide(
  slug: string,
  pages: number,
  extraIndexes: SearchIndex[] = [],
  probePrefix = '',
): SourceDef<'astro'> {
  const hasApiIndex = extraIndexes.some((index) => index.role === 'api');
  const hasOwnSampleIndex = extraIndexes.some((index) => index.role === 'sample');
  return {
    id: 'guide',
    title: hasApiIndex ? 'Guide, tutorials, samples and API reference' : 'Guide and tutorials',
    kinds: ['guide', 'tutorial', 'sample', 'release-notes', ...(hasApiIndex ? ['api' as const] : [])],
    adapter: 'astro',
    config: {
      base: `/${slug}/{prefix}`,
      sitemap: 'sitemap-0.xml',
      searchIndexes: [GUIDE_INDEX, ...(hasOwnSampleIndex ? [] : [SAMPLE_INDEX]), ...extraIndexes],
      classify: [
        ['^tutorials/', 'tutorial'],
        ['^sample-code/', 'sample'],
        ['^release-notes/', 'release-notes'],
        ['(?:^|/)api-reference/', 'api'],
      ],
    },
    capability: 'website',
    floor: true,
    pagesApprox: pages,
    probe: {
      url: `${D}/${slug}/${probePrefix}sitemap-0.xml`,
      expect: 'xml',
      minRecords: Math.floor(pages / 2),
      family: 'astro',
    },
  };
}

/** An API reference source; `path` is relative to the SDK slug and may contain `{prefix}`. */
function reference<A extends 'docc' | 'dokka' | 'dartdoc' | 'docfx-net' | 'javadoc'>(
  id: 'api' | 'toolkit-api',
  adapter: A,
  config: AdapterConfigMap[A],
  probe: Probe,
  extras: Partial<SourceDef<A>> = {},
): SourceDef<A> {
  return {
    id,
    title: id === 'api' ? 'API reference' : 'Toolkit API reference',
    kinds: ['api'],
    adapter,
    config,
    capability: 'website',
    probe,
    ...extras,
  };
}

interface SamplesSpec {
  repo: string;
  /** `release-tag`: the repository tags each SDK release as `v<version>`. */
  pin: 'release-tag' | 'branch';
  preset?: AdapterConfigMap['github-repo']['preset'];
  include?: string[];
  count?: number;
}

function samples(spec: SamplesSpec): SourceDef<'github-repo'> {
  return {
    id: 'samples',
    title: 'Samples (GitHub)',
    kinds: ['sample'],
    adapter: 'github-repo',
    config: {
      repo: spec.repo,
      preset: spec.preset ?? 'samples-metadata',
      pin: spec.pin,
      ...(spec.pin === 'release-tag' ? { tagTemplate: 'v{version}' } : {}),
      ...(spec.include === undefined ? {} : { include: spec.include }),
    },
    capability: 'github',
    license: 'apache-2.0',
    ...(spec.count === undefined ? {} : { pagesApprox: spec.count }),
    probe: {
      url: `https://api.github.com/repos/${spec.repo}`,
      expect: 'json',
      mustContain: 'full_name',
    },
  };
}

function repo(
  name: string,
  role: RepoRef['role'],
  license: RepoRef['license'] = 'apache-2.0',
): RepoRef {
  return { repo: name, role, license, defaultBranch: 'main' };
}

const banner = (path: string): OracleSpec => ({
  type: 'page-regex',
  options: { url: `${D}${path}` },
  provides: ['documented', 'released'],
});

const oracle = (
  type: 'github-release' | 'nuget-flat' | 'pub-dev',
  key: 'repo' | 'id' | 'package',
  value: string,
): OracleSpec => ({ type, options: { [key]: value }, provides: ['installable'] });

interface NativeSpec {
  id: string;
  /** First path segment on developers.arcgis.com. */
  slug: string;
  name: string;
  aliases: string[];
  category?: Product['category'];
  status?: Product['status'];
  statusNote?: string;
  successor?: string;
  summary: string;
  keywords: string[];
  languages: string[];
  packages?: PackageRef[];
  repos: RepoRef[];
  workspaceSignals?: WorkspaceSignal[];
  lines?: VersionLine[];
  sources: AnySourceDef[];
  oracles: OracleSpec[];
  /** Slug of a release-notes page, with the version placeholders of `Product.releaseNotes`. */
  releaseNotesSlug?: string;
  pitfalls: string[];
  related: string[];
}

/** Vocabulary shared by every Maps SDK, for the query router. */
const MAPS_SDK_KEYWORDS = [
  'native',
  'offline',
  'offline map',
  'mobile map package',
  'geodatabase',
  'sync',
  'routing',
  'geocoding',
  'location display',
  'gps',
  'augmented reality',
  'utility network',
  'feature layer',
  'graphics overlay',
  'authentication',
  'toolkit',
];

function nativeSdk(spec: NativeSpec): Product {
  const home = `${D}/${spec.slug}/`;
  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases,
    category: spec.category ?? 'native',
    tier: 'developer',
    status: spec.status ?? 'active',
    ...(spec.statusNote === undefined ? {} : { statusNote: spec.statusNote }),
    ...(spec.successor === undefined ? {} : { successor: spec.successor }),
    summary: spec.summary,
    keywords: spec.keywords,
    languages: spec.languages,
    homepage: home,
    packages: spec.packages ?? [],
    repos: spec.repos,
    ...(spec.workspaceSignals === undefined ? {} : { workspaceSignals: spec.workspaceSignals }),
    lines: spec.lines ?? [LINE_300, LINE_200],
    sources: spec.sources,
    oracles: spec.oracles,
    releaseNotes: {
      current: `${home}release-notes/`,
      // Pages of superseded releases move under `prior-releases/`; the sitemap finds those.
      pattern: `${home}{prefix}release-notes/${spec.releaseNotesSlug ?? 'release-notes-for-{major}-{minor}'}/`,
      sitemapFilter: '/release-notes/',
    },
    startHere: [
      { title: spec.name, ref: home },
      { title: 'Release notes', ref: `${home}release-notes/` },
    ],
    pitfalls: spec.pitfalls,
    related: spec.related,
    licenseTier: 'esri-website-terms',
    verifiedOn: VERIFIED_ON,
  };
}

const LTS_PITFALL =
  'Two lines are documented: 300.x (current) and 200.x LTS under /v200/. Pass version to read the line you build against.';
const MIGRATION_PITFALL =
  'ArcGIS Runtime 100.x code does not compile against 200.x or later; follow the migration topic in the guide.';

const swift = nativeSdk({
  id: 'swift-maps-sdk',
  slug: 'swift',
  name: 'ArcGIS Maps SDK for Swift',
  aliases: ['ios', 'arcgis-maps-sdk-swift', 'swift', 'swiftui', 'ipados', 'visionos'],
  summary:
    'Native mapping SDK for iOS, iPadOS, macOS Catalyst and visionOS apps in Swift and SwiftUI: 2D/3D maps, offline, routing.',
  keywords: [...MAPS_SDK_KEYWORDS, 'apple', 'iphone', 'ipad', 'xcode', 'swift package'],
  languages: ['swift'],
  packages: [
    { registry: 'swiftpm', name: 'arcgis-maps-sdk-swift', license: 'esri-ma', primary: true },
  ],
  repos: [
    repo('Esri/arcgis-maps-sdk-swift-samples', 'samples'),
    repo('Esri/arcgis-maps-sdk-swift-toolkit', 'toolkit'),
    repo('Esri/arcgis-maps-sdk-swift', 'source', 'esri-ma'),
  ],
  workspaceSignals: [
    {
      files: ['Package.swift', '**/Package.resolved', '**/project.pbxproj'],
      pattern: 'arcgis-maps-sdk-swift(?!-)',
    },
  ],
  sources: [
    guide('swift', 395),
    reference(
      'api',
      'docc',
      { base: '/swift/{prefix}api-reference/' },
      {
        url: `${D}/swift/api-reference/index/index.json`,
        expect: 'json',
        mustContain: 'interfaceLanguages',
      },
      { pagesApprox: 14430 },
    ),
    reference(
      'toolkit-api',
      'docc',
      // Deeper nodes are inherited SwiftUI view modifiers, not toolkit API.
      { base: '/swift/{prefix}toolkit-api-reference/', maxDepth: 3 },
      {
        url: `${D}/swift/toolkit-api-reference/index/index.json`,
        expect: 'json',
        mustContain: 'interfaceLanguages',
      },
    ),
    samples({
      repo: 'Esri/arcgis-maps-sdk-swift-samples',
      pin: 'release-tag',
      include: ['Shared/Samples/**'],
      count: 243,
    }),
  ],
  oracles: [oracle('github-release', 'repo', 'Esri/arcgis-maps-sdk-swift'), banner('/swift/')],
  pitfalls: [
    LTS_PITFALL,
    MIGRATION_PITFALL,
    'API reference paths are lower-case and case-sensitive; take refs from search or lookup instead of building them.',
  ],
  related: ['kotlin-maps-sdk', 'flutter-maps-sdk', 'runtime-100'],
});

const kotlin = nativeSdk({
  id: 'kotlin-maps-sdk',
  slug: 'kotlin',
  name: 'ArcGIS Maps SDK for Kotlin',
  aliases: ['android', 'com.arcgismaps', 'arcgis-maps-kotlin', 'kotlin', 'jetpack compose'],
  summary:
    'Native mapping SDK for Android apps in Kotlin with Jetpack Compose: 2D/3D maps, offline data, routing, geocoding.',
  keywords: [...MAPS_SDK_KEYWORDS, 'compose', 'gradle', 'coroutines', 'android studio'],
  languages: ['kotlin'],
  packages: [
    {
      registry: 'maven',
      name: 'com.esri:arcgis-maps-kotlin',
      license: 'esri-ma',
      primary: true,
    },
  ],
  repos: [
    repo('Esri/arcgis-maps-sdk-kotlin-samples', 'samples'),
    repo('Esri/arcgis-maps-sdk-kotlin-toolkit', 'toolkit'),
  ],
  workspaceSignals: [
    {
      files: ['**/build.gradle.kts', '**/build.gradle', 'gradle/libs.versions.toml'],
      pattern: 'com\\.esri:arcgis-maps-kotlin(?::(\\d[\\w.]*))?',
      versionGroup: 1,
    },
  ],
  sources: [
    guide('kotlin', 326),
    reference(
      'api',
      'dokka',
      { base: '/kotlin/{prefix}api-reference/' },
      { url: `${D}/kotlin/api-reference/scripts/pages.json`, expect: 'json', minRecords: 4473 },
      { pagesApprox: 8946 },
    ),
    reference(
      'toolkit-api',
      'dokka',
      { base: '/kotlin/{prefix}toolkit-api-reference/' },
      {
        url: `${D}/kotlin/toolkit-api-reference/scripts/pages.json`,
        expect: 'json',
        minRecords: 305,
      },
      { pagesApprox: 610 },
    ),
    samples({
      repo: 'Esri/arcgis-maps-sdk-kotlin-samples',
      pin: 'release-tag',
      include: ['samples/**'],
      count: 173,
    }),
  ],
  // The Maven repository of the SDK itself forbids crawling, so the toolkit release, which
  // ships with every SDK release, stands in for the installable version.
  oracles: [
    banner('/kotlin/'),
    oracle('github-release', 'repo', 'Esri/arcgis-maps-sdk-kotlin-toolkit'),
  ],
  pitfalls: [
    LTS_PITFALL,
    MIGRATION_PITFALL,
    'API reference file names are mangled (ArcGISMap is -arc-g-i-s-map); take refs from search or lookup.',
  ],
  related: ['swift-maps-sdk', 'flutter-maps-sdk', 'java-maps-sdk', 'runtime-100'],
});

const DOTNET_PLATFORMS = ['wpf', 'maui', 'winui'];

const dotnet = nativeSdk({
  id: 'dotnet-maps-sdk',
  slug: 'net',
  name: 'ArcGIS Maps SDK for .NET',
  aliases: ['net', 'dotnet', 'esri.arcgisruntime', 'maui', 'wpf', 'winui', '.net', 'dotnet maui'],
  summary:
    'Native mapping SDK for .NET apps on WPF, .NET MAUI and WinUI in C#: 2D/3D maps, offline data, routing, geocoding.',
  keywords: [...MAPS_SDK_KEYWORDS, 'windows', 'xaml', 'nuget', 'desktop', 'cross-platform'],
  languages: ['csharp'],
  packages: [
    { registry: 'nuget', name: 'Esri.ArcGISRuntime', license: 'esri-ma', primary: true },
  ],
  repos: [
    repo('Esri/arcgis-maps-sdk-dotnet-samples', 'samples'),
    repo('Esri/arcgis-maps-sdk-dotnet-toolkit', 'toolkit'),
  ],
  workspaceSignals: [
    {
      files: ['**/*.csproj', 'Directory.Packages.props'],
      pattern: 'Include="Esri\\.ArcGISRuntime(?:\\.[\\w.]+)?"\\s+Version="([^"]+)"',
      versionGroup: 1,
    },
  ],
  sources: [
    // This site publishes one sample index per UI platform and none without a platform.
    guide(
      'net',
      400,
      DOTNET_PLATFORMS.map((platform) => ({
        url: `sample-code-${platform}-search.json`,
        role: 'sample' as const,
        platform,
      })),
    ),
    reference(
      'api',
      'docfx-net',
      // `xrefmap.yml` without a platform prefix exists but is empty.
      { base: '/net/{prefix}api-reference/', xrefmaps: ['net.xrefmap.yml', 'netwin.xrefmap.yml'] },
      {
        url: `${D}/net/api-reference/net.xrefmap.yml`,
        expect: 'yaml',
        minRecords: 7525,
        mustContain: 'uid:',
      },
      { pagesApprox: 15050 },
    ),
    reference(
      'toolkit-api',
      'docfx-net',
      { base: 'https://esri.github.io/arcgis-maps-sdk-dotnet-toolkit/', xrefmaps: ['xrefmap.yml'] },
      {
        url: 'https://esri.github.io/arcgis-maps-sdk-dotnet-toolkit/xrefmap.yml',
        expect: 'yaml',
        mustContain: 'uid:',
      },
      // GitHub Pages hosts one build, the current one.
      { license: 'apache-2.0', lines: ['latest'] },
    ),
    samples({ repo: 'Esri/arcgis-maps-sdk-dotnet-samples', pin: 'release-tag', count: 690 }),
  ],
  oracles: [banner('/net/'), oracle('nuget-flat', 'id', 'esri.arcgisruntime')],
  pitfalls: [
    LTS_PITFALL,
    MIGRATION_PITFALL,
    'UI controls differ per platform (WPF, MAUI, WinUI): samples and some API pages are platform-specific.',
  ],
  related: ['arcgis-pro-sdk', 'qt-maps-sdk', 'runtime-100'],
});

const qt = nativeSdk({
  id: 'qt-maps-sdk',
  slug: 'qt',
  name: 'ArcGIS Maps SDK for Qt',
  aliases: ['qt', 'qml', 'qt quick', 'arcgis-maps-sdk-qt'],
  summary:
    'Native mapping SDK for cross-platform Qt apps in C++ with Qt Quick: 2D/3D maps, offline data, routing, geocoding.',
  keywords: [...MAPS_SDK_KEYWORDS, 'c++', 'cmake', 'qmake', 'cross-platform', 'embedded', 'linux'],
  languages: ['cpp', 'qml'],
  repos: [
    repo('Esri/arcgis-maps-sdk-samples-qt', 'samples'),
    repo('Esri/arcgis-maps-sdk-toolkit-qt', 'toolkit'),
  ],
  workspaceSignals: [
    { files: ['**/*.pro', '**/CMakeLists.txt'], pattern: 'ArcGISRuntime|arcgis_runtime' },
  ],
  sources: [
    // The C++ and toolkit references are pages of the guide site with their own symbol indexes.
    guide('qt', 370, [
      { url: 'cpp/api-reference/search.json', role: 'api' },
      { url: 'toolkit/api-reference/search.json', role: 'api' },
    ]),
    // Tags of this repository are pre-release builds, so samples follow the default branch.
    samples({ repo: 'Esri/arcgis-maps-sdk-samples-qt', pin: 'branch', count: 232 }),
  ],
  oracles: [banner('/qt/')],
  pitfalls: [
    LTS_PITFALL,
    MIGRATION_PITFALL,
    'The QML API was removed in 200.x: write application logic in C++ and the UI in Qt Quick.',
  ],
  related: ['dotnet-maps-sdk', 'runtime-100'],
});

const flutter = nativeSdk({
  id: 'flutter-maps-sdk',
  slug: 'flutter',
  name: 'ArcGIS Maps SDK for Flutter',
  aliases: ['arcgis_maps', 'flutter', 'dart', 'arcgis-maps-sdk-flutter'],
  summary:
    'Mapping SDK for cross-platform Flutter apps in Dart on Android and iOS: maps, scenes, offline data, routing.',
  keywords: [...MAPS_SDK_KEYWORDS, 'cross-platform', 'pub.dev', 'pubspec', 'widget'],
  languages: ['dart'],
  packages: [{ registry: 'pub', name: 'arcgis_maps', license: 'esri-ma', primary: true }],
  repos: [
    repo('Esri/arcgis-maps-sdk-flutter-samples', 'samples'),
    repo('Esri/arcgis-maps-sdk-flutter-toolkit', 'toolkit'),
  ],
  workspaceSignals: [
    {
      files: ['pubspec.yaml', '**/pubspec.yaml'],
      pattern: 'arcgis_maps:\\s*[\'"]?[\\^~>=<\\s]*(\\d[\\w.+-]*)',
      versionGroup: 1,
    },
  ],
  sources: [
    guide('flutter', 259),
    reference(
      'api',
      'dartdoc',
      { base: '/flutter/{prefix}api-reference/reference/', index: 'index.json' },
      {
        url: `${D}/flutter/api-reference/reference/index.json`,
        expect: 'json',
        minRecords: 3372,
      },
      { pagesApprox: 6744 },
    ),
    reference(
      'toolkit-api',
      'dartdoc',
      // Unlike the SDK reference, the toolkit reference has no `reference/` segment.
      { base: '/flutter/{prefix}toolkit-api-reference/', index: 'index.json' },
      { url: `${D}/flutter/toolkit-api-reference/index.json`, expect: 'json', minRecords: 35 },
      { pagesApprox: 70 },
    ),
    // Tags ahead of the release exist in this repository, so samples follow the default branch.
    samples({
      repo: 'Esri/arcgis-maps-sdk-flutter-samples',
      pin: 'branch',
      include: ['lib/samples/**'],
      count: 143,
    }),
  ],
  oracles: [oracle('pub-dev', 'package', 'arcgis_maps'), banner('/flutter/')],
  pitfalls: [
    LTS_PITFALL,
    'pub.dev versions carry a build suffix (300.1.0+5042); the SDK version is the part before the plus sign.',
  ],
  related: ['kotlin-maps-sdk', 'swift-maps-sdk'],
});

const JAVA_LINE: VersionLine = { ...LINE_200, label: '200.x (final)', current: true };

const java = nativeSdk({
  id: 'java-maps-sdk',
  slug: 'java',
  name: 'ArcGIS Maps SDK for Java',
  aliases: ['java', 'javafx', 'com.esri.arcgisruntime', 'arcgis-java'],
  status: 'deprecated',
  statusNote: 'Final release 200.6; no 300.x line',
  successor: 'kotlin-maps-sdk',
  summary:
    'Deprecated mapping SDK for JavaFX desktop apps. 200.6 is the final release; new work should use another Maps SDK.',
  keywords: [...MAPS_SDK_KEYWORDS, 'javafx', 'desktop', 'gradle', 'maven', 'deprecated'],
  languages: ['java'],
  packages: [
    {
      registry: 'maven',
      name: 'com.esri.arcgisruntime:arcgis-java',
      license: 'esri-ma',
      primary: true,
    },
  ],
  repos: [repo('Esri/arcgis-maps-sdk-java-samples', 'samples')],
  workspaceSignals: [
    {
      files: ['**/build.gradle', '**/build.gradle.kts', '**/pom.xml'],
      pattern: 'com\\.esri\\.arcgisruntime',
    },
  ],
  lines: [JAVA_LINE],
  sources: [
    // Unversioned Java URLs redirect to the v200 tree, so the canary names it.
    guide('java', 348, [], 'v200/'),
    reference(
      'api',
      'javadoc',
      { base: '/java/v200/api-reference/reference/' },
      {
        url: `${D}/java/v200/api-reference/reference/type-search-index.js`,
        expect: 'text',
        mustContain: 'typeSearchIndex',
      },
    ),
    samples({ repo: 'Esri/arcgis-maps-sdk-java-samples', pin: 'branch', count: 217 }),
  ],
  oracles: [
    {
      type: 'static',
      options: {
        version: '200.6',
        ga: '2024-11-25',
        mature: '2026-11-25',
        retirement: '2028-11-25',
      },
      provides: ['documented', 'lifecycle'],
    },
    banner('/java/v200/'),
  ],
  pitfalls: [
    'Deprecated: 200.6 is the last release and there is no 300.x line.',
    'All documentation lives under /java/v200/; URLs without v200 redirect there.',
  ],
  related: ['kotlin-maps-sdk', 'dotnet-maps-sdk', 'qt-maps-sdk'],
});

/** Game-engine plugins have one documentation line; their older major is not documented here. */
const ENGINE_LINE: VersionLine = { ...LINE_300, label: '2.x', vars: {} };

const ENGINE_KEYWORDS = [
  'game engine',
  '3d',
  'xr',
  'vr',
  'ar',
  'digital twin',
  'simulation',
  'visualization',
  'terrain',
  'elevation',
  'camera',
];

function gameEngine(spec: {
  id: string;
  slug: string;
  engine: string;
  aliases: string[];
  languages: string[];
  pages: number;
  options: Omit<AdapterConfigMap['gatsby'], 'base'>;
  samplesRepo: string;
  workspaceSignals: WorkspaceSignal[];
  pitfalls: string[];
  related: string[];
}): Product {
  return nativeSdk({
    id: spec.id,
    slug: spec.slug,
    name: `ArcGIS Maps SDK for ${spec.engine}`,
    aliases: spec.aliases,
    category: 'game-engine',
    summary: `Plugin that brings ArcGIS maps, 3D layers and geospatial coordinates into ${spec.engine} projects, with samples.`,
    keywords: [...ENGINE_KEYWORDS, spec.engine.toLowerCase()],
    languages: spec.languages,
    repos: [repo(spec.samplesRepo, 'samples')],
    workspaceSignals: spec.workspaceSignals,
    lines: [ENGINE_LINE],
    sources: [
      {
        id: 'guide',
        title: 'Guide, samples and API reference',
        kinds: ['guide', 'sample', 'api', 'release-notes'],
        adapter: 'gatsby',
        config: { base: `/${spec.slug}/`, ...spec.options },
        capability: 'website',
        floor: true,
        pagesApprox: spec.pages,
        probe: {
          url: `${D}/${spec.slug}/sitemap-0.xml`,
          expect: 'xml',
          minRecords: Math.floor(spec.pages / 2),
          family: 'gatsby',
        },
      },
      // Most samples of these repositories have a README but no metadata file.
      samples({ repo: spec.samplesRepo, pin: 'branch', preset: 'samples-readme' }),
    ],
    oracles: [banner(`/${spec.slug}/`)],
    releaseNotesSlug: 'release-notes-{major}-{minor}-{patch}',
    pitfalls: spec.pitfalls,
    related: spec.related,
  });
}

const unity = gameEngine({
  id: 'unity-maps-sdk',
  slug: 'unity',
  engine: 'Unity',
  aliases: ['unity', 'unity3d', 'arcgis-maps-sdk-unity'],
  languages: ['csharp'],
  pages: 259,
  options: { symbols: 'fuse-store', bodyFrom: 'auto' },
  samplesRepo: 'Esri/arcgis-maps-sdk-unity-samples',
  workspaceSignals: [
    {
      files: ['Packages/manifest.json'],
      pattern: '"com\\.esri\\.arcgis-maps-sdk"\\s*:\\s*"([^"]+)"',
      versionGroup: 1,
    },
  ],
  pitfalls: [
    'API reference URLs mix upper and lower case and are case-sensitive; use refs exactly as returned.',
    'The samples repository can lag one release behind the documentation.',
  ],
  related: ['unreal-maps-sdk'],
});

const unreal = gameEngine({
  id: 'unreal-maps-sdk',
  slug: 'unreal-engine',
  engine: 'Unreal Engine',
  aliases: ['unreal', 'unreal-engine', 'ue5', 'arcgis-maps-sdk-unreal-engine'],
  languages: ['cpp', 'blueprints'],
  pages: 260,
  options: { symbols: 'fuse-store' },
  samplesRepo: 'Esri/arcgis-maps-sdk-unreal-engine-samples',
  workspaceSignals: [{ files: ['*.uproject', '**/*.uproject'], pattern: 'ArcGISMapsSDK' }],
  pitfalls: [
    'Most features exist both as Blueprint nodes and C++ classes; pages document both under one type name.',
    'The samples repository can lag one release behind the documentation.',
  ],
  related: ['unity-maps-sdk'],
});

const MIGRATION_PAGE = 'reference/migrate-from-100-x-to-200-x/';

const runtime100: Product = {
  id: 'runtime-100',
  name: 'ArcGIS Runtime SDKs 100.x',
  aliases: ['arcgis runtime', 'runtime sdk', 'arcgis-runtime', 'runtime 100', 'arcgis runtime sdk'],
  category: 'native',
  tier: 'developer',
  status: 'retired',
  statusNote:
    'Retires 2027-09-01; documentation is on an archive host that is linked, not fetched',
  successor: 'kotlin-maps-sdk',
  summary:
    'Tombstone for ArcGIS Runtime SDKs 100.x (Android, iOS, .NET, Qt, Java). Points to the migration guides of the Maps SDKs.',
  keywords: ['runtime', '100.x', '100.15', 'legacy', 'migration', 'migrate', 'retired'],
  languages: [],
  homepage: 'https://archive.developers.arcgis.com/',
  packages: [],
  repos: [],
  lines: [{ id: 'v100', label: '100.x', current: true, access: 'live', vars: {} }],
  sources: [
    {
      id: 'card',
      title: 'Migration guides',
      kinds: ['guide'],
      adapter: 'static',
      config: {
        entries: [
          ['kotlin', 'Kotlin (Android)'],
          ['swift', 'Swift (iOS)'],
          ['net', '.NET'],
          ['qt', 'Qt'],
        ].map(([slug, label]) => ({
          url: `${D}/${slug}/${MIGRATION_PAGE}`,
          title: `Migrate from 100.x to 200.x: ${label}`,
          kind: 'guide' as const,
        })),
      },
      capability: 'website',
      floor: true,
      probe: { url: `${D}/kotlin/${MIGRATION_PAGE}`, expect: 'html', family: 'astro', minChars: 500 },
    },
  ],
  oracles: [
    {
      type: 'static',
      options: { version: '100.15', mature: '2025-09-01', retirement: '2027-09-01' },
      provides: ['documented', 'lifecycle'],
    },
  ],
  startHere: [
    { title: 'Migrate to Kotlin', ref: `${D}/kotlin/${MIGRATION_PAGE}` },
    { title: 'Migrate to Swift', ref: `${D}/swift/${MIGRATION_PAGE}` },
  ],
  pitfalls: [
    '100.x documentation is on archive.developers.arcgis.com, which this server links to but never reads.',
    'Android moves to the Kotlin SDK, iOS to the Swift SDK; .NET and Qt keep their SDK and change major version.',
  ],
  related: ['kotlin-maps-sdk', 'swift-maps-sdk', 'dotnet-maps-sdk', 'qt-maps-sdk'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

/** The nine native and game-engine products of design section 4.2. */
export const nativeProducts: readonly Product[] = [
  swift,
  kotlin,
  dotnet,
  qt,
  flutter,
  java,
  unity,
  unreal,
  runtime100,
];
