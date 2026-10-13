/**
 * Registry data: Python, data science and R (design section 4.3).
 */
import { DEVELOPERS_ORIGIN as D } from '../../core/names.js';
import type {
  AdapterConfigMap,
  OracleSpec,
  Product,
  SourceDef,
  VersionLine,
} from '../../core/types.js';
import { helpDeveloperSources } from './help.generated.js';

const VERIFIED_ON = '2026-10-13';

const LATEST: VersionLine = {
  id: 'latest',
  label: 'Current',
  current: true,
  access: 'live',
  vars: {},
};

/** A Gatsby guide site on developers.arcgis.com; `pages` is its sitemap size. */
function gatsbyGuide(
  base: string,
  pages: number,
  options: Omit<AdapterConfigMap['gatsby'], 'base'> = {},
  extras: Partial<SourceDef<'gatsby'>> = {},
): SourceDef<'gatsby'> {
  return {
    id: 'guide',
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

/** A Sphinx API reference, enumerated from its `objects.inv` inventory. */
function sphinxApi(base: string): SourceDef<'sphinx'> {
  return {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    adapter: 'sphinx',
    config: { base },
    capability: 'website',
    fallbacks: ['guide'],
    probe: { url: `${D}${base}objects.inv`, expect: 'text', mustContain: '# Sphinx inventory' },
  };
}

/** A repository of Jupyter notebooks. */
function notebooks(repo: string, title: string, include?: string[]): SourceDef<'github-repo'> {
  return {
    id: 'samples',
    title,
    kinds: ['sample'],
    adapter: 'github-repo',
    config: { repo, preset: 'notebooks', ...(include === undefined ? {} : { include }) },
    capability: 'github',
    license: 'apache-2.0',
    probe: {
      url: `https://api.github.com/repos/${repo}`,
      expect: 'json',
      mustContain: 'full_name',
    },
  };
}

const banner = (path: string): OracleSpec => ({
  type: 'page-regex',
  options: { url: `${D}${path}` },
  provides: ['documented', 'released'],
});

/**
 * Release, maturity and retirement dates from Esri's product life cycle service, which lists
 * the product under its registry name. Read only with the opt-in capability `lifecycle-api`.
 */
const LIFECYCLE: OracleSpec = {
  type: 'plc',
  options: { category: 'Developer' },
  provides: ['lifecycle'],
};

const PY = '/python/latest/';

const pythonApi: Product = {
  id: 'python-api',
  name: 'ArcGIS API for Python',
  aliases: [
    'python',
    'arcgis api for python',
    'arcgis-python-api',
    'python api',
    'arcgis.gis',
    'arcgis.learn',
    'arcgis.ai',
    'arcgis-mapping',
    'arcgis python',
  ],
  category: 'python',
  tier: 'developer',
  status: 'active',
  summary:
    'Python library for ArcGIS Online and Enterprise: content and user management, spatial dataframes, analysis, GeoAI.',
  keywords: [
    'notebook',
    'jupyter',
    'pandas',
    'spatially enabled dataframe',
    'gis',
    'content management',
    'administration',
    'automation',
    'deep learning',
    'geoai',
    'arcgis.learn',
    'arcgis.features',
    'pip',
    'conda',
    'scripting',
  ],
  languages: ['python'],
  homepage: `${D}${PY}`,
  packages: [
    { registry: 'pypi', name: 'arcgis', license: 'esri-ma', primary: true },
    { registry: 'pypi', name: 'arcgis-mapping', license: 'esri-ma' },
  ],
  repos: [
    {
      repo: 'Esri/arcgis-python-api',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'master',
    },
  ],
  workspaceSignals: [
    {
      files: [
        'requirements*.txt',
        'pyproject.toml',
        'environment.yml',
        'environment.yaml',
        'Pipfile',
        'setup.py',
        'setup.cfg',
      ],
      pattern: '(?:^|[\\s"\'\\[,-])arcgis(?![\\w.-])\\s*(?:[=~<>!]=*\\s*(\\d[\\w.]*))?',
      versionGroup: 1,
    },
  ],
  lines: [
    { ...LATEST, label: '2.4.x', vars: { base: PY } },
    // The only frozen copy of an older release that the site keeps.
    { id: '2.3', label: '2.3.x', current: false, access: 'live', vars: { base: '/python-2-3/' } },
  ],
  sources: [
    {
      ...gatsbyGuide(
        '{base}',
        480,
        {
          // Guide and sample pages are rendered notebooks: `auto` picks the notebook body.
          bodyFrom: 'auto',
          exclude: ['^api-reference/'],
          classify: [
            ['^samples/', 'sample'],
            ['^guide/release-notes', 'release-notes'],
          ],
        },
        {
          title: 'Guide, tutorials and sample notebooks',
          kinds: ['guide', 'tutorial', 'sample', 'release-notes'],
        },
      ),
      probe: { url: `${D}${PY}sitemap-0.xml`, expect: 'xml', minRecords: 240, family: 'gatsby' },
    },
    {
      id: 'api',
      title: 'API reference',
      kinds: ['api'],
      adapter: 'gatsby',
      config: {
        base: '{base}api-reference/',
        symbols: 'sphinx-pagination',
        bodyFrom: 'sphinxJson',
      },
      capability: 'website',
      fallbacks: ['guide'],
      pagesApprox: 68,
      probe: { url: `${D}${PY}api-reference/`, expect: 'html', family: 'gatsby', minChars: 500 },
    },
    notebooks('Esri/arcgis-python-api', 'Sample and guide notebooks (GitHub)', [
      'samples/**/*.ipynb',
      'guide/**/*.ipynb',
    ]),
  ],
  // The documentation can describe a release before PyPI serves it, so both are reported.
  oracles: [
    { type: 'pypi', options: { package: 'arcgis' }, provides: ['installable'] },
    banner(PY),
    {
      type: 'github-release',
      options: { repo: 'Esri/arcgis-python-api' },
      provides: ['released'],
    },
    LIFECYCLE,
  ],
  releaseNotes: {
    // The slug runs the digits together: 2.4.4 is `release-notes-244`.
    pattern: `${D}{base}guide/release-notes-{compact}/`,
    sitemapFilter: '/guide/release-notes-\\d+/',
  },
  startHere: [
    { title: 'ArcGIS API for Python', ref: `${D}${PY}` },
    { title: 'API reference', ref: `${D}${PY}api-reference/` },
    { title: 'Deprecation notices', ref: `${D}${PY}guide/deprecation-notices/` },
  ],
  pitfalls: [
    'The documented version can be ahead of what pip installs; compare both with arcgis_docs_get_versions.',
    'Map widgets moved to the separate arcgis-mapping package in 2.4; older notebooks import them from arcgis.',
    'This is not ArcPy: arcgis talks to web GIS over REST, arcpy runs geoprocessing inside ArcGIS Pro or Server.',
  ],
  related: ['arcpy', 'rest-api', 'geoanalytics-engine'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const PRO_DOCS = 'https://doc.esri.com/en/arcgis-pro/latest/';

/** A slice of the ArcGIS Pro documentation site, enumerated from its own table of contents. */
function proSection(
  id: string,
  title: string,
  scope: string,
  pages: number,
  options: Partial<AdapterConfigMap['docfx-esri']> = {},
  extras: Partial<SourceDef<'docfx-esri'>> = {},
): SourceDef<'docfx-esri'> {
  return {
    id,
    title,
    kinds: ['api', 'guide'],
    adapter: 'docfx-esri',
    config: { slug: 'arcgis-pro', scope, toc: `${scope}toc.json`, symbols: 'toc', ...options },
    capability: 'website',
    // doc.esri.com documents the current release only.
    lines: ['latest'],
    pagesApprox: pages,
    probe: { url: `${PRO_DOCS}${scope}toc.json`, expect: 'json', family: 'docfx-esri' },
    ...extras,
  };
}

/**
 * The ArcPy and tool-reference books of earlier ArcGIS Pro releases on pro.arcgis.com. They
 * are generated from the same research as the ArcGIS Pro help (`npm run gen`), so the book
 * list and the version lines have one definition; here they only get the kinds of a
 * developer reference.
 */
function proLegacySource(id: string): SourceDef<'legacy-help'> {
  const source = helpDeveloperSources[`arcpy/${id}`];
  if (source?.adapter !== 'legacy-help') {
    throw new Error(`help.generated.ts has no legacy-help source arcpy/${id}`);
  }
  return { ...source, kinds: ['api', 'guide'] };
}

const PRO_LEGACY_SOURCES = ['legacy', 'legacy-tools', 'legacy-tools-extensions'].map(
  proLegacySource,
);

/** Releases whose pages are fetched (`config.lines`) and every release the sources exist for. */
const PRO_LIVE_LINES = new Set(PRO_LEGACY_SOURCES[0]?.config.lines ?? []);
const PRO_LEGACY_LINES = PRO_LEGACY_SOURCES[0]?.lines ?? [];

const arcpy: Product = {
  id: 'arcpy',
  name: 'ArcPy and geoprocessing tools',
  aliases: [
    'geoprocessing',
    'gp-tools',
    'tool-reference',
    'arcpy.da',
    'arcpy.mp',
    'geoprocessing tools',
    'arcgis pro python',
  ],
  category: 'python',
  tier: 'developer',
  status: 'active',
  summary:
    'Python site package of ArcGIS Pro and the geoprocessing tool reference: cursors, mapping, analysis, tool syntax.',
  keywords: [
    'geoprocessing',
    'tool',
    'toolbox',
    'script tool',
    'python toolbox',
    'cursor',
    'searchcursor',
    'updatecursor',
    'spatial analyst',
    'network analyst',
    'feature class',
    'geodatabase',
    'buffer',
    'modelbuilder',
    'arcgis pro',
  ],
  languages: ['python'],
  homepage: `${PRO_DOCS}arcpy/main/arcgis-pro-arcpy-reference.html`,
  // ArcPy ships with ArcGIS Pro and Server; it is not a published package.
  packages: [],
  repos: [],
  lines: [
    { ...LATEST, label: 'Pro 3.7' },
    // The same lines as product arcgis-pro: the two previous releases are read on demand,
    // older ones are links only, for the help and for this reference alike.
    ...PRO_LEGACY_LINES.map(
      (id): VersionLine => ({
        id,
        label: `Pro ${id}`,
        current: false,
        access: PRO_LIVE_LINES.has(id) ? 'live' : 'link-only',
        vars: {},
      }),
    ),
  ],
  sources: [
    proSection('arcpy', 'ArcPy reference', 'arcpy/', 1050, {}, { floor: true }),
    proSection('tools', 'Geoprocessing tool reference', 'tool-reference/', 10865, {
      gpParameters: true,
    }),
    ...PRO_LEGACY_SOURCES,
  ],
  oracles: [{ type: 'docesri-sitemap', options: { slug: 'arcgis-pro' }, provides: ['documented'] }],
  compatibility: [
    {
      name: 'Python libraries shipped with ArcGIS Pro',
      url: `${PRO_DOCS}arcpy/get-started/available-python-libraries.html`,
    },
  ],
  releaseNotes: { current: `${PRO_DOCS}get-started/whats-new-in-arcgis-pro.html` },
  startHere: [
    { title: 'ArcPy reference', ref: `${PRO_DOCS}arcpy/main/arcgis-pro-arcpy-reference.html` },
    {
      title: 'Python libraries shipped with ArcGIS Pro',
      ref: `${PRO_DOCS}arcpy/get-started/available-python-libraries.html`,
    },
    {
      title: "What's new in ArcGIS Pro",
      ref: `${PRO_DOCS}get-started/whats-new-in-arcgis-pro.html`,
    },
  ],
  pitfalls: [
    'ArcPy versions are ArcGIS Pro versions; a tool or parameter may not exist in an older Pro release.',
    'Tool pages give the dialog and the Python signature; the Python parameter names are the ones scripts use.',
    'Use arcpy.da cursors: the older arcpy.SearchCursor family is slower and kept only for compatibility.',
    'Many tools need an extension licence (Spatial Analyst, Network Analyst); the tool page states which.',
  ],
  related: ['python-api', 'arcgis-pro-sdk', 'arcgis-pro'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const geoanalyticsEngine: Product = {
  id: 'geoanalytics-engine',
  name: 'ArcGIS GeoAnalytics Engine',
  aliases: ['geoanalytics', 'gae', 'geoanalytics engine', 'arcgis geoanalytics'],
  category: 'python',
  tier: 'developer',
  status: 'active',
  summary:
    'Spatial analysis library for Apache Spark: SQL functions, tools and data sources in PySpark, SQL and Scala.',
  keywords: [
    'spark',
    'pyspark',
    'databricks',
    'big data',
    'sql functions',
    'st_',
    'spatial sql',
    'dataframe',
    'emr',
    'synapse',
    'tracks',
    'aggregation',
  ],
  languages: ['python', 'sql', 'scala'],
  homepage: `${D}/geoanalytics/`,
  packages: [],
  repos: [
    {
      repo: 'Esri/geoanalytics-engine-samples',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'main',
    },
  ],
  lines: [LATEST],
  sources: [
    gatsbyGuide(
      '/geoanalytics/',
      313,
      { exclude: ['^api-reference/'] },
      { title: 'Guide and tutorials', kinds: ['guide', 'tutorial', 'release-notes'] },
    ),
    sphinxApi('/geoanalytics/api-reference/'),
    notebooks('Esri/geoanalytics-engine-samples', 'Sample notebooks'),
  ],
  oracles: [banner('/geoanalytics/')],
  releaseNotes: {
    current: `${D}/geoanalytics/release-notes/`,
    sitemapFilter: '/release-notes/',
  },
  startHere: [
    { title: 'GeoAnalytics Engine', ref: `${D}/geoanalytics/` },
    { title: 'Release notes', ref: `${D}/geoanalytics/release-notes/` },
  ],
  pitfalls: [
    'SQL functions are documented in the guide (sql-functions/), the Python tools in the API reference.',
    'The PyPI package named geoanalytics is unrelated; the engine is installed from an Esri download.',
  ],
  related: ['geoanalytics-fabric', 'python-api'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const geoanalyticsFabric: Product = {
  id: 'geoanalytics-fabric',
  name: 'ArcGIS GeoAnalytics for Microsoft Fabric',
  aliases: ['geoanalytics for fabric', 'microsoft fabric geoanalytics', 'fabric geoanalytics'],
  category: 'python',
  tier: 'developer',
  status: 'active',
  summary:
    'Spatial functions and tools built into Microsoft Fabric Spark runtimes, used from PySpark and Spark SQL.',
  keywords: [
    'microsoft fabric',
    'fabric',
    'spark',
    'pyspark',
    'lakehouse',
    'onelake',
    'sql functions',
    'spatial sql',
    'notebook',
  ],
  languages: ['python', 'sql'],
  homepage: `${D}/geoanalytics-fabric/`,
  packages: [],
  repos: [
    {
      repo: 'Esri/geoanalytics-fabric-samples',
      role: 'samples',
      license: 'apache-2.0',
      defaultBranch: 'main',
    },
  ],
  lines: [LATEST],
  sources: [
    gatsbyGuide(
      '/geoanalytics-fabric/',
      236,
      { exclude: ['^api-reference/'] },
      { title: 'Guide and tutorials', kinds: ['guide', 'tutorial', 'release-notes'] },
    ),
    sphinxApi('/geoanalytics-fabric/api-reference/'),
    notebooks('Esri/geoanalytics-fabric-samples', 'Sample notebooks'),
  ],
  oracles: [],
  releaseNotes: { current: `${D}/geoanalytics-fabric/release-notes/` },
  startHere: [
    { title: 'GeoAnalytics for Microsoft Fabric', ref: `${D}/geoanalytics-fabric/` },
    { title: 'Release notes', ref: `${D}/geoanalytics-fabric/release-notes/` },
  ],
  pitfalls: [
    'The library is part of the Fabric runtime: there is nothing to install, and the runtime decides the version.',
  ],
  related: ['geoanalytics-engine'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const R_PACKAGES = [
  'arcgis',
  'arcgislayers',
  'arcgisutils',
  'arcgisgeocode',
  'arcgisplaces',
  'arcgisrouting',
  'arcpbf',
  'calcite',
  'arcgisviz',
];

const rArcgis: Product = {
  id: 'r-arcgis',
  name: 'R-ArcGIS Bridge and arcgis R packages',
  aliases: ['r', 'r-bridge', 'arcgisbinding', 'arcgislayers', 'r-arcgis bridge', 'rstats'],
  category: 'python',
  tier: 'developer',
  status: 'active',
  summary:
    'R packages for ArcGIS: read and write feature services, geocode, route and use ArcGIS Pro data from R.',
  keywords: [
    'r language',
    'rstudio',
    'sf',
    'tidyverse',
    'cran',
    'data science',
    'statistics',
    'feature service',
    'geocoding',
  ],
  languages: ['r'],
  homepage: `${D}/r-bridge/`,
  packages: [{ registry: 'cran', name: 'arcgis', license: 'unlicensed', primary: true }],
  repos: [
    {
      repo: 'R-ArcGIS/arcgislayers',
      role: 'source',
      license: 'unlicensed',
      defaultBranch: 'main',
    },
  ],
  workspaceSignals: [
    { files: ['DESCRIPTION', 'renv.lock'], pattern: '\\barcgis(?:layers|utils|binding)?\\b' },
  ],
  lines: [LATEST],
  sources: [
    gatsbyGuide('/r-bridge/', 263, {}, { kinds: ['guide', 'release-notes'] }),
    {
      id: 'packages',
      title: 'Package reference sites',
      kinds: ['api'],
      adapter: 'pkgdown',
      config: { host: 'r.esri.com', packages: R_PACKAGES },
      capability: 'website',
      // These sites state no licence, and not every package has one yet: the adapter probes
      // each package before using it.
      license: 'unlicensed',
      fallbacks: ['guide'],
      probe: { url: 'https://r.esri.com/arcgislayers/search.json', expect: 'json' },
    },
  ],
  oracles: [],
  releaseNotes: { sitemapFilter: '/whats-new/' },
  startHere: [{ title: 'R-ArcGIS Bridge', ref: `${D}/r-bridge/` }],
  pitfalls: [
    'arcgisbinding needs a local ArcGIS Pro licence; the arcgis metapackage works against services only.',
    'Function reference pages are per package on r.esri.com, not on developers.arcgis.com.',
  ],
  related: ['python-api', 'rest-api'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

/** The five products of design section 4.3. */
export const pythonProducts: readonly Product[] = [
  pythonApi,
  arcpy,
  geoanalyticsEngine,
  geoanalyticsFabric,
  rArcgis,
];
