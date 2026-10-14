/**
 * Registry data: REST APIs, services and platform products (design section 4.5).
 *
 * `rest-api` is one product made of 17 independent Gatsby sub-sites; the other entries are
 * the developer guide, ArcGIS Location Platform help and the smaller service APIs. Only ids,
 * URLs, patterns and adapter configs live here; summaries and pitfalls are this project's own
 * wording. Page counts are from the research of 2026-10-13 and feed `pagesApprox` and the
 * probe floor (50 % of the count).
 */
import type { AnySourceDef, DocKind, Product, SourceDef } from '../../core/types.js';
import { D, LATEST, apacheRepo, githubRepoProbe } from './builders.js';

const VERIFIED_ON = '2026-10-13';
const DEVELOPERS_INDEX = 'developers_arcgis_v1';

/** Fields shared by every product in this file. */
const COMMON = {
  category: 'rest-services',
  tier: 'developer',
  status: 'active',
  packages: [],
  repos: [],
  lines: [LATEST],
  oracles: [],
  pitfalls: [],
  related: [],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
} satisfies Partial<Product>;

/** A Gatsby sub-site probe: its own sitemap, which exists even where the global index omits the site. */
function sitemapProbe(base: string, pages: number): SourceDef['probe'] {
  const root = base.startsWith('http') ? base : `${D}${base}`;
  return { url: `${root}sitemap-0.xml`, expect: 'xml', minRecords: Math.floor(pages / 2) };
}

/** An Apache-2.0 repository read as Markdown documents. */
function markdownRepo(id: string, title: string, repo: string, kinds: DocKind[]): AnySourceDef {
  return {
    id,
    title,
    kinds,
    adapter: 'github-repo',
    config: { repo, preset: 'markdown-docs' },
    capability: 'github',
    license: 'apache-2.0',
    probe: githubRepoProbe(repo),
  };
}

/**
 * One Gatsby sub-site below `/rest/`: source id, title, path on developers.arcgis.com, pages
 * in its sitemap, index-build priority. The rows follow the table of design section 4.5.
 */
type RestSiteRow = [id: string, title: string, base: string, pages: number, priority: number];

// prettier-ignore
const REST_SITE_ROWS: readonly RestSiteRow[] = [
  ['services-enterprise', 'Services reference (ArcGIS Enterprise): feature, map, image, GP, geometry, scene', '/rest/services-reference/enterprise/', 906, 1],
  ['portal', 'Users, groups and items (sharing API)', '/rest/users-groups-and-items/', 336, 2],
  ['geocode', 'Geocoding service', '/rest/geocode/', 15, 4],
  ['routing', 'Routing service', '/rest/routing/', 30, 5],
  ['services-online', 'Services reference (ArcGIS Online hosted services)', '/rest/services-reference/online/', 46, 6],
  ['geoenrichment', 'GeoEnrichment service', '/rest/geoenrichment/', 18, 7],
  // Absent from the global sitemap index; its own sitemap-0.xml exists.
  ['analysis', 'Spatial analysis service', '/rest/analysis/', 43, 8],
  ['elevation-analysis', 'Elevation and hydrology analysis services', '/rest/elevation-analysis/', 10, 9],
  ['packaging', 'Packaging service (offline map areas)', '/rest/packaging/', 4, 9],
  ['services-mission', 'Services reference (ArcGIS Mission)', '/rest/services-reference/mission/', 21, 9],
  ['admin-enterprise', 'Administration API (ArcGIS Enterprise on Kubernetes)', '/rest/enterprise-administration/enterprise/', 340, 10],
  ['admin-server', 'Administration API (ArcGIS Server)', '/rest/enterprise-administration/server/', 275, 10],
  ['admin-portal', 'Administration API (Portal for ArcGIS)', '/rest/enterprise-administration/portal/', 125, 10],
  ['admin-notebook', 'Administration API (ArcGIS Notebook Server)', '/rest/enterprise-administration/notebook/', 137, 10],
  ['admin-mission', 'Administration API (ArcGIS Mission Server)', '/rest/enterprise-administration/mission-server/', 53, 10],
  // Absent from the global sitemap index as well.
  ['admin-video', 'Administration API (ArcGIS Video Server)', '/rest/enterprise-administration/video-server/', 115, 10],
];

