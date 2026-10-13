import { newBudget } from '../../src/core/async.js';
import type { Config } from '../../src/core/config.js';
import type { CallOptions, Ctx, Registry, Renderer, SourcePolicy } from '../../src/core/ports.js';
import type { Product, WorkspaceSdk } from '../../src/core/types.js';
import { makeConfig } from './builders.js';
import { FakeClock } from './fake-clock.js';
import { FakeGithub } from './fake-github.js';
import { FakeHttp, type Cassette } from './fake-http.js';
import { FakeLogger } from './fake-logger.js';
import { fakePolicy } from './fake-policy.js';
import { fakeRegistry } from './fake-registry.js';
import { FakeRenderer } from './fake-render.js';
import { MemoryCache } from './memory-cache.js';

/** A `Ctx` whose collaborators are the fakes, typed as such so tests can script and inspect them. */
export interface TestCtx extends Ctx {
  clock: FakeClock;
  logger: FakeLogger;
  http: FakeHttp;
  github: FakeGithub;
  cache: MemoryCache;
}

/** Options of {@link makeCtx}. Anything omitted gets a fresh fake. */
export interface MakeCtxOptions {
  config?: Partial<Config>;
  clock?: FakeClock;
  logger?: FakeLogger;
  http?: FakeHttp;
  /** Shorthand for `http: new FakeHttp({ cassette })`. */
  cassette?: Cassette;
  github?: FakeGithub;
  cache?: MemoryCache;
  policy?: SourcePolicy;
  registry?: Registry;
  /** Shorthand for `registry: fakeRegistry({ products })`. */
  products?: Product[];
  render?: Renderer;
  /** What `ctx.workspace()` resolves to. Default `[]`. */
  workspace?: WorkspaceSdk[];
}

/**
 * Builds a complete offline `Ctx`. All fakes share one `FakeClock`, so advancing it moves
 * time for the HTTP fake, budgets and anything else that reads the clock.
 *
 * @example
 * const ctx = makeCtx({ cassette: loadCassette('cassettes', 'site', 'astro-guide.json') });
 * const records = await adapter.enumerate(ctx, bindSource(product, source, line));
 * expect(ctx.http.unrecorded).toEqual([]);
 */
export function makeCtx(options: MakeCtxOptions = {}): TestCtx {
  const clock = options.clock ?? new FakeClock();
  const config = makeConfig(options.config);
  const workspace = options.workspace ?? [];
  return {
    config,
    clock,
    logger: options.logger ?? new FakeLogger(),
    http:
      options.http ??
      new FakeHttp(
        options.cassette === undefined ? { clock } : { clock, cassette: options.cassette },
      ),
    github: options.github ?? new FakeGithub({}, clock),
    cache: options.cache ?? new MemoryCache(),
    policy:
      options.policy ?? fakePolicy({ enabled: [...config.capabilities], offline: config.offline }),
    registry:
      options.registry ??
      fakeRegistry(options.products === undefined ? {} : { products: options.products }),
    render: options.render ?? new FakeRenderer(),
    workspace: async () => workspace,
  };
}

/** `CallOptions` with a fresh budget taken from the context's limits (12 requests, 25 s by default). */
export function makeCall(ctx: Ctx, overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    budget: newBudget(
      ctx.config.limits.requestsPerCall,
      ctx.config.limits.callDeadlineMs,
      ctx.clock,
    ),
    ...overrides,
  };
}
