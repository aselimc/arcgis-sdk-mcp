import { describe, expect, it } from 'vitest';
import { ownedPrefix } from '../../../src/core/adapter-helpers.js';
import { DEVELOPERS_ORIGIN as D } from '../../../src/core/names.js';
import type { AnySourceDef, Product } from '../../../src/core/types.js';
import { aiProducts } from '../../../src/registry/data/ai.js';
import { devopsOssProducts } from '../../../src/registry/data/devops-oss.js';
import { helpDeveloperLinks, helpProducts } from '../../../src/registry/data/help.generated.js';
import { legacyProducts } from '../../../src/registry/data/legacy.js';
import { restServicesProducts } from '../../../src/registry/data/rest-services.js';
import { specsProducts } from '../../../src/registry/data/specs.js';
import { supportProducts } from '../../../src/registry/data/support.js';
import { validateProducts } from '../../../src/registry/schema.js';
import {
  OTHER_DEVELOPER_IDS,
  floorViolations,
  hostViolations,
  identityViolations,
  sourceViolations,
  wordingViolations,
} from './invariants.js';

const ALL: readonly Product[] = [
  ...restServicesProducts,
  ...aiProducts,
  ...supportProducts,
  ...specsProducts,
  ...devopsOssProducts,
  ...legacyProducts,
];

function byId(id: string): Product {
  const product = ALL.find((candidate) => candidate.id === id);
  if (product === undefined) throw new Error(`no product ${id}`);
  return product;
}

function sourceOf(product: Product, id: string): AnySourceDef {
  const source = product.sources.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`no source ${product.id}/${id}`);
  return source;
}

/** The source of `product` that owns `url` by the longest prefix, as the registry decides it. */
function ownerOf(product: Product, url: string): string | undefined {
  const [line] = product.lines;
  let best: { id: string; length: number } | undefined;
  for (const source of product.sources) {
    const prefix = line === undefined ? undefined : ownedPrefix(source, line, url);
    if (prefix !== undefined && prefix.length > (best?.length ?? 0)) {
      best = { id: source.id, length: prefix.length };
    }
  }
  return best?.id;
}

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

  it('holds the invariants INV-1 to INV-5', () => {
    const helpIds = new Set(helpProducts.map((product) => product.id));
    const others = new Set([...OTHER_DEVELOPER_IDS, ...helpIds]);
    expect(floorViolations(ALL)).toEqual([]);
    expect(hostViolations(ALL)).toEqual([]);
    expect(sourceViolations(ALL)).toEqual([]);
    expect(identityViolations(ALL, others)).toEqual([]);
    expect(wordingViolations(ALL)).toEqual([]);
  });

  it('shares no id or alias with the generated help products', () => {
    expect(identityViolations([...ALL, ...helpProducts], OTHER_DEVELOPER_IDS)).toEqual([]);
  });
});