/** The floor source, and the only sub-site with a what's-new page. */
const ENTERPRISE_SERVICES = 'services-enterprise';

interface RestSite {
  id: string;
  title: string;
  base: string;
  pages: number;
  priority: number;
}

/** The 16 sub-sites below `/rest/` that have their own Gatsby build. */
const REST_SITES: readonly RestSite[] = REST_SITE_ROWS.map(
  ([id, title, base, pages, priority]) => ({ id, title, base, pages, priority }),
);

const WHATS_NEW: [string, DocKind] = ['^whats-new', 'release-notes'];
/** `^` matches every path: these are reference sites, so a page is `api` unless a rule above says otherwise. */
const EVERYTHING_ELSE_IS_API: [string, DocKind] = ['^', 'api'];

function restSource(site: RestSite): AnySourceDef {
  const flagship = site.id === ENTERPRISE_SERVICES;
  return {
    id: site.id,
    title: site.title,
    kinds: flagship ? ['api', 'release-notes'] : ['api'],
    adapter: 'gatsby',
    config: {
      base: site.base,
      seedPage: site.base,
      symbols: 'rest-operations',
      classify: [...(flagship ? [WHATS_NEW] : []), EVERYTHING_ELSE_IS_API],
    },
    capability: 'website',
    ...(flagship ? { floor: true } : {}),
    priority: site.priority,
    pagesApprox: site.pages,
    probe: { ...sitemapProbe(site.base, site.pages), family: 'gatsby-rest' },
  };
}

/**
 * The root site at `/rest/` holds the hub pages and the OpenAPI-generated services (places,
 * elevation, basemap-styles, static-basemap-tiles, static-maps). It shares its prefix with
 * the 16 sub-sites, so each of them is excluded by its path relative to `/rest/`.
 */
const LOCATION_SERVICES: AnySourceDef = {
  id: 'location-services',
  title: 'Location services: places, elevation, basemap styles, static basemap tiles, static maps',
  kinds: ['api'],
  adapter: 'gatsby',
  config: {
    base: '/rest/',
    seedPage: '/rest/',
    symbols: 'openapi',
    exclude: REST_SITES.map((site) => `^${site.base.slice('/rest/'.length)}`),
    classify: [EVERYTHING_ELSE_IS_API],
  },
  capability: 'website',
  priority: 3,
  pagesApprox: 257,
  probe: { ...sitemapProbe('/rest/', 257), family: 'gatsby-rest' },
};

const REST_SOURCES: AnySourceDef[] = REST_SITES.map(restSource);
// Index-build order follows `priority`; the array keeps the order of the design table.
REST_SOURCES.splice(2, 0, LOCATION_SERVICES);

/** The sub-sites of the REST reference that are released with ArcGIS Enterprise. */
const ENTERPRISE_SOURCES = [
  'services-enterprise',
  'services-mission',
  'admin-enterprise',
  'admin-server',
  'admin-portal',
  'admin-notebook',
  'admin-mission',
  'admin-video',
];

