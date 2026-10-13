/**
 * Registry data: desktop and Enterprise extensibility (design section 4.4).
 */
import { DEVELOPERS_ORIGIN as D } from '../../core/names.js';
import type {
  AdapterConfigMap,
  Product,
  RepoRef,
  SourceDef,
  VersionLine,
} from '../../core/types.js';

const VERIFIED_ON = '2026-10-13';

const LATEST: VersionLine = {
  id: 'latest',
  label: 'Current',
  current: true,
  access: 'live',
  vars: {},
};

function repo(name: string, role: RepoRef['role'], defaultBranch: string): RepoRef {
  return { repo: name, role, license: 'apache-2.0', defaultBranch };
}

/** A GitHub repository source; the licence is a hint that the adapter confirms at run time. */
function githubSource(
  id: string,
  title: string,
  config: AdapterConfigMap['github-repo'],
  extras: Partial<SourceDef<'github-repo'>> = {},
): SourceDef<'github-repo'> {
  return {
    id,
    title,
    kinds: ['sample'],
    adapter: 'github-repo',
    config,
    capability: 'github',
    license: 'apache-2.0',
    probe: {
      url: `https://api.github.com/repos/${config.repo}`,
      expect: 'json',
      mustContain: 'full_name',
    },
    ...extras,
  };
}

type Book = AdapterConfigMap['legacy-help']['books'][number];

/**
 * A help tree in the older page layout. `books` are `[path, table-of-contents script id]`
 * pairs: the script lives at `<base><path>/<id>.js`, with `latest` spelled as `version`.
 */
function legacyHelp(spec: {
  id: string;
  title: string;
  kinds: SourceDef['kinds'];
  host: string;
  base: string;
  /** The numbered directory that `latest` stands for in script paths. */
  version?: string;
  books: Array<[path: string, tocId: number]>;
  pages: number;
}): SourceDef<'legacy-help'> {
  const scriptBase =
    spec.version === undefined ? spec.base : spec.base.replace('/latest/', `/${spec.version}/`);
  const books: Book[] = spec.books.map(([path, tocId]) => ({
    path,
    tocScript: `${scriptBase}${path}/${tocId}.js`,
  }));
  const first = spec.books[0]?.[0] ?? '';
  return {
    id: spec.id,
    title: spec.title,
    kinds: spec.kinds,
    adapter: 'legacy-help',
    config: { host: spec.host, base: spec.base, books },
    capability: 'website',
    floor: true,
    pagesApprox: spec.pages,
    probe: {
      // Every book publishes its own sitemap.
      url: `https://${spec.host}${spec.base}${first}/sitemap.xml`,
      expect: 'xml',
      minRecords: 1,
      family: 'legacy-help',
    },
  };
}

const PRO_SDK_REPO = 'Esri/arcgis-pro-sdk';

const arcgisProSdk: Product = {
  id: 'arcgis-pro-sdk',
  name: 'ArcGIS Pro SDK for .NET',
  aliases: [
    'pro-sdk',
    'arcgis.desktop',
    'arcgis.core',
    'pro sdk',
    'arcgis pro sdk',
    'arcgis pro add-in',
    'pro add-in',
  ],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'active',
  summary:
    'SDK for extending ArcGIS Pro with .NET add-ins and configurations: DAML, MVVM panes, editing, mapping, geodatabase.',
  keywords: [
    'add-in',
    'addin',
    'daml',
    'configuration',
    'dockpane',
    'ribbon',
    'map tool',
    'queuedtask',
    'mvvm',
    'wpf',
    'visual studio',
    'cim',
    'proconcepts',
    'proguide',
    'prosnippets',
    'arcgis pro',
    'desktop',
  ],
  languages: ['csharp'],
  homepage: `https://github.com/${PRO_SDK_REPO}/wiki`,
  // The NuGet ids of the SDK are not on the public flat container.
  packages: [],
  repos: [
    repo(PRO_SDK_REPO, 'docs', 'master'),
    repo('Esri/arcgis-pro-sdk-community-samples', 'samples', 'master'),
    repo('Esri/arcgis-pro-sdk-snippets', 'samples', 'main'),
  ],
  workspaceSignals: [
    {
      files: ['**/*.csproj', '**/Config.daml'],
      pattern: 'ArcGIS\\.Desktop\\.|Esri\\.ArcGISPro\\.Extensions|<ArcGIS\\s',
    },
  ],
  lines: [{ ...LATEST, label: 'Pro 3.x' }],
  sources: [
    githubSource(
      'wiki',
      'Concepts and guides (wiki)',
      { repo: PRO_SDK_REPO, preset: 'wiki' },
      { kinds: ['guide'], floor: true },
    ),
    {
      id: 'api',
      title: 'API reference (IntelliSense XML)',
      kinds: ['api'],
      adapter: 'xmldoc',
      config: { repo: PRO_SDK_REPO, dir: 'References/ArcGIS Pro API', docUrlHost: 'doc.esri.com' },
      capability: 'github',
      license: 'apache-2.0',
      probe: {
        url: `https://api.github.com/repos/${PRO_SDK_REPO}`,
        expect: 'json',
        mustContain: 'full_name',
      },
    },
    githubSource(
      'samples',
      'Community samples',
      { repo: 'Esri/arcgis-pro-sdk-community-samples', preset: 'samples-readme' },
      { pagesApprox: 334 },
    ),
    githubSource('snippets', 'Code snippets', {
      repo: 'Esri/arcgis-pro-sdk-snippets',
      preset: 'snippets-region',
    }),
  ],
  oracles: [
    { type: 'github-release', options: { repo: PRO_SDK_REPO }, provides: ['installable'] },
    { type: 'docesri-sitemap', options: { slug: 'arcgis-pro' }, provides: ['documented'] },
  ],
  startHere: [
    { title: 'ArcGIS Pro SDK wiki', ref: `https://github.com/${PRO_SDK_REPO}/wiki` },
    { title: 'Repository README', ref: `https://github.com/${PRO_SDK_REPO}/blob/master/README.md` },
  ],
  pitfalls: [
    'Most API calls must run on the main CIM thread inside QueuedTask.Run; the member remarks say when.',
    'An add-in built for Pro 3.x does not load in 2.x and the reverse; rebuild against the target major version.',
    'Concept and API topic pages on doc.esri.com are readable by URL but are not enumerated here.',
  ],
  related: ['arcpy', 'dotnet-maps-sdk', 'cim-spec', 'arcgis-pro'],
  licenseTier: 'apache-2.0',
  verifiedOn: VERIFIED_ON,
};