describe('rest-api', () => {
  const rest = byId('rest-api');

  /** The table of design section 4.5: source id, base, pages, priority. */
  const TABLE: Array<[id: string, base: string, pages: number, priority: number]> = [
    ['services-enterprise', '/rest/services-reference/enterprise/', 906, 1],
    ['portal', '/rest/users-groups-and-items/', 336, 2],
    ['location-services', '/rest/', 257, 3],
    ['geocode', '/rest/geocode/', 15, 4],
    ['routing', '/rest/routing/', 30, 5],
    ['services-online', '/rest/services-reference/online/', 46, 6],
    ['geoenrichment', '/rest/geoenrichment/', 18, 7],
    ['analysis', '/rest/analysis/', 43, 8],
    ['elevation-analysis', '/rest/elevation-analysis/', 10, 9],
    ['packaging', '/rest/packaging/', 4, 9],
    ['services-mission', '/rest/services-reference/mission/', 21, 9],
    ['admin-enterprise', '/rest/enterprise-administration/enterprise/', 340, 10],
    ['admin-server', '/rest/enterprise-administration/server/', 275, 10],
    ['admin-portal', '/rest/enterprise-administration/portal/', 125, 10],
    ['admin-notebook', '/rest/enterprise-administration/notebook/', 137, 10],
    ['admin-mission', '/rest/enterprise-administration/mission-server/', 53, 10],
    ['admin-video', '/rest/enterprise-administration/video-server/', 115, 10],
  ];

  it('has the 17 Gatsby sources of the design table, in its order', () => {
    expect(rest.sources.map((source) => source.id)).toEqual(TABLE.map(([id]) => id));
    for (const [id, base, pages, priority] of TABLE) {
      const source = sourceOf(rest, id);
      expect(source.adapter, id).toBe('gatsby');
      if (source.adapter !== 'gatsby') continue;
      expect(source.config.base, id).toBe(base);
      expect(source.config.seedPage, id).toBe(base);
      expect(source.pagesApprox, id).toBe(pages);
      expect(source.priority, id).toBe(priority);
      expect(source.capability, id).toBe('website');
      expect(source.probe, id).toEqual({
        url: `${D}${base}sitemap-0.xml`,
        expect: 'xml',
        minRecords: Math.floor(pages / 2),
        family: 'gatsby-rest',
      });
    }
    expect(TABLE.reduce((sum, [, , pages]) => sum + pages, 0)).toBe(2731);
  });

  it('floors on the Enterprise services reference', () => {
    expect(rest.sources.filter((source) => source.floor).map((source) => source.id)).toEqual([
      'services-enterprise',
    ]);
  });

  it('indexes operations everywhere except the OpenAPI-generated root site', () => {
    for (const source of rest.sources) {
      if (source.adapter !== 'gatsby') continue;
      expect(source.config.symbols, source.id).toBe(
        source.id === 'location-services' ? 'openapi' : 'rest-operations',
      );
    }
  });

  it('excludes the other 16 sub-sites from the root site', () => {
    const root = sourceOf(rest, 'location-services');
    expect(root.adapter === 'gatsby' ? root.config.exclude : []).toHaveLength(16);
  });

  it.each([
    ['/rest/', 'location-services'],
    ['/rest/places/nearby-search-get/', 'location-services'],
    ['/rest/basemap-styles/arcgis-navigation-style-get/', 'location-services'],
    // Hub pages of the root site share a first path segment with sub-sites.
    ['/rest/enterprise-administration/', 'location-services'],
    ['/rest/analysis-services/', 'location-services'],
    ['/rest/analysis/api-reference/find-hot-spots/', 'analysis'],
    ['/rest/elevation-analysis/summarize-elevation/', 'elevation-analysis'],
    ['/rest/geocode/find-address-candidates/', 'geocode'],
    ['/rest/services-reference/enterprise/apply-edits-feature-service/', 'services-enterprise'],
    ['/rest/services-reference/online/add-to-definition/', 'services-online'],
    ['/rest/services-reference/mission/mission-service/', 'services-mission'],
    ['/rest/users-groups-and-items/search/', 'portal'],
    ['/rest/enterprise-administration/server/site/', 'admin-server'],
    ['/rest/enterprise-administration/enterprise/overview/', 'admin-enterprise'],
    ['/rest/enterprise-administration/mission-server/logs/', 'admin-mission'],
    ['/rest/enterprise-administration/video-server/services/', 'admin-video'],
  ])('resolves %s to source %s', (path, expected) => {
    expect(ownerOf(rest, `${D}${path}`)).toBe(expected);
  });

  it('owns nothing outside /rest/', () => {
    expect(ownerOf(rest, `${D}/documentation/`)).toBeUndefined();
    expect(ownerOf(rest, `${D}/arcgis-rest-js/`)).toBeUndefined();
  });

  it('reads the documented version from the what-is-new page and from ArcGIS Online', () => {
    expect(rest.oracles.map((oracle) => oracle.type)).toEqual(['page-regex', 'agol-rest-info']);
    const pattern = new RegExp(rest.oracles[0]?.options.pattern ?? '(?!)');
    // The shape of the page's first version heading, written by hand.
    const heading = '<h2 id="121" class="group relative">12.1<a href="#121"></a></h2>';
    expect(pattern.exec(heading)?.[1]).toBe('12.1');
    expect(pattern.exec('<h2 id="geoprocessing">Geoprocessing services<a></a></h2>')).toBeNull();
  });
});

