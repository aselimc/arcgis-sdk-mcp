import { makeLine, makeProduct, makeSource } from '../../support/builders.js';
import type { CatalogRecord, DocKind, Product } from '../../../src/core/types.js';

/**
 * A small invented documentation estate for service tests: six products with the shapes the
 * services must handle (guide + reference + samples, two version lines, a scoped REST
 * product, briefs, a retired product, a link-tier product). Titles and descriptions are
 * written for these tests; only the host names are real.
 */

const ORIGIN = 'https://developers.arcgis.com';

/** JavaScript SDK: guide, core reference, a second reference source and samples. */
export const jsSdk: Product = makeProduct({
  id: 'js-maps-sdk',
  name: 'Maps SDK for JavaScript',
  aliases: ['javascript', '@arcgis/core'],
  keywords: ['javascript', 'web', 'browser', 'featurelayer', 'mapview', 'webmap', 'arcgis-map'],
  languages: ['javascript', 'typescript'],
  homepage: `${ORIGIN}/javascript/latest/`,
  startHere: [{ title: 'Get started with the SDK', ref: `${ORIGIN}/javascript/latest/get-started/` }],
  sources: [
    makeSource(
      'gatsby',
      { base: '/javascript/latest/' },
      { id: 'guide', title: 'Guide', kinds: ['guide', 'tutorial'] },
    ),
    makeSource(
      'astro',
      { base: '/javascript/latest/references/core/' },
      { id: 'core', title: 'Core API reference', kinds: ['api'], floor: false, fallbacks: ['typings'] },
    ),
    makeSource(
      'npm-dts',
      { package: '@arcgis/core', docUrl: '/javascript/latest/references/core/{path}/' },
      {
        id: 'typings',
        title: 'Core typings',
        kinds: ['api'],
        floor: false,
        capability: 'package-cdn',
      },
    ),
    makeSource(
      'docc',
      { base: '/javascript/latest/sample-code/' },
      { id: 'samples', title: 'Samples', kinds: ['sample'], floor: false },
    ),
  ],
});

/** Kotlin SDK: current and LTS lines, guide, reference and GitHub samples. */
export const kotlinSdk: Product = makeProduct({
  id: 'kotlin-maps-sdk',
  name: 'Maps SDK for Kotlin',
  aliases: ['kotlin', 'android'],
  category: 'native',
  keywords: ['kotlin', 'android', 'offline', 'mobile', 'geodatabase'],
  languages: ['kotlin'],
  homepage: `${ORIGIN}/kotlin/`,
  lines: [
    makeLine({ id: 'latest', label: '300.x', vars: { prefix: '' } }),
    makeLine({ id: 'v200', label: '200.x LTS', current: false, vars: { prefix: 'v200/' } }),
  ],
  sources: [
    makeSource(
      'gatsby',
      { base: '/kotlin/{prefix}', exclude: ['^api-reference/'] },
      { id: 'guide', title: 'Guide', kinds: ['guide', 'tutorial'] },
    ),
    makeSource(
      'dokka',
      { base: '/kotlin/{prefix}api-reference/' },
      { id: 'api', title: 'API reference', kinds: ['api'], floor: false },
    ),
    makeSource(
      'github-repo',
      { repo: 'Esri/arcgis-maps-sdk-kotlin-samples', preset: 'samples-metadata' },
      {
        id: 'samples',
        title: 'Samples on GitHub',
        kinds: ['sample'],
        floor: false,
        capability: 'github',
        license: 'apache-2.0',
        lines: ['latest'],
      },
    ),
  ],
});