const enterpriseSdk: Product = {
  id: 'enterprise-sdk',
  name: 'ArcGIS Enterprise SDK',
  aliases: [
    'soe',
    'soi',
    'enterprise sdk',
    'server object extension',
    'server object interceptor',
    'custom data feeds',
    'cdf',
    'service interceptors',
    'arcobjects enterprise',
  ],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'active',
  summary:
    'SDK for extending ArcGIS Enterprise services: server object extensions and interceptors, custom data feeds, webhooks.',
  keywords: [
    'server object extension',
    'server object interceptor',
    'service interceptor',
    'custom data feed',
    'custom data provider',
    'arcobjects',
    'map service',
    'arcgis server',
    'extend services',
    'koop',
  ],
  languages: ['java', 'csharp', 'javascript'],
  homepage: `${D}/enterprise-sdk/`,
  packages: [],
  repos: [repo('Esri/arcgis-enterprise-sdk-resources', 'samples', 'master')],
  lines: [LATEST],
  sources: [
    {
      id: 'guide',
      title: 'Guide and .NET API reference',
      kinds: ['guide', 'api'],
      adapter: 'gatsby',
      config: {
        base: '/enterprise-sdk/',
        // The .NET types come from the reference navigation tree; their pages carry the
        // rendered reference in page data where it exists.
        symbols: 'apiref-nav',
        bodyFrom: 'auto',
        exclude: ['^api-reference/java/'],
      },
      capability: 'website',
      floor: true,
      pagesApprox: 3975,
      probe: {
        url: `${D}/enterprise-sdk/sitemap-0.xml`,
        expect: 'xml',
        minRecords: 1987,
        family: 'gatsby',
      },
    },
    {
      id: 'java-api',
      title: 'Java API reference',
      kinds: ['api'],
      adapter: 'javadoc',
      // Generated by an old javadoc: a frame set with a class list instead of search indexes.
      config: { base: '/enterprise-sdk/api-reference/java/', legacy: true },
      capability: 'website',
      pagesApprox: 6214,
      probe: {
        url: `${D}/enterprise-sdk/api-reference/java/allclasses-noframe.html`,
        expect: 'html',
        family: 'javadoc-legacy',
        minChars: 10_000,
      },
    },
    githubSource('samples', 'Samples', {
      repo: 'Esri/arcgis-enterprise-sdk-resources',
      preset: 'markdown-docs',
      exclude: ['**/bin/**', '**/obj/**', '**/target/**', '**/build/**', '**/node_modules/**'],
    }),
  ],
  oracles: [
    {
      type: 'page-regex',
      options: { url: `${D}/enterprise-sdk/` },
      provides: ['documented', 'released'],
    },
  ],
  // One page per version and language (`whats-new-12-1-net`), so there is no single template.
  releaseNotes: { sitemapFilter: '/whats-new-' },
  startHere: [{ title: 'ArcGIS Enterprise SDK', ref: `${D}/enterprise-sdk/` }],
  pitfalls: [
    'Extensions are built against one Enterprise version; the what-is-new pages are per version and per language.',
    'The Java reference is a frame-based Javadoc: open class pages by URL or through lookup, not through search.',
  ],
  related: ['rest-api', 'koop', 'arcgis-enterprise'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const cityengine: Product = {
  id: 'cityengine',
  name: 'ArcGIS CityEngine',
  aliases: ['cga', 'pyprt', 'procedural runtime', 'prt', 'city engine', 'cityengine sdk'],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'active',
  summary:
    'Procedural 3D city modelling: CGA shape grammar, the Python scripting API, the Procedural Runtime SDK and PyPRT.',
  keywords: [
    'procedural',
    'procedural modeling',
    'cga rule',
    'shape grammar',
    'rule package',
    'rpk',
    '3d city',
    'urban design',
    'jython',
    'scripting',
  ],
  languages: ['cga', 'python', 'cpp'],
  homepage: 'https://doc.arcgis.com/en/cityengine/latest/get-started/',
  packages: [{ registry: 'pypi', name: 'pyprt', license: 'apache-2.0', primary: true }],
  repos: [
    repo('Esri/cityengine-sdk', 'source', 'main'),
    repo('Esri/pyprt', 'source', 'main'),
    repo('Esri/pyprt-examples', 'samples', 'main'),
  ],
  workspaceSignals: [
    {
      files: ['requirements*.txt', 'pyproject.toml', 'environment.yml'],
      pattern: '\\bpyprt\\b\\s*(?:[=~<>!]=*\\s*(\\d[\\w.]*))?',
      versionGroup: 1,
    },
  ],
  lines: [LATEST],
  sources: [
    legacyHelp({
      id: 'help',
      title: 'Help, CGA reference and Python reference',
      kinds: ['help', 'api', 'tutorial'],
      host: 'doc.arcgis.com',
      base: '/en/cityengine/latest/',
      version: '2026.0',
      books: [
        ['cga', 1787],
        ['get-started', 1752],
        ['help', 2295],
        ['install/linux', 1400],
        ['install/windows', 1415],
        ['python', 2296],
        ['tutorials', 1161],
        ['whats-new', 2433],
      ],
      pages: 642,
    }),
    {
      id: 'sdk',
      title: 'Procedural Runtime and PyPRT API references',
      kinds: ['api'],
      adapter: 'static',
      config: {
        entries: [
          {
            url: 'https://esri.github.io/cityengine-sdk/html/',
            title: 'CityEngine SDK: Procedural Runtime C++ API reference',
            kind: 'api',
          },
          {
            url: 'https://esri.github.io/pyprt/apidoc/',
            title: 'PyPRT API reference',
            kind: 'api',
          },
        ],
      },
      capability: 'website',
      license: 'apache-2.0',
      probe: {
        url: 'https://esri.github.io/cityengine-sdk/html/',
        expect: 'html',
        minChars: 500,
      },
    },
    githubSource('examples', 'CityEngine SDK examples', {
      repo: 'Esri/cityengine-sdk',
      preset: 'markdown-docs',
    }),
    githubSource('pyprt-examples', 'PyPRT example notebooks', {
      repo: 'Esri/pyprt-examples',
      preset: 'notebooks',
    }),
  ],
  oracles: [],
  releaseNotes: {
    current: 'https://doc.arcgis.com/en/cityengine/latest/whats-new/cityengine-whats-new.htm',
  },
  esearch: { site: 'arcgis_doc_col', products: ['city-engine'] },
  startHere: [
    {
      title: "What's new in CityEngine",
      ref: 'https://doc.arcgis.com/en/cityengine/latest/whats-new/cityengine-whats-new.htm',
    },
    { title: 'Procedural Runtime API reference', ref: 'https://esri.github.io/cityengine-sdk/html/' },
    { title: 'PyPRT API reference', ref: 'https://esri.github.io/pyprt/apidoc/' },
  ],
  pitfalls: [
    'The built-in Python API runs on Jython inside CityEngine; PyPRT is a separate CPython package without the application.',
    'Numbered help URLs redirect to latest, so only the current release is documented.',
  ],
  related: ['arcgis-urban', 'python-api'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const earthAutomationApi: Product = {
  id: 'earth-automation-api',
  name: 'ArcGIS Earth Automation API',
  aliases: ['arcgis earth api', 'earth automation', 'arcgisearth-automation-api'],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'active',
  summary:
    'Local REST API of the ArcGIS Earth desktop app: control the camera, add layers and graphics, take snapshots.',
  keywords: ['arcgis earth', 'globe', 'camera', 'kml', 'localhost', 'automation', 'flight'],
  languages: ['rest'],
  homepage: 'https://doc.arcgis.com/en/arcgis-earth/automation-api/get-started.htm',
  packages: [],
  repos: [repo('Esri/arcgisearth-automation-api', 'samples', 'main')],
  lines: [LATEST],
  sources: [
    legacyHelp({
      id: 'api',
      title: 'Automation API reference',
      kinds: ['api', 'guide'],
      host: 'doc.arcgis.com',
      base: '/en/arcgis-earth/',
      books: [['automation-api', 2108]],
      pages: 31,
    }),
  ],
  oracles: [],
  esearch: { site: 'arcgis_doc_col', products: ['arcgis-earth'] },
  startHere: [
    {
      title: 'Automation API book',
      ref: 'https://doc.arcgis.com/en/arcgis-earth/automation-api/get-started.htm',
    },
  ],
  pitfalls: [
    'The API listens on localhost of the machine that runs ArcGIS Earth and must be enabled in the app settings.',
  ],
  related: ['arcgis-earth'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const autocadApi: Product = {
  id: 'autocad-api',
  name: 'ArcGIS for AutoCAD API',
  aliases: ['arcgis for autocad api', 'autocad api', 'autolisp'],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'active',
  summary:
    'AutoLISP and .NET API and commands of the ArcGIS for AutoCAD plug-in: feature layers, attributes, map services.',
  keywords: ['autocad', 'autolisp', 'lisp', 'cad', 'dwg', 'commands', 'plug-in', 'civil 3d'],
  languages: ['autolisp', 'csharp'],
  homepage: 'https://doc.arcgis.com/en/arcgis-for-autocad/latest/commands-api/',
  packages: [],
  repos: [repo('Esri/ArcGIS-for-AutoCAD-API-Samples', 'samples', 'main')],
  lines: [LATEST],
  sources: [
    legacyHelp({
      id: 'api',
      title: 'Commands and API reference',
      kinds: ['api', 'help'],
      host: 'doc.arcgis.com',
      base: '/en/arcgis-for-autocad/latest/',
      books: [['commands-api', 3085]],
      pages: 220,
    }),
  ],
  oracles: [],
  esearch: { site: 'arcgis_doc_col', products: ['arcgis-for-autocad'] },
  startHere: [
    {
      title: 'Commands and API reference',
      ref: 'https://doc.arcgis.com/en/arcgis-for-autocad/latest/commands-api/',
    },
  ],
  pitfalls: [
    'Each API function is documented twice, once for AutoLISP and once for .NET; the page title names the language.',
  ],
  related: ['arcgis-for-autocad'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

const geoeventServer: Product = {
  id: 'geoevent-server',
  name: 'ArcGIS GeoEvent Server',
  aliases: ['geoevent', 'geoevent processor', 'arcgis geoevent'],
  category: 'desktop-enterprise',
  tier: 'developer',
  status: 'deprecated',
  statusNote: 'The SDK and REST API documentation ship with the product, not on the web',
  successor: 'arcgis-velocity',
  summary:
    'Deprecated real-time event processing server of ArcGIS Enterprise: inputs, outputs, processors and filters.',
  keywords: [
    'real-time',
    'realtime',
    'streaming',
    'stream service',
    'connectors',
    'input',
    'output',
    'processor',
    'geofence',
    'iot',
  ],
  languages: ['java'],
  homepage: 'https://enterprise.arcgis.com/en/geoevent/latest/get-started/',
  packages: [],
  repos: [],
  lines: [LATEST],
  sources: [
    legacyHelp({
      id: 'help',
      title: 'Help',
      kinds: ['help'],
      host: 'enterprise.arcgis.com',
      base: '/en/geoevent/latest/',
      version: '12.1',
      books: [
        ['administer', 1334],
        ['analyze', 2577],
        ['deploy', 2585],
        ['disseminate-and-notify', 2578],
        ['geoevent-services', 2579],
        ['get-started', 1255],
        ['ingest', 2576],
        ['reference', 2580],
      ],
      pages: 164,
    }),
  ],
  oracles: [{ type: 'static', options: { version: '12.1' }, provides: ['documented'] }],
  startHere: [
    {
      title: 'GeoEvent Server help',
      ref: 'https://enterprise.arcgis.com/en/geoevent/latest/get-started/',
    },
  ],
  pitfalls: [
    'Deprecated: new real-time work belongs in ArcGIS Velocity.',
    'The GeoEvent SDK (custom connectors and processors) is documented only inside the product download.',
  ],
  related: ['arcgis-velocity', 'velocity-grpc', 'arcgis-enterprise'],
  licenseTier: 'esri-website-terms',
  verifiedOn: VERIFIED_ON,
};

/** The six products of design section 4.4. */
export const desktopEnterpriseProducts: readonly Product[] = [
  arcgisProSdk,
  enterpriseSdk,
  cityengine,
  earthAutomationApi,
  autocadApi,
  geoeventServer,
];
