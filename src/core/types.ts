/**
 * Domain data types shared by every package.
 *
 * This file holds data shapes only: no behaviour, no imports. Anything that crosses a
 * package boundary is declared here or in `ports.ts`.
 */

/** Content type of a document or catalogue record. */
export type DocKind =
  | 'guide'
  | 'tutorial'
  | 'api'
  | 'sample'
  | 'release-notes'
  | 'spec'
  | 'help'
  | 'troubleshooting'
  | 'brief';

/** Every {@link DocKind}, for schemas and exhaustive iteration. */
export const DOC_KINDS = [
  'guide',
  'tutorial',
  'api',
  'sample',
  'release-notes',
  'spec',
  'help',
  'troubleshooting',
  'brief',
] as const satisfies readonly DocKind[];

/**
 * Licence tier of a piece of content. It selects the `Source:` line (`attribution.ts`) and
 * whether text may be adapted (`cc-by-nd` is returned verbatim only).
 */
export type LicenseTier =
  'esri-website-terms' | 'esri-ma' | 'apache-2.0' | 'cc-by-nd' | 'unlicensed' | 'project';

/** Every {@link LicenseTier}. */
export const LICENSE_TIERS = [
  'esri-website-terms',
  'esri-ma',
  'apache-2.0',
  'cc-by-nd',
  'unlicensed',
  'project',
] as const satisfies readonly LicenseTier[];

/**
 * A class of upstream source that can be switched on or off as a unit.
 * The first seven are on in preset `standard`; `site-search` and `lifecycle-api` are opt-in.
 *
 * Two places enforce a capability:
 *
 * - the gateway, per host: `SourcePolicy.check` refuses a URL whose host needs a capability
 *   that is off ({@link HostPolicy.capability});
 * - the caller, per kind of file: `site-index` shares its hosts with `website`, so only the
 *   adapter knows that a request is for a site-published index file (search and symbol
 *   indexes, nav / TOC / manifest JSON, xrefmaps, inventories). Adapters ask
 *   `ctx.policy.enabled('site-index')` before requesting one. Sitemaps are read under the
 *   source's own capability: they are the rung below the index files, which is what keeps a
 *   source enumerable with `-site-index` (slug-derived titles).
 */
export type Capability =
  | 'website'
  | 'site-index'
  | 'package-cdn'
  | 'github'
  | 'registries'
  | 'local-packages'
  | 'workspace'
  | 'site-search'
  | 'lifecycle-api';

/** Product grouping used by `arcgis_docs_list_products`. */
export type Category =
  | 'web'
  | 'native'
  | 'game-engine'
  | 'python'
  | 'desktop-enterprise'
  | 'rest-services'
  | 'ai'
  | 'specs'
  | 'devops-oss'
  | 'support'
  | 'product-help';

/** Every {@link Category}. */
export const CATEGORIES = [
  'web',
  'native',
  'game-engine',
  'python',
  'desktop-enterprise',
  'rest-services',
  'ai',
  'specs',
  'devops-oss',
  'support',
  'product-help',
] as const satisfies readonly Category[];

/** Lifecycle status of a product. `retired` products are tombstones. */
export type ProductStatus = 'active' | 'beta' | 'deprecated' | 'retired';

/**
 * How deeply a product is covered: `developer` (full), `help` (end-user help, full), `link`
 * (listed and readable when named explicitly; the router never picks it).
 */
export type ProductTier = 'developer' | 'help' | 'link';

/** Where a response body came from. `stale` means an expired copy served after an upstream failure. */
export type CacheState = 'hit' | 'revalidated' | 'miss' | 'stale';

/** Freshness class of a cached HTTP entry; durations live in `src/cache/ttl.ts`. */
export type TtlClass =
  | 'immutable'
  | 'page'
  | 'index'
  | 'volatile'
  | 'github-meta'
  | 'spec'
  | 'remote-search'
  | 'negative';

/** In-memory health of one source. */
export type HealthState = 'ok' | 'degraded' | 'failing' | 'disabled' | 'unknown';

/** How much of a symbol `arcgis_docs_lookup_symbol` returns. */
export type SymbolDetail = 'signature' | 'summary' | 'full';

/** HTML page family; selects the extraction profile. */
export type HtmlFamily =
  | 'astro'
  | 'astro-js-ref'
  | 'astro-sample'
  | 'gatsby'
  | 'gatsby-rest'
  | 'qdoc'
  | 'dokka'
  | 'dartdoc'
  | 'docfx-net'
  | 'docfx-esri'
  | 'documentx'
  | 'javadoc'
  | 'javadoc-legacy'
  | 'legacy-help'
  | 'support-kb'
  | 'generic';