const restApi: Product = {
  ...COMMON,
  id: 'rest-api',
  name: 'ArcGIS REST APIs',
  aliases: ['rest', 'arcgis-rest-api', 'arcgis-rest-apis', 'services-reference', 'sharing-rest'],
  summary:
    'HTTP reference for ArcGIS services: feature, map and image services, the portal sharing API, location services and the administration APIs.',
  keywords: [
    'rest',
    'endpoint',
    'operation',
    'feature service',
    'map service',
    'image service',
    'geoprocessing service',
    'applyEdits',
    'query',
    'sharing',
    'portal',
    'geocode',
    'routing',
    'places',
    'elevation',
    'basemap styles',
    'geoenrichment',
    'admin api',
    'f=json',
  ],
  languages: ['rest', 'json'],
  homepage: `${D}/rest/`,
  sources: REST_SOURCES,
  oracles: [
    {
      type: 'page-regex',
      options: {
        url: `${D}/rest/services-reference/enterprise/whats-new/`,
        pattern: '<h2[^>]*>\\s*(\\d+(?:\\.\\d+)+)\\s*<',
        // The ArcGIS Enterprise release: it describes the references that ship with
        // Enterprise, not the hosted location services, which have no version.
        sources: ENTERPRISE_SOURCES.join(','),
      },
      provides: ['documented'],
    },
    {
      type: 'agol-rest-info',
      options: {
        url: 'https://www.arcgis.com/sharing/rest?f=json',
        sources: 'portal,services-online',
      },
      provides: ['documented'],
    },
  ],
  releaseNotes: { current: `${D}/rest/services-reference/enterprise/whats-new/` },
  esearch: { index: DEVELOPERS_INDEX, products: ['api-rest'], dropUrl: '^/workflow-manager/' },
  startHere: [
    { title: 'ArcGIS REST APIs overview', ref: `${D}/rest/` },
    { title: 'Services reference', ref: `${D}/rest/services-reference/enterprise/` },
    { title: 'Users, groups and items', ref: `${D}/rest/users-groups-and-items/` },
  ],
  pitfalls: [
    'The same operation is documented per deployment: Location Platform, ArcGIS Online and ArcGIS Enterprise pages differ. Read brief:rest/deployment-variants.',
    'The reference is unversioned; the Enterprise services reference marks the version an operation or parameter was added in.',
    'Operation titles look like "/applyEdits: Apply Edits (Feature Service)": look them up by operation name with arcgis_docs_lookup_symbol.',
    'Calling these services from JavaScript is the job of rest-js; authentication is explained in developer-guide.',
  ],
  related: ['rest-js', 'developer-guide', 'location-platform', 'arcgis-enterprise'],
};

