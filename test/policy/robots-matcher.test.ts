import { describe, expect, it } from 'vitest';
import {
  denyingPattern,
  isRobotsDenied,
  parseRobotsTxt,
  robotsPatternMatches,
  robotsTarget,
} from '../../src/policy/robots-matcher.js';

describe('robotsPatternMatches', () => {
  const cases: Array<[pattern: string, target: string, expected: boolean]> = [
    // Plain prefixes.
    ['/search/', '/search/', true],
    ['/search/', '/search/results?q=map', true],
    ['/search/', '/searching', false],
    ['/search/', '/guide/search/', false],
    ['/downloads', '/downloads', true],
    ['/downloads', '/downloads/sdk.zip', true],
    ['/downloads', '/downloads-old', true],
    ['/', '/anything/at/all', true],
    // Wildcards.
    ['*?q=', '/documentation/?q=layers', true],
    ['*?q=', '/documentation/', false],
    ['/*/config/', '/pro/config/daml.xml', true],
    ['/*/config/', '/pro/sdk/config/', true],
    ['/*/config/', '/config/', false],
    ['/a*b*c', '/a-b-c', true],
    ['/a*b*c', '/a-c-b', false],
    ['/a**b', '/a-b', true],
    ['/en/*/test/*', '/en/pro/test/page.htm', true],
    ['/en/*/test/*', '/en/test/', false],
    ['*', '/', true],
    // End anchor.
    ['/*.pdf$', '/guide/intro.pdf', true],
    ['/*.pdf$', '/guide/intro.pdf?page=2', false],
    ['/exact$', '/exact', true],
    ['/exact$', '/exact/more', false],
    ['/a*c$', '/abc', true],
    ['/a*c$', '/abcd', false],
    // The tail of an anchored pattern may not overlap what the head already consumed.
    ['/ab*b$', '/ab', false],
    ['/ab*b$', '/abb', true],
    // A wildcard followed by a literal that never appears.
    ['/a*z', '/abc', false],
    // Percent escapes compare case-insensitively in their hex digits.
    ['/caf%c3%a9', '/caf%C3%A9', true],
    // A path without a leading slash is read as rooted.
    ['search/', '/search/x', true],
    // An empty pattern restricts nothing.
    ['', '/anything', false],
    ['   ', '/anything', false],
  ];

  it.each(cases)('%s against %s is %s', (pattern, target, expected) => {
    expect(robotsPatternMatches(pattern, target)).toBe(expected);
  });

  it('stays fast on a pattern built to make a regular expression backtrack', () => {
    const pattern = `/${'*a'.repeat(40)}$`;
    const target = `/${'a'.repeat(5000)}b`;
    const started = performance.now();
    expect(robotsPatternMatches(pattern, target)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('robotsTarget', () => {
  it('joins path and query and drops the fragment', () => {
    expect(robotsTarget(new URL('https://example.org/a/b?q=1#frag'))).toBe('/a/b?q=1');
  });

  it('normalises the case of percent escapes', () => {
    expect(robotsTarget(new URL('https://example.org/a%2fb'))).toBe('/a%2Fb');
  });
});

describe('isRobotsDenied', () => {
  it('allows everything when there is no rule', () => {
    expect(isRobotsDenied({ allow: [], disallow: [] }, '/x')).toBe(false);
  });

  it('denies a matching disallow rule', () => {
    expect(isRobotsDenied({ allow: [], disallow: ['/search/'] }, '/search/x')).toBe(true);
  });

  it('lets the longest matching rule decide', () => {
    const rules = { allow: ['/api/public/'], disallow: ['/api/'] };
    expect(isRobotsDenied(rules, '/api/public/spec.json')).toBe(false);
    expect(isRobotsDenied(rules, '/api/private/spec.json')).toBe(true);
  });

  it('prefers allow when both rules are equally specific', () => {
    expect(isRobotsDenied({ allow: ['/page'], disallow: ['/page'] }, '/page')).toBe(false);
  });

  it('denies when the disallow rule is more specific than the allow rule', () => {
    const rules = { allow: ['/docs/'], disallow: ['/docs/internal/'] };
    expect(isRobotsDenied(rules, '/docs/internal/notes')).toBe(true);
  });
});

describe('denyingPattern', () => {
  it('names the most specific pattern that excludes the target', () => {
    const rules = { allow: [], disallow: ['/en/', '/en/asset/', '/js/'] };
    expect(denyingPattern(rules, '/en/asset/logo.svg')).toBe('/en/asset/');
  });

  it('is undefined for an allowed target', () => {
    expect(denyingPattern({ allow: ['/en/'], disallow: ['/e'] }, '/en/page')).toBeUndefined();
    expect(denyingPattern({ allow: [], disallow: ['/x'] }, '/y')).toBeUndefined();
  });
});

describe('parseRobotsTxt', () => {
  const agent = 'arcgis-sdk-mcp/1.0.0 (+https://github.com/aselimc/arcgis-sdk-mcp)';

  it('reads the wildcard group when no group names this crawler', () => {
    const text = [
      'User-agent: *',
      'Disallow: /search/',
      'Disallow: /*/config/',
      'Allow: /search/help',
      '',
      'User-agent: otherbot',
      'Disallow: /',
    ].join('\n');
    expect(parseRobotsTxt(text, agent)).toEqual({
      allow: ['/search/help'],
      disallow: ['/search/', '/*/config/'],
    });
  });

  it('prefers the groups that name this crawler and merges them', () => {
    const text = [
      'User-agent: *',
      'Disallow: /everyone/',
      'User-agent: ArcGIS-SDK-MCP',
      'Disallow: /only-us/',
      'User-agent: arcgis-sdk-mcp',
      'Disallow: /also-us/',
    ].join('\n');
    expect(parseRobotsTxt(text, agent).disallow).toEqual(['/only-us/', '/also-us/']);
  });

  it('shares the rules of a group between consecutive user-agent lines', () => {
    const text = 'User-agent: somebot\nUser-agent: *\nDisallow: /shared/\n';
    expect(parseRobotsTxt(text, agent).disallow).toEqual(['/shared/']);
  });

  it('starts a new group at a user-agent line that follows rules', () => {
    const text = 'User-agent: somebot\nDisallow: /a/\nUser-agent: *\nDisallow: /b/\n';
    expect(parseRobotsTxt(text, agent).disallow).toEqual(['/b/']);
  });

  it('ignores comments, blank values, unknown keys, CRLF and a byte-order mark', () => {
    const text = [
      '\uFEFF# robots for a documentation host',
      'User-Agent: * # everyone',
      'Crawl-delay: 5',
      'Disallow:',
      'Allow:',
      'Sitemap: https://example.org/sitemap.xml',
      'DISALLOW: /private/ # staff only',
      'this line has no colon',
    ].join('\r\n');
    expect(parseRobotsTxt(text, agent)).toEqual({ allow: [], disallow: ['/private/'] });
  });

  it('does not let Sitemap or Crawl-delay lines split a user-agent list', () => {
    const text = 'User-agent: somebot\nCrawl-delay: 2\nUser-agent: *\nDisallow: /x/\n';
    expect(parseRobotsTxt(text, 'somebot').disallow).toEqual(['/x/']);
  });

  it('drops rules that precede every user-agent line', () => {
    expect(parseRobotsTxt('Disallow: /orphan/\nUser-agent: *\nDisallow: /a/', agent)).toEqual({
      allow: [],
      disallow: ['/a/'],
    });
  });

  it('returns no rules for an empty file, a file without groups or an HTML page', () => {
    const none = { allow: [], disallow: [] };
    expect(parseRobotsTxt('', agent)).toEqual(none);
    expect(parseRobotsTxt('User-agent: otherbot\nDisallow: /', agent)).toEqual(none);
    expect(parseRobotsTxt('<!doctype html><html><body>Not found</body></html>', agent)).toEqual(
      none,
    );
  });

  it('reads a blanket denial', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /\n', agent);
    expect(isRobotsDenied(rules, '/any/page')).toBe(true);
  });

  it('ignores everything past the size limit', () => {
    const padding = `# ${'x'.repeat(1000)}\n`.repeat(600);
    const text = `User-agent: *\nDisallow: /early/\n${padding}Disallow: /late/\n`;
    expect(parseRobotsTxt(text, agent).disallow).toEqual(['/early/']);
  });

  it('accepts a bare product token as the agent', () => {
    const text = 'User-agent: arcgis-sdk-mcp\nDisallow: /x/\n';
    expect(parseRobotsTxt(text, 'arcgis-sdk-mcp').disallow).toEqual(['/x/']);
  });
});