/** Every {@link HtmlFamily}, in no particular order (detection order is owned by the extractor). */
export const HTML_FAMILIES = [
  'astro',
  'astro-js-ref',
  'astro-sample',
  'gatsby',
  'gatsby-rest',
  'qdoc',
  'dokka',
  'dartdoc',
  'docfx-net',
  'docfx-esri',
  'documentx',
  'javadoc',
  'javadoc-legacy',
  'legacy-help',
  'support-kb',
  'generic',
] as const satisfies readonly HtmlFamily[];

/** A published package that carries or identifies a product. */
export interface PackageRef {
  registry: 'npm' | 'pypi' | 'nuget' | 'pub' | 'maven' | 'swiftpm' | 'cran';
  name: string;
  license: LicenseTier;
  /** The package whose version is "the" product version. */
  primary?: boolean;
}

/** A GitHub repository related to a product. */
export interface RepoRef {
  /** `owner/name`. */
  repo: string;
  role: 'samples' | 'toolkit' | 'source' | 'docs' | 'spec' | 'templates';
  license: LicenseTier;
  /** A hint verified at registry-authoring time; the real default branch is discovered at run time. */
  defaultBranch: string;
}

/** How to recognise a product in a workspace: a glob list plus a regex applied to each file's text. */
export interface WorkspaceSignal {
  files: string[];
  pattern: string;
  /** Capture group of `pattern` that holds the version, when the manifest states one. */
  versionGroup?: number;
}

/** One documentation line of a product (for example current and LTS). */
export interface VersionLine {
  /** `latest`, `v200`, `2.3`, `3.6`, `11.5`. */
  id: string;
  /** Human label: `300.x`, `200.x LTS`, `Pro 3.6`. */
  label: string;
  /** Exactly one line per product is current. */
  current: boolean;
  /**
   * `link-only`: the pages of this line are never fetched (an archive host, or gone), so its
   * sources with capability `website` or `site-index` answer `LINK_ONLY` with the URL. Sources
   * that address versions themselves (npm packages, GitHub tags) still work on such a line and
   * are bound with the requested version (`BoundSource.version`).
   */
  access: 'live' | 'link-only';
  /** Substituted into source URL templates, for example `{ prefix: 'v200/' }`. */
  vars: Record<string, string>;
}

/** One entry of the product registry. */
export interface Product {
  /** Kebab-case, stable forever, never reused. */
  id: string;
  /** Official product name. */
  name: string;
  /** Lower-case names, abbreviations, package names, old names. */
  aliases: string[];
  category: Category;
  tier: ProductTier;
  status: ProductStatus;
  /** For example `Final release 200.6`. */
  statusNote?: string;
  /** Product id of the successor of a deprecated or retired product. */
  successor?: string;
  /** At most 160 characters, written by this project. */
  summary: string;
  /** Router vocabulary. */
  keywords: string[];
  /** Fence languages and filters. */
  languages: string[];
  /** Always-reachable entry page. */
  homepage: string;
  packages: PackageRef[];
  repos: RepoRef[];
  workspaceSignals?: WorkspaceSignal[];
  lines: VersionLine[];
  /** A discriminated union on `adapter`, so each `config` is checked against its adapter type. */
  sources: AnySourceDef[];
  /** Ordered; the first success per role wins, all are kept as evidence. */
  oracles: OracleSpec[];
  compatibility?: Array<{ name: string; url: string }>;
  releaseNotes?: { current?: string; pattern?: string; sitemapFilter?: string };
  esearch?: {
    index?: string;
    site?: string;
    products?: string[];
    urlPrefix?: string;
    keepUrl?: string;
    dropUrl?: string;
  };
  startHere: Array<{ title: string; ref: string }>;
  /** At most four agent-facing one-liners, written by this project. */
  pitfalls: string[];
  /** Related product ids. */
  related: string[];
  /** Default tier; sources may override. */
  licenseTier: LicenseTier;
  /** ISO date of the last manual verification. */
  verifiedOn: string;
}

/** Identifier of a source adapter implementation. */
export type AdapterType =
  | 'astro'
  | 'gatsby'
  | 'docfx-esri'
  | 'legacy-help'
  | 'sitemap'
  | 'static'
  | 'brief'
  | 'openapi'
  | 'docc'
  | 'dokka'
  | 'dartdoc'
  | 'docfx-net'
  | 'javadoc'
  | 'sphinx'
  | 'npm-dts'
  | 'npm-cem'
  | 'npm-json'
  | 'github-repo'
  | 'xmldoc'
  | 'pkgdown';

