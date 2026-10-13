/**
 * Interfaces between packages (design section 5.2). A package implements the ports assigned
 * to it and reaches every other package only through these types, the `Ctx` object and the
 * factories in `factories.ts`.
 */
import type { Config } from './config.js';
import type * as T from './types.js';

/** Structured logger. Implementations write JSON lines to stderr only; stdout carries JSON-RPC. */
export interface Logger {
  debug(msg: string, f?: object): void;
  info(msg: string, f?: object): void;
  warn(msg: string, f?: object): void;
  error(msg: string, f?: object): void;
}

/** Time source, injected so that TTLs, budgets and breakers are testable. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** ISO 8601 timestamp of `now()`. */
  iso(): string;
  /** UTC date of `now()` as `YYYY-MM-DD`. */
  today(): string;
}

// ---- HTTP (implemented by WP1) ----------------------------------------------------------------

/** One upstream request. Only https URLs on allow-listed hosts are ever fetched. */
export interface HttpRequest {
  url: string;
  /** Validated: status, content type and a parse sniff. */
  expect: 'html' | 'json' | 'xml' | 'text' | 'yaml';
  /** Default from the host table and the URL class. */
  ttl?: T.TtlClass;
  /** Default 8 MB for pages, 32 MB for index files. */
  maxBytes?: number;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Per-tool-call request counter and deadline. */
  budget?: RequestBudget;
}

/** A validated upstream response, possibly served from cache. */
export interface HttpResponse {
  /** The requested URL. */
  url: string;
  /** The URL that produced the body, after redirects and meta-refresh hops. */
  finalUrl: string;
  status: number;
  contentType: string;
  /** Decoded body with any byte-order mark removed. */
  text: string;
  etag?: string;
  lastModified?: string;
  /** ISO timestamp of the fetch that produced the body. */
  fetchedAt: string;
  cache: T.CacheState;
  /** HTTP redirects and meta-refresh hops followed, in order, excluding `finalUrl`. */
  aliasChain: string[];
}

/** The single gateway to the network (design section 6.2). */
export interface HttpClient {
  /**
   * Policy check, single-flight, cache, limiter, fetch, redirect and meta-refresh following,
   * validation, stale-if-error. Throws `McpDocError`.
   */
  get(req: HttpRequest): Promise<HttpResponse>;
  /** `get` with `expect: 'json'` and a parsed body. */
  getJson<J = unknown>(req: Omit<HttpRequest, 'expect'>): Promise<{ data: J; res: HttpResponse }>;
  /** Circuit-breaker state per contacted host, for the status resource and `doctor`. */
  hostStates(): Array<{
    host: string;
    breaker: 'closed' | 'open' | 'half-open';
    lastError?: string;
  }>;
}

/**
 * Mutable request allowance of one tool call or index build. `used` is incremented by the
 * HTTP client for every request that reaches the network; `deadline` is a `Clock.now()` value.
 * Create with `newBudget`, spend with `consumeBudget` (`async.ts`).
 */
export interface RequestBudget {
  maxRequests: number;
  used: number;
  deadline: number;
}

/** GitHub access through the HTTP client: metadata from the API, content from the raw host. */
export interface GithubClient {
  /** Cached 7 days. */
  repoMeta(
    repo: string,
  ): Promise<{ defaultBranch: string; license: T.LicenseTier; archived: boolean }>;
  /** One API call, cached 24 hours. */
  tree(repo: string, ref: string): Promise<Array<{ path: string; size?: number }>>;
  /** A file from `raw.githubusercontent.com`. */
  raw(repo: string, ref: string, path: string): Promise<HttpResponse>;
  wikiRaw(repo: string, page: string): Promise<HttpResponse>;
  latestRelease(repo: string): Promise<{ tag: string; publishedAt: string } | undefined>;
  quota(): { authenticated: boolean; remaining?: number; resetAt?: string };
}

// ---- Cache (implemented by WP1) ---------------------------------------------------------------

/** One cached HTTP response with its freshness window (epoch milliseconds). */
export interface CachedHttpEntry {
  url: string;
  finalUrl: string;
  aliasChain: string[];
  status: number;
  contentType: string;
  body: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  ttl: T.TtlClass;
}

