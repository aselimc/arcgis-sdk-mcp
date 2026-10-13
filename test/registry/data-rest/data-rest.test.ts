import { describe, expect, it } from 'vitest';
import { DEVELOPERS_ORIGIN as D } from '../../../src/core/names.js';
import type { Product } from '../../../src/core/types.js';
import { aiProducts } from '../../../src/registry/data/ai.js';
import { devopsOssProducts } from '../../../src/registry/data/devops-oss.js';
import { helpDeveloperLinks, helpProducts } from '../../../src/registry/data/help.generated.js';
import { legacyProducts } from '../../../src/registry/data/legacy.js';
import { restServicesProducts } from '../../../src/registry/data/rest-services.js';
import { specsProducts } from '../../../src/registry/data/specs.js';
import { supportProducts } from '../../../src/registry/data/support.js';
import { validateProducts } from '../../../src/registry/schema.js';
import { lintOf } from '../registry-data.js';
import { ALL, byId, ownerOf, sourceOf } from './lookup.js';

describe('developer-tier registry data of section 4.5', () => {
  it('defines the 29 product ids of the design, per category', () => {
    const ids = (products: readonly Product[]): string[] => products.map((product) => product.id);
    expect(ids(restServicesProducts)).toEqual([
      'rest-api',
      'developer-guide',
      'location-platform',
      'hub-dev',
      'site-scan-api',
      'urban-api',
      'workflow-manager-dev',
      'survey123-dev',
      'velocity-grpc',
    ]);
    expect(ids(aiProducts)).toEqual(['ai-agents']);
    expect(ids(supportProducts)).toEqual(['support-kb']);
    expect(ids(specsProducts)).toEqual([
      'i3s-spec',
      'cim-spec',
      'arcgis-pbf',
      'knowledge-pbf',
      'lerc',
      'tile-package-spec',
      'spatially-optimized-parquet',
      '3d-tiles-esri-crs',
      'projection-engine-db',
      'file-geodatabase-api',
    ]);
    expect(ids(devopsOssProducts)).toEqual([
      'enterprise-devops',
      'koop',
      'developer-support',
      'oss-libraries',
    ]);
    expect(ids(legacyProducts)).toEqual([
      'web-appbuilder',
      'appstudio',
      'js-api-3x',
      'arcobjects-arcmap',
    ]);
  });

  it('puts every product in the category of its data file, at tier developer', () => {
    const expected: Array<[readonly Product[], string[]]> = [
      [restServicesProducts, ['rest-services']],
      [aiProducts, ['ai']],
      [supportProducts, ['support']],
      [specsProducts, ['specs']],
      [devopsOssProducts, ['devops-oss']],
      [legacyProducts, ['web', 'native', 'desktop-enterprise']],
    ];
    for (const [products, categories] of expected) {
      for (const product of products) {
        expect(categories, product.id).toContain(product.category);
        expect(product.tier, product.id).toBe('developer');
      }
    }
  });

  it('passes the registry schema', () => {
    expect(validateProducts(ALL)).toEqual([]);
  });

  // The one lint of `npm run registry:check`, over the whole registry: ids and aliases are
  // then also unique against the generated help products, and references resolve as they do
  // in the server.
  it('holds the invariants INV-1 to INV-5', () => {
    expect(lintOf(ALL)).toEqual([]);
  });
});

describe('specifications', () => {
  /** The table of design section 4.5: repository and licence tier per id. */
  const TABLE: Array<[id: string, repo: string, branch: string, license: string]> = [
    ['i3s-spec', 'Esri/i3s-spec', 'master', 'cc-by-nd'],
    ['cim-spec', 'Esri/cim-spec', 'main', 'cc-by-nd'],
    ['arcgis-pbf', 'Esri/arcgis-pbf', 'main', 'apache-2.0'],
    ['knowledge-pbf', 'Esri/knowledge-pbf', 'master', 'apache-2.0'],
    ['lerc', 'Esri/lerc', 'master', 'apache-2.0'],
    ['tile-package-spec', 'Esri/tile-package-spec', 'master', 'apache-2.0'],
    ['spatially-optimized-parquet', 'Esri/spatially-optimized-parquet', 'main', 'apache-2.0'],
    ['3d-tiles-esri-crs', 'Esri/3D-tiles-layer', 'main', 'apache-2.0'],
    ['projection-engine-db', 'Esri/projection-engine-db-doc', 'main', 'apache-2.0'],
    ['file-geodatabase-api', 'Esri/file-geodatabase-api', 'master', 'apache-2.0'],
  ];

  it.each(TABLE)('%s is one floor repository source (%s, %s, %s)', (id, repo, branch, license) => {
    const product = byId(id);
    expect(product.sources).toHaveLength(1);
    const [source] = product.sources;
    expect(source).toMatchObject({
      adapter: 'github-repo',
      floor: true,
      capability: 'github',
      license,
      kinds: ['spec'],
    });
    expect(source?.adapter === 'github-repo' ? source.config : undefined).toMatchObject({
      repo,
      preset: 'markdown-docs',
    });
    expect(product.licenseTier).toBe(license);
    expect(product.repos).toEqual([{ repo, role: 'spec', license, defaultBranch: branch }]);
    expect(product.homepage).toBe(`https://github.com/${repo}`);
  });

  it('warns that the CC BY-ND specifications are returned verbatim', () => {
    for (const id of ['i3s-spec', 'cim-spec']) {
      expect(byId(id).pitfalls.join(' ')).toMatch(/verbatim/);
    }
  });

  it('makes every CIM type a symbol and leaves the WKID lists out', () => {
    const cim = sourceOf(byId('cim-spec'), 'spec');
    expect(cim.adapter === 'github-repo' ? cim.config.symbolsFromHeadings : 0).toBe(2);
    const pe = sourceOf(byId('projection-engine-db'), 'spec');
    expect(pe.adapter === 'github-repo' ? pe.config.exclude : []).toEqual(['json/**']);
  });
});