/** REST APIs: two scoped sources of the same adapter type. */
export const restApi: Product = makeProduct({
  id: 'rest-api',
  name: 'ArcGIS REST APIs',
  aliases: ['rest'],
  category: 'rest-services',
  keywords: ['rest', 'endpoint', 'operation', 'feature service', 'portal'],
  languages: ['json'],
  homepage: `${ORIGIN}/rest/`,
  sources: [
    makeSource(
      'javadoc',
      { base: '/rest/services-reference/enterprise/' },
      { id: 'services', title: 'Services reference', kinds: ['api'], priority: 1 },
    ),
    makeSource(
      'javadoc',
      { base: '/rest/users-groups-and-items/' },
      { id: 'portal', title: 'Portal directory', kinds: ['api'], floor: false, priority: 2 },
    ),
  ],
});

// Briefs are bundled: the source needs no capability, so the builder's default is removed.
const { capability: _bundled, ...briefSource } = makeSource(
  'brief',
  { slugs: ['ai/*'] },
  { id: 'briefs', title: 'Briefs', kinds: ['brief'], license: 'project' },
);

/** The AI product: curated briefs. */
export const aiAgents: Product = makeProduct({
  id: 'ai-agents',
  name: 'AI, agents and MCP across ArcGIS',
  aliases: ['mcp', 'agentic-ai'],
  category: 'ai',
  status: 'beta',
  keywords: ['ai', 'agent', 'mcp', 'assistant'],
  languages: [],
  homepage: `${ORIGIN}/ai/`,
  licenseTier: 'project',
  sources: [briefSource],
});

/** A retired product: its hits are down-weighted. */
export const arcObjects: Product = makeProduct({
  id: 'arcobjects',
  name: 'ArcObjects SDK',
  aliases: ['arcmap'],
  category: 'desktop-enterprise',
  status: 'retired',
  successor: 'js-maps-sdk',
  keywords: ['arcobjects', 'arcmap', 'desktop', 'featurelayer'],
  languages: ['csharp'],
  homepage: 'https://desktop.arcgis.com/en/arcobjects/',
  sources: [
    makeSource(
      'sitemap',
      { url: 'https://desktop.arcgis.com/en/arcobjects/sitemap.xml' },
      { id: 'help', title: 'Help', kinds: ['help'] },
    ),
  ],
});

/** A product that is listed but only linked to. */
export const linkProduct: Product = makeProduct({
  id: 'cityengine',
  name: 'ArcGIS CityEngine',
  aliases: [],
  tier: 'link',
  category: 'product-help',
  keywords: ['cityengine', 'procedural', 'rules'],
  languages: [],
  homepage: 'https://doc.arcgis.com/en/cityengine/latest/',
  sources: [
    makeSource(
      'sphinx',
      { base: 'https://doc.arcgis.com/en/cityengine/latest/' },
      { id: 'help', title: 'Help', kinds: ['help'] },
    ),
  ],
});

/** Every fixture product. */
export const PRODUCTS: Product[] = [jsSdk, kotlinSdk, restApi, aiAgents, arcObjects, linkProduct];

function rec(
  product: Product,
  source: string,
  path: string,
  title: string,
  extra: Partial<CatalogRecord> = {},
): CatalogRecord {
  const def = product.sources.find((candidate) => candidate.id === source);
  const kind: DocKind = extra.kind ?? def?.kinds[0] ?? 'guide';
  return {
    ref: /^(?:https|brief):/.test(path) ? path : `${ORIGIN}${path}`,
    product: product.id,
    source,
    line: 'latest',
    kind,
    title,
    license: def?.license ?? product.licenseTier,
    ...extra,
  };
}

function type(product: Product, source: string, path: string, name: string, description: string) {
  return rec(product, source, path, name, {
    symbol: name,
    qualified: name,
    symbolKind: 'class',
    description,
  });
}

function member(
  product: Product,
  source: string,
  path: string,
  parent: string,
  name: string,
  symbolKind: string,
  description: string,
) {
  return rec(product, source, `${path}#${name}`, `${parent}.${name}`, {
    symbol: name,
    qualified: `${parent}.${name}`,
    parent,
    symbolKind,
    description,
  });
}

const JS_CORE = '/javascript/latest/references/core';

