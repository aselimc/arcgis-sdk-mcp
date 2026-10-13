import { describe, expect, it } from 'vitest';
import type { CreateGithubClient, CreateHttpClient } from '../../src/core/factories.js';
import { systemClock } from '../../src/core/logger.js';
import { createGithubClient } from '../../src/net/github.js';
import { createHttpClient } from '../../src/net/index.js';
import { makeConfig } from '../support/builders.js';
import { FakeLogger } from '../support/fake-logger.js';
import { fakePolicy } from '../support/fake-policy.js';
import { MemoryCache } from '../support/memory-cache.js';
import { mcpError } from './harness.js';

// Assignability is the test: the composition root wires these through the factory types.
const httpFactory: CreateHttpClient = createHttpClient;
const githubFactory: CreateGithubClient = createGithubClient;

describe('factory contracts', () => {
  it('builds both clients from the contract dependencies alone, without any I/O', async () => {
    const cache = new MemoryCache();
    const logger = new FakeLogger();
    const config = makeConfig({ offline: true });
    const http = httpFactory({
      config,
      logger,
      clock: systemClock,
      cache,
      policy: fakePolicy(),
      detectMetaRefresh: () => undefined,
    });
    const github = githubFactory({ config, http, cache, logger });

    expect(http.hostStates()).toEqual([]);
    expect(github.quota()).toEqual({ authenticated: false });
    expect(cache.reads).toEqual({ http: 0, derived: 0 });

    // Offline: the default transport (the built-in fetch) is never reached.
    const error = await mcpError(github.raw('Esri/calcite-design-system', 'main', 'README.md'));
    expect(error.code).toBe('OFFLINE_MISS');
    expect(error.details?.host).toBe('raw.githubusercontent.com');
  });
});