const developerGuide: Product = {
  ...COMMON,
  id: 'developer-guide',
  name: 'ArcGIS developer guide',
  aliases: [
    'documentation',
    'arcgis-developer-guide',
    'mapping-and-location-services',
    'security-and-authentication',
    'glossary',
  ],
  summary:
    'Cross-product guide: mapping and location services, portal and data services, spatial analysis, authentication, app builders, offline apps and the glossary.',
  keywords: [
    'authentication',
    'api key',
    'oauth',
    'pkce',
    'user authentication',
    'app authentication',
    'access token',
    'privileges',
    'data hosting',
    'basemap',
    'spatial analysis',
    'offline',
    'app builders',
    'glossary',
    'attribution',
  ],
  languages: ['javascript', 'python', 'rest'],
  homepage: `${D}/documentation/`,
  sources: [
    {
      id: 'guide',
      title: 'Developer guide and glossary',
      kinds: ['guide', 'tutorial'],
      adapter: 'gatsby',
      config: {
        base: '/documentation/',
        symbols: 'glossary',
        classify: [['/tutorials/', 'tutorial']],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 944,
      probe: { ...sitemapProbe('/documentation/', 944), family: 'gatsby' },
    },
  ],
  esearch: { index: DEVELOPERS_INDEX, urlPrefix: 'developers.arcgis.com/documentation' },
  startHere: [
    { title: 'Choosing an authentication type', ref: 'brief:auth/choosing-authentication' },
    {
      title: 'Security and authentication',
      ref: `${D}/documentation/security-and-authentication/`,
    },
    {
      title: 'Mapping and location services',
      ref: `${D}/documentation/mapping-and-location-services/`,
    },
    { title: 'Portal and data services', ref: `${D}/documentation/portal-and-data-services/` },
  ],
  pitfalls: [
    'Guide pages show one concept for several client APIs; pass a product to arcgis_docs_find_samples when you need code for a specific SDK.',
    'Glossary terms are symbols: arcgis_docs_lookup_symbol resolves a term such as "feature service" to its definition.',
  ],
  related: ['rest-api', 'location-platform', 'js-maps-sdk', 'python-api'],
};

const locationPlatform: Product = {
  ...COMMON,
  id: 'location-platform',
  name: 'ArcGIS Location Platform help',
  aliases: ['arcgis-location-platform', 'location-platform-help', 'alp'],
  summary:
    'Account-level help for ArcGIS Location Platform: pricing, service usage, API key credentials, billing and monthly release notes.',
  keywords: ['pricing', 'billing', 'free tier', 'usage', 'credentials', 'subscription', 'paas'],
  languages: [],
  homepage: 'https://location.arcgis.com/help/',
  sources: [
    {
      id: 'help',
      title: 'Location Platform help, pricing and features',
      kinds: ['help', 'release-notes'],
      adapter: 'gatsby',
      config: {
        base: 'https://location.arcgis.com/',
        // The rest of the sitemap is the signed-in dashboard (credentials, billing shells).
        include: ['^help/', '^pricing/', '^features/'],
        classify: [
          ['^help/release-notes/', 'release-notes'],
          ['^', 'help'],
        ],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 46,
      probe: { ...sitemapProbe('https://location.arcgis.com/', 46), family: 'gatsby' },
    },
  ],
  oracles: [
    {
      type: 'meta-refresh-target',
      options: { url: 'https://location.arcgis.com/help/release-notes/' },
      provides: ['documented', 'released'],
    },
  ],
  releaseNotes: {
    current: 'https://location.arcgis.com/help/release-notes/',
    sitemapFilter: '/help/release-notes/',
  },
  startHere: [
    { title: 'Location Platform help', ref: 'https://location.arcgis.com/help/' },
    { title: 'Pricing', ref: 'https://location.arcgis.com/pricing/' },
    { title: 'Deployment variants of a REST operation', ref: 'brief:rest/deployment-variants' },
  ],
  pitfalls: [
    'This host is not covered by the site search of developers.arcgis.com; search here goes through the local index only.',
    'Releases are named by month (YYYY-MM), not by a version number.',
  ],
  related: ['rest-api', 'developer-guide', 'ai-agents'],
};

const hubDev: Product = {
  ...COMMON,
  id: 'hub-dev',
  name: 'ArcGIS Hub developer APIs',
  aliases: ['hub-api', 'arcgis-hub-api', 'hub-search-api', 'ogc-api-records'],
  summary:
    'ArcGIS Hub service APIs: OGC API Records search, DCAT and RSS feeds, discussions, events and newsletters, described by OpenAPI documents.',
  keywords: ['hub', 'open data', 'dcat', 'rss', 'feed', 'discussions', 'events', 'newsletters'],
  languages: ['rest', 'json'],
  homepage: `${D}/hub/`,
  repos: [apacheRepo('Esri/hub-py', 'source', 'master')],
  sources: [
    {
      // Absent from the global sitemap index; its own sitemap-0.xml exists.
      id: 'guide',
      title: 'Hub developer guide',
      kinds: ['guide'],
      adapter: 'gatsby',
      config: { base: '/hub/' },
      capability: 'website',
      floor: true,
      pagesApprox: 15,
      probe: { ...sitemapProbe('/hub/', 15), family: 'gatsby' },
    },
    {
      // hub.arcgis.com asks for one request per 60 s (robots Crawl-delay); the host policy enforces it.
      id: 'api',
      title: 'Hub service APIs (OpenAPI)',
      kinds: ['api'],
      adapter: 'openapi',
      config: {
        specs: [
          'https://hub.arcgis.com/api/events/v1/docs-json',
          'https://hub.arcgis.com/api/discussions/v2/docs-json',
          'https://hub.arcgis.com/api/newsletters/v1/docs-json',
          {
            url: 'https://hub.arcgis.com/api/search/definition/swagger-ui-init.js',
            embedded: true,
          },
          { url: 'https://hub.arcgis.com/api/feed/definition/swagger-ui-init.js', embedded: true },
        ],
      },
      capability: 'website',
      probe: {
        url: 'https://hub.arcgis.com/api/newsletters/v1/docs-json',
        expect: 'json',
        mustContain: '"openapi"',
      },
    },
  ],
  esearch: { index: DEVELOPERS_INDEX, urlPrefix: 'developers.arcgis.com/hub' },
  startHere: [
    { title: 'Hub developer guide', ref: `${D}/hub/` },
    { title: 'Hub services overview', ref: `${D}/hub/services/overview/` },
  ],
  pitfalls: [
    'The search and feed APIs are served per Hub site (https://<site>.hub.arcgis.com/api/...); the documents on hub.arcgis.com describe the same paths.',
    'The feed API document is Swagger 2.0; the other four are OpenAPI 3.0.',
    'hub.js is archived: see oss-libraries for its repository, and prefer the service APIs.',
  ],
  related: ['arcgis-hub', 'oss-libraries', 'rest-api'],
};

const siteScanApi: Product = {
  ...COMMON,
  id: 'site-scan-api',
  name: 'Site Scan for ArcGIS API',
  aliases: ['site-scan-rest-api', 'sitescan-api', 'sitescan'],
  summary:
    'REST API of Site Scan for ArcGIS (drone flight planning, missions, projects, processing), published as one OpenAPI 3.1 document.',
  keywords: ['drone', 'mission', 'flight', 'project', 'processing', 'orthomosaic', 'openapi'],
  languages: ['rest', 'json'],
  homepage: 'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
  sources: [
    {
      id: 'api',
      title: 'Site Scan API v2 (OpenAPI)',
      kinds: ['api'],
      adapter: 'openapi',
      config: { specs: ['https://sitescan-api.arcgis.com/api/v2/apidocs.json'] },
      capability: 'website',
      floor: true,
      probe: {
        url: 'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
        expect: 'json',
        mustContain: '"openapi"',
      },
    },
  ],
  oracles: [
    {
      // The API version is the document's `info.version`, the first "version" key in the file.
      type: 'page-regex',
      options: {
        url: 'https://sitescan-api.arcgis.com/api/v2/apidocs.json',
        pattern: '"version"\\s*:\\s*"([^"]+)"',
      },
      provides: ['documented'],
    },
  ],
  startHere: [
    { title: 'Site Scan API v2', ref: 'https://sitescan-api.arcgis.com/api/v2/apidocs.json' },
  ],
  pitfalls: [
    'Operations have no operationId: they are keyed by their summary text.',
    'The API is served per region (US, EU, IN hosts); the document lists the server URLs.',
    'The HTML page next to the document is a client-rendered shell; read the JSON document.',
  ],
  related: ['site-scan'],
};

const urbanApi: Product = {
  ...COMMON,
  id: 'urban-api',
  name: 'ArcGIS Urban API',
  aliases: ['arcgis-urban-api', 'urban-graphql'],
  summary:
    'GraphQL API of ArcGIS Urban: plans, projects, parcels, zoning and metrics, with guides, sample scripts and dated release notes.',
  keywords: ['graphql', 'urban', 'plan', 'project', 'parcel', 'zoning', 'metrics', 'sgqlc'],
  languages: ['graphql', 'python'],
  homepage: `${D}/arcgis-urban-api/`,
  sources: [
    {
      id: 'guide',
      title: 'Urban API guide, sample code and release notes',
      kinds: ['guide', 'sample', 'release-notes'],
      adapter: 'gatsby',
      config: {
        base: '/arcgis-urban-api/',
        // Superseded copies of the guide, still in the sitemap.
        exclude: ['^OLD/'],
        classify: [
          ['^release-notes/', 'release-notes'],
          ['^sample-code/', 'sample'],
        ],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 42,
      probe: { ...sitemapProbe('/arcgis-urban-api/', 42), family: 'gatsby' },
    },
  ],
  oracles: [
    {
      type: 'sitemap-slug',
      options: { sitemap: `${D}/arcgis-urban-api/sitemap-0.xml`, filter: '/release-notes/' },
      provides: ['documented', 'released'],
    },
  ],
  releaseNotes: {
    pattern: `${D}/arcgis-urban-api/release-notes/{version}/`,
    sitemapFilter: '/release-notes/',
  },
  esearch: { index: DEVELOPERS_INDEX, products: ['urban-api'] },
  startHere: [
    { title: 'Get started', ref: `${D}/arcgis-urban-api/get-started/` },
    { title: 'Data model', ref: `${D}/arcgis-urban-api/guides/data-model/` },
  ],
  pitfalls: [
    'The API reference page is an embedded GraphiQL explorer with no readable text; the types are not indexed here, so introspect the endpoint for the schema.',
    'Releases are identified by date (YYYY-MM-DD), not by a version number.',
  ],
  related: ['arcgis-urban'],
};

const workflowManagerDev: Product = {
  ...COMMON,
  id: 'workflow-manager-dev',
  name: 'ArcGIS Workflow Manager developer APIs',
  aliases: ['workflow-manager-api', 'workflow-manager-rest', '@arcgis/workflow-manager'],
  summary:
    'REST and JavaScript APIs of ArcGIS Workflow Manager: jobs, steps, diagrams and searches, plus custom step and automation samples.',
  keywords: ['workflow', 'job', 'step', 'diagram', 'job template', 'automation', 'web request'],
  languages: ['rest', 'javascript', 'typescript'],
  homepage: `${D}/workflow-manager/`,
  packages: [
    { registry: 'npm', name: '@arcgis/workflow-manager', license: 'esri-ma', primary: true },
  ],
  repos: [apacheRepo('Esri/workflowmanager-samples', 'samples', 'master')],
  workspaceSignals: [
    {
      files: ['package.json'],
      pattern: '"@arcgis/workflow-manager"\\s*:\\s*"[~^]?([0-9][^"]*)"',
      versionGroup: 1,
    },
  ],
  sources: [
    {
      id: 'guide',
      title: 'Workflow Manager guide and API reference',
      kinds: ['guide', 'api', 'release-notes'],
      adapter: 'gatsby',
      config: {
        base: '/workflow-manager/',
        symbolsFromSlug: '^api-reference/(?:rest|javascript)/(.+)/$',
        classify: [
          ['^api-reference/', 'api'],
          ['^whats-new', 'release-notes'],
        ],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 211,
      probe: { ...sitemapProbe('/workflow-manager/', 211), family: 'gatsby' },
    },
    markdownRepo('samples', 'Workflow Manager samples', 'Esri/workflowmanager-samples', ['sample']),
  ],
  oracles: [
    {
      type: 'page-regex',
      options: { url: `${D}/workflow-manager/whats-new/`, pattern: '<h2[^>]*>\\s*([^<]+?)\\s*<' },
      provides: ['documented'],
    },
  ],
  compatibility: [
    {
      name: 'JavaScript API version compatibility',
      url: `${D}/workflow-manager/javascript/version-compatibility/`,
    },
  ],
  releaseNotes: { current: `${D}/workflow-manager/whats-new/` },
  // The site search labels these pages `api-rest`, so only the URL prefix identifies them.
  esearch: { index: DEVELOPERS_INDEX, urlPrefix: 'developers.arcgis.com/workflow-manager' },
  startHere: [
    { title: 'Workflow Manager developer guide', ref: `${D}/workflow-manager/` },
    { title: "What's new", ref: `${D}/workflow-manager/whats-new/` },
  ],
  pitfalls: [
    'Releases are named after the ArcGIS Online update or the ArcGIS Enterprise version, not after an API version.',
    'The JavaScript API version is tied to a Maps SDK for JavaScript version: check the compatibility page before pinning.',
  ],
  related: ['arcgis-workflow-manager', 'rest-api'],
};

const survey123Dev: Product = {
  ...COMMON,
  id: 'survey123-dev',
  name: 'ArcGIS Survey123 developer resources',
  aliases: ['survey123-api', 'survey123-web-app-api', 'survey123-developer'],
  summary:
    'Embedding and automating ArcGIS Survey123: the web app JavaScript API, the report REST API, URL parameters, webhooks and Python tools.',
  keywords: [
    'survey',
    'form',
    'xlsform',
    'web form',
    'embed',
    'report',
    'webhook',
    'feature report',
  ],
  languages: ['javascript', 'python', 'rest'],
  homepage: `${D}/survey123/`,
  repos: [
    apacheRepo('Esri/Survey123-tools', 'samples', 'main'),
    apacheRepo('Esri/webhooks-samples', 'samples', 'master'),
  ],
  sources: [
    {
      id: 'guide',
      title: 'Survey123 developer guide and API reference',
      kinds: ['guide', 'api'],
      adapter: 'gatsby',
      config: { base: '/survey123/', classify: [['^api-reference/', 'api']] },
      capability: 'website',
      floor: true,
      pagesApprox: 26,
      probe: { ...sitemapProbe('/survey123/', 26), family: 'gatsby' },
    },
    markdownRepo(
      'tools',
      'Survey123 tools (Python notebooks and scripts)',
      'Esri/Survey123-tools',
      ['sample'],
    ),
    markdownRepo('webhooks', 'Webhook samples', 'Esri/webhooks-samples', ['sample']),
  ],
  esearch: { index: DEVELOPERS_INDEX, products: ['survey123'] },
  startHere: [
    { title: 'Survey123 developer guide', ref: `${D}/survey123/` },
    { title: 'Web app API reference', ref: `${D}/survey123/api-reference/web-app/` },
    { title: 'REST API reference', ref: `${D}/survey123/api-reference/rest/` },
  ],
  pitfalls: [
    'The version banner on the developer site lags behind the product: do not read the current Survey123 version from it.',
    'XLSForm authoring, pulldata and JavaScript functions are end-user help: they are in product survey123, not here.',
  ],
  related: ['survey123', 'rest-api'],
};

const velocityGrpc: Product = {
  ...COMMON,
  id: 'velocity-grpc',
  name: 'ArcGIS Velocity gRPC feeds',
  aliases: ['realtime-grpc-feed', 'velocity-grpc-feed', 'grpc-feed'],
  status: 'beta',
  summary:
    'Protocol definition and client examples for sending features to an ArcGIS Velocity gRPC feed.',
  keywords: ['grpc', 'protobuf', 'feed', 'real-time', 'stream', 'velocity', 'iot'],
  languages: ['protobuf', 'csharp', 'python'],
  homepage: 'https://github.com/Esri/realtime-grpc-feed',
  repos: [apacheRepo('Esri/realtime-grpc-feed', 'source', 'main')],
  sources: [
    {
      id: 'repo',
      title: 'realtime-grpc-feed repository (proto file and READMEs)',
      kinds: ['spec', 'guide'],
      adapter: 'github-repo',
      config: {
        repo: 'Esri/realtime-grpc-feed',
        preset: 'markdown-docs',
        include: ['**/*.md', '**/*.proto'],
        // The repository carries committed build output.
        exclude: ['**/.vs/**', '**/bin/**', '**/obj/**'],
      },
      capability: 'github',
      license: 'apache-2.0',
      floor: true,
      probe: githubRepoProbe('Esri/realtime-grpc-feed'),
    },
  ],
  startHere: [
    {
      title: 'velocity_grpc.proto',
      ref: 'https://github.com/Esri/realtime-grpc-feed/blob/main/proto/velocity_grpc.proto',
    },
  ],
  pitfalls: [
    'The repository has not changed since 2023: confirm the feed type is still offered before building on it (see arcgis-velocity).',
  ],
  related: ['arcgis-velocity'],
  licenseTier: 'apache-2.0',
};

/** REST, services and platform products (design section 4.5), nine ids. */
export const restServicesProducts: readonly Product[] = [
  restApi,
  developerGuide,
  locationPlatform,
  hubDev,
  siteScanApi,
  urbanApi,
  workflowManagerDev,
  survey123Dev,
  velocityGrpc,
];