/** Records of the JavaScript SDK. */
export const JS_RECORDS: CatalogRecord[] = [
  rec(jsSdk, 'guide', '/javascript/latest/get-started/', 'Get started with the SDK', {
    description: 'Install the packages and show a first map in the browser.',
    keywords: ['install', 'npm', 'cdn'],
  }),
  rec(jsSdk, 'guide', '/javascript/latest/clustering/', 'Cluster points', {
    description: 'Group nearby point features into clusters that grow with zoom level.',
    headings: ['Enable clustering', 'Cluster popups', 'Label clusters'],
    breadcrumb: 'Guide > Visualization',
  }),
  rec(jsSdk, 'guide', '/javascript/latest/popups/', 'Configure popups', {
    description: 'Show attributes of a feature when the user clicks it.',
    headings: ['Popup templates', 'Arcade in popups'],
    breadcrumb: 'Guide > Visualization',
  }),
  rec(jsSdk, 'guide', '/javascript/latest/authentication/', 'Authentication', {
    description: 'Sign users in with OAuth or use an API key.',
    headings: ['OAuth with PKCE', 'API keys', 'App authentication'],
    keywords: ['oauth', 'identity', 'token'],
  }),
  rec(jsSdk, 'guide', '/javascript/latest/editing/', 'Edit features', {
    description: 'Add, update and delete features and their attachments.',
    headings: ['Apply edits', 'Attachments', 'Editing constraints'],
  }),
  rec(jsSdk, 'guide', '/javascript/latest/release-notes/', 'Release notes', {
    kind: 'release-notes',
    description: 'What changed in this release, including breaking changes.',
  }),
  rec(
    jsSdk,
    'guide',
    '/javascript/latest/tutorials/display-a-map/',
    'Tutorial: display a map',
    {
      kind: 'tutorial',
      description: 'Step by step: create a page with a map and a basemap.',
    },
  ),
  rec(
    jsSdk,
    'guide',
    '/javascript/latest/migration/components/',
    'Migrate widgets to components',
    {
      description: 'Replace widget classes with web components, one at a time.',
      keywords: ['upgrade', 'widgets', 'components'],
    },
  ),
  type(jsSdk, 'core', `${JS_CORE}/layers/FeatureLayer/`, 'FeatureLayer', 'A layer of features from a service or client-side graphics.'),
  member(jsSdk, 'core', `${JS_CORE}/layers/FeatureLayer/`, 'FeatureLayer', 'queryFeatures', 'method', 'Runs a query against the layer and resolves to a feature set.'),
  member(jsSdk, 'core', `${JS_CORE}/layers/FeatureLayer/`, 'FeatureLayer', 'applyEdits', 'method', 'Sends adds, updates and deletes to the service.'),
  member(jsSdk, 'core', `${JS_CORE}/layers/FeatureLayer/`, 'FeatureLayer', 'featureReduction', 'property', 'Configures clustering or binning of point features.'),
  type(jsSdk, 'core', `${JS_CORE}/layers/GraphicsLayer/`, 'GraphicsLayer', 'A layer holding client-side graphics.'),
  type(jsSdk, 'core', `${JS_CORE}/views/MapView/`, 'MapView', 'A two-dimensional view of a map.'),
  member(jsSdk, 'core', `${JS_CORE}/views/MapView/`, 'MapView', 'goTo', 'method', 'Animates the view to a target.'),
  type(jsSdk, 'core', `${JS_CORE}/views/SceneView/`, 'SceneView', 'A three-dimensional view of a scene.'),
  member(jsSdk, 'core', `${JS_CORE}/views/SceneView/`, 'SceneView', 'goTo', 'method', 'Animates the camera to a target.'),
  type(jsSdk, 'core', `${JS_CORE}/geometry/Point/`, 'Point', 'A location with x and y coordinates.'),
  rec(jsSdk, 'core', `${JS_CORE}/rest/support/Query/`, 'Query', {
    symbol: 'Query',
    qualified: 'rest.support.Query',
    symbolKind: 'class',
    description: 'Parameters of a query against a layer or service.',
  }),
  rec(jsSdk, 'core', `${JS_CORE}/smartMapping/Point/`, 'Point (statistics)', {
    symbol: 'Point',
    qualified: 'smartMapping.Point',
    symbolKind: 'class',
    description: 'A statistics helper that happens to share a name.',
  }),
  type(jsSdk, 'typings', `${JS_CORE}/layers/FeatureLayer/`, 'FeatureLayer', 'Typings of the feature layer class.'),
  rec(
    jsSdk,
    'samples',
    '/javascript/latest/sample-code/featurereduction-cluster/',
    'Point clustering sample',
    {
      description: 'Clusters earthquake points and shows a popup for each cluster.',
      keywords: ['cluster', 'popup'],
    },
  ),
  rec(jsSdk, 'samples', '/javascript/latest/sample-code/editing-applyedits/', 'Apply edits sample', {
    description: 'Adds and deletes features with applyEdits on a FeatureLayer.',
    keywords: ['FeatureLayer', 'applyEdits', 'editing'],
  }),
  rec(jsSdk, 'samples', '/javascript/latest/sample-code/layers-scenelayer/', 'Scene layer sample', {
    description: 'Shows textured buildings in a scene.',
  }),
  rec(jsSdk, 'samples', '/javascript/latest/sample-code/widgets-legacy/', 'Legacy widget sample', {
    description: 'Uses a widget class that components replace; edits features too.',
    keywords: ['editing'],
    deprecated: true,
  }),
];

