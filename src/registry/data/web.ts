/**
 * Registry data: web products (design section 4.1). Ids, URLs, patterns and adapter configs
 * only; summaries, keywords and pitfalls are written by this project.
 */
import { DEVELOPERS_ORIGIN as D } from '../../core/names.js';
import type {
  AdapterConfigMap,
  AnySourceDef,
  PackageRef,
  Product,
  SourceDef,
  VersionLine,
  WorkspaceSignal,
} from '../../core/types.js';

const VERIFIED_ON = '2026-10-13';

const LATEST: VersionLine = {
  id: 'latest',
  label: 'Current',
  current: true,
  access: 'live',
  vars: {},
};

type GatsbyOptions = Omit<AdapterConfigMap['gatsby'], 'base'>;
type Extras<A extends keyof AdapterConfigMap> = Partial<
  Omit<SourceDef<A>, 'id' | 'adapter' | 'config'>
>;

/** A Gatsby documentation site on developers.arcgis.com; `pages` is its sitemap size. */
function gatsbySite(
  id: string,
  base: string,
  pages: number,
  options: GatsbyOptions = {},
  extras: Extras<'gatsby'> = {},
): SourceDef<'gatsby'> {
  return {
    id,
    title: 'Guide',
    kinds: ['guide'],
    adapter: 'gatsby',
    config: { base, ...options },
    capability: 'website',
    floor: true,
    pagesApprox: pages,
    probe: {
      url: `${D}${base}sitemap-0.xml`,
      expect: 'xml',
      minRecords: Math.floor(pages / 2),
      family: 'gatsby',
    },
    ...extras,
  };
}

/** A GitHub repository read with the Markdown preset. */
function markdownRepo(
  id: string,
  title: string,
  repo: string,
  options: Partial<AdapterConfigMap['github-repo']> = {},
  extras: Extras<'github-repo'> = {},
): SourceDef<'github-repo'> {
  return {
    id,
    title,
    kinds: ['sample'],
    adapter: 'github-repo',
    config: { repo, preset: 'markdown-docs', ...options },
    capability: 'github',
    license: 'apache-2.0',
    probe: { url: `https://api.github.com/repos/${repo}`, expect: 'json', mustContain: 'full_name' },
    ...extras,
  };
}

/** Canary of an npm-backed source: the package's dist-tags, the smallest registry document. */
function npmProbe(pkg: string): SourceDef['probe'] {
  return {
    url: `https://registry.npmjs.org/-/package/${pkg}/dist-tags`,
    expect: 'json',
    mustContain: 'latest',
  };
}

function npm(name: string, license: PackageRef['license'], primary = false): PackageRef {
  return { registry: 'npm', name, license, ...(primary ? { primary } : {}) };
}

/** Recognises an npm dependency in `package.json` and captures its version range. */
function npmSignal(pkg: string): WorkspaceSignal {
  const escaped = pkg.replace(/[/.]/g, '\\$&');
  return { files: ['package.json'], pattern: `"${escaped}"\\s*:\\s*"([^"]+)"`, versionGroup: 1 };
}

const npmDistTags = (pkg: string, tags?: string): Product['oracles'][number] => ({
  type: 'npm-dist-tags',
  options: { package: pkg, ...(tags === undefined ? {} : { tags }) },
  provides: ['installable', 'prerelease'],
});

const banner = (path: string): Product['oracles'][number] => ({
  type: 'page-regex',
  options: { url: `${D}${path}` },
  provides: ['documented', 'released'],
});

const JS = '/javascript/latest/';

const JS_COMPONENT_PACKAGES = [
  '@arcgis/map-components',
  '@arcgis/charts-components',
  '@arcgis/ai-components',
  '@arcgis/coding-components',
  '@arcgis/common-components',
];