/** Namespace of a derived (computed) cache value. */
export type DerivedNamespace =
  'catalog' | 'symbols' | 'bodies' | 'doc' | 'license' | 'versions' | 'robots' | 'misc';

/** Persistent per-user cache plus a bounded in-memory memo. */
export interface Cache {
  getHttp(key: string): Promise<CachedHttpEntry | undefined>;
  putHttp(key: string, entry: CachedHttpEntry): Promise<void>;
  /** Extends the freshness of an entry after a 304. */
  touchHttp(
    key: string,
    patch: Pick<CachedHttpEntry, 'freshUntil' | 'staleUntil'> & {
      etag?: string;
      lastModified?: string;
    },
  ): Promise<void>;
  /** JSON values, gzip on disk. */
  getDerived<V>(ns: DerivedNamespace, key: string): Promise<V | undefined>;
  putDerived<V>(ns: DerivedNamespace, key: string, value: V): Promise<void>;
  deleteDerived(ns: DerivedNamespace, key: string): Promise<void>;
  /** In-memory byte-bounded LRU for parsed documents and loaded indexes. */
  memo<V>(key: string, compute: () => Promise<{ value: V; bytes: number }>): Promise<V>;
  info(): Promise<{ dir: string; bytes: number; entries: number }>;
  clear(scope?: 'http' | 'derived' | 'all'): Promise<void>;
}

// ---- Policy (implemented by WP1) --------------------------------------------------------------

/** The effective source policy: which hosts and capabilities may be used. */
export interface SourcePolicy {
  enabled(cap: T.Capability): boolean;
  /**
   * Throws `HOST_NOT_ALLOWED`, `LINK_ONLY` or `SOURCE_DISABLED`. Called for the initial URL
   * and every redirect or meta-refresh hop.
   */
  check(url: URL, method?: 'GET' | 'POST'): { host: T.HostPolicy; capability: T.Capability };
  summary(): {
    preset: string;
    enabled: T.Capability[];
    disabled: T.Capability[];
    offline: boolean;
  };
}

// ---- Registry (implemented by WP2) ------------------------------------------------------------

/** Outcome of resolving a free-form `product` argument. */
export interface ProductResolution {
  product: T.Product;
  /** Present when the input had the scope form `product/source`. */
  source?: T.AnySourceDef;
  /** The input as given, for the echo in the status line. */
  resolvedFrom: string;
  how: 'id' | 'alias' | 'scope' | 'fuzzy';
}

/** The product registry: pure, synchronous, no I/O. */
export interface Registry {
  all(): readonly T.Product[];
  get(id: string): T.Product | undefined;
  /** Throws `UNKNOWN_PRODUCT` with the five nearest ids. */
  resolve(input: string): ProductResolution;
  /** Product ids a free-text or symbol-shaped query most likely refers to (max n, tier developer/help only). */
  route(query: string, n?: number): Array<{ product: string; confidence: number }>;
  /**
   * Longest-prefix match of a URL against source base URLs and repos. The base URLs of a
   * source are defined by `sourceBaseUrls` (`adapter-helpers.ts`).
   */
  ownerOf(
    url: URL,
  ): { product: T.Product; source: T.AnySourceDef; line: T.VersionLine } | undefined;
  hosts(): readonly T.HostPolicy[];
  /** The line for a version or line id; the current line when omitted. Throws `VERSION_UNAVAILABLE`. */
  line(product: T.Product, version?: string): T.VersionLine;
  /** Curated briefs, embedded at build time; no disk I/O. */
  briefs(): Array<{
    slug: string;
    title: string;
    verifiedOn: string;
    sources: string[];
    markdown: string;
  }>;
}

// ---- Extraction and rendering (WP3 implements 'html'; WP4 the rest and the dispatcher) --------

/** Which part of a document to return. `member` is a member name or id on an API page. */
export interface SectionSelector {
  section?: string;
  member?: string;
}

/** Options common to every renderer. */
export interface RenderOptions {
  select?: SectionSelector;
  detail?: T.SymbolDetail;
  /** Astro tutorials: keep only the lines each step adds. */
  focusedCode?: boolean;
  /** `cc-by-nd` content: no rewriting of any kind. */
  verbatim?: boolean;
}

