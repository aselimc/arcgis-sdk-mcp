/**
 * Version parsing and ordering across the channels Esri publishes on: npm (`5.1.0`,
 * `5.2.0-next.20261001`), Git tags (`v300.1.0`), pub.dev (`300.1.0+5042`), URL slugs
 * (`300-1`), PyPI (`2.5.0rc1`) and calendar versions (`2026.2`).
 */

/** Suffix words that mark a build as not generally available. */
const PRERELEASE_WORD =
  /^[._-]?(?:alpha|beta|preview|canary|nightly|snapshot|next|dev|pre|rc|a|b|c)(?![a-z])/i;

interface Parsed {
  numbers: number[];
  /** Whatever follows the numeric part, for example `-next.1`, `rc1` or an empty string. */
  suffix: string;
  /** True when the numeric part used dots (a real version) rather than hyphens (a URL slug). */
  dotted: boolean;
}

function parse(s: string): Parsed {
  // A leading `v` and a `+build` suffix carry no ordering information.
  const text = s
    .trim()
    .replace(/^v(?=\d)/i, '')
    .replace(/\+.*$/, '');
  const dotted = /^\d+\./.test(text);
  const match = (dotted ? /^\d+(?:\.\d+)*/ : /^\d+(?:-\d+)*/).exec(text);
  if (match === null) return { numbers: [], suffix: text, dotted: false };
  return {
    numbers: match[0].split(/[.-]/).map(Number),
    suffix: text.slice(match[0].length),
    dotted,
  };
}

/**
 * Numeric components of a version string.
 *
 * `300.1.0`, `v300.1.0` and `300.1.0+5042` give `[300, 1, 0]`; the slug form `300-1` gives
 * `[300, 1]`; `2026.2` gives `[2026, 2]`. A pre-release suffix is ignored here (see
 * {@link isPrerelease}): `5.2.0-next.20261001` and `2.5.0rc1` give `[5, 2, 0]` and `[2, 5, 0]`.
 * A string that does not start with a number gives `[]`.
 */
export function parseVersion(s: string): number[] {
  return parse(s).numbers;
}

/**
 * True for alpha, beta, rc, next, dev, preview and similar builds, and for a dotted version
 * with a numeric hyphen suffix (`200.8.0-4605`, the semver pre-release form). False for
 * plain releases, URL slugs such as `300-1` and unparseable strings.
 */
export function isPrerelease(s: string): boolean {
  const { numbers, suffix, dotted } = parse(s);
  if (numbers.length === 0) return false;
  return PRERELEASE_WORD.test(suffix) || (dotted && /^-\d/.test(suffix));
}

/**
 * Orders two version strings: negative when `a < b`, positive when `a > b`, 0 when equal.
 * Missing components count as 0 (`5.1` equals `5.1.0`); with equal numbers a pre-release
 * sorts before the release. Unparseable strings sort before everything.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.length === 0 || pb.length === 0) return Math.sign(pa.length - pb.length);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const difference = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return Number(isPrerelease(b)) - Number(isPrerelease(a));
}

/** The highest version of a list by {@link compareVersions}; `undefined` when nothing parses. */
export function maxVersion(list: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const candidate of list) {
    if (parseVersion(candidate).length === 0) continue;
    if (best === undefined || compareVersions(candidate, best) > 0) best = candidate;
  }
  return best;
}
