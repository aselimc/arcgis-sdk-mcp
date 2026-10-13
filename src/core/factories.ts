/**
 * Factory signatures (design section 5.3): the only coupling between packages. Each
 * package's `index.ts` exports exactly the factory typed here, and only
 * `src/app/composition-root.ts` imports and wires them.
 */
import type { Config } from './config.js';
import type * as P from './ports.js';
import type { HostPolicy, WorkspaceSdk } from './types.js';

/** `src/cache/index.ts` (WP1). */
export type CreateCache = (deps: { config: Config; logger: P.Logger; clock: P.Clock }) => P.Cache;

/** `src/policy/index.ts` (WP1). */
export type CreatePolicy = (deps: {
  config: Config;
  hosts: readonly HostPolicy[];
}) => P.SourcePolicy;

/**
 * `src/net/index.ts` (WP1). `detectMetaRefresh` comes from the HTML extractor and is injected
 * so that the gateway does not import it; `fetchImpl` replaces the built-in `fetch` in tests.
 */
export type CreateHttpClient = (deps: {
  config: Config;
  logger: P.Logger;
  clock: P.Clock;
  cache: P.Cache;
  policy: P.SourcePolicy;
  detectMetaRefresh: (html: string, baseUrl: string) => string | undefined;
  fetchImpl?: typeof fetch;
}) => P.HttpClient;

/** `src/net/github.ts` (WP1). */
export type CreateGithubClient = (deps: {
  config: Config;
  http: P.HttpClient;
  cache: P.Cache;
  logger: P.Logger;
}) => P.GithubClient;

/** `src/registry/index.ts` (WP2). Pure and synchronous. */
export type CreateRegistry = () => P.Registry;

/** `src/versions/index.ts` (WP2). */
export type CreateVersionService = (ctx: P.Ctx) => P.VersionService;

/** `src/workspace/index.ts` (WP2). */
export type DetectWorkspace = (deps: {
  config: Config;
  registry: P.Registry;
  logger: P.Logger;
}) => Promise<WorkspaceSdk[]>;

/** `src/extract/index.ts` (WP3). */
export type CreateHtmlExtractor = () => P.HtmlExtractor;

/** `src/render/index.ts` (WP4). */
export type CreateRenderer = (html: P.HtmlExtractor) => P.Renderer;

/** `src/adapters/site/index.ts` (WP5). */
export type SiteAdapters = () => P.SourceAdapter[];

/** `src/adapters/reference/index.ts` (WP6). */
export type ReferenceAdapters = () => P.SourceAdapter[];

/** `src/services/index.ts` (WP7). The version service is built by WP2 and injected. */
export type CreateServices = (
  ctx: P.Ctx,
  adapters: P.AdapterRegistry,
  versions: P.VersionService,
) => Omit<P.Services, 'versions'>;