/** What the caller knows about a document before it is rendered. */
export interface RenderMeta {
  url: string;
  product?: string;
  source?: string;
  line?: string;
  version?: string;
  kind: T.DocKind;
  license: T.LicenseTier;
  /** The response the input came from; supplies `retrievedAt`, `cache` and `redirectedFrom`. */
  res?: HttpResponse;
}

/** Input shape per renderer kind. */
export interface RendererInputs {
  html: { html: string; familyHint?: T.HtmlFamily };
  /** GitHub markdown, pkgdown `.md`, briefs. */
  markdown: { markdown: string };
  /** Samples. */
  source: {
    files: Array<{ name: string; text: string; ref: string }>;
    readme?: string;
    metadata?: unknown;
  };
  notebook: { ipynb: unknown };
  openapi: {
    operation?: unknown;
    schemas?: unknown;
    spec?: unknown;
    target?: string;
    sitePrefix?: string;
  };
  typedoc: { raw: unknown; member?: string };
  cem: { manifest: unknown; tag: string; member?: string; packageName: string };
  docc: { json: unknown };
  sphinx: { html: string; anchor?: string };
  xmldoc: { xml: string; memberId: string };
  dts: { source: string; modulePath: string; member?: string; packageName: string };
  arcade: { item: unknown; profile?: boolean };
}

/** Converts fetched content of any supported shape into a `DocPage`. */
export interface Renderer {
  render<K extends keyof RendererInputs>(
    kind: K,
    input: RendererInputs[K],
    meta: RenderMeta,
    opts?: RenderOptions,
  ): T.DocPage;
  detectFamily(html: string): T.HtmlFamily;
  /** Target of a meta-refresh stub page, if `html` is one. Also injected into the HTTP client. */
  detectMetaRefresh(html: string, baseUrl: string): string | undefined;
}

/** WP3's public surface; WP4's `Renderer` delegates `'html'` to it. */
export interface HtmlExtractor {
  extract(input: RendererInputs['html'], meta: RenderMeta, opts?: RenderOptions): T.DocPage;
  detectFamily(html: string): T.HtmlFamily;
  detectMetaRefresh(html: string, baseUrl: string): string | undefined;
}

// ---- Adapters (implemented by WP5 and WP6) ----------------------------------------------------

/** Everything an adapter or service may touch. Built once by the composition root. */
export interface Ctx {
  config: Config;
  logger: Logger;
  clock: Clock;
  http: HttpClient;
  github: GithubClient;
  cache: Cache;
  policy: SourcePolicy;
  registry: Registry;
  render: Renderer;
  /** Esri SDKs detected in the project; `[]` in HTTP mode or when capability `workspace` is off. */
  workspace(): Promise<T.WorkspaceSdk[]>;
}

/** A source bound to one product and version line. Create with `bindSource`. */
export interface BoundSource<A extends T.AdapterType = T.AdapterType> {
  product: T.Product;
  source: T.SourceDef<A>;
  line: T.VersionLine;
  /** Exact version when pinned (npm adapters, GitHub tags). */
  version?: string;
  /** The source's primary base URL with line variables substituted, joined with `path`. */
  url(path?: string): string;
  budget?: RequestBudget;
}

/** What `SourceAdapter.read` should fetch. */
export interface ReadTarget {
  url: URL;
  select?: SectionSelector;
  detail?: T.SymbolDetail;
  focusedCode?: boolean;
  /** The catalogue record that led here, when the read follows a search or lookup. */
  record?: T.CatalogRecord;
}

/** Outcome of a canary request. */
export interface ProbeResult {
  ok: boolean;
  records?: number;
  chars?: number;
  family?: T.HtmlFamily;
  error?: string;
  ms: number;
}

