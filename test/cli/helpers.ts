import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Container } from '../../src/app/container.js';
import type { CliDeps } from '../../src/cli/run.js';
import { TOOLS } from '../../src/core/names.js';
import type { IndexState, Services, SourceAdapter } from '../../src/core/ports.js';
import { FakeAdapter, fakeAdapterRegistry } from '../support/fake-adapter.js';
import { makeCtx, type MakeCtxOptions, type TestCtx } from '../support/make-ctx.js';

/** A container over the test fakes, typed so tests can script them. */
export interface TestContainer extends Container {
  ctx: TestCtx;
  /** Arguments of every `services.index.ensure` call. */
  ensured: Array<{ product: string; sources: string[] | undefined; line: string }>;
}

/** Options of {@link makeContainer}. */
export interface MakeContainerOptions extends MakeCtxOptions {
  /** Default: one `FakeAdapter` of type `gatsby` (the adapter of `makeProduct()`). */
  adapters?: SourceAdapter[];
  /** What successive `services.index.ensure` calls return; the last entry repeats. */
  indexStates?: IndexState[][];
}

/**
 * A `Container` whose collaborators are the fakes of `test/support`. Only the index service
 * is implemented among the services, because `warm` is the one command that calls a service
 * directly; the tools reach the others through a server instance.
 */
export function makeContainer(options: MakeContainerOptions = {}): TestContainer {
  const ctx = makeCtx(options);
  const ensured: TestContainer['ensured'] = [];
  const script = options.indexStates ?? [[]];
  let calls = 0;
  const index: Pick<Services['index'], 'ensure'> = {
    ensure: async (product, sources, line) => {
      ensured.push({ product: product.id, sources, line: line.id });
      const states = script[Math.min(calls, script.length - 1)] ?? [];
      calls += 1;
      return states;
    },
  };
  return {
    config: ctx.config,
    logger: ctx.logger,
    clock: ctx.clock,
    registry: ctx.registry,
    policy: ctx.policy,
    cache: ctx.cache,
    http: ctx.http,
    github: ctx.github,
    render: ctx.render,
    ctx,
    adapters: fakeAdapterRegistry(options.adapters ?? [new FakeAdapter('gatsby')]),
    // Only `index.ensure` exists; a command that touched another service would fail loudly.
    services: { index } as unknown as Services,
    workspace: ctx.workspace,
    ensured,
  };
}

/** A real MCP server with one tool under the name of `arcgis_docs_search`. */
export function makeEchoServer(): McpServer {
  const server = new McpServer({ name: 'echo', version: '0.0.0' });
  server.registerTool(
    TOOLS.search,
    {
      title: 'Echo',
      description: 'Returns the query.',
      inputSchema: z.object({ query: z.string().min(2), fail: z.boolean().optional() }),
    },
    ({ query, fail }) => ({
      content: [{ type: 'text', text: `echo: ${query}` }],
      ...(fail === true ? { isError: true } : {}),
    }),
  );
  return server;
}

/** What a test run of the CLI wrote and started. */
export interface CliHarness {
  deps: CliDeps;
  out: string[];
  err: string[];
  container: TestContainer;
  /** Number of times the application modules were loaded. */
  loads: () => number;
  /** Modes the configuration was created for, one per `createContainer` call. */
  modes: string[];
  served: Array<{ kind: 'stdio' } | { kind: 'http'; host: string; port: number }>;
  shutdownHooks: Array<() => Promise<void>>;
  closed: string[];
  slept: number[];
}

/** `CliDeps` made of recorders and the fake container. */
export function makeCli(
  options: MakeContainerOptions & { env?: NodeJS.ProcessEnv; deps?: Partial<CliDeps> } = {},
): CliHarness {
  const container = makeContainer(options);
  const out: string[] = [];
  const err: string[] = [];
  const modes: string[] = [];
  const served: CliHarness['served'] = [];
  const shutdownHooks: CliHarness['shutdownHooks'] = [];
  const closed: string[] = [];
  const slept: number[] = [];
  let loads = 0;
  const deps: CliDeps = {
    env: options.env ?? {},
    cwd: '/work',
    nodeVersion: '22.15.0',
    pkg: { version: '9.9.9', repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp' },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    loadApp: async () => {
      loads += 1;
      return {
        createContainer: (config) => {
          modes.push(config.mode);
          return container;
        },
        createServer: () => makeEchoServer(),
      };
    },
    serveStdio: async () => {
      served.push({ kind: 'stdio' });
      return { close: async () => void closed.push('stdio') };
    },
    serveHttp: async ({ host, port }) => {
      served.push({ kind: 'http', host, port });
      return {
        url: `http://${host}:${port}/mcp`,
        port,
        close: async () => void closed.push('http'),
      };
    },
    onShutdown: (close) => void shutdownHooks.push(close),
    checkWritable: async () => undefined,
    sleep: async (ms) => void slept.push(ms),
    ...options.deps,
  };
  return {
    deps,
    out,
    err,
    container,
    loads: () => loads,
    modes,
    served,
    shutdownHooks,
    closed,
    slept,
  };
}
