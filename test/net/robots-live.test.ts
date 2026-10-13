import { describe, expect, it } from 'vitest';
import {
  LiveRobots,
  ROBOTS_RETRY_MS,
  ROBOTS_TTL_MS,
  type RobotsFetch,
} from '../../src/net/robots-live.js';
// The live reader parses and matches with the static policy's implementation; these cases
// pin the behaviour the gateway relies on.
import {
  denyingPattern as robotsDenial,
  parseRobotsTxt as parseRobots,
} from '../../src/policy/robots-matcher.js';
import { FakeClock, HOUR } from '../support/fake-clock.js';
import { FakeLogger } from '../support/fake-logger.js';
import { MemoryCache } from '../support/memory-cache.js';

const AGENT = 'arcgis-sdk-mcp';

describe('robots.txt parsing as used for live files', () => {
  it('reads the wildcard group, ignoring comments, blank lines and other directives', () => {
    const rules = parseRobots(
      [
        '# robots for a documentation site',
        'User-agent: *',
        '',
        'Disallow: *?q=   # search results',
        'Disallow: /downloads',
        'Allow: /',
        'Crawl-delay: 5',
        'Sitemap: https://example.com/sitemap.xml',
        'not a directive at all',
      ].join('\r\n'),
      AGENT,
    );
    expect(rules).toEqual({ allow: ['/'], disallow: ['*?q=', '/downloads'] });
  });

  it('prefers a group that names this client over the wildcard group', () => {
    const text = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: ArcGIS-SDK-MCP',
      'Disallow: /private/',
    ].join('\n');
    expect(parseRobots(text, AGENT)).toEqual({ allow: [], disallow: ['/private/'] });
  });

  it('shares rules between consecutive user-agent lines and skips other crawlers', () => {
    const text = [
      'User-agent: Googlebot',
      'User-agent: *',
      'Disallow: /a/',
      'User-agent: Bingbot',
      'Disallow: /b/',
      'User-agent: *',
      'Disallow: /c/',
    ].join('\n');
    expect(parseRobots(text, AGENT).disallow).toEqual(['/a/', '/c/']);
  });

  it('treats an empty Disallow as "nothing is disallowed"', () => {
    expect(parseRobots('User-agent: *\nDisallow:', AGENT)).toEqual({ allow: [], disallow: [] });
  });

  it('finds no rules in a body that is not a robots file', () => {
    expect(parseRobots('{"_id":"robots.txt","name":"robots.txt"}', AGENT).disallow).toEqual([]);
    expect(parseRobots('<!doctype html><html><body>Not found</body></html>', AGENT)).toEqual({
      allow: [],
      disallow: [],
    });
    // Rules before any user-agent line belong to nobody.
    expect(parseRobots('Disallow: /x/', AGENT).disallow).toEqual([]);
  });
});

describe('robots matching as used for live files', () => {
  const rules = {
    allow: ['/products/open/', '/exact$'],
    disallow: ['*?q=', '/downloads', '/products/', '/*.pdf$', '/exact', '/a+b(1)/'],
  };

  it.each<[string, string | undefined]>([
    ['/javascript/latest/', undefined],
    ['/downloads', '/downloads'],
    ['/downloads/sdk', '/downloads'],
    ['/search/?q=layers', '*?q='],
    ['/products/closed/', '/products/'],
    ['/products/open/page', undefined],
    ['/docs/guide.pdf', '/*.pdf$'],
    ['/docs/guide.pdf?page=2', undefined],
    ['/exact', undefined],
    ['/exactly', '/exact'],
    ['/a+b(1)/x', '/a+b(1)/'],
    ['/aab1/x', undefined],
  ])('%s', (path, denied) => {
    expect(robotsDenial(rules, path)).toBe(denied);
  });

  it('lets Allow win a tie', () => {
    expect(robotsDenial({ allow: ['/same/'], disallow: ['/same/'] }, '/same/x')).toBeUndefined();
  });
});

describe('LiveRobots', () => {
  function make(replies: RobotsFetch[]) {
    const clock = new FakeClock();
    const cache = new MemoryCache();
    const logger = new FakeLogger();
    const fetched: string[] = [];
    const robots = new LiveRobots({
      cache,
      clock,
      logger,
      agentToken: AGENT,
      fetchRobots: async (host) => {
        fetched.push(host);
        return replies[Math.min(fetched.length, replies.length) - 1] ?? { kind: 'none' };
      },
    });
    return { clock, cache, logger, fetched, robots };
  }
  const url = (path: string) => new URL(`https://h.example.com${path}`);
  const RULES: RobotsFetch = { kind: 'rules', text: 'User-agent: *\nDisallow: /no/' };

  it('reads once for concurrent first requests', async () => {
    const { robots, fetched } = make([RULES]);
    const answers = await Promise.all([
      robots.denial('h.example.com', url('/no/a')),
      robots.denial('h.example.com', url('/yes/')),
      robots.denial('h.example.com', url('/no/b')),
    ]);
    expect(answers).toEqual(['/no/', undefined, '/no/']);
    expect(fetched).toEqual(['h.example.com']);
  });

  it('matches against the path and the query', async () => {
    const { robots } = make([{ kind: 'rules', text: 'User-agent: *\nDisallow: /*?q=' }]);
    expect(await robots.denial('h.example.com', url('/s/?q=1'))).toBe('/*?q=');
    expect(await robots.denial('h.example.com', url('/s/'))).toBeUndefined();
  });

  it('trusts a missing file for a day and an unreachable one for an hour', async () => {
    const missing = make([{ kind: 'none' }]);
    await missing.robots.denial('h.example.com', url('/'));
    missing.clock.advance(ROBOTS_TTL_MS - 1);
    await missing.robots.denial('h.example.com', url('/'));
    expect(missing.fetched).toHaveLength(1);

    const down = make([{ kind: 'unreachable' }, RULES]);
    expect(await down.robots.denial('h.example.com', url('/no/'))).toBeUndefined();
    down.clock.advance(ROBOTS_RETRY_MS - 1);
    await down.robots.denial('h.example.com', url('/no/'));
    expect(down.fetched).toHaveLength(1);
    down.clock.advance(1);
    expect(await down.robots.denial('h.example.com', url('/no/'))).toBe('/no/');
  });

  it('drops a rule when a later read no longer has it', async () => {
    const { robots, clock } = make([RULES, { kind: 'rules', text: 'User-agent: *\nDisallow:' }]);
    expect(await robots.denial('h.example.com', url('/no/'))).toBe('/no/');
    clock.advance(25 * HOUR);
    expect(await robots.denial('h.example.com', url('/no/'))).toBeUndefined();
  });

  it('works with a cache that fails in both directions', async () => {
    const { robots, cache, logger } = make([RULES]);
    cache.getDerived = () => Promise.reject(new Error('unreadable'));
    cache.putDerived = () => Promise.reject(new Error('read-only'));
    expect(await robots.denial('h.example.com', url('/no/'))).toBe('/no/');
    expect(logger.messages('warn')).toEqual(['could not store robots rules']);
  });
});