/** One documentation source type. Adapters are stateless; all state lives in `Ctx`. */
export interface SourceAdapter<A extends T.AdapterType = T.AdapterType> {
  readonly type: A;
  /** Hard request budget for `enumerate()`; the index builder aborts beyond it. */
  readonly maxEnumerateRequests: number;
  /** Catalogue records (pages, samples, symbols) for one source and line. Index files only; never page bodies in bulk. */
  enumerate?(ctx: Ctx, src: BoundSource<A>): Promise<T.CatalogRecord[]>;
  /** True when this source owns the URL beyond the registry's base-prefix match (structured twins, repo blob URLs). */
  owns?(url: URL, src: BoundSource<A>): boolean;
  /** Fetch one document and convert it. Must honour `target.select` by slicing before cleaning on heavy pages. */
  read(ctx: Ctx, src: BoundSource<A>, target: ReadTarget): Promise<T.DocPage>;
  /** Render one symbol record (type or member). Default: `defaultSymbolRead` in `adapter-helpers.ts`. */
  symbol?(
    ctx: Ctx,
    src: BoundSource<A>,
    record: T.CatalogRecord,
    detail: T.SymbolDetail,
  ): Promise<T.DocPage>;
  /** Sample bundle (README, metadata, files). Present on sample-capable adapters. */
  sample?(ctx: Ctx, src: BoundSource<A>, record: T.CatalogRecord): Promise<T.DocPage>;
  /** Canary; at most 2 requests. */
  probe(ctx: Ctx, src: BoundSource<A>): Promise<ProbeResult>;
}

/** Lookup of adapters by type; built by the composition root. */
export interface AdapterRegistry {
  get<A extends T.AdapterType>(type: A): SourceAdapter<A>;
  types(): T.AdapterType[];
}

// ---- Services (implemented by WP7; versions by WP2) -------------------------------------------

/** Per-call context handed to every service method. */
export interface CallOptions {
  budget: RequestBudget;
  signal?: AbortSignal;
}

/** State of one catalogue index. */
export interface IndexState {
  product: string;
  source: string;
  line: string;
  state: 'ready' | 'stale' | 'building' | 'partial' | 'unavailable';
  records: number;
  builtAt?: string;
}

/** Catalogue, symbol and body indexes (design section 6.4). */
export interface IndexService {
  /** Load from memory or disk, or build within the budget; never throws for upstream failure. */
  ensure(
    product: T.Product,
    sourceIds: string[] | undefined,
    line: T.VersionLine,
    call: CallOptions,
  ): Promise<IndexState[]>;
  query(q: {
    text: string;
    products: string[];
    sources?: string[];
    line?: string;
    kind?: T.DocKind;
    limit: number;
    offset: number;
  }): { hits: T.SearchHit[]; total: number };
  symbols(
    product: string,
    line: string,
  ): {
    exact(name: string): T.CatalogRecord[];
    members(qualifiedType: string): T.CatalogRecord[];
    fuzzy(name: string, n: number): T.CatalogRecord[];
  };
  samples(product: string, line: string): T.CatalogRecord[];
  toc(product: string, source: string, line: string): T.CatalogRecord[];
  /** Adds a fetched page to the fetched-pages full-text index. */
  addBody(page: T.DocPage): void;
  health(): Array<{ product: string; source: string } & T.SourceHealth>;
}

/** Input of `SearchService.search`. */
export interface SearchRequest {
  query: string;
  product?: string;
  kind?: T.DocKind;
  version?: string;
  limit: number;
  cursor?: string;
}

/** Result of `SearchService.search`. */
export interface SearchResponse {
  query: string;
  scope: {
    products: string[];
    sources?: string[];
    resolvedFrom?: string;
    kind?: T.DocKind;
    line: string;
  };
  mode: 'local' | 'local+site';
  total: number;
  hits: T.SearchHit[];
  nextCursor?: string;
  notes: string[];
}

/** Ranked search over the indexes. Zero hits is a normal result. */
export interface SearchService {
  search(req: SearchRequest, call: CallOptions): Promise<SearchResponse>;
}

/** Optional remote search backend (capability `site-search`). */
export interface SearchProvider {
  readonly id: 'site-search';
  search(
    q: { text: string; products: T.Product[]; line: string; limit: number },
    call: CallOptions,
  ): Promise<T.SearchHit[]>;
}

/** Input of `DocService.read`. */
export interface ReadRequest {
  ref: string;
  section?: string;
  view: 'auto' | 'outline' | 'full';
  maxTokens: number;
  cursor?: string;
}

/** Result of `DocService.read`: the page plus the budgeted text of the requested view. */
export interface ReadResponse {
  page: T.DocPage;
  /** Body only: no status line, no `Next:` line, no `Source:` line. */
  text: string;
  outline: Array<{ id: string; title: string; level: number; tokens: number }>;
  truncated: boolean;
  nextCursor?: string;
  /** The most useful follow-up as a complete call from `formatCall` (no `Next:` prefix). */
  next?: string;
}

