/**
 * The MCP endpoint of a hosted deployment (a Vercel function, see `api/mcp.ts` and
 * docs/hosting.md): the web-standard handler of `http-fetch.ts` over one application
 * container per instance.
 *
 * What differs from `arcgis-sdk-mcp --http` on a workstation:
 * - a bearer token is mandatory; without `ARCGIS_DOCS_HTTP_TOKEN` every request gets 503;
 * - `Host` and `Origin` are checked against the deployment's own host names (on Vercel,
 *   `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`) plus
 *   `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`, instead of loopback;
 * - the cache lives in the instance's temporary directory (`/tmp` on Vercel), capped at
 *   {@link HOSTED_CACHE_MAX_MB}, and starts empty on every cold start;
 * - it runs in HTTP mode, so capabilities `workspace` and `local-packages` are off.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import type { Container } from '../app/container.js';
import { readPackageInfo, type PackageInfo } from '../app/package-info.js';
import { ConfigError } from '../core/capabilities.js';
import { loadConfig, loadHttpSettings, type Config } from '../core/config.js';
import { PACKAGE_NAME } from '../core/names.js';
import { allowedHostnames, tokenRequirement } from './http-auth.js';
import { createFetchApp, NO_STORE_HEADERS, type FetchApp } from './http-fetch.js';
import type { ServerInstance } from './run.js';

/** Cache directory of a hosted instance when `ARCGIS_DOCS_CACHE_DIR` is not set. */
export const hostedCacheDir = (): string => join(tmpdir(), PACKAGE_NAME);

/** Cache cap of a hosted instance when `ARCGIS_DOCS_CACHE_MAX_MB` is not set. */
export const HOSTED_CACHE_MAX_MB = 256;

/** The application modules the handler wires; tests pass small fakes. */
export interface HostedApp {
  createContainer: (config: Config) => Container;
  createServer: (container: Container) => ServerInstance;
}

/** What {@link createHostedHandler} reads from its surroundings. */
export interface HostedOptions {
  env: NodeJS.ProcessEnv;
  /** Imports the composition root and the MCP server module; called once per instance. */
  loadApp: () => Promise<HostedApp>;
  /** Default: this package's `package.json`. */
  pkg?: PackageInfo;
}

/** A web-standard request handler, the shape a platform function exports. */
export type FetchHandler = (request: Request) => Promise<Response>;

/** The environment with the hosted defaults filled in where the deployment set nothing. */
export function hostedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const unset = (name: string): boolean => (env[name]?.trim() ?? '') === '';
  return {
    ...env,
    ...(unset('ARCGIS_DOCS_CACHE_DIR') ? { ARCGIS_DOCS_CACHE_DIR: hostedCacheDir() } : {}),
    ...(unset('ARCGIS_DOCS_CACHE_MAX_MB')
      ? { ARCGIS_DOCS_CACHE_MAX_MB: String(HOSTED_CACHE_MAX_MB) }
      : {}),
  };
}

const failure = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', ...NO_STORE_HEADERS },
  });

/**
 * Creates the handler of one function instance.
 *
 * Nothing is loaded at creation: the first request reads the configuration, imports the
 * application and builds the container, which every later request of the instance shares
 * (caches, indexes, rate limits). A configuration error answers every request with 500 and
 * the variable at fault, and is logged; the instance does not retry until it is replaced.
 */
export function createHostedHandler(options: HostedOptions): FetchHandler {
  let app: Promise<FetchApp> | undefined;

  const build = async (): Promise<FetchApp> => {
    const env = hostedEnv(options.env);
    const pkg = options.pkg ?? readPackageInfo();
    const settings = loadHttpSettings(env);
    const config = loadConfig(env, { mode: 'http', cwd: tmpdir() }, pkg);
    const { createContainer, createServer } = await options.loadApp();
    const container = createContainer(config);
    const factory: McpServerFactory = () => createServer(container);
    return createFetchApp({
      factory,
      logger: container.logger,
      version: config.version,
      token: settings.token,
      tokenRequired: tokenRequirement(undefined, settings.platform),
      allowedHosts: allowedHostnames(undefined, settings.allowedHosts),
    });
  };

  return async (request) => {
    app ??= build();
    let ready: FetchApp;
    try {
      ready = await app;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // stderr is where the platform collects function logs; the logger is not built yet.
      process.stderr.write(
        `${JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'hosted handler failed to start', error: message })}\n`,
      );
      return error instanceof ConfigError
        ? failure(500, `Configuration error: ${message}`)
        : failure(500, 'Internal error');
    }
    return ready.fetch(request);
  };
}