const jsSources: AnySourceDef[] = [
  {
    id: 'guide',
    title: 'Guide and tutorials',
    kinds: ['guide', 'tutorial', 'release-notes'],
    adapter: 'astro',
    config: {
      base: JS,
      sitemap: 'sitemap-0.xml',
      searchIndexes: [{ url: 'guide-topic-search.json', role: 'guide' }],
      exclude: [
        '^api-reference/',
        '/live/$',
        '^demo-apps/',
        '^\\d+\\.\\d+/$',
        '^references/',
        '^sample-code/',
      ],
      classify: [
        ['^tutorials/', 'tutorial'],
        ['^release-notes', 'release-notes'],
      ],
    },
    capability: 'website',
    floor: true,
    pagesApprox: 370,
    probe: {
      url: `${D}${JS}sitemap-0.xml`,
      expect: 'xml',
      minRecords: 2366,
      family: 'astro',
    },
  },
  {
    id: 'samples',
    title: 'Samples',
    kinds: ['sample'],
    adapter: 'astro',
    config: { base: JS, include: ['^sample-code/'], sampleIndexPage: 'sample-code/' },
    capability: 'website',
    pagesApprox: 412,
    probe: {
      url: `${D}${JS}sample-code/`,
      expect: 'html',
      family: 'astro-sample',
      mustContain: 'data-sample-id',
    },
  },
  {
    id: 'core',
    title: 'API reference',
    kinds: ['api'],
    adapter: 'astro',
    config: {
      base: JS,
      // Guide, samples and reference share one base, so each is told apart by its filter.
      include: ['^references/'],
      searchIndexes: [{ url: 'references-search.json', role: 'api' }],
    },
    capability: 'website',
    fallbacks: ['typings'],
    pagesApprox: 23816,
    probe: {
      url: `${D}${JS}references-search.json`,
      expect: 'json',
      minRecords: 11908,
      family: 'astro-js-ref',
    },
  },
  {
    id: 'components',
    title: 'Web components (Custom Elements Manifest)',
    kinds: ['api'],
    adapter: 'npm-cem',
    config: {
      packages: JS_COMPONENT_PACKAGES,
      file: 'dist/docs/api.json',
      docUrl: `${JS}references/{pkg}/components/{tag}/`,
    },
    capability: 'package-cdn',
    license: 'esri-ma',
    fallbacks: ['core'],
    probe: npmProbe('@arcgis/map-components'),
  },
  {
    id: 'typings',
    title: 'TypeScript declarations of @arcgis/core (any published version)',
    kinds: ['api'],
    adapter: 'npm-dts',
    config: { package: '@arcgis/core', docUrl: `${JS}references/core/{path}/` },
    capability: 'package-cdn',
    license: 'esri-ma',
    probe: npmProbe('@arcgis/core'),
  },
  markdownRepo('templates', 'Starter templates', 'Esri/jsapi-resources', {
    include: ['templates/**', 'README.md'],
  }),
];