/** Every {@link AdapterType}; the first eight are site adapters, the rest reference adapters. */
export const ADAPTER_TYPES = [
  'astro',
  'gatsby',
  'docfx-esri',
  'legacy-help',
  'sitemap',
  'static',
  'brief',
  'openapi',
  'docc',
  'dokka',
  'dartdoc',
  'docfx-net',
  'javadoc',
  'sphinx',
  'npm-dts',
  'npm-cem',
  'npm-json',
  'github-repo',
  'xmldoc',
  'pkgdown',
] as const satisfies readonly AdapterType[];

/**
 * Path filters applied to URLs of a source. Patterns are regular-expression sources matched
 * against the path **relative to the source base** (no leading slash), for example
 * `^api-reference/` or `/live/$`. Semantics are implemented once in `adapter-helpers.ts`.
 */
export interface UrlFilter {
  include?: string[];
  exclude?: string[];
  classify?: Array<[pattern: string, kind: DocKind]>;
}

/** Configuration shape per adapter type. `base` values are absolute URLs or paths on developers.arcgis.com. */
export interface AdapterConfigMap {
  astro: UrlFilter & {
    base: string;
    sitemap?: string;
    searchIndexes?: Array<{ url: string; role: 'guide' | 'sample' | 'api'; platform?: string }>;
    sampleIndexPage?: string;
    symbolsFromSlug?: string;
  };
  gatsby: UrlFilter & {
    base: string;
    seedPage?: string;
    symbols?:
      | 'typedoc'
      | 'openapi'
      | 'fuse-store'
      | 'sphinx-pagination'
      | 'apiref-nav'
      | 'glossary'
      | 'rest-operations';
    bodyFrom?:
      'auto' | 'html' | 'jupyterNotebook' | 'sphinxJson' | 'apiRef' | 'childMarkdownRemark';
    symbolsFromSlug?: string;
  };
  'docfx-esri': {
    slug: string;
    scope?: string;
    toc?: string;
    sections?: string[];
    symbols?: 'toc';
    gpParameters?: boolean;
  };
  'legacy-help': {
    host: string;
    base: string;
    books: Array<{ path: string; tocScript?: string }>;
    lines?: string[];
    enumerate?: 'eager' | 'on-demand';
  };
  sitemap: UrlFilter & { url?: string; urls?: string[]; titleFrom?: 'slug'; kind?: DocKind };
  static: { entries: Array<{ url: string; title: string; kind: DocKind }> };
  /** `slugs` are globs over `briefs/`. */
  brief: { slugs: string[] };
  openapi: { specs: Array<string | { url: string; embedded?: boolean }> };
  docc: { base: string; maxDepth?: number };
  dokka: { base: string };
  dartdoc: { base: string; index: string };
  'docfx-net': { base: string; xrefmaps: string[] };
  javadoc: { base: string; legacy?: boolean };
  sphinx: { base: string };
  'npm-dts': { package: string; docUrl: string };
  'npm-cem': { packages: string[]; file: string; docUrl: string };
  'npm-json': {
    package: string;
    file: string;
    mapper: 'arcade-api' | 'arcade-profiles';
    docUrl?: string;
  };
  'github-repo': {
    repo: string;
    ref?: string;
    pin?: 'release-tag' | 'branch';
    tagTemplate?: string;
    preset:
      | 'samples-metadata'
      | 'samples-readme'
      | 'markdown-docs'
      | 'notebooks'
      | 'snippets-region'
      | 'wiki';
    include?: string[];
    exclude?: string[];
    symbolsFromHeadings?: number;
    /**
     * Preset `wiki` only: the path in the wiki repository of a page whose file name differs
     * from its link in more than letter case can be guessed from (page name -> path without
     * `.md`). Looked up case-insensitively, before any guessing.
     */
    paths?: Record<string, string>;
  };
  xmldoc: { repo: string; ref?: string; dir: string; docUrlHost?: string };
  pkgdown: { host: string; packages: string[] };
}

/**
 * Canary request of a source. `family` doubles as the family hint adapters pass to the
 * renderer for pages of this source (detection by content stays authoritative).
 */
export interface Probe {
  url: string;
  expect: 'xml' | 'json' | 'html' | 'text' | 'yaml';
  minRecords?: number;
  family?: HtmlFamily;
  minChars?: number;
  mustContain?: string;
}

/**
 * One documentation source of a product, typed by its adapter.
 *
 * `SourceDef` without a type argument accepts any adapter but does not correlate `adapter`
 * with `config`; use {@link AnySourceDef} where narrowing on `adapter` is wanted.
 */