const KT_SAMPLES = 'https://github.com/Esri/arcgis-maps-sdk-kotlin-samples/tree/v300.0.0';

/** Records of the Kotlin SDK on both lines. */
export const KOTLIN_RECORDS: CatalogRecord[] = [
  rec(kotlinSdk, 'guide', '/kotlin/offline-maps/', 'Take a map offline', {
    description: 'Download a map area to the device and open it without a network.',
    headings: ['Preplanned areas', 'On-demand areas', 'Synchronize edits'],
  }),
  rec(kotlinSdk, 'guide', '/kotlin/install-and-set-up/', 'Install and set up', {
    description: 'Add the Maven repository and the dependency to a Gradle project.',
  }),
  rec(kotlinSdk, 'guide', '/kotlin/v200/offline-maps/', 'Take a map offline', {
    line: 'v200',
    description: 'Download a map area with the 200.x API.',
  }),
  rec(kotlinSdk, 'api', '/kotlin/api-reference/arcgis/com.arcgismaps.mapping/-arc-g-i-s-map/', 'ArcGISMap', {
    symbol: 'ArcGISMap',
    qualified: 'com.arcgismaps.mapping.ArcGISMap',
    symbolKind: 'class',
    description: 'A map: basemap, operational layers and tables.',
  }),
  rec(kotlinSdk, 'api', '/kotlin/api-reference/arcgis/com.arcgismaps.mapping.layers/-feature-layer/', 'FeatureLayer', {
    symbol: 'FeatureLayer',
    qualified: 'com.arcgismaps.mapping.layers.FeatureLayer',
    symbolKind: 'class',
    description: 'A layer that draws features of a feature table.',
  }),
  rec(kotlinSdk, 'samples', `${KT_SAMPLES}/samples/download-preplanned-map-area`, 'Download preplanned map area', {
    description: 'Takes a preplanned map area offline.',
    platform: 'android',
    language: 'kotlin',
  }),
  rec(kotlinSdk, 'samples', `${KT_SAMPLES}/samples/add-feature-layers`, 'Add feature layers', {
    description: 'Shows feature layers from different data sources.',
    platform: 'android',
    language: 'kotlin',
  }),
];

const REST_SVC = '/rest/services-reference/enterprise';

