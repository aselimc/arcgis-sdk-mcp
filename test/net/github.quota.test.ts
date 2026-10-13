import { describe, expect, it } from 'vitest';
import type { GithubClient, HttpClient } from '../../src/core/ports.js';
import { createGithubClient } from '../../src/net/github.js';
import type { QuotaSource } from '../../src/net/rate-limit-info.js';
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

  it('recognises a secondary rate limit by its Retry-After, and waits it out', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(429, { ...limitHeaders(37), 'retry-after': '90' }));
    const error = await mcpError(rig.github.latestRelease(REPO));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(error.details?.why).toContain(new Date(FAKE_NOW + 90_000).toISOString());

    rig.clock.advance(60_000);
    expect((await mcpError(rig.github.tree(REPO, 'main'))).code).toBe('RATE_LIMITED_GITHUB');
    expect(rig.origin.calls).toHaveLength(1);
  });

  it('leaves a refusal that is not about quota as UPSTREAM_BLOCKED', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(403, limitHeaders(55)));
    expect((await mcpError(rig.github.repoMeta(REPO))).code).toBe('UPSTREAM_BLOCKED');
  });

  it('stops calling the API once the quota is known to be spent, until it resets', async () => {
    const rig = make();
    rig.origin.on(/trees\/branch-/, status(403, { ...limitHeaders(0), 'retry-after': '1800' }));
    // Seven calls for different trees, as an index build would make them.
    for (let n = 0; n < 7; n += 1) {
      rig.clock.advance(2000);
      const error = await mcpError(rig.github.tree(REPO, `branch-${n}`));
      expect(error.code).toBe('RATE_LIMITED_GITHUB');
      expect(error.details?.why).toContain(`resets at ${RESET_ISO}`);
    }
    // GitHub asks clients not to keep sending while limited: one refusal is enough.
    expect(rig.origin.calls).toHaveLength(1);
    expect(rig.http.hostStates()).toEqual([
      { host: 'api.github.com', breaker: 'closed', lastError: 'HTTP 403' },
    ]);

    const nextWindow = {
      'x-ratelimit-remaining': '59',
      'x-ratelimit-reset': String(RESET_SECONDS + 3600),
    };
    rig.origin.on(/trees\/after-reset/, json({ tree: [] }, nextWindow));
    rig.clock.advance(31 * MINUTE);
    expect(await rig.github.tree(REPO, 'after-reset')).toEqual([]);
    expect(rig.github.quota()).toMatchObject({ remaining: 59 });
  });

  it('stops after the last request the quota allowed, before any refusal', async () => {
    const rig = make();
    rig.origin
      .on(/releases/, json({ tag_name: 'v1' }, limitHeaders(0)))
      .on(/trees/, json({ tree: [] }));
    await rig.github.latestRelease(REPO);

    const error = await mcpError(rig.github.tree(REPO, 'main'));
    expect(error.code).toBe('RATE_LIMITED_GITHUB');
    expect(rig.origin.urls().filter((url) => url.includes('/trees/'))).toEqual([]);
  });

  it('serves what it has stored while the quota is spent', async () => {
    const rig = make();
    rig.origin
      .on(/trees\/main/, json({ tree: [{ path: 'README.md', type: 'blob' }] }, limitHeaders(1)))
      .on(/releases/, status(403, limitHeaders(0)));
    await rig.github.tree(REPO, 'main');
    await mcpError(rig.github.latestRelease(REPO));
    expect(await rig.github.tree(REPO, 'main')).toEqual([{ path: 'README.md' }]);
    expect(rig.origin.calls).toHaveLength(2);
  });

  it('keeps saying RATE_LIMITED_GITHUB once the breaker has opened on refusals without a reset time', async () => {
    const rig = make();
    // No reset time: nothing says when to ask again, so the circuit breaker bounds the calls.
    rig.origin.on(/api\.github/, status(403, { 'x-ratelimit-remaining': '0' }));
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

  it('does not take a refusal for the quota when the API said nothing about quota', async () => {
    const rig = make();
    rig.origin.on(/api\.github/, status(403));
    const error = await mcpError(rig.github.repoMeta(REPO));
    expect(error.code).toBe('UPSTREAM_BLOCKED');
    expect(error.details?.why).toBe('The server answered 403');
    expect(rig.github.quota()).toEqual({ authenticated: false });
  });
});

describe('github: quota facts and the HTTP client', () => {
  /** The quota is not spent: a refusal with 4999 requests left is about something else. */
  const NOT_QUOTA = { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(RESET_SECONDS) };
  const SPENT = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET_SECONDS) };

  function over(http: HttpClient, rig: Rig): GithubClient {
    return createGithubClient({
      config: rig.config,
      http,
      cache: rig.cache,
      logger: rig.logger,
      clock: rig.clock,
    });
  }

  it('reads them through a client that wraps the gateway and forwards the method', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const real = rig.http;
    const wrapped: HttpClient & QuotaSource = {
      get: (req) => real.get(req),
      getJson: (req) => real.getJson(req),
      hostStates: () => real.hostStates(),
      rateLimit: (host) => real.rateLimit(host),
    };
    rig.origin
      .on(/repos\/Esri\/blocked/, status(403, NOT_QUOTA))
      .on(/repos\/Esri\/limited/, status(403, SPENT));
    const github = over(wrapped, rig);

    expect((await mcpError(github.repoMeta('Esri/blocked'))).code).toBe('UPSTREAM_BLOCKED');
    expect(github.quota()).toMatchObject({ remaining: 4999 });
    expect((await mcpError(github.repoMeta('Esri/limited'))).code).toBe('RATE_LIMITED_GITHUB');
  });

  // The quota used to travel through hidden state keyed on the identity of the gateway
  // object, and a refusal seen through any other object was guessed to be the quota.
  it('never guesses: behind a client that reports no quota a refusal stays a refusal', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const real = rig.http;
    const wrapped: HttpClient = {
      get: (req) => real.get(req),
      getJson: (req) => real.getJson(req),
      hostStates: () => real.hostStates(),
    };
    rig.origin.on(/api\.github/, status(403, NOT_QUOTA));
    const github = over(wrapped, rig);

    const error = await mcpError(github.repoMeta(REPO));
    expect(error.code).toBe('UPSTREAM_BLOCKED');
    expect(github.quota()).toEqual({ authenticated: false });
  });

  it('does the same with a replay client', async () => {
    const http = new FakeHttp().fail(/api\.github\.com/, 403);
    const github = createGithubClient({
      config: makeConfig(),
      http,
      cache: new MemoryCache(),
      logger: new FakeLogger(),
      clock: new FakeClock(),
    });
    expect((await mcpError(github.repoMeta(REPO))).code).toBe('UPSTREAM_BLOCKED');
    expect(github.quota()).toEqual({ authenticated: false });
  });
});