describe('services and platform products', () => {
  it.each([
    ['developer-guide', 'guide', 'gatsby', 944],
    ['location-platform', 'help', 'gatsby', 46],
    ['hub-dev', 'guide', 'gatsby', 15],
    ['site-scan-api', 'api', 'openapi', undefined],
    ['urban-api', 'guide', 'gatsby', 42],
    ['workflow-manager-dev', 'guide', 'gatsby', 211],
    ['survey123-dev', 'guide', 'gatsby', 26],
    ['velocity-grpc', 'repo', 'github-repo', undefined],
    ['support-kb', 'articles', 'sitemap', 7888],
    ['ai-agents', 'briefs', 'brief', 4],
    ['web-appbuilder', 'guide', 'sitemap', 267],
    ['appstudio', 'guide', 'gatsby', 332],
  ])('%s floors on %s (%s)', (id, sourceId, adapter, pages) => {
    const floor = byId(id).sources.find((source) => source.floor);
    expect(floor?.id).toBe(sourceId);
    expect(floor?.adapter).toBe(adapter);
    expect(floor?.pagesApprox).toBe(pages);
  });

  it('indexes the glossary terms of the developer guide as symbols', () => {
    const guide = sourceOf(byId('developer-guide'), 'guide');
    expect(guide.adapter === 'gatsby' ? guide.config : undefined).toMatchObject({
      base: '/documentation/',
      symbols: 'glossary',
    });
  });

  it('keeps the Location Platform source to its help, pricing and feature pages', () => {
    const platform = byId('location-platform');
    const at = (path: string): string | undefined =>
      ownerOf(platform, `https://location.arcgis.com/${path}`);
    expect(at('help/release-notes/2026-07/')).toBe('help');
    expect(at('pricing/')).toBe('help');
    expect(at('features/')).toBe('help');
    expect(at('dashboard/')).toBeUndefined();
    expect(at('credentials/')).toBeUndefined();
  });

  it('lists the five Hub API documents, two of them embedded in a script', () => {
    const api = sourceOf(byId('hub-dev'), 'api');
    const specs = api.adapter === 'openapi' ? api.config.specs : [];
    expect(specs).toHaveLength(5);
    expect(specs.filter((spec) => typeof spec !== 'string' && spec.embedded)).toHaveLength(2);
    for (const spec of specs) {
      expect(typeof spec === 'string' ? spec : spec.url).toMatch(
        /^https:\/\/hub\.arcgis\.com\/api\/[a-z]+\/(v\d\/docs-json|definition\/swagger-ui-init\.js)$/,
      );
    }
  });

  it('reads the Site Scan API version from the first version key of the document', () => {
    const [oracle] = byId('site-scan-api').oracles;
    const pattern = new RegExp(oracle?.options.pattern ?? '(?!)');
    const document =
      '{\n  "openapi": "3.1.0",\n  "info": {\n    "title": "T",\n    "version": "2.0.0"';
    expect(pattern.exec(document)?.[1]).toBe('2.0.0');
  });

  it('derives Workflow Manager symbols from REST and JavaScript reference slugs', () => {
    const guide = sourceOf(byId('workflow-manager-dev'), 'guide');
    const pattern = new RegExp(
      guide.adapter === 'gatsby' ? (guide.config.symbolsFromSlug ?? '(?!)') : '(?!)',
    );
    expect(pattern.exec('api-reference/rest/jobs/create-job/')?.[1]).toBe('jobs/create-job');
    expect(pattern.exec('api-reference/javascript/JobsManager/')?.[1]).toBe('JobsManager');
    expect(pattern.exec('guide/overview/')).toBeNull();
  });

  it('recognises the Workflow Manager package in a manifest', () => {
    const [signal] = byId('workflow-manager-dev').workspaceSignals ?? [];
    const match = new RegExp(signal?.pattern ?? '(?!)').exec(
      '{ "dependencies": { "@arcgis/workflow-manager": "^12.1.0" } }',
    );
    expect(match?.[signal?.versionGroup ?? 0]).toBe('12.1.0');
  });

  it('reads Survey123 tools and webhook samples as two repository sources', () => {
    const survey = byId('survey123-dev');
    const repos = survey.sources.flatMap((source) =>
      source.adapter === 'github-repo' ? [source.config.repo] : [],
    );
    expect(repos).toEqual(['Esri/Survey123-tools', 'Esri/webhooks-samples']);
    expect(survey.oracles).toEqual([]);
  });

  it('keeps build output of the gRPC feed repository out of the index', () => {
    const repo = sourceOf(byId('velocity-grpc'), 'repo');
    expect(byId('velocity-grpc').status).toBe('beta');
    expect(repo.adapter === 'github-repo' ? repo.config : undefined).toMatchObject({
      repo: 'Esri/realtime-grpc-feed',
      include: ['**/*.md', '**/*.proto'],
    });
  });

  it('titles knowledge base articles from their slugs', () => {
    const articles = sourceOf(byId('support-kb'), 'articles');
    expect(articles.adapter === 'sitemap' ? articles.config : undefined).toEqual({
      url: 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml',
      titleFrom: 'slug',
      kind: 'troubleshooting',
    });
    expect(articles.probe.family).toBe('support-kb');
    expect(articles.probe.minRecords).toBe(3944);
  });
});