export interface SourceDef<T extends AdapterType = AdapterType> {
  /** Unique within the product; addressable as `product/source`. */
  id: string;
  title: string;
  kinds: DocKind[];
  adapter: T;
  config: AdapterConfigMap[T];
  /**
   * The capability needed to read this source's documents; when it is off the whole source is
   * disabled (`SOURCE_DISABLED`, `enabled: false` in the product profile). Absent means no
   * network (bundled briefs).
   */
  capability?: Capability;
  license?: LicenseTier;
  /** Invariant INV-1: exactly one floor source per product. */
  floor?: boolean;
  /** Version lines this source exists for; default all. */
  lines?: string[];
  /** Index build order, lower first; default 5. */
  priority?: number;
  /** Other source ids of this product, tried in order. */
  fallbacks?: string[];
  pagesApprox?: number;
  probe: Probe;
}

/**
 * The discriminated union of every concrete {@link SourceDef}. Registry data is written
 * against this type so a config that does not match its `adapter` fails to compile
 *. Every member is assignable to `SourceDef`.
 */
export type AnySourceDef = { [A in AdapterType]: SourceDef<A> }[AdapterType];

/** Kind of version oracle. */
export type OracleType =
  | 'npm-dist-tags'
  | 'pypi'
  | 'nuget-flat'
  | 'pub-dev'
  | 'github-release'
  | 'page-regex'
  | 'sitemap-slug'
  | 'meta-refresh-target'
  | 'docesri-sitemap'
  | 'agol-rest-info'
  | 'static'
  | 'plc';

/** One configured version oracle of a product. */
export interface OracleSpec {
  type: OracleType;
  options: Record<string, string>;
  provides: Array<'documented' | 'installable' | 'released' | 'prerelease' | 'lifecycle'>;
}

/** Access rules and quirks of one upstream host. */
export interface HostPolicy {
  host: string;
  /**
   * The capability every request to this host needs; `null` marks a link-only host, which is
   * never fetched. A documentation host that also serves index files is `website`
   * (see {@link Capability} for how `site-index` is enforced).
   */
  capability: Capability | null;
  /** Regular expressions over the path; absent means the whole host. */
  allowPaths?: string[];
  /**
   * The one request method the host is used with; default `GET`. `POST` is for a search
   * backend that takes its query in the request body, and such a host accepts nothing else.
   */
  method?: 'GET' | 'POST';
  /** Static denials in robots syntax (`*` and `$`). */
  robotsDisallow: string[];
  revalidate: 'etag' | 'last-modified' | 'both' | 'none';
  /** Bodies start with a UTF-8 byte-order mark. */
  bom?: boolean;
  /** A 200 response of exactly this size is a soft 404. */
  softNotFoundBytes?: number;
  /** Path prefixes that answer 200 `text/html` for any path. */
  catchAllPrefixes?: string[];
  ratePerSec: number;
  maxConcurrent: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  githubOwners?: string[];
}

/** One row of a catalogue index: a page, a sample or an API symbol. */
export interface CatalogRecord {
  /** Canonical URL, with `#anchor` for members. */
  ref: string;
  product: string;
  source: string;
  line: string;
  kind: DocKind;
  title: string;
  /** Simple name: `queryFeatures`, `FeatureLayer`, `arcgis-map`. */
  symbol?: string;
  /** `FeatureLayer.queryFeatures`, `arcgis.gis.GIS.map`, `com.arcgismaps.mapping.ArcGISMap`. */
  qualified?: string;
  /** `class`, `method`, `property`, `event`, `component`, `function`, `operation`, `tool`, `type`, `term`. */
  symbolKind?: string;
  /** Qualified name of the owning type. Present exactly when the record is a member. */
  parent?: string;
  /**
   * Titles of the ancestors in the source's navigation, outermost first, joined with
   * `BREADCRUMB_SEPARATOR` (`names.ts`); the record's own title is not part of it. The number
   * of ancestors is the entry's depth in a table of contents.
   */
  breadcrumb?: string;
  description?: string;
  headings?: string[];
  keywords?: string[];
  platform?: string;
  language?: string;
  /** Adapter-private: file path, DocC path, uid, member id, repo path. */
  locator?: Record<string, string>;
  boost?: number;
  deprecated?: boolean;
  license: LicenseTier;
}

/**
 * One section of a document.
 *
 * Sections are **flat and in document order**: `markdown` holds the section's own text,
 * starting with its ATX heading line (the lead section may have none) and ending before the
 * next heading of any level. Joining every section's `markdown` with a blank line gives the
 * whole document; `parent` records the hierarchy. See `sections.ts`.
 */
