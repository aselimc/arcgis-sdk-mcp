import { describe, expect, it } from 'vitest';
import { DEVELOPERS_ORIGIN as D } from '../../../src/core/names.js';
import { byId, ownerOf, sourceOf } from './lookup.js';

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