describe('ai-agents', () => {
  const ai = byId('ai-agents');

  it('is a beta product with the aliases of the design', () => {
    expect(ai.status).toBe('beta');
    expect(ai.aliases).toEqual(['mcp', 'mcp-location-services', 'agentic-ai', 'esri-mcp']);
    // These two stay aliases of js-maps-sdk.
    expect(ai.aliases).not.toContain('ai-components');
    expect(ai.aliases).not.toContain('arcgis-assistant');
    expect(ai.related).toEqual([
      'js-maps-sdk',
      'python-api',
      'arcgis-pro-sdk',
      'experience-builder',
    ]);
  });

  it('floors on the bundled briefs, which need no capability', () => {
    const briefs = sourceOf(ai, 'briefs');
    expect(briefs.floor).toBe(true);
    expect(briefs.capability).toBeUndefined();
    expect(briefs.license).toBe('project');
    expect(briefs.adapter === 'brief' ? briefs.config.slugs : []).toEqual(['ai/*']);
  });

  it('reads the MCP documentation without the placeholder URL of its sitemap', () => {
    const docs = `${D}/ai/mcp-arcgis-location-services/`;
    expect(ownerOf(ai, `${docs}get-started/`)).toBe('mcp-location-services');
    expect(ownerOf(ai, `${docs}old/path/url/`)).toBeUndefined();
    expect(ownerOf(ai, 'https://location.arcgis.com/help/agentic-ai/')).toBe(
      'location-platform-agentic',
    );
  });

  it('starts from the overview brief and links into the JavaScript guides', () => {
    const refs = ai.startHere.map((link) => link.ref);
    expect(refs[0]).toBe('brief:ai/overview');
    expect(refs).toContain(`${D}/javascript/latest/agentic-apps/`);
    expect(refs).toContain(`${D}/javascript/latest/ai-assisted-development/`);
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
