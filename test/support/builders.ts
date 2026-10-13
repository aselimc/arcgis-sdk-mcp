import { attribution } from '../../src/core/attribution.js';
import { CONFIG_DEFAULTS, DEFAULT_LIMITS, type Config } from '../../src/core/config.js';
import { PRESETS } from '../../src/core/capabilities.js';
import type { HttpResponse } from '../../src/core/ports.js';
import { sectionsFromMarkdown } from '../../src/core/sections.js';
import type {
  AdapterConfigMap,
  AdapterType,
  CatalogRecord,
  DocPage,
  HostPolicy,
  Product,
  SearchHit,
  SourceDef,
  VersionLine,
} from '../../src/core/types.js';
import { FAKE_NOW } from './fake-clock.js';

/**
 * Builders for domain objects with sensible defaults. Every builder takes a partial
 * override, so a test states only what it is about. All data is invented: the hosts are
 * real documentation hosts, the paths and prose are not.
 */

/** ISO timestamp matching `FAKE_NOW`. */
export const FAKE_NOW_ISO = new Date(FAKE_NOW).toISOString();

/** A `Config` for stdio mode with preset `standard`. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: '0.0.0-test',
    repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp',
    mode: 'stdio',
    preset: 'standard',
    capabilities: new Set(PRESETS.standard),
    offline: false,
    cacheMaxMb: CONFIG_DEFAULTS.cacheMaxMb,
    memoryMaxMb: CONFIG_DEFAULTS.memoryMaxMb,
    projectDir: '/project',
    defaultMaxTokens: CONFIG_DEFAULTS.defaultMaxTokens,
    logLevel: 'silent',
    limits: { ...DEFAULT_LIMITS },
    ...overrides,
  };
}

/** A version line; `latest` and current by default. */
export function makeLine(overrides: Partial<VersionLine> = {}): VersionLine {
  return { id: 'latest', label: 'Current', current: true, access: 'live', vars: {}, ...overrides };
}

/** A source of the given adapter type. `config` is checked against the adapter. */
export function makeSource<A extends AdapterType>(
  adapter: A,
  config: AdapterConfigMap[A],
  overrides: Partial<Omit<SourceDef<A>, 'adapter' | 'config'>> = {},
): SourceDef<A> {
  return {
    id: 'guide',
    title: 'Guide',
    kinds: ['guide'],
    adapter,
    config,
    capability: 'website',
    floor: true,
    probe: { url: 'https://developers.arcgis.com/widgets/', expect: 'html' },
    ...overrides,
  };
}

/** A developer-tier product with one Gatsby guide source at `/widgets/`. */
export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'widgets-sdk',
    name: 'Widgets SDK',
    aliases: ['widgets'],
    category: 'web',
    tier: 'developer',
    status: 'active',
    summary: 'An invented SDK used by tests.',
    keywords: ['widgets', 'testing'],
    languages: ['typescript'],
    homepage: 'https://developers.arcgis.com/widgets/',
    packages: [],
    repos: [],
    lines: [makeLine()],
    sources: [makeSource('gatsby', { base: '/widgets/' })],
    oracles: [],
    startHere: [],
    pitfalls: [],
    related: [],
    licenseTier: 'esri-website-terms',
    verifiedOn: '2026-10-13',
    ...overrides,
  };
}

/** A catalogue record for a guide page of `widgets-sdk`. */
export function makeRecord(overrides: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    ref: 'https://developers.arcgis.com/widgets/get-started/',
    product: 'widgets-sdk',
    source: 'guide',
    line: 'latest',
    kind: 'guide',
    title: 'Get started',
    license: 'esri-website-terms',
    ...overrides,
  };
}

/** A search hit; fields follow {@link makeRecord}. */
export function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    ref: 'https://developers.arcgis.com/widgets/get-started/',
    title: 'Get started',
    product: 'widgets-sdk',
    source: 'guide',
    line: 'latest',
    kind: 'guide',
    match: 'title',
    score: 1,
    license: 'esri-website-terms',
    ...overrides,
  };
}

/** A host row with generous limits. */
export function makeHost(overrides: Partial<HostPolicy> = {}): HostPolicy {
  return {
    host: 'developers.arcgis.com',
    capability: 'website',
    robotsDisallow: [],
    revalidate: 'etag',
    ratePerSec: 2,
    maxConcurrent: 2,
    ...overrides,
  };
}

/** An `HttpResponse` as the gateway returns it for a fresh fetch. */
export function makeResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  const url = overrides.url ?? 'https://developers.arcgis.com/widgets/get-started/';
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    text: '<html><body><main><h1>Get started</h1><p>Install the package.</p></main></body></html>',
    fetchedAt: FAKE_NOW_ISO,
    cache: 'miss',
    aliasChain: [],
    ...overrides,
  };
}

/** The Markdown of the default {@link makeDocPage}: a lead, two sections, a fence and a table. */
export const SAMPLE_MARKDOWN = [
  '# Get started',
  '',
  'Install the package and create a widget.',
  '',
  '## Install',
  '',
  '```bash',
  'npm install @example/widgets',
  '```',
  '',
  '## Options',
  '',
  '| Option | Default |',
  '| --- | --- |',
  '| `size` | `medium` |',
].join('\n');

/**
 * A converted page. `markdown` (default {@link SAMPLE_MARKDOWN}) becomes `sections`; the
 * attribution line is generated from the licence tier, as adapters do.
 */
export function makeDocPage(overrides: Partial<DocPage> & { markdown?: string } = {}): DocPage {
  const { markdown = SAMPLE_MARKDOWN, ...rest } = overrides;
  const url = rest.url ?? rest.ref ?? 'https://developers.arcgis.com/widgets/get-started/';
  const license = rest.license ?? 'esri-website-terms';
  const cache = rest.cache ?? 'miss';
  const retrievedAt = rest.retrievedAt ?? FAKE_NOW_ISO;
  const sections = sectionsFromMarkdown(markdown);
  return {
    ref: url,
    url,
    title: sections[0]?.title ?? 'Untitled',
    product: 'widgets-sdk',
    source: 'guide',
    line: 'latest',
    kind: 'guide',
    sections,
    license,
    attribution: attribution(license, { url, retrievedAt, cache }),
    retrievedAt,
    cache,
    redirectedFrom: [],
    diagnostics: {
      family: 'structured',
      fences: 0,
      fencesWithLanguage: 0,
      tablesByStrategy: {},
      unknownIslands: [],
      leftoverHtmlTags: 0,
      redirectHops: 0,
      ms: 0,
    },
    notices: [],
    ...rest,
  };
}