const jsMapsSdk: Product = {
  id: 'js-maps-sdk',
  name: 'ArcGIS Maps SDK for JavaScript',
  aliases: [
    'javascript',
    'js',
    'jsapi',
    '@arcgis/core',
    '@arcgis/map-components',
    'ai-components',
    'arcgis-assistant',
    'arcgis maps sdk for javascript',
    'arcgis js api',
    'arcgis-js-api',
    'js sdk',
    'maps sdk js',
  ],
  category: 'web',
  tier: 'developer',
  status: 'active',
  statusNote: 'AI components are in beta',
  summary:
    'Web mapping SDK: 2D and 3D maps, layers, queries, editing and analysis as web components and an ES module API.',
  keywords: [
    'web',
    'browser',
    'map',
    'scene',
    'mapview',
    'sceneview',
    'featurelayer',
    'feature layer',
    'layers',
    'basemap',
    'graphics',
    'query',
    'editing',
    'symbols',
    'labels',
    'web components',
    'map components',
    'charts',
    'widgets',
    'esm',
    'typescript',
    'vite',
    'react',
    'angular',
    'vue',
    '3d',
    'webgl',
    'popup',
    'renderer',
    'clustering',
  ],
  languages: ['javascript', 'typescript'],
  homepage: `${D}${JS}`,
  packages: [
    npm('@arcgis/core', 'esri-ma', true),
    ...JS_COMPONENT_PACKAGES.map((name) => npm(name, 'esri-ma')),
  ],
  repos: [
    {
      repo: 'Esri/jsapi-resources',
      role: 'templates',
      license: 'apache-2.0',
      defaultBranch: 'main',
    },
  ],
  workspaceSignals: [npmSignal('@arcgis/core'), npmSignal('@arcgis/map-components')],
  lines: [
    { ...LATEST, label: '5.x' },
    {
      id: 'npm-any-version',
      label: 'Any other published npm version (typings only)',
      current: false,
      // Pages of older versions live on the archive host, which is never fetched; the
      // typings of every published version stay reachable through npm.
      access: 'link-only',
      vars: { versions: '^\\d' },
    },
  ],
  sources: jsSources,
  oracles: [npmDistTags('@arcgis/core'), banner(JS)],
  compatibility: [{ name: 'Version matrix', url: `${D}${JS}version-matrix/` }],
  releaseNotes: { current: `${D}${JS}release-notes/`, sitemapFilter: '/release-notes/' },
  startHere: [
    { title: 'Get started', ref: `${D}${JS}get-started/` },
    { title: 'Tutorials', ref: `${D}${JS}tutorials/` },
    { title: 'Samples', ref: `${D}${JS}sample-code/` },
    { title: 'Release notes', ref: `${D}${JS}release-notes/` },
    { title: 'Version matrix', ref: `${D}${JS}version-matrix/` },
  ],
  pitfalls: [
    'Since 5.0 map UI is built with web components (arcgis-map, arcgis-scene); most widgets are deprecated in their favour.',
    'Import from @arcgis/core/... as ES modules; AMD require() and the esri/ prefix belong to 4.x CDN code.',
    'Documentation pages describe the current release only; for an older installed version read the typings (pass version).',
    'AI components (beta) need signed-in ArcGIS Online named users and a web map with embeddings.',
  ],
  related: ['calcite', 'arcade', 'rest-js', 'experience-builder', 'web-map-spec', 'ai-agents'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const calcite: Product = {
  id: 'calcite',
  name: 'Calcite Design System',
  aliases: ['calcite-components', '@esri/calcite-components', 'calcite design system'],
  category: 'web',
  tier: 'developer',
  status: 'active',
  summary:
    'Esri design system: web components, design tokens, icons and UI patterns for ArcGIS web apps.',
  keywords: [
    'ui',
    'design system',
    'web components',
    'components',
    'tokens',
    'icons',
    'theming',
    'css',
    'accessibility',
    'button',
    'panel',
    'shell',
    'dark mode',
  ],
  languages: ['javascript', 'html', 'css'],
  homepage: `${D}/calcite-design-system/`,
  packages: [npm('@esri/calcite-components', 'esri-ma', true)],
  repos: [
    {
      repo: 'Esri/calcite-design-system',
      role: 'source',
      // Not Apache: files are fetched on demand and never indexed for full text.
      license: 'esri-ma',
      defaultBranch: 'dev',
    },
  ],
  workspaceSignals: [npmSignal('@esri/calcite-components')],
  lines: [LATEST],
  sources: [
    gatsbySite('guide', '/calcite-design-system/', 180, { seedPage: '/calcite-design-system/' }),
    {
      id: 'components',
      title: 'Component API (Custom Elements Manifest)',
      kinds: ['api'],
      adapter: 'npm-cem',
      config: {
        packages: ['@esri/calcite-components'],
        file: 'dist/docs/api.json',
        docUrl: '/calcite-design-system/components/{tagShort}/',
      },
      capability: 'package-cdn',
      license: 'esri-ma',
      fallbacks: ['guide'],
      probe: npmProbe('@esri/calcite-components'),
    },
  ],
  oracles: [npmDistTags('@esri/calcite-components'), banner('/calcite-design-system/')],
  releaseNotes: {
    current: `${D}/calcite-design-system/whats-new/`,
    pattern: `${D}/calcite-design-system/releases/changelogs/{version}/`,
    sitemapFilter: '/releases/|/whats-new/',
  },
  startHere: [
    { title: 'Calcite Design System', ref: `${D}/calcite-design-system/` },
    { title: "What's new", ref: `${D}/calcite-design-system/whats-new/` },
  ],
  pitfalls: [
    'Component tags are calcite-<name>; the documentation URL drops the prefix (components/button/).',
    'Major versions rename and remove properties; check the changelog before upgrading.',
  ],
  related: ['js-maps-sdk', 'experience-builder'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const ARCADE_ASSETS = 'dist/cdn/assets/arcade-language';

const arcade: Product = {
  id: 'arcade',
  name: 'ArcGIS Arcade',
  aliases: ['arcade expressions', 'arcade language', 'arcgis-arcade'],
  category: 'web',
  tier: 'developer',
  status: 'active',
  summary:
    'Expression language for popups, labels, symbology, field calculation and rules across ArcGIS, with profiles.',
  keywords: [
    'expression',
    'expressions',
    'popup',
    'labeling',
    'attribute rules',
    'calculate',
    'profile',
    'featureset',
    'functions',
    '$feature',
    'scripting',
  ],
  languages: ['arcade'],
  homepage: `${D}/arcade/`,
  packages: [],
  repos: [
    {
      repo: 'Esri/arcade-expressions',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'master',
    },
  ],
  lines: [LATEST],
  sources: [
    gatsbySite('guide', '/arcade/', 89),
    {
      id: 'functions',
      title: 'Function reference',
      kinds: ['api'],
      adapter: 'npm-json',
      config: {
        package: '@arcgis/coding-components',
        file: `${ARCADE_ASSETS}/api/arcade-api.t9n.en.json`,
        mapper: 'arcade-api',
        docUrl: '/arcade/function-reference/',
      },
      capability: 'package-cdn',
      license: 'esri-ma',
      fallbacks: ['guide'],
      pagesApprox: 271,
      probe: npmProbe('@arcgis/coding-components'),
    },
    {
      id: 'profiles',
      title: 'Profiles',
      kinds: ['api'],
      adapter: 'npm-json',
      config: {
        package: '@arcgis/coding-components',
        file: `${ARCADE_ASSETS}/profiles/arcade-profiles.t9n.en.json`,
        mapper: 'arcade-profiles',
      },
      capability: 'package-cdn',
      license: 'esri-ma',
      fallbacks: ['guide'],
      pagesApprox: 42,
      probe: npmProbe('@arcgis/coding-components'),
    },
    markdownRepo('expressions', 'Community expressions', 'Esri/arcade-expressions'),
  ],
  oracles: [
    {
      type: 'page-regex',
      options: {
        url: `${D}/arcade/guide/release-notes/`,
        // The first heading id is `version-138` for 1.38.
        pattern: '<h2[^>]*\\bid="version-(\\d)(\\d+)"',
        match: 'html',
        format: '$1.$2',
      },
      provides: ['documented'],
    },
  ],
  compatibility: [{ name: 'Version matrix', url: `${D}/arcade/guide/version-matrix/` }],
  releaseNotes: {
    current: `${D}/arcade/guide/release-notes/`,
    // One page for every version, with a heading id such as `version-138` for 1.38.
    pattern: `${D}/arcade/guide/release-notes/#version-{major}{minor}`,
  },
  startHere: [
    { title: 'Arcade', ref: `${D}/arcade/` },
    { title: 'Function reference', ref: `${D}/arcade/function-reference/` },
    { title: 'Release notes', ref: `${D}/arcade/guide/release-notes/` },
    { title: 'Version matrix', ref: `${D}/arcade/guide/version-matrix/` },
  ],
  pitfalls: [
    'Which functions and globals exist depends on the profile (popup, labeling, attribute rule ...); check the profile first.',
    'The Arcade version depends on the host product release; consult the version matrix before using a new function.',
  ],
  related: ['js-maps-sdk', 'arcgis-pro-sdk'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const REST_JS_PACKAGES = [
  'request',
  'auth',
  'portal',
  'feature-service',
  'geocoding',
  'routing',
  'places',
  'demographics',
].map((suffix) => `@esri/arcgis-rest-${suffix}`);

const restJs: Product = {
  id: 'rest-js',
  name: 'ArcGIS REST JS',
  aliases: ['arcgis-rest-js', '@esri/arcgis-rest-request', 'arcgis rest js', 'rest js'],
  category: 'web',
  tier: 'developer',
  status: 'active',
  summary:
    'Lightweight JavaScript and TypeScript wrappers for ArcGIS REST APIs, for Node.js and browsers, without a map.',
  keywords: [
    'node',
    'nodejs',
    'server',
    'fetch',
    'request',
    'authentication',
    'api key',
    'oauth',
    'geocoding',
    'routing',
    'feature service',
    'portal',
    'places',
  ],
  languages: ['javascript', 'typescript'],
  homepage: `${D}/arcgis-rest-js/`,
  packages: REST_JS_PACKAGES.map((name, index) => npm(name, 'apache-2.0', index === 0)),
  repos: [
    { repo: 'Esri/arcgis-rest-js', role: 'source', license: 'apache-2.0', defaultBranch: 'main' },
    {
      repo: 'Esri/arcgis-rest-js-samples',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'main',
    },
  ],
  workspaceSignals: [npmSignal('@esri/arcgis-rest-request')],
  lines: [LATEST],
  sources: [
    gatsbySite(
      'guide',
      '/arcgis-rest-js/',
      609,
      { symbols: 'typedoc' },
      { title: 'Guide and API reference', kinds: ['guide', 'api'] },
    ),
    markdownRepo('samples', 'Samples', 'Esri/arcgis-rest-js-samples'),
  ],
  // The highest version is not always under `latest`: an `lts-*` tag can be ahead of it.
  oracles: [npmDistTags('@esri/arcgis-rest-request', 'latest,lts-*')],
  releaseNotes: { current: `${D}/arcgis-rest-js/release-notes/` },
  startHere: [
    { title: 'ArcGIS REST JS', ref: `${D}/arcgis-rest-js/` },
    { title: 'Release notes', ref: `${D}/arcgis-rest-js/release-notes/` },
  ],
  pitfalls: [
    'Each REST area is its own package (@esri/arcgis-rest-<area>); all of them need @esri/arcgis-rest-request.',
    'Version 4 moved authentication classes into arcgis-rest-request; older snippets import from arcgis-rest-auth.',
  ],
  related: ['rest-api', 'js-maps-sdk', 'developer-guide'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const experienceBuilder: Product = {
  id: 'experience-builder',
  name: 'ArcGIS Experience Builder (developer edition)',
  aliases: ['exb', 'jimu', 'experience builder', 'experience-builder-dev', 'jimu-core'],
  category: 'web',
  tier: 'developer',
  status: 'active',
  summary:
    'Developer edition of Experience Builder: custom widgets and themes in TypeScript and React on the jimu framework.',
  keywords: [
    'widget',
    'widgets',
    'custom widget',
    'theme',
    'react',
    'jimu-core',
    'jimu-arcgis',
    'jimu-ui',
    'low-code',
    'app builder',
    'data source',
    'message action',
  ],
  languages: ['typescript', 'react'],
  homepage: `${D}/experience-builder/`,
  // The jimu packages ship inside the developer edition download; they are not on npm.
  packages: [],
  repos: [
    {
      repo: 'Esri/arcgis-experience-builder-sdk-resources',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'master',
    },
  ],
  workspaceSignals: [
    { files: ['package.json', '**/manifest.json'], pattern: '"jimu-(?:core|arcgis|ui)"' },
  ],
  lines: [LATEST],
  sources: [
    gatsbySite(
      'guide',
      '/experience-builder/',
      578,
      { symbols: 'typedoc' },
      { title: 'Guide and jimu API reference', kinds: ['guide', 'api'] },
    ),
    markdownRepo(
      'resources',
      'Sample widgets, themes and the widget-development skill',
      'Esri/arcgis-experience-builder-sdk-resources',
      {
        include: [
          'widgets/**/README.md',
          'themes/**/README.md',
          'skills/arcgis-exb-widget-dev/**',
        ],
      },
    ),
  ],
  oracles: [
    {
      type: 'page-regex',
      options: {
        url: `${D}/experience-builder/guide/release-versions/`,
        // First cell of the first body row of the release table.
        pattern: '<tbody[^>]*>\\s*<tr[^>]*>\\s*<td[^>]*>(?:\\s*<[^>]+>)*\\s*(\\d+(?:\\.\\d+)+)',
        match: 'html',
      },
      provides: ['documented'],
    },
  ],
  compatibility: [
    { name: 'Release versions', url: `${D}/experience-builder/guide/release-versions/` },
  ],
  releaseNotes: {
    current: `${D}/experience-builder/guide/whats-new/`,
    pattern: `${D}/experience-builder/guide/{major}.{minor}/whats-new/`,
  },
  startHere: [
    { title: 'Experience Builder developer edition', ref: `${D}/experience-builder/` },
    { title: "What's new", ref: `${D}/experience-builder/guide/whats-new/` },
    { title: 'Release versions', ref: `${D}/experience-builder/guide/release-versions/` },
  ],
  pitfalls: [
    'Each developer edition release is tied to one JavaScript SDK, Calcite, Node and React version; see release versions.',
    'jimu-* packages are not on npm: they resolve only inside the developer edition client folder.',
    'A widget built with a newer developer edition may not load in an older ArcGIS Enterprise.',
  ],
  related: ['js-maps-sdk', 'calcite', 'experience-builder-help'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

/** An open-source mapping library documented together with ArcGIS services. */
function mappingLibrary(spec: {
  id: string;
  name: string;
  library: string;
  aliases: string[];
  base: string;
  pages: number;
  options?: GatsbyOptions;
  npmPackage?: string;
  repo?: { repo: string; defaultBranch: string };
  releaseNotes?: string;
}): Product {
  const hasApi = spec.options?.symbolsFromSlug !== undefined;
  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases,
    category: 'web',
    tier: 'developer',
    status: 'active',
    summary: `Guides and tutorials for using ${spec.library} with ArcGIS basemaps, data services and location services.`,
    keywords: [spec.library.toLowerCase(), 'open source', 'basemap', 'vector tiles', 'tutorial'],
    languages: ['javascript'],
    homepage: `${D}${spec.base}`,
    packages: spec.npmPackage === undefined ? [] : [npm(spec.npmPackage, 'apache-2.0', true)],
    repos:
      spec.repo === undefined
        ? []
        : [{ ...spec.repo, role: 'source' as const, license: 'apache-2.0' as const }],
    ...(spec.npmPackage === undefined ? {} : { workspaceSignals: [npmSignal(spec.npmPackage)] }),
    lines: [LATEST],
    sources: [
      gatsbySite(
        'guide',
        spec.base,
        spec.pages,
        spec.options,
        hasApi ? { title: 'Guide and API reference', kinds: ['guide', 'tutorial', 'api'] } : {},
      ),
    ],
    oracles: spec.npmPackage === undefined ? [] : [npmDistTags(spec.npmPackage)],
    ...(spec.releaseNotes === undefined
      ? {}
      : { releaseNotes: { current: `${D}${spec.releaseNotes}` } }),
    startHere: [{ title: spec.name, ref: `${D}${spec.base}` }],
    pitfalls: [
      'ArcGIS services need an access token (API key or OAuth); requests without one fail with 403 or 498.',
    ],
    related: ['js-maps-sdk', 'rest-api', 'developer-guide'],
    licenseTier: 'esri-website-terms',
    verifiedOn: VERIFIED_ON,
  };
}

const API_PAGE_SLUG = '^api-reference/([^/]+)/$';

const esriLeaflet = mappingLibrary({
  id: 'esri-leaflet',
  name: 'Esri Leaflet',
  library: 'Leaflet',
  aliases: ['leaflet', 'esri leaflet', 'l.esri'],
  base: '/esri-leaflet/',
  pages: 151,
  options: { symbolsFromSlug: API_PAGE_SLUG },
  npmPackage: 'esri-leaflet',
  repo: { repo: 'Esri/esri-leaflet', defaultBranch: 'master' },
});

const maplibreArcgis = mappingLibrary({
  id: 'maplibre-arcgis',
  name: 'MapLibre GL JS with ArcGIS',
  library: 'MapLibre GL JS',
  aliases: ['maplibre', 'maplibre-gl-js', '@esri/maplibre-arcgis', 'maplibre gl js'],
  base: '/maplibre-gl-js/',
  pages: 114,
  options: { symbolsFromSlug: API_PAGE_SLUG },
  npmPackage: '@esri/maplibre-arcgis',
  repo: { repo: 'Esri/maplibre-arcgis', defaultBranch: 'main' },
  releaseNotes: '/maplibre-gl-js/release-notes/',
});

const openlayersArcgis = mappingLibrary({
  id: 'openlayers-arcgis',
  name: 'OpenLayers with ArcGIS',
  library: 'OpenLayers',
  aliases: ['openlayers', 'ol'],
  base: '/openlayers/',
  pages: 53,
});

const cesiumArcgis = mappingLibrary({
  id: 'cesium-arcgis',
  name: 'CesiumJS with ArcGIS',
  library: 'CesiumJS',
  aliases: ['cesium', 'cesiumjs'],
  base: '/cesiumjs/',
  pages: 51,
});

const SPEC_OBJECT_SLUG = '^objects/([^/]+)/$';

/** The JSON specifications of web maps and web scenes share everything but their site. */
function jsonSpec(spec: {
  id: string;
  name: string;
  noun: string;
  aliases: string[];
  source: AnySourceDef;
  base: string;
}): Product {
  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases,
    category: 'web',
    tier: 'developer',
    status: 'active',
    summary: `JSON specification of the ${spec.noun}: every object, property and allowed value, by specification version.`,
    keywords: ['json', 'specification', 'schema', 'operational layers', 'basemap', 'item data'],
    languages: ['json'],
    homepage: `${D}${spec.base}`,
    packages: [],
    repos: [],
    lines: [LATEST],
    sources: [spec.source],
    // The specification version follows the JavaScript SDK release; it has no oracle of its own.
    oracles: [],
    compatibility: [{ name: 'JavaScript SDK version matrix', url: `${D}${JS}version-matrix/` }],
    startHere: [{ title: spec.name, ref: `${D}${spec.base}` }],
    pitfalls: [
      'Object pages are named after the JSON object (objects/<name>/); property names are case-sensitive.',
    ],
    related: ['js-maps-sdk', 'rest-api'],
    licenseTier: 'esri-website-terms',
    verifiedOn: VERIFIED_ON,
  };
}

const webMapSpec = jsonSpec({
  id: 'web-map-spec',
  name: 'Web map specification',
  noun: 'ArcGIS web map',
  aliases: ['web map specification', 'webmap spec', 'web-map-specification', 'webmap json'],
  base: '/web-map-specification/',
  source: {
    id: 'spec',
    title: 'Specification',
    kinds: ['spec', 'api'],
    adapter: 'astro',
    config: {
      base: '/web-map-specification/',
      sitemap: 'sitemap-0.xml',
      symbolsFromSlug: SPEC_OBJECT_SLUG,
    },
    capability: 'website',
    floor: true,
    pagesApprox: 319,
    probe: {
      url: `${D}/web-map-specification/sitemap-0.xml`,
      expect: 'xml',
      minRecords: 159,
      family: 'astro',
    },
  },
});

const webSceneSpec = jsonSpec({
  id: 'web-scene-spec',
  name: 'Web scene specification',
  noun: 'ArcGIS web scene',
  aliases: [
    'web scene specification',
    'webscene spec',
    'web-scene-specification',
    'webscene json',
  ],
  base: '/web-scene-specification/',
  source: gatsbySite(
    'spec',
    '/web-scene-specification/',
    311,
    { bodyFrom: 'childMarkdownRemark', symbolsFromSlug: SPEC_OBJECT_SLUG },
    { title: 'Specification', kinds: ['spec', 'api'] },
  ),
});

/** The eleven web products of design section 4.1. */
export const webProducts: readonly Product[] = [
  jsMapsSdk,
  calcite,
  arcade,
  restJs,
  experienceBuilder,
  esriLeaflet,
  maplibreArcgis,
  openlayersArcgis,
  cesiumArcgis,
  webMapSpec,
  webSceneSpec,
];
