/**
 * The container: every long-lived object of one server process, wired from the factories of
 * `src/core/factories.ts`. This file holds the wiring logic only and imports no package, so
 * it can be tested with fake factories; `composition-root.ts` supplies the real ones.
 */
import type { Config } from '../core/config.js';
import type * as F from '../core/factories.js';
import { createLogger, systemClock } from '../core/logger.js';
import type {
  AdapterRegistry,
  Cache,
  Clock,
  Ctx,
  GithubClient,
  HttpClient,
  Logger,
  Registry,
  Renderer,
  Services,
  SourcePolicy,
} from '../core/ports.js';
import type { WorkspaceSdk } from '../core/types.js';
import { createAdapterRegistry } from './adapter-registry.js';

/** The factory of every package, as typed in `src/core/factories.ts`. */
export interface Factories {
  createCache: F.CreateCache;
  createPolicy: F.CreatePolicy;
  createHttpClient: F.CreateHttpClient;
  createGithubClient: F.CreateGithubClient;
  createRegistry: F.CreateRegistry;
  createVersionService: F.CreateVersionService;
  detectWorkspace: F.DetectWorkspace;
  createHtmlExtractor: F.CreateHtmlExtractor;
  createRenderer: F.CreateRenderer;
  siteAdapters: F.SiteAdapters;
  referenceAdapters: F.ReferenceAdapters;
  createServices: F.CreateServices;
}

/** Replaceable collaborators of {@link buildContainer}; everything defaults to the real thing. */
export interface ContainerOptions {
  /** Default: JSON lines on stderr at `config.logLevel`. */
  logger?: Logger;
  /** Default: the system clock. */
  clock?: Clock;
  /** Replaces the built-in `fetch` of the HTTP gateway (tests, embedders with a proxy agent). */
  fetchImpl?: typeof fetch;
}

/**
 * Everything the MCP surface and the CLI need. Members are created on first access and then
 * kept, so reading `config` or `logger` constructs nothing else, and nothing here performs
 * network or disk I/O until a tool call or CLI command asks for it.
 */
export interface Container {
  readonly config: Config;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly registry: Registry;
  readonly policy: SourcePolicy;
  readonly cache: Cache;
  readonly http: HttpClient;
  readonly github: GithubClient;
  readonly render: Renderer;
  /** The context handed to adapters and services; shares the instances above. */
  readonly ctx: Ctx;
  readonly adapters: AdapterRegistry;
  readonly services: Services;
  /**
   * Esri SDKs detected in the project directory. Scanned on first call and again once a scan
   * is a minute old; `[]` in HTTP mode, with capability `workspace` off, and when the scan
   * fails.
   */
  workspace(): Promise<WorkspaceSdk[]>;
}

/** How long one scan of the project answers; the same as the version service's scan. */
const WORKSPACE_TTL_MS = 60 * 1000;

/** Runs `create` on the first call and returns the same value afterwards. */
function lazy<V>(create: () => V): () => V {
  let slot: { value: V } | undefined;
  return () => {
    slot ??= { value: create() };
    return slot.value;
  };
}

/**
 * Wires the factories into a {@link Container}.
 *
 * Dependency order: registry and extractor need nothing; policy needs the registry's host
 * table; the gateway needs cache, policy and the extractor's meta-refresh detector; the
 * GitHub client needs the gateway; `Ctx` bundles them; version service and services take
 * `Ctx`. Each is a lazy singleton, so the order is resolved by access rather than by code
 * position and a command that needs only the cache never builds the services.
 */
export function buildContainer(
  config: Config,
  factories: Factories,
  options: ContainerOptions = {},
): Container {
  const logger = options.logger ?? createLogger(config.logLevel);
  const clock = options.clock ?? systemClock;

  const registry = lazy(() => factories.createRegistry());
  const extractor = lazy(() => factories.createHtmlExtractor());
  const render = lazy(() => factories.createRenderer(extractor()));
  const policy = lazy(() => factories.createPolicy({ config, hosts: registry().hosts() }));
  const cache = lazy(() => factories.createCache({ config, logger, clock }));
  const http = lazy(() =>
    factories.createHttpClient({
      config,
      logger,
      clock,
      cache: cache(),
      policy: policy(),
      detectMetaRefresh: (html, baseUrl) => extractor().detectMetaRefresh(html, baseUrl),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    }),
  );
  const github = lazy(() =>
    factories.createGithubClient({ config, http: http(), cache: cache(), logger, clock }),
  );

  // A project changes while the server runs (an upgrade, a new package): a scan answers for
  // WORKSPACE_TTL_MS, and calls that arrive during a scan share it.
  let scanned: { at: number; sdks: Promise<WorkspaceSdk[]> } | undefined;
  const workspace = (): Promise<WorkspaceSdk[]> => {
    if (config.mode !== 'stdio' || !config.capabilities.has('workspace'))
      return Promise.resolve([]);
    if (scanned !== undefined && clock.now() - scanned.at < WORKSPACE_TTL_MS) return scanned.sdks;
    const sdks = (async () => {
      try {
        return await factories.detectWorkspace({ config, registry: registry(), logger });
      } catch (error) {
        // Version pinning is a convenience: a project that cannot be read must not fail a call.
        logger.warn('workspace detection failed', { error });
        return [];
      }
    })();
    scanned = { at: clock.now(), sdks };
    return sdks;
  };

  const ctx = lazy((): Ctx => ({
    config,
    logger,
    clock,
    http: http(),
    github: github(),
    cache: cache(),
    policy: policy(),
    registry: registry(),
    render: render(),
    workspace,
  }));
  const adapters = lazy(() =>
    createAdapterRegistry(factories.siteAdapters(), factories.referenceAdapters()),
  );
  const services = lazy((): Services => {
    const versions = factories.createVersionService(ctx());
    return { ...factories.createServices(ctx(), adapters(), versions), versions };
  });

  return {
    config,
    logger,
    clock,
    get registry() {
      return registry();
    },
    get policy() {
      return policy();
    },
    get cache() {
      return cache();
    },
    get http() {
      return http();
    },
    get github() {
      return github();
    },
    get render() {
      return render();
    },
    get ctx() {
      return ctx();
    },
    get adapters() {
      return adapters();
    },
    get services() {
      return services();
    },
    workspace,
  };
}
