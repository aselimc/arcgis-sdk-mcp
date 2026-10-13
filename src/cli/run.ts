/**
 * The command dispatcher behind the binary. Everything the process provides (environment,
 * output streams, the application modules, the serving entry points) arrives through
 * {@link CliDeps}, so each command can be run in a test with fakes; `main.ts` supplies the
 * real ones.
 */
import type { McpServerFactory } from '@modelcontextprotocol/server';
import type { Container } from '../app/container.js';
import type { PackageInfo } from '../app/package-info.js';
import { ConfigError } from '../core/capabilities.js';
import { loadConfig, type Config } from '../core/config.js';
import { isMcpDocError } from '../core/errors.js';
import { PACKAGE_NAME } from '../core/names.js';
import type { Logger } from '../core/ports.js';
import { HELP_TEXT, UsageError, isLoopbackHost, parseCli, type Command } from './args.js';
import { cacheClear, cacheInfo } from './cache-cmd.js';
import { formatDoctorReport } from './doctor-format.js';
import { runDoctor } from './doctor.js';
import type { HttpHandle, HttpServeOptions } from './http.js';
import { formatWarm, runWarm } from './warm.js';

/** Process exit statuses of the binary. */
export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

/** Printed on stderr when the HTTP server is bound beyond loopback. */
export const REMOTE_WARNING = [
  'WARNING: --allow-remote exposes this server to other machines.',
  '  - It has no authentication: anyone who can reach the port can use it.',
  "  - Esri's website terms cover personal, on-demand use. Operating a shared or public",
  "    instance needs Esri's permission (see docs/source-policy.md).",
  '  - Workspace detection and local package reading are off in HTTP mode.',
  '',
].join('\n');

/** One MCP server instance, as the SDK's serving entries accept it. */
export type ServerInstance = Awaited<ReturnType<McpServerFactory>>;

/** A running server that can be stopped. */
export interface Closeable {
  close: () => Promise<void>;
}

/** The application modules, loaded only by commands that need them. */
export interface App {
  createContainer: (config: Config) => Container;
  createServer: (container: Container) => ServerInstance;
}

/** Everything the dispatcher takes from the process. */
export interface CliDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** `process.versions.node`. */
  nodeVersion: string;
  pkg: PackageInfo;
  /** Writes to stdout. Never called while serving stdio, where stdout carries JSON-RPC. */
  out: (text: string) => void;
  /** Writes to stderr. */
  err: (text: string) => void;
  /** Imports the composition root and the MCP server module. */
  loadApp: () => Promise<App>;
  serveStdio: (factory: McpServerFactory, logger: Logger) => Promise<Closeable>;
  serveHttp: (options: HttpServeOptions) => Promise<HttpHandle>;
  /** Registers what to close when the process is asked to stop. */
  onShutdown: (close: () => Promise<void>) => void;
  /** Tries to create a file in `dir`; resolves with the failure message, or nothing on success. */
  checkWritable: (dir: string) => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
}

/** An error as the terminal shows it: the catalogue form for `McpDocError`, the message otherwise. */
export function describeError(error: unknown): string {
  if (!isMcpDocError(error)) {
    return `Error: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  const { why, next, candidates } = error.details ?? {};
  const parts = [`Error [${error.code}]: ${error.message}.`];
  if (why !== undefined) parts.push(`${why}.`);
  if (next !== undefined) parts.push(`Next: ${next}`);
  if (candidates !== undefined && candidates.length > 0) {
    parts.push(`Candidates: ${candidates.join(', ')}`);
  }
  return `${parts.join(' ')}\n`;
}

async function execute(
  command: Exclude<Command, { kind: 'help' | 'version' }>,
  deps: CliDeps,
): Promise<number | undefined> {
  const mode = command.kind === 'serve-http' ? 'http' : 'stdio';
  const config = loadConfig(deps.env, { mode, cwd: deps.cwd }, deps.pkg);
  const app = await deps.loadApp();
  // One container per process. In HTTP mode the server factory runs once per request and
  // closes over it, so caches, indexes and rate limits are shared by all requests.
  const container = app.createContainer(config);
  const factory: McpServerFactory = () => app.createServer(container);

  switch (command.kind) {
    case 'serve-stdio': {
      const handle = await deps.serveStdio(factory, container.logger);
      deps.onShutdown(() => handle.close());
      return undefined;
    }
    case 'serve-http': {
      if (!isLoopbackHost(command.host)) deps.err(REMOTE_WARNING);
      const handle = await deps.serveHttp({
        factory,
        logger: container.logger,
        version: config.version,
        host: command.host,
        port: command.port,
      });
      deps.onShutdown(() => handle.close());
      deps.err(`${PACKAGE_NAME} ${config.version} listening on ${handle.url}\n`);
      return undefined;
    }
    case 'doctor': {
      const report = await runDoctor(
        container,
        {
          tier: command.tier,
          ...(command.product === undefined ? {} : { product: command.product }),
        },
        {
          env: deps.env,
          nodeVersion: deps.nodeVersion,
          checkWritable: deps.checkWritable,
          sleep: deps.sleep,
          // With --json, stdout is the report and stderr stays quiet for scripts.
          ...(command.json
            ? {}
            : {
                progress: (line: string) => {
                  deps.err(`${line}\n`);
                },
              }),
        },
      );
      deps.out(command.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
      return report.exitCode;
    }
    case 'cache-info':
      deps.out(await cacheInfo(container.cache, config.cacheMaxMb));
      return EXIT.ok;
    case 'cache-clear':
      deps.out(await cacheClear(container.cache, command.scope));
      return EXIT.ok;
    case 'warm': {
      const results = await runWarm(container, command.products, deps.sleep);
      deps.out(formatWarm(results));
      return results.every((result) => result.usable) ? EXIT.ok : EXIT.failure;
    }
    case 'call': {
      // Loaded here because it pulls in the MCP SDK, which the other commands do not need.
      const { runCall } = await import('./call.js');
      const outcome = await runCall(
        app.createServer(container),
        command.tool,
        command.args,
        config.version,
      );
      deps.out(`${outcome.text}\n`);
      return outcome.isError ? EXIT.failure : EXIT.ok;
    }
  }
}

/**
 * Runs one invocation of the binary.
 *
 * @param argv the arguments after the binary name.
 * @returns the exit status, or `undefined` when a server was started and the process must
 *   keep running. `--help` and `--version` load neither the application nor the
 *   configuration.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number | undefined> {
  let command: Command;
  try {
    command = parseCli(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.err(`${error.message}\nRun "${PACKAGE_NAME} --help" for usage.\n`);
    return EXIT.usage;
  }
  if (command.kind === 'help') {
    deps.out(HELP_TEXT);
    return EXIT.ok;
  }
  if (command.kind === 'version') {
    deps.out(`${deps.pkg.version}\n`);
    return EXIT.ok;
  }
  try {
    return await execute(command, deps);
  } catch (error) {
    if (error instanceof ConfigError) {
      deps.err(`Configuration error: ${error.message}\n`);
      return EXIT.usage;
    }
    deps.err(describeError(error));
    return EXIT.failure;
  }
}