/** Records of the REST APIs. */
export const REST_RECORDS: CatalogRecord[] = [
  rec(restApi, 'services', `${REST_SVC}/apply-edits-feature-service-layer/`, '/applyEdits: Apply Edits (Feature Service/Layer)', {
    symbol: 'applyEdits',
    qualified: 'FeatureService.Layer.applyEdits',
    symbolKind: 'operation',
    description: 'Adds, updates and deletes features of one layer in a single request.',
  }),
  rec(restApi, 'services', `${REST_SVC}/add-attachment/`, '/addAttachment: Add Attachment', {
    symbol: 'addAttachment',
    qualified: 'FeatureService.Layer.Feature.addAttachment',
    symbolKind: 'operation',
    description: 'Uploads a file and attaches it to a feature.',
  }),
  rec(restApi, 'services', `${REST_SVC}/query-feature-service-layer/`, '/query: Query (Feature Service/Layer)', {
    symbol: 'query',
    qualified: 'FeatureService.Layer.query',
    symbolKind: 'operation',
    description: 'Returns the features of a layer that satisfy a filter.',
  }),
  rec(restApi, 'portal', '/rest/users-groups-and-items/add-item/', '/addItem: Add Item', {
    symbol: 'addItem',
    qualified: 'User.addItem',
    symbolKind: 'operation',
    description: 'Creates an item in the content of a user.',
  }),
  rec(restApi, 'portal', '/rest/users-groups-and-items/search/', '/search: Search', {
    symbol: 'search',
    qualified: 'Portal.search',
    symbolKind: 'operation',
    description: 'Finds items, groups and users of a portal.',
  }),
  rec(restApi, 'portal', '/rest/users-groups-and-items/webhooks/', 'Webhooks', {
    kind: 'guide',
    description: 'Get notified when items, groups or users change.',
  }),
];

/** Records of the AI product: briefs. */
export const AI_RECORDS: CatalogRecord[] = [
  rec(aiAgents, 'briefs', 'brief:ai/overview', 'AI across ArcGIS: an overview', {
    description: 'Where AI assistants, agents and MCP servers fit in the platform.',
    keywords: ['mcp', 'agent', 'assistant'],
  }),
  rec(aiAgents, 'briefs', 'brief:ai/mcp-servers', 'MCP servers for ArcGIS', {
    description: 'Which MCP servers exist, how they authenticate and what they can do.',
  }),
];

/** Records of the retired and link-tier products. */
export const OTHER_RECORDS: CatalogRecord[] = [
  rec(arcObjects, 'help', 'https://desktop.arcgis.com/en/arcobjects/feature-layer/', 'FeatureLayer', {
    description: 'The feature layer class of the retired desktop SDK.',
  }),
  rec(linkProduct, 'help', 'https://doc.arcgis.com/en/cityengine/latest/rules/', 'Rule files', {
    description: 'Write procedural rules that generate buildings.',
  }),
];

/** Every fixture record. */
export const RECORDS: CatalogRecord[] = [
  ...JS_RECORDS,
  ...KOTLIN_RECORDS,
  ...REST_RECORDS,
  ...AI_RECORDS,
  ...OTHER_RECORDS,
];

/** The briefs of the fixture registry. */
export const BRIEFS = [
  {
    slug: 'ai/overview',
    title: 'AI across ArcGIS: an overview',
    verifiedOn: '2026-10-13',
    sources: ['https://developers.arcgis.com/ai/'],
    markdown: [
      '# AI across ArcGIS: an overview',
      '',
      'Three things are called AI here, and they are easy to mix up.',
      '',
      '## Assistants inside an app',
      '',
      'Components that answer questions about the map the user is looking at.',
      '',
      '## MCP servers',
      '',
      'Servers that let an agent call location services.',
    ].join('\n'),
  },
  {
    slug: 'auth/choosing-authentication',
    title: 'Choosing an authentication type',
    verifiedOn: '2026-10-13',
    sources: ['https://developers.arcgis.com/documentation/security-and-authentication/'],
    markdown: '# Choosing an authentication type\n\nUse user authentication for private content.',
  },
];