/** Reads and budgets documents. */
export interface DocService {
  read(req: ReadRequest, call: CallOptions): Promise<ReadResponse>;
  /** The converted page without view or budget logic. */
  page(ref: string, call: CallOptions, select?: SectionSelector): Promise<T.DocPage>;
}

/** Input of `SymbolService.lookup`. */
export interface SymbolRequest {
  symbol: string;
  product?: string;
  detail: T.SymbolDetail;
  version?: string;
  maxTokens: number;
}

/** Result of `SymbolService.lookup`. */
export interface SymbolResponse {
  record: T.CatalogRecord;
  page: T.DocPage;
  /** Body only, as in {@link ReadResponse.text}. */
  text: string;
  /** Up to three other candidates. */
  alternates: T.CatalogRecord[];
  resolvedProduct: ProductResolution;
  /** A complete call from `formatCall` (no `Next:` prefix). */
  next?: string;
}

/** Exact symbol lookup. Throws `AMBIGUOUS_SYMBOL` or `SYMBOL_NOT_FOUND` with candidates. */
export interface SymbolService {
  lookup(req: SymbolRequest, call: CallOptions): Promise<SymbolResponse>;
}

/** Input of `SampleService.find`. */
export interface SamplesRequest {
  query: string;
  product?: string;
  usesApi?: string;
  platform?: string;
  withCode: boolean;
  limit: number;
  maxTokens: number;
}

/** One sample hit. */
export interface SampleHit {
  record: T.CatalogRecord;
  summary: string;
  relevantApis?: string[];
  files?: Array<{ name: string; ref: string; bytes?: number }>;
  origin: 'esri-site' | 'github';
  apiConfirmed?: boolean;
  legacyPattern?: boolean;
}

/** Result of `SampleService.find`. */
export interface SamplesResponse {
  scope: { product: string; line: string; platform?: string; pinnedTo?: string };
  total: number;
  hits: SampleHit[];
  code?: { ref: string; file: string; language: string; text: string; truncated: boolean };
  notes: string[];
}

/** Sample search. */
export interface SampleService {
  find(req: SamplesRequest, call: CallOptions): Promise<SamplesResponse>;
}

/** Product list, profile and table of contents. */
export interface CatalogService {
  /** Pure registry data; no network. */
  list(req: {
    query?: string;
    category?: T.Category | 'all';
    includeLegacy: boolean;
    limit: number;
    cursor?: string;
  }): { products: T.Product[]; total: number; nextCursor?: string };
  /** `health` is keyed by source id. */
  profile(input: string): {
    resolution: ProductResolution;
    health: Record<string, T.SourceHealth>;
  };
  toc(
    input: string,
    section: string,
    cursor: string | undefined,
    call: CallOptions,
  ): Promise<{ entries: T.CatalogRecord[]; total: number; nextCursor?: string }>;
}

/** One version oracle implementation. Returns `[]` rather than throwing when it has no answer. */
export interface VersionOracle {
  readonly type: T.OracleType;
  read(ctx: Ctx, product: T.Product, spec: T.OracleSpec): Promise<T.VersionFact[]>;
}

/** Result of `VersionService.report`. */
export interface VersionReport {
  /** ISO date the facts were gathered. */
  asOf: string;
  products: Array<{
    product: T.Product;
    facts: T.VersionFact[];
    project?: T.WorkspaceSdk;
    compatibility: Array<{ with: string; value: string; unreleased: boolean; source: string }>;
    releaseNotes: Array<{ version: string; ref: string }>;
    notices: string[];
    mismatches: string[];
  }>;
  notes: string[];
}

/** Version facts per product. */
export interface VersionService {
  report(req: { product?: string; version?: string }, call: CallOptions): Promise<VersionReport>;
  /** Cheap, cached: the version label to print on results for a product line (`5.1`, `300.1`). */
  label(product: T.Product, line: T.VersionLine): Promise<string | undefined>;
}

/** Every service the MCP surface calls. */
export interface Services {
  catalog: CatalogService;
  index: IndexService;
  search: SearchService;
  docs: DocService;
  symbols: SymbolService;
  samples: SampleService;
  versions: VersionService;
}
