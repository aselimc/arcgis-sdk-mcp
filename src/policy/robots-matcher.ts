/**
 * robots.txt pattern matching and parsing (RFC 9309), hand-written and dependency-free.
 *
 * Two callers use it: the static policy matches the compiled `HostPolicy.robotsDisallow`
 * patterns, and the gateway's lazy live reader (`src/net/robots-live.ts`) parses a fetched
 * `robots.txt` and matches its rules. Live rules can only add denials, so an `Allow` line is
 * honoured only against `Disallow` lines of the same rule set.
 */

/** The rules of one robots.txt group (or of several merged groups). */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Bytes of a robots.txt that a crawler must be able to parse (RFC 9309 section 2.5). */
const MAX_ROBOTS_CHARS = 512_000;

/** Upper-cases the hex digits of percent escapes so that `%2f` and `%2F` compare equal. */
function normalizeEscapes(text: string): string {
  return text.replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase());
}

/** A rule path must start at the root; a bare `search/` is read as `/search/`. */
function normalizePattern(pattern: string): string {
  const trimmed = normalizeEscapes(pattern.trim());
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.startsWith('*')) return trimmed;
  return `/${trimmed}`;
}

/**
 * The part of a URL that robots rules are matched against: path plus query, without the
 * fragment.
 */
export function robotsTarget(url: URL): string {
  return normalizeEscapes(`${url.pathname}${url.search}`);
}

/**
 * Tests one robots pattern against a path-plus-query string.
 *
 * `*` matches any run of characters and a trailing `$` anchors the end; everything else is
 * literal and the pattern is anchored at the start. Matching walks the literal pieces with
 * `indexOf` instead of building a regular expression, so a hostile live robots.txt cannot
 * cause catastrophic backtracking.
 *
 * @example robotsPatternMatches('/*\/config/', '/pro/config/daml.xml') // true
 * @example robotsPatternMatches('/*.pdf$', '/guide/intro.pdf?x=1')    // false
 */
export function robotsPatternMatches(pattern: string, target: string): boolean {
  const normalized = normalizePattern(pattern);
  if (normalized === '') return false;
  const anchored = normalized.endsWith('$');
  const pieces = (anchored ? normalized.slice(0, -1) : normalized).split('*');
  const subject = normalizeEscapes(target);

  const first = pieces[0] ?? '';
  if (!subject.startsWith(first)) return false;
  if (pieces.length === 1) return !anchored || subject.length === first.length;

  let position = first.length;
  const last = pieces.length - 1;
  for (let i = 1; i < last; i += 1) {
    const piece = pieces[i] ?? '';
    const found = subject.indexOf(piece, position);
    if (found === -1) return false;
    position = found + piece.length;
  }

  const tail = pieces[last] ?? '';
  if (anchored) return subject.length - tail.length >= position && subject.endsWith(tail);
  return subject.indexOf(tail, position) !== -1;
}

/** Length of the most specific pattern that matches, or -1 when none does. */
function bestMatch(patterns: readonly string[], target: string): number {
  let best = -1;
  for (const pattern of patterns) {
    if (!robotsPatternMatches(pattern, target)) continue;
    best = Math.max(best, normalizePattern(pattern).length);
  }
  return best;
}

/**
 * True when the rules deny the target. The most specific (longest) matching rule decides and
 * `Allow` wins a tie, as RFC 9309 section 2.2.2 requires.
 *
 * @param target path plus query; build it with {@link robotsTarget}.
 */
export function isRobotsDenied(rules: RobotsRules, target: string): boolean {
  const denied = bestMatch(rules.disallow, target);
  if (denied === -1) return false;
  return denied > bestMatch(rules.allow, target);
}

/** The pattern responsible for a denial, for error messages; `undefined` when allowed. */
export function denyingPattern(rules: RobotsRules, target: string): string | undefined {
  if (!isRobotsDenied(rules, target)) return undefined;
  const longest = bestMatch(rules.disallow, target);
  return rules.disallow.find(
    (pattern) =>
      normalizePattern(pattern).length === longest && robotsPatternMatches(pattern, target),
  );
}

interface Group {
  agents: string[];
  rules: RobotsRules;
}

/** The product token of a `User-agent` value: `Foo-Bot/1.2 (+url)` gives `foo-bot`. */
function productToken(value: string): string {
  return (/^[^\s/]*/.exec(value.trim())?.[0] ?? '').toLowerCase();
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  // Consecutive User-agent lines share one group; the first rule line closes the list.
  let collectingAgents = false;

  const lines = text
    .slice(0, MAX_ROBOTS_CHARS)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '');
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (current === undefined || !collectingAgents) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(productToken(value));
    } else if (key === 'allow' || key === 'disallow') {
      collectingAgents = false;
      // A rule before any User-agent line belongs to no group; an empty value restricts nothing.
      if (current === undefined || value === '') continue;
      current.rules[key].push(value);
    }
    // Sitemap, Crawl-delay and unknown keys neither add rules nor end a group.
  }
  return groups;
}

/**
 * Parses a robots.txt body and returns the rules that apply to one crawler.
 *
 * Groups naming the crawler's product token are merged; when there is none, the `*` groups
 * apply. Unknown lines are ignored and the parser never throws: a malformed file yields
 * whatever rules could be read.
 *
 * @param agent the User-Agent or product token of this server, for example `arcgis-sdk-mcp`.
 */
export function parseRobotsTxt(text: string, agent: string): RobotsRules {
  const token = productToken(agent);
  const groups = parseGroups(text);
  const named = groups.filter((group) => group.agents.includes(token));
  const selected = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  return {
    allow: selected.flatMap((group) => group.rules.allow),
    disallow: selected.flatMap((group) => group.rules.disallow),
  };
}
