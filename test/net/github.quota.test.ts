import { describe, expect, it } from 'vitest';
import type { GithubClient } from '../../src/core/ports.js';
import { createGithubClient } from '../../src/net/github.js';
import { FAKE_NOW, FakeClock, MINUTE } from '../support/fake-clock.js';
import { FakeHttp } from '../support/fake-http.js';
import { FakeLogger } from '../support/fake-logger.js';
import { makeConfig } from '../support/builders.js';
import { MemoryCache } from '../support/memory-cache.js';
import { body, hostRow, json, makeRig, mcpError, status, type Rig } from './harness.js';

const REPO = 'Esri/arcgis-maps-sdk-kotlin-samples';
const HOSTS = [
  hostRow('api.github.com', { capability: 'github' }),
  hostRow('raw.githubusercontent.com', { capability: 'github' }),
];
const RESET_SECONDS = FAKE_NOW / 1000 + 30 * 60;
const RESET_ISO = new Date(RESET_SECONDS * 1000).toISOString();

function make(token?: string): Rig & { github: GithubClient } {
  const rig = makeRig({ hosts: HOSTS, config: token === undefined ? {} : { githubToken: token } });
  const github = createGithubClient({
    config: rig.config,
    http: rig.http,
    cache: rig.cache,
    logger: rig.logger,
    clock: rig.clock,
  });
  return { ...rig, github };
}

describe('github: quota', () => {
  const limitHeaders = (remaining: number) => ({
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-reset': String(RESET_SECONDS),
  });

  it('reports the quota the API last stated, until it resets', async () => {
    const rig = make();
    expect(rig.github.quota()).toEqual({ authenticated: false });

    rig.origin.on(/releases/, json({ tag_name: 'v1' }, limitHeaders(41)));
    await rig.github.latestRelease(REPO);
    expect(rig.github.quota()).toEqual({ authenticated: false, remaining: 41, resetAt: RESET_ISO });

    rig.clock.advance(31 * MINUTE);
    expect(rig.github.quota()).toEqual({ authenticated: false });
  });

  it('sends the token to the API when one is configured', async () => {
    const rig = make('ghp_secret');
    rig.origin.on(/releases/, json({ tag_name: 'v1' }, limitHeaders(4999)));
    await rig.github.latestRelease(REPO);
    expect(rig.origin.calls[0]?.headers.authorization).toBe('Bearer ghp_secret');
    expect(rig.github.quota()).toMatchObject({ authenticated: true, remaining: 4999 });
  });

  it('turns a refusal with a spent quota into RATE_LIMITED_GITHUB with the reset time', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(403, limitHeaders(0)));
    const error = await mcpError(rig.github.tree(REPO, 'main'));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(error.details).toMatchObject({ host: 'api.github.com', retryable: false });
    expect(error.details?.why).toContain(`resets at ${RESET_ISO}`);
    expect(error.details?.why).toContain('60 requests per hour');
    expect(error.details?.next).toContain('GITHUB_TOKEN');
    expect(rig.github.quota()).toMatchObject({ remaining: 0, resetAt: RESET_ISO });
  });

  it('does not suggest a token to a client that already has one', async () => {
    const rig = make('ghp_secret');
    rig.origin.on(/api\.github/, status(403, limitHeaders(0)));
    const error = await mcpError(rig.github.repoMeta(REPO));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(error.details?.next).toBe(`Retry after ${RESET_ISO}`);
  });

  it('recognises a secondary rate limit by its Retry-After', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(429, { ...limitHeaders(37), 'retry-after': '90' }));
    const error = await mcpError(rig.github.latestRelease(REPO));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(error.details?.why).toContain(new Date(FAKE_NOW + 90_000).toISOString());
  });

  it('leaves a refusal that is not about quota as UPSTREAM_BLOCKED', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(403, limitHeaders(55)));
    expect((await mcpError(rig.github.repoMeta(REPO))).code).toBe('UPSTREAM_BLOCKED');
  });

  it('keeps saying RATE_LIMITED_GITHUB once the breaker has opened on the refusals', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(403, limitHeaders(0)));
    for (let n = 0; n < 5; n += 1) await mcpError(rig.github.tree(REPO, `branch-${n}`));
    const error = await mcpError(rig.github.tree(REPO, 'one-more'));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(rig.origin.calls).toHaveLength(5);
  });

  it('still reads raw content while the API quota is spent', async () => {
    const rig = make();
    rig.origin
      .on(/api\.github/, status(403, limitHeaders(0)))
      .on(/raw\./, body('# Readme', 'text/plain'));
    await mcpError(rig.github.repoMeta(REPO));
    expect((await rig.github.raw(REPO, 'main', 'README.md')).text).toBe('# Readme');
  });

  it('passes other failures through unchanged', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(404));
    expect((await mcpError(rig.github.tree(REPO, 'main'))).code).toBe('DOC_NOT_FOUND');

    const down = make();
    down.origin.on(/api\.github/, status(502, limitHeaders(50)));
    expect((await mcpError(down.github.tree(REPO, 'main'))).code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('takes a refusal for the quota when the HTTP client publishes no quota headers', async () => {
    const http = new FakeHttp().fail(/api\.github\.com/, 403);
    const github = createGithubClient({
      config: makeConfig(),
      http,
      cache: new MemoryCache(),
      logger: new FakeLogger(),
      clock: new FakeClock(),
    });
    const error = await mcpError(github.repoMeta(REPO));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(error.details?.why).toContain('an unknown time');
    expect(github.quota()).toEqual({ authenticated: false });
  });
});