export interface DocSection {
  id: string;
  /** Heading level 1 to 6; 0 for a lead section without a heading. */
  level: number;
  title: string;
  markdown: string;
  /** Token estimate of `markdown` (`estimateTokens`). */
  tokens: number;
  /** Id of the nearest preceding section with a lower level. */
  parent?: string;
}

/** One member of an API type, as listed on its page. */
export interface MemberEntry {
  /** The member's anchor on the page. A section documenting the member has this id. */
  id: string;
  name: string;
  kind: string;
  signature?: string;
  summary?: string;
  inheritedFrom?: string;
  deprecated?: boolean;
  readonly?: boolean;
}

/** One source file of a sample. */
export interface SourceFile {
  name: string;
  language: string;
  text: string;
  ref: string;
  bytes: number;
}

/** Counters describing how a document was converted; used by tests, `doctor` and drift detection. */
export interface Diagnostics {
  family: HtmlFamily | 'structured';
  renderer?: string;
  fences: number;
  fencesWithLanguage: number;
  tablesByStrategy: Record<string, number>;
  unknownIslands: string[];
  leftoverHtmlTags: number;
  redirectHops: number;
  ms: number;
}

/** A fetched and converted document. Produced by adapters, consumed by the doc service and presenters. */
export interface DocPage {
  ref: string;
  url: string;
  title: string;
  product?: string;
  source?: string;
  line?: string;
  version?: string;
  kind: DocKind;
  /** Ancestor titles joined with `BREADCRUMB_SEPARATOR`, as on {@link CatalogRecord}. */
  breadcrumb?: string;
  /** Metadata block always shown first (REST `dl.grid`, GP tool signature, import lines). */
  header?: string;
  /**
   * In document order; `sections[0]` is the lead. Only the selected part when the page was
   * read with a selector that matched (`SectionSelector` in `ports.ts`).
   */
  sections: DocSection[];
  /**
   * API pages: every member of the type, also when `sections` hold a slice. A member that is
   * documented on the page is the section whose id equals its `MemberEntry.id`.
   */
  members?: MemberEntry[];
  /**
   * Samples: the source files, main file first. Their text is not repeated in `sections`
   * (which hold the description), so the doc service decides how much code a view shows.
   */
  files?: SourceFile[];
  relevantApis?: string[];
  license: LicenseTier;
  /** The complete `Source:` line from `attribution()`; empty for tier `project`. */
  attribution: string;
  /** ISO timestamp. */
  retrievedAt: string;
  cache: CacheState;
  redirectedFrom: string[];
  degraded?: {
    level: 'html-profile' | 'generic-extractor' | 'stale' | 'link-only';
    reason: string;
  };
  diagnostics: Diagnostics;
  notices: string[];
}

/** One ranked search result. */
export interface SearchHit {
  ref: string;
  title: string;
  product: string;
  source: string;
  line: string;
  kind: DocKind;
  version?: string;
  /** As on {@link CatalogRecord}. */
  breadcrumb?: string;
  excerpt?: string;
  symbolKind?: string;
  match: 'symbol' | 'title' | 'heading' | 'keyword' | 'description' | 'body' | 'site';
  score: number;
  license: LicenseTier;
}

/**
 * One version statement produced by an oracle. What the fields hold depends on `role`:
 *
 * | Role | `value` | `date` | `tag` | `registry`, `package` |
 * |---|---|---|---|---|
 * | `documented` | version the documentation describes | its release date | | |
 * | `installable` | version a package manager serves | publication date | dist-tag or release tag (`latest`, `lts-v4.x`, `v300.1.0`) | where and what to install |
 * | `prerelease` | pre-release version | publication date | dist-tag (`next`, `beta`) | as above |
 * | `lifecycle` | ISO date of the phase | the same date | phase: `ga`, `mature` or `retirement` | |
 */
export interface VersionFact {
  role: 'documented' | 'installable' | 'prerelease' | 'lifecycle';
  value: string;
  /** ISO date (`YYYY-MM-DD`). */
  date?: string;
  tag?: string;
  /** A `PackageRef.registry` value, or `github` for a release. */
  registry?: string;
  package?: string;
  oracle: OracleType;
  /** The URL the fact was read from; shown as its source. */
  url: string;
}

/** An Esri SDK found in the user's project. */
export interface WorkspaceSdk {
  product: string;
  package: string;
  version: string;
  /** Manifest path relative to the project directory. */
  file: string;
}

/** Health record of one source. */
export interface SourceHealth {
  state: HealthState;
  lastOk?: string;
  lastError?: string;
  records?: number;
  builtAt?: string;
  stale?: boolean;
}