describe('DevOps and open source', () => {
  const reposOf = (id: string): string[] =>
    byId(id).sources.flatMap((source) =>
      source.adapter === 'github-repo' ? [`${source.id}=${source.config.repo}`] : [],
    );

  it('has one repository source per row of the design table, the first one the floor', () => {
    expect(reposOf('enterprise-devops')).toEqual([
      'cookbook=Esri/arcgis-cookbook',
      'powershell-dsc=Esri/arcgis-powershell-dsc',
      'gitops=Esri/arcgis-gitops',
      'packer=Esri/arcgis-packer',
      'kubernetes=Esri/arcgis-enterprise-on-kubernetes-resources',
      'observability=Esri/arcgis-enterprise-observability',
    ]);
    expect(reposOf('koop')).toEqual(['docs=koopjs/koopjs.github.io', 'koop=koopjs/koop']);
    expect(reposOf('developer-support')).toEqual(['repo=Esri/developer-support']);
    expect(reposOf('oss-libraries')).toEqual([
      'solution-js=Esri/solution.js',
      'hub-js=Esri/hub.js',
      'geometry-api-java=Esri/geometry-api-java',
      'html-sanitizer=Esri/arcgis-html-sanitizer',
      'wayback-core=Esri/wayback-core',
      'raster-functions=Esri/raster-functions',
      'public-transit-tools=Esri/public-transit-tools',
      'storymaps-developer-samples=Esri/storymaps-developer-samples',
      'field-maps-scripts=Esri/field-maps-scripts',
    ]);
    for (const product of devopsOssProducts) {
      expect(product.sources[0]?.floor, product.id).toBe(true);
      expect(product.repos).toHaveLength(product.sources.length);
    }
  });

  it('reads the PowerShell DSC documentation from the wiki', () => {
    const dsc = sourceOf(byId('enterprise-devops'), 'powershell-dsc');
    expect(dsc.adapter === 'github-repo' ? dsc.config.preset : '').toBe('wiki');
  });

  it('records branch hints and the one repository without a recognised licence', () => {
    const branch = (id: string, repo: string): string | undefined =>
      byId(id).repos.find((ref) => ref.repo === repo)?.defaultBranch;
    expect(branch('oss-libraries', 'Esri/solution.js')).toBe('develop');
    expect(branch('koop', 'koopjs/koopjs.github.io')).toBe('master');
    expect(sourceOf(byId('koop'), 'koop').license).toBe('unlicensed');
    expect(sourceOf(byId('koop'), 'docs').license).toBe('apache-2.0');
  });

  it('claims a repository URL for the source of that repository', () => {
    const oss = byId('oss-libraries');
    expect(ownerOf(oss, 'https://github.com/Esri/hub.js/blob/master/README.md')).toBe('hub-js');
    expect(ownerOf(oss, 'https://raw.githubusercontent.com/Esri/wayback-core/main/README.md')).toBe(
      'wayback-core',
    );
    expect(ownerOf(oss, 'https://github.com/Esri/arcgis-cookbook')).toBeUndefined();
  });
});

describe('developer tombstones', () => {
  it('are retired and name their successor', () => {
    const successors = legacyProducts.map((product) => [product.id, product.successor]);
    expect(legacyProducts.every((product) => product.status === 'retired')).toBe(true);
    expect(successors).toEqual([
      ['web-appbuilder', 'experience-builder'],
      ['appstudio', undefined],
      ['js-api-3x', 'js-maps-sdk'],
      ['arcobjects-arcmap', 'arcgis-pro-sdk'],
    ]);
  });

  it('keeps the pages of Web AppBuilder and AppStudio readable', () => {
    const wab = sourceOf(byId('web-appbuilder'), 'guide');
    expect(wab.adapter === 'sitemap' ? wab.config.urls : []).toEqual([
      '/web-appbuilder/guide/sitemap.xml',
      '/web-appbuilder/api-reference/sitemap.xml',
      '/web-appbuilder/sample-code/sitemap.xml',
    ]);
    const web = byId('web-appbuilder');
    expect(ownerOf(web, `${D}/web-appbuilder/api-reference/css-framework/`)).toBe('guide');
    expect(ownerOf(web, `${D}/web-appbuilder/sample-code/create-custom-widget/`)).toBe('guide');
    const studio = sourceOf(byId('appstudio'), 'guide');
    expect(studio.adapter === 'gatsby' ? studio.config.base : '').toBe('/appstudio/');
  });

  it('has no sources for the JavaScript 3.x API and ArcObjects, only links', () => {
    for (const id of ['js-api-3x', 'arcobjects-arcmap']) {
      const product = byId(id);
      expect(product.sources).toEqual([]);
      expect(product.lines.map((line) => line.access)).toEqual(['link-only']);
    }
    expect(new URL(byId('arcobjects-arcmap').homepage).hostname).toBe('desktop.arcgis.com');
  });

  it('adds the retired end-user help from the help import as a start-here link', () => {
    for (const id of ['web-appbuilder', 'appstudio']) {
      const link = helpDeveloperLinks[id];
      expect(link, id).toBeDefined();
      expect(byId(id).startHere).toContainEqual(link);
    }
  });

  it('states the retirement dates the design gives', () => {
    const retirement = (id: string): string | undefined =>
      byId(id).oracles.find((oracle) => oracle.type === 'static')?.options.retirement;
    expect(retirement('appstudio')).toBe('2025-02-01');
    expect(retirement('js-api-3x')).toBe('2024-07-01');
  });
});
