import { describe, expect, it } from 'vitest';
import { classifyUrl, matchUrlFilter } from '../../src/core/adapter-helpers.js';
import { sourceRootUrl } from '../../src/core/source-urls.js';
import type { AnySourceDef, DocKind, Product } from '../../src/core/types.js';
import { desktopEnterpriseProducts } from '../../src/registry/data/desktop-enterprise.js';
import { nativeProducts } from '../../src/registry/data/native.js';
import { pythonProducts } from '../../src/registry/data/python.js';
import { webProducts } from '../../src/registry/data/web.js';

/**
 * The registry content of design sections 4.1 to 4.4: every product, source, adapter and
 * floor flag, written as compact rows so that a diff against the design is readable.
 */

const D = 'https://developers.arcgis.com';
const ALL = [...webProducts, ...nativeProducts, ...pythonProducts, ...desktopEnterpriseProducts];

function product(id: string): Product {
  const found = ALL.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no product ${id}`);
  return found;
}

function source(productId: string, sourceId: string): AnySourceDef {
  const found = product(productId).sources.find((candidate) => candidate.id === sourceId);
  if (found === undefined) throw new Error(`no source ${productId}/${sourceId}`);
  return found;
}

/** `id: adapter` per source, `*` marking the floor, as the design tables write them. */
function shape(target: Product): string {
  return target.sources
    .map((entry) => `${entry.id}${entry.floor === true ? '*' : ''}:${entry.adapter}`)
    .join(' ');
}

/** `[id, category, status, sources]`. */
const PRODUCTS: Array<[string, Product['category'], Product['status'], string]> = [
  [
    'js-maps-sdk',
    'web',
    'active',
    'guide*:astro samples:astro core:astro components:npm-cem typings:npm-dts templates:github-repo',
  ],
  ['calcite', 'web', 'active', 'guide*:gatsby components:npm-cem'],
  [
    'arcade',
    'web',
    'active',
    'guide*:gatsby functions:npm-json profiles:npm-json expressions:github-repo',
  ],
  ['rest-js', 'web', 'active', 'guide*:gatsby samples:github-repo'],
  ['experience-builder', 'web', 'active', 'guide*:gatsby resources:github-repo'],
  ['esri-leaflet', 'web', 'active', 'guide*:gatsby'],
  ['maplibre-arcgis', 'web', 'active', 'guide*:gatsby'],
  ['openlayers-arcgis', 'web', 'active', 'guide*:gatsby'],
  ['cesium-arcgis', 'web', 'active', 'guide*:gatsby'],
  ['web-map-spec', 'web', 'active', 'spec*:astro'],
  ['web-scene-spec', 'web', 'active', 'spec*:gatsby'],
  [
    'swift-maps-sdk',
    'native',
    'active',
    'guide*:astro api:docc toolkit-api:docc samples:github-repo',
  ],
  [
    'kotlin-maps-sdk',
    'native',
    'active',
    'guide*:astro api:dokka toolkit-api:dokka samples:github-repo',
  ],
  [
    'dotnet-maps-sdk',
    'native',
    'active',
    'guide*:astro api:docfx-net toolkit-api:docfx-net samples:github-repo',
  ],
  ['qt-maps-sdk', 'native', 'active', 'guide*:astro samples:github-repo'],
  [
    'flutter-maps-sdk',
    'native',
    'active',
    'guide*:astro api:dartdoc toolkit-api:dartdoc samples:github-repo',
  ],
  ['java-maps-sdk', 'native', 'deprecated', 'guide*:astro api:javadoc samples:github-repo'],
  ['unity-maps-sdk', 'game-engine', 'active', 'guide*:gatsby samples:github-repo'],
  ['unreal-maps-sdk', 'game-engine', 'active', 'guide*:gatsby samples:github-repo'],
  // In mature support until 2027: not retired, whatever the word "tombstone" suggests.
  ['runtime-100', 'native', 'deprecated', 'card*:static'],
  ['python-api', 'python', 'active', 'guide*:gatsby api:gatsby samples:github-repo'],
  [
    'arcpy',
    'python',
    'active',
    'arcpy*:docfx-esri tools:docfx-esri legacy:legacy-help legacy-tools:legacy-help legacy-tools-extensions:legacy-help',
  ],
  ['geoanalytics-engine', 'python', 'active', 'guide*:gatsby api:sphinx samples:github-repo'],
  ['geoanalytics-fabric', 'python', 'active', 'guide*:gatsby api:sphinx samples:github-repo'],
  ['r-arcgis', 'python', 'active', 'guide*:gatsby packages:pkgdown'],
  [
    'arcgis-pro-sdk',
    'desktop-enterprise',
    'active',
    'wiki*:github-repo api:xmldoc samples:github-repo snippets:github-repo',
  ],
  [
    'enterprise-sdk',
    'desktop-enterprise',
    'active',
    'guide*:gatsby java-api:javadoc samples:github-repo',
  ],
  [
    'cityengine',
    'desktop-enterprise',
    'active',
    'help*:legacy-help sdk:static examples:github-repo pyprt-examples:github-repo',
  ],
  ['earth-automation-api', 'desktop-enterprise', 'active', 'api*:legacy-help'],
  ['autocad-api', 'desktop-enterprise', 'active', 'api*:legacy-help'],
  ['geoevent-server', 'desktop-enterprise', 'deprecated', 'help*:legacy-help'],
];

/** `[product, source, base as written in the registry]`. */
const BASES: Array<[string, string, string]> = [
  ['js-maps-sdk', 'guide', '/javascript/latest/'],
  ['js-maps-sdk', 'samples', '/javascript/latest/'],
  ['js-maps-sdk', 'core', '/javascript/latest/'],
  ['calcite', 'guide', '/calcite-design-system/'],
  ['arcade', 'guide', '/arcade/'],
  ['rest-js', 'guide', '/arcgis-rest-js/'],
  ['experience-builder', 'guide', '/experience-builder/'],
  ['esri-leaflet', 'guide', '/esri-leaflet/'],
  ['maplibre-arcgis', 'guide', '/maplibre-gl-js/'],
  ['openlayers-arcgis', 'guide', '/openlayers/'],
  ['cesium-arcgis', 'guide', '/cesiumjs/'],
  ['web-map-spec', 'spec', '/web-map-specification/'],
  ['web-scene-spec', 'spec', '/web-scene-specification/'],
  ['swift-maps-sdk', 'guide', '/swift/{prefix}'],
  ['swift-maps-sdk', 'api', '/swift/{prefix}api-reference/'],
  ['swift-maps-sdk', 'toolkit-api', '/swift/{prefix}toolkit-api-reference/'],
  ['kotlin-maps-sdk', 'guide', '/kotlin/{prefix}'],
  ['kotlin-maps-sdk', 'api', '/kotlin/{prefix}api-reference/'],
  ['kotlin-maps-sdk', 'toolkit-api', '/kotlin/{prefix}toolkit-api-reference/'],
  ['dotnet-maps-sdk', 'guide', '/net/{prefix}'],
  ['dotnet-maps-sdk', 'api', '/net/{prefix}api-reference/'],
  ['dotnet-maps-sdk', 'toolkit-api', 'https://esri.github.io/arcgis-maps-sdk-dotnet-toolkit/'],
  ['qt-maps-sdk', 'guide', '/qt/{prefix}'],
  ['flutter-maps-sdk', 'guide', '/flutter/{prefix}'],
  ['flutter-maps-sdk', 'api', '/flutter/{prefix}api-reference/reference/'],
  ['flutter-maps-sdk', 'toolkit-api', '/flutter/{prefix}toolkit-api-reference/'],
  ['java-maps-sdk', 'guide', '/java/{prefix}'],
  ['java-maps-sdk', 'api', '/java/v200/api-reference/reference/'],
  ['unity-maps-sdk', 'guide', '/unity/'],
  ['unreal-maps-sdk', 'guide', '/unreal-engine/'],
  ['python-api', 'guide', '{base}'],
  ['python-api', 'api', '{base}api-reference/'],
  ['geoanalytics-engine', 'guide', '/geoanalytics/'],
  ['geoanalytics-engine', 'api', '/geoanalytics/api-reference/'],
  ['geoanalytics-fabric', 'guide', '/geoanalytics-fabric/'],
  ['geoanalytics-fabric', 'api', '/geoanalytics-fabric/api-reference/'],
  ['r-arcgis', 'guide', '/r-bridge/'],
  ['enterprise-sdk', 'guide', '/enterprise-sdk/'],
  ['enterprise-sdk', 'java-api', '/enterprise-sdk/api-reference/java/'],
  ['cityengine', 'help', '/en/cityengine/latest/'],
  ['earth-automation-api', 'api', '/en/arcgis-earth/'],
  ['autocad-api', 'api', '/en/arcgis-for-autocad/latest/'],
  ['geoevent-server', 'help', '/en/geoevent/latest/'],
];

/** `[product, source, repository, preset]`. */
const REPOSITORIES: Array<[string, string, string, string]> = [
  ['js-maps-sdk', 'templates', 'Esri/jsapi-resources', 'markdown-docs'],
  ['arcade', 'expressions', 'Esri/arcade-expressions', 'markdown-docs'],
  ['rest-js', 'samples', 'Esri/arcgis-rest-js-samples', 'markdown-docs'],
  [
    'experience-builder',
    'resources',
    'Esri/arcgis-experience-builder-sdk-resources',
    'markdown-docs',
  ],
  ['swift-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-swift-samples', 'samples-metadata'],
  ['kotlin-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-kotlin-samples', 'samples-metadata'],
  ['dotnet-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-dotnet-samples', 'samples-metadata'],
  ['qt-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-samples-qt', 'samples-metadata'],
  ['flutter-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-flutter-samples', 'samples-metadata'],
  ['java-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-java-samples', 'samples-metadata'],
  ['unity-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-unity-samples', 'samples-readme'],
  // An Unreal Engine sample is a README next to Blueprint assets, which are not code files:
  // `samples-readme` found none of them. A few carry a metadata file, and the sibling rule
  // of `samples-metadata` then finds every sample directory.
  ['unreal-maps-sdk', 'samples', 'Esri/arcgis-maps-sdk-unreal-engine-samples', 'samples-metadata'],
  ['python-api', 'samples', 'Esri/arcgis-python-api', 'notebooks'],
  ['geoanalytics-engine', 'samples', 'Esri/geoanalytics-engine-samples', 'notebooks'],
  ['geoanalytics-fabric', 'samples', 'Esri/geoanalytics-fabric-samples', 'notebooks'],
  ['arcgis-pro-sdk', 'wiki', 'Esri/arcgis-pro-sdk', 'wiki'],
  ['arcgis-pro-sdk', 'samples', 'Esri/arcgis-pro-sdk-community-samples', 'samples-readme'],
  ['arcgis-pro-sdk', 'snippets', 'Esri/arcgis-pro-sdk-snippets', 'snippets-region'],
  ['enterprise-sdk', 'samples', 'Esri/arcgis-enterprise-sdk-resources', 'markdown-docs'],
  ['cityengine', 'examples', 'Esri/cityengine-sdk', 'markdown-docs'],
  ['cityengine', 'pyprt-examples', 'Esri/pyprt-examples', 'notebooks'],
];

/** `[product, oracle types in order]`. */
const ORACLES: Array<[string, string[]]> = [
  ['js-maps-sdk', ['npm-dist-tags', 'page-regex', 'plc']],
  ['calcite', ['npm-dist-tags', 'page-regex', 'plc']],
  ['arcade', ['page-regex']],
  ['rest-js', ['npm-dist-tags']],
  ['experience-builder', ['page-regex']],
  // The core package and its two plug-ins, which have version numbers of their own.
  ['esri-leaflet', ['npm-dist-tags', 'npm-dist-tags', 'npm-dist-tags']],
  ['maplibre-arcgis', ['npm-dist-tags']],
  ['openlayers-arcgis', []],
  ['cesium-arcgis', []],
  ['swift-maps-sdk', ['github-release', 'page-regex', 'plc']],
  ['kotlin-maps-sdk', ['page-regex', 'github-release', 'plc']],
  ['dotnet-maps-sdk', ['page-regex', 'nuget-flat', 'plc']],
  ['qt-maps-sdk', ['page-regex', 'plc']],
  ['flutter-maps-sdk', ['pub-dev', 'page-regex', 'plc']],
  ['java-maps-sdk', ['static', 'page-regex']],
  ['unity-maps-sdk', ['page-regex', 'plc']],
  ['unreal-maps-sdk', ['page-regex', 'plc']],
  ['runtime-100', ['static']],
  ['python-api', ['pypi', 'page-regex', 'github-release', 'plc']],
  ['arcpy', ['docesri-sitemap']],
  ['geoanalytics-engine', ['page-regex']],
  ['geoanalytics-fabric', []],
  ['r-arcgis', []],
  ['arcgis-pro-sdk', ['github-release', 'docesri-sitemap']],
  ['enterprise-sdk', ['page-regex']],
  ['cityengine', []],
  ['geoevent-server', ['static']],
];

describe('registry data of design sections 4.1 to 4.4', () => {
  it('holds the 31 products in the order of the design', () => {
    expect(ALL.map((entry) => entry.id)).toEqual(PRODUCTS.map(([id]) => id));
    expect(webProducts).toHaveLength(11);
    expect(nativeProducts).toHaveLength(9);
    expect(pythonProducts).toHaveLength(5);
    expect(desktopEnterpriseProducts).toHaveLength(6);
  });

  it.each(PRODUCTS)('%s: category %s, status %s, sources', (id, category, status, sources) => {
    const target = product(id);
    expect({ category: target.category, status: target.status, tier: target.tier }).toEqual({
      category,
      status,
      tier: 'developer',
    });
    expect(shape(target)).toBe(sources);
  });

  it.each(BASES)('%s/%s is based at %s', (productId, sourceId, base) => {
    const config = source(productId, sourceId).config as { base?: string };
    expect(config.base).toBe(base);
  });

  it.each(REPOSITORIES)('%s/%s reads %s with preset %s', (productId, sourceId, repo, preset) => {
    const entry = source(productId, sourceId);
    expect(entry.adapter).toBe('github-repo');
    expect(entry.config).toMatchObject({ repo, preset });
    expect(entry.capability).toBe('github');
    // Every source repository is also listed among the product's repositories.
    expect(product(productId).repos.map((ref) => ref.repo)).toContain(repo);
  });

  // Regression: the sitemap of a native SDK lists the `.htm` addresses of the Runtime
  // documentation and a `-heading/` page per navigation group. All are redirect stubs; for
  // .NET they were almost half of the guide records.
  it.each(['swift', 'kotlin', 'dotnet', 'qt', 'flutter', 'java'])(
    '%s-maps-sdk/guide leaves the redirect stubs of its sitemap out',
    (sdk) => {
      const { config } = source(`${sdk}-maps-sdk`, 'guide');
      const kept = (path: string) => matchUrlFilter(path, config as { exclude?: string[] });
      expect(kept('android/latest/sample-code/display-map.htm')).toBe(false);
      expect(kept('device-location-heading/')).toBe(false);
      expect(kept('device-location/')).toBe(true);
      expect(kept('sample-code/display-map/')).toBe(true);
      expect(kept('api-reference/html/class.html')).toBe(true);
      // Tutorials sit under their topic, not under one tutorials/ directory.
      const filter = config as { classify?: Array<[string, DocKind]> };
      expect(classifyUrl('layers/tutorials/add-a-feature-layer/', filter)).toBe('tutorial');
      expect(classifyUrl('layers/feature-layers/', filter)).toBe('guide');
    },
  );

  it.each(ORACLES)('%s asks the oracles %j', (id, types) => {
    expect(product(id).oracles.map((oracle) => oracle.type)).toEqual(types);
  });

  // Regression: the life cycle oracle existed but no product declared it, so switching the
  // capability `lifecycle-api` on changed nothing. The service lists a product by its name.
  it('asks the life cycle service by category for the products it lists by name', () => {
    const asked = ALL.filter((entry) => entry.oracles.some((oracle) => oracle.type === 'plc'));
    expect(asked.map((entry) => entry.name).sort()).toEqual([
      'ArcGIS API for Python',
      'ArcGIS Maps SDK for .NET',
      'ArcGIS Maps SDK for Flutter',
      'ArcGIS Maps SDK for JavaScript',
      'ArcGIS Maps SDK for Kotlin',
      'ArcGIS Maps SDK for Qt',
      'ArcGIS Maps SDK for Swift',
      'ArcGIS Maps SDK for Unity',
      'ArcGIS Maps SDK for Unreal Engine',
      'Calcite Design System',
    ]);
    for (const entry of asked) {
      const oracle = entry.oracles.find((candidate) => candidate.type === 'plc');
      expect(oracle).toMatchObject({ options: { category: 'Developer' }, provides: ['lifecycle'] });
    }
  });

  it('gives every source the capability of its adapter class', () => {
    const expected: Partial<Record<AnySourceDef['adapter'], string>> = {
      'npm-cem': 'package-cdn',
      'npm-dts': 'package-cdn',
      'npm-json': 'package-cdn',
      'github-repo': 'github',
      xmldoc: 'github',
    };
    for (const target of ALL) {
      for (const entry of target.sources) {
        expect(entry.capability, `${target.id}/${entry.id}`).toBe(
          expected[entry.adapter] ?? 'website',
        );
      }
    }
  });

  it('marks Esri package content as esri-ma and sample repositories as apache-2.0', () => {
    for (const target of ALL) {
      for (const entry of target.sources) {
        if (entry.capability === 'package-cdn') expect(entry.license).toBe('esri-ma');
        if (entry.adapter === 'github-repo') expect(entry.license).toBe('apache-2.0');
      }
    }
    expect(source('r-arcgis', 'packages').license).toBe('unlicensed');
    expect(product('calcite').repos[0]).toMatchObject({ license: 'esri-ma', defaultBranch: 'dev' });
  });

  it('sets probe floors to half of the counted records', () => {
    expect(source('js-maps-sdk', 'guide').probe.minRecords).toBe(2366);
    expect(source('js-maps-sdk', 'core').probe.minRecords).toBe(11908);
    expect(source('calcite', 'guide').probe.minRecords).toBe(90);
    expect(source('kotlin-maps-sdk', 'api').probe.minRecords).toBe(4473);
    expect(source('dotnet-maps-sdk', 'api').probe.minRecords).toBe(7525);
    expect(source('flutter-maps-sdk', 'api').probe.minRecords).toBe(3372);
    expect(source('enterprise-sdk', 'guide').probe.minRecords).toBe(1987);
    expect(source('python-api', 'guide').probe.minRecords).toBe(240);
  });
});

describe('JavaScript SDK', () => {
  const js = product('js-maps-sdk');

  it('carries the aliases and packages of the design', () => {
    expect(js.aliases).toEqual(
      expect.arrayContaining([
        'javascript',
        'js',
        'jsapi',
        '@arcgis/core',
        '@arcgis/map-components',
        'ai-components',
        'arcgis-assistant',
        'arcgis maps sdk for javascript',
      ]),
    );
    expect(js.packages.map((pkg) => pkg.name)).toEqual([
      '@arcgis/core',
      '@arcgis/map-components',
      '@arcgis/charts-components',
      '@arcgis/ai-components',
      '@arcgis/coding-components',
      '@arcgis/common-components',
    ]);
    expect(js.packages.filter((pkg) => pkg.primary)).toHaveLength(1);
  });

  it('splits one site into guide, samples and reference by filters', () => {
    const guide = source('js-maps-sdk', 'guide');
    const samples = source('js-maps-sdk', 'samples');
    const core = source('js-maps-sdk', 'core');
    if (guide.adapter !== 'astro' || samples.adapter !== 'astro' || core.adapter !== 'astro') {
      throw new Error('expected three astro sources');
    }
    const owners = (path: string) =>
      [guide, samples, core].filter((entry) => matchUrlFilter(path, entry.config)).map((e) => e.id);
    expect(owners('layers/')).toEqual(['guide']);
    expect(owners('tutorials/some/')).toEqual(['guide']);
    expect(owners('sample-code/some/')).toEqual(['samples']);
    expect(owners('references/core/Map/')).toEqual(['core']);
    expect(owners('sample-code/some/live/')).toEqual(['samples']);
    expect(owners('demo-apps/some/')).toEqual([]);
    expect(owners('4.10/')).toEqual([]);
    // Dotted version pages are redirect stubs; the notes of a release are at v<major>-<minor>/.
    expect(owners('release-notes/4.9/')).toEqual([]);
    expect(owners('release-notes/')).toEqual(['guide']);
    expect(owners('v5-0/')).toEqual(['guide']);
    expect(classifyUrl('v5-0/', guide.config)).toBe('release-notes');
    expect(classifyUrl('vector-tiles-v2-0/', guide.config)).toBe('guide');
    expect(guide.config.classify).toEqual([
      ['^tutorials/', 'tutorial'],
      ['^release-notes', 'release-notes'],
      ['^v\\d+-\\d+/$', 'release-notes'],
    ]);
    expect(guide.config.searchIndexes).toEqual([{ url: 'guide-topic-search.json', role: 'guide' }]);
    expect(core.config.searchIndexes).toEqual([{ url: 'references-search.json', role: 'api' }]);
    expect(samples.config.sampleIndexPage).toBe('sample-code/');
  });

  it('documents the current line and links every other npm version', () => {
    expect(js.lines.map((line) => [line.id, line.current, line.access])).toEqual([
      ['latest', true, 'live'],
      ['npm-any-version', false, 'link-only'],
    ]);
    expect(source('js-maps-sdk', 'typings').config).toEqual({
      package: '@arcgis/core',
      docUrl: '/javascript/latest/references/core/{path}/',
    });
    expect(source('js-maps-sdk', 'core').fallbacks).toEqual(['typings']);
  });
});

describe('native SDKs', () => {
  const CURRENT = [
    'swift-maps-sdk',
    'kotlin-maps-sdk',
    'dotnet-maps-sdk',
    'qt-maps-sdk',
    'flutter-maps-sdk',
  ];

  it.each(CURRENT)('%s has the lines latest and v200', (id) => {
    expect(product(id).lines).toEqual([
      { id: 'latest', label: '300.x', current: true, access: 'live', vars: { prefix: '' } },
      { id: 'v200', label: '200.x LTS', current: false, access: 'live', vars: { prefix: 'v200/' } },
    ]);
  });

  it('resolves the guide root of each line', () => {
    const kotlin = product('kotlin-maps-sdk');
    const guide = source('kotlin-maps-sdk', 'guide');
    expect(kotlin.lines.map((line) => sourceRootUrl(guide, line))).toEqual([
      `${D}/kotlin/`,
      `${D}/kotlin/v200/`,
    ]);
  });

  it('uses the search indexes of each site', () => {
    const indexes = (id: string) => {
      const guide = source(id, 'guide');
      return guide.adapter === 'astro' ? (guide.config.searchIndexes ?? []).map((i) => i.url) : [];
    };
    expect(indexes('swift-maps-sdk')).toEqual([
      '__starship-mdx/search/mdxPages.json',
      'sample-code-search.json',
    ]);
    expect(indexes('dotnet-maps-sdk')).toEqual([
      '__starship-mdx/search/mdxPages.json',
      'sample-code-wpf-search.json',
      'sample-code-maui-search.json',
      'sample-code-winui-search.json',
    ]);
    expect(indexes('qt-maps-sdk')).toEqual([
      '__starship-mdx/search/mdxPages.json',
      'sample-code-search.json',
      'cpp/api-reference/search.json',
      'toolkit/api-reference/search.json',
    ]);
  });

  it('pins samples to release tags only where the repository tags releases', () => {
    const pin = (id: string) => (source(id, 'samples').config as { pin?: string }).pin;
    expect(CURRENT.map(pin)).toEqual([
      'release-tag',
      'release-tag',
      'release-tag',
      'branch',
      'branch',
    ]);
    expect(source('swift-maps-sdk', 'samples').config).toMatchObject({ tagTemplate: 'v{version}' });
    expect(['java-maps-sdk', 'unity-maps-sdk', 'unreal-maps-sdk'].map(pin)).toEqual([
      'branch',
      'branch',
      'branch',
    ]);
  });

  it('keeps Java on its final line with Kotlin as successor', () => {
    const java = product('java-maps-sdk');
    expect(java.successor).toBe('kotlin-maps-sdk');
    expect(java.lines).toHaveLength(1);
    expect(java.lines[0]).toMatchObject({ id: 'v200', current: true, vars: { prefix: 'v200/' } });
    expect(java.oracles[0]?.options).toMatchObject({ version: '200.6' });
  });

  it('describes Runtime 100.x as a card that points to the migration guide of every platform', () => {
    const runtime = product('runtime-100');
    expect(runtime.homepage).toBe('https://archive.developers.arcgis.com/');
    const card = source('runtime-100', 'card');
    if (card.adapter !== 'static') throw new Error('expected a static source');
    const guides = ['swift', 'kotlin', 'net', 'qt'].map(
      (slug) => `${D}/${slug}/reference/migrate-from-100-x-to-200-x/`,
    );
    expect(card.config.entries.map((entry) => entry.url)).toEqual(guides);
    expect(runtime.oracles[0]?.options).toMatchObject({ retirement: '2027-09-01' });
    // Regression: "retired" next to a retirement date a year ahead, and Kotlin named as the
    // one successor of an SDK family that also covers iOS, .NET, Qt and Java.
    expect(runtime.status).toBe('deprecated');
    expect(runtime.successor).toBeUndefined();
    for (const id of ['swift-maps-sdk', 'kotlin-maps-sdk', 'dotnet-maps-sdk', 'qt-maps-sdk']) {
      expect(runtime.statusNote, id).toContain(id);
      expect(runtime.related, id).toContain(id);
    }
    expect(runtime.startHere.map((link) => link.ref)).toEqual(guides);
  });

  // Regression: the samples source of the Unreal Engine SDK listed nothing, because its
  // preset looked for code files next to each README and Blueprint samples have none.
  it('reads the Unreal Engine samples with the preset that finds README-only samples', () => {
    const preset = (id: string): string => {
      const samples = source(id, 'samples');
      return samples.adapter === 'github-repo' ? samples.config.preset : '';
    };
    expect(preset('unreal-maps-sdk')).toBe('samples-metadata');
    expect(preset('unity-maps-sdk')).toBe('samples-readme');
    expect(source('unreal-maps-sdk', 'samples').pagesApprox).toBe(17);
  });
});

describe('Python and desktop products', () => {
  it('addresses the two Python documentation lines through a base variable', () => {
    const python = product('python-api');
    expect(python.lines.map((line) => [line.id, line.vars.base])).toEqual([
      ['latest', '/python/latest/'],
      ['2.3', '/python-2-3/'],
    ]);
    const api = source('python-api', 'api');
    expect(python.lines.map((line) => sourceRootUrl(api, line))).toEqual([
      `${D}/python/latest/api-reference/`,
      `${D}/python-2-3/api-reference/`,
    ]);
    expect(api.config).toMatchObject({ symbols: 'sphinx-pagination', bodyFrom: 'sphinxJson' });
  });

  it('reads ArcPy and the tool reference from the Pro documentation, older lines on demand', () => {
    expect(source('arcpy', 'arcpy').config).toEqual({
      slug: 'arcgis-pro',
      scope: 'arcpy/',
      toc: 'arcpy/toc.json',
      symbols: 'toc',
    });
    expect(source('arcpy', 'tools').config).toMatchObject({
      scope: 'tool-reference/',
      toc: 'tool-reference/toc.json',
      gpParameters: true,
    });
    const older = ['3.4', '3.3', '3.2', '3.1', '3.0', '2.9', '2.8', '2.7', '2.6'];
    expect(product('arcpy').lines.map((line) => [line.id, line.access])).toEqual([
      ['latest', 'live'],
      ['3.6', 'live'],
      ['3.5', 'live'],
      ...older.map((id) => [id, 'link-only']),
    ]);
    for (const id of ['legacy', 'legacy-tools', 'legacy-tools-extensions']) {
      const legacy = source('arcpy', id);
      // A developer reference, on every numbered line, fetched for the two newest only.
      expect(legacy.kinds, id).toEqual(['api', 'guide']);
      expect(legacy.lines, id).toEqual(['3.6', '3.5', ...older]);
      expect(legacy.config, id).toMatchObject({
        host: 'pro.arcgis.com',
        base: '/en/pro-app/{line}/',
        lines: ['3.6', '3.5'],
        enumerate: 'on-demand',
      });
    }
  });

  it('names real books of the earlier Pro releases, each with its table-of-contents script', () => {
    const books = (id: string): Array<{ path: string; tocScript?: string }> => {
      const legacy = source('arcpy', id);
      return legacy.adapter === 'legacy-help' ? legacy.config.books : [];
    };
    // The section itself is listed through its `main` book; `arcpy/` publishes no listing.
    expect(books('legacy')[0]).toEqual({
      path: 'arcpy',
      tocScript: '/en/pro-app/{line}/arcpy/main/1520.js',
    });
    expect(books('legacy')).toContainEqual({
      path: 'arcpy/functions',
      tocScript: '/en/pro-app/{line}/arcpy/functions/577.js',
    });
    expect(books('legacy-tools')[0]?.path).toBe('tool-reference');
    expect(books('legacy-tools').map((book) => book.path)).toContain('tool-reference/analysis');
    expect(books('legacy-tools-extensions').map((book) => book.path)).toContain(
      'tool-reference/spatial-analyst',
    );
    for (const id of ['legacy', 'legacy-tools', 'legacy-tools-extensions']) {
      // One request per book, inside the 30 requests of an index build.
      expect(books(id).length, id).toBeLessThanOrEqual(27);
      for (const book of books(id)) expect(book.tocScript, book.path).toMatch(/\/\d+\.js$/);
      // The canary is a link list of a real book, so `doctor` fails when listing cannot work.
      expect(source('arcpy', id).probe.url, id).toMatch(
        /\/pro-app\/3\.6\/(?:arcpy|tool-reference)\/[a-z0-9-]+\/flisting\.htm$/,
      );
    }
  });

  it('lists the nine R package sites', () => {
    expect(source('r-arcgis', 'packages').config).toEqual({
      host: 'r.esri.com',
      packages: [
        'arcgis',
        'arcgislayers',
        'arcgisutils',
        'arcgisgeocode',
        'arcgisplaces',
        'arcgisrouting',
        'arcpbf',
        'calcite',
        'arcgisviz',
      ],
    });
  });

  it('reads the Pro SDK from its repositories', () => {
    expect(source('arcgis-pro-sdk', 'api').config).toEqual({
      repo: 'Esri/arcgis-pro-sdk',
      dir: 'References/ArcGIS Pro API',
      docUrlHost: 'doc.esri.com',
    });
    expect(product('arcgis-pro-sdk').aliases).toEqual(
      expect.arrayContaining(['pro-sdk', 'arcgis.desktop', 'arcgis.core']),
    );
  });

  it('lists the help books with their table-of-contents scripts', () => {
    const books = (productId: string, sourceId: string) => {
      const entry = source(productId, sourceId);
      return entry.adapter === 'legacy-help' ? entry.config.books : [];
    };
    expect(books('cityengine', 'help').map((book) => book.path)).toEqual([
      'cga',
      'get-started',
      'help',
      'install/linux',
      'install/windows',
      'python',
      'tutorials',
      'whats-new',
    ]);
    expect(books('cityengine', 'help')[0]?.tocScript).toBe('/en/cityengine/2026.0/cga/1787.js');
    expect(books('geoevent-server', 'help')).toHaveLength(8);
    expect(books('geoevent-server', 'help')[0]?.tocScript).toBe(
      '/en/geoevent/12.1/administer/1334.js',
    );
    expect(books('earth-automation-api', 'api')).toEqual([
      { path: 'automation-api', tocScript: '/en/arcgis-earth/automation-api/2108.js' },
    ]);
    expect(books('autocad-api', 'api')).toEqual([
      { path: 'commands-api', tocScript: '/en/arcgis-for-autocad/latest/commands-api/3085.js' },
    ]);
  });

  it('marks GeoEvent Server as deprecated in favour of Velocity', () => {
    expect(product('geoevent-server')).toMatchObject({
      status: 'deprecated',
      successor: 'arcgis-velocity',
    });
    expect(product('geoevent-server').statusNote).toMatch(/ship with the product/);
  });
});

// Regression: `arcgis_docs_find_samples` selects sources by their declared kinds. The sample
// pages of Esri Leaflet (61), Calcite (14) and Experience Builder (49) were indexed with
// kind `sample` by sources that did not declare it, so the tool said "no sample source".
describe('declared kinds of the guide sites', () => {
  /** `[product, source, kinds]`: the sections each site has, by its sitemap on 2026-10-14. */
  const KINDS: Array<[string, string, string[]]> = [
    ['calcite', 'guide', ['guide', 'tutorial', 'sample', 'release-notes']],
    ['arcade', 'guide', ['guide', 'release-notes']],
    ['rest-js', 'guide', ['guide', 'tutorial', 'api', 'release-notes']],
    ['experience-builder', 'guide', ['guide', 'tutorial', 'sample', 'api', 'release-notes']],
    ['esri-leaflet', 'guide', ['guide', 'tutorial', 'sample', 'api']],
    ['maplibre-arcgis', 'guide', ['guide', 'tutorial', 'api', 'release-notes']],
    ['openlayers-arcgis', 'guide', ['guide', 'tutorial']],
    ['cesium-arcgis', 'guide', ['guide', 'tutorial']],
    ['unity-maps-sdk', 'guide', ['guide', 'tutorial', 'sample', 'api', 'release-notes']],
    ['unreal-maps-sdk', 'guide', ['guide', 'tutorial', 'sample', 'api', 'release-notes']],
    ['python-api', 'guide', ['guide', 'tutorial', 'sample', 'release-notes']],
    ['geoanalytics-engine', 'guide', ['guide', 'tutorial', 'release-notes']],
    ['geoanalytics-fabric', 'guide', ['guide', 'tutorial', 'release-notes']],
    ['r-arcgis', 'guide', ['guide', 'release-notes']],
    ['enterprise-sdk', 'guide', ['guide', 'api', 'release-notes']],
  ];

  it.each(KINDS)('%s/%s declares %j', (productId, sourceId, kinds) => {
    expect(source(productId, sourceId).kinds).toEqual(kinds);
  });

  it('gives a sample source to every product whose site has a samples section', () => {
    for (const id of ['esri-leaflet', 'calcite', 'experience-builder']) {
      expect(
        product(id).sources.some((candidate) => candidate.kinds.includes('sample')),
        id,
      ).toBe(true);
    }
  });

  it('keeps the first kind, which is what a page without a section is, a guide', () => {
    for (const [productId, sourceId] of KINDS) {
      expect(source(productId, sourceId).kinds[0], productId).toBe('guide');
    }
  });
});

describe('Esri Leaflet and Experience Builder', () => {
  // Regression: the plug-ins most samples need were unknown products without a version.
  it('lists the Esri Leaflet plug-ins as packages, each with its own version oracle', () => {
    const leaflet = product('esri-leaflet');
    expect(leaflet.packages.map((ref) => [ref.name, ref.primary === true])).toEqual([
      ['esri-leaflet', true],
      ['esri-leaflet-vector', false],
      ['esri-leaflet-geocoder', false],
    ]);
    expect(leaflet.oracles.map((oracle) => oracle.options.package)).toEqual([
      'esri-leaflet',
      'esri-leaflet-vector',
      'esri-leaflet-geocoder',
    ]);
  });

  // Regression: nothing said that jimu-ui is documented in a Storybook this server cannot
  // read, so a lookup of `Button` came back with an unrelated jimu-core class.
  it('says where the jimu-ui components are documented', () => {
    const builder = product('experience-builder');
    expect(builder.pitfalls.some((pitfall) => /jimu-ui.*Storybook/.test(pitfall))).toBe(true);
    expect(builder.startHere.map((link) => link.ref)).toContain(
      `${D}/experience-builder/storybook/`,
    );
  });

  // Regression: a release was listed with its custom-data-feeds page only; the pages for
  // server object extensions, which the SDK is named after, were dropped as duplicates.
  it('names the audience of an Enterprise SDK release page in its release-notes pattern', () => {
    const pattern = new RegExp(product('enterprise-sdk').releaseNotes?.pattern ?? '^$');
    const match = (path: string): Record<string, string | undefined> | undefined => {
      const groups = pattern.exec(path)?.groups;
      return groups === undefined ? undefined : { ...groups };
    };
    expect(match('/enterprise-sdk/guide/net/whats-new-12-1-net/')).toEqual({
      part: undefined,
      version: '12-1',
      variant: 'net',
    });
    expect(match('/enterprise-sdk/guide/java/whats-new-api-10-9-1-java/')).toEqual({
      part: 'api',
      version: '10-9-1',
      variant: 'java',
    });
    expect(match('/enterprise-sdk/guide/custom-data-feeds/whats-new-12-1-cdf/')).toEqual({
      part: undefined,
      version: '12-1',
      variant: 'cdf',
    });
    // The extensions come first: the pattern names them before the data feeds.
    expect(pattern.source.indexOf('net')).toBeLessThan(pattern.source.indexOf('cdf'));
  });
});
