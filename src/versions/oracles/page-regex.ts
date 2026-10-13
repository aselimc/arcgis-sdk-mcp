/**
 * Oracle `page-regex`: one page and one regular expression. The default reads the
 * "Current version: X - date" banner of a developers.arcgis.com product home page; a custom
 * pattern covers the first release-notes heading or the first row of a release table.
 *
 * Options:
 * - `url`: the page; default the product's home page for the line. Line variables such as
 *   `{prefix}` are substituted. A `.json` URL is read as JSON text.
 * - `pattern`: a regular expression; default the banner patterns.
 * - `match`: `text` (tags removed, whitespace collapsed) or `html` (the raw
 *   markup). Default for a custom pattern: `html` when it contains `<`, else the text first
 *   and the markup as a second try. The banner patterns always read the text.
 * - `format`: how the version is built from the capture groups (`$1.$2` turns
 *   `version-(\d)(\d+)` into `1.38`); default the group named by `versionGroup`, else `$1`.
 * - `dateGroup` (or `date`, a template like `format`): where the release date is. The
 *   built-in banner patterns have it in group 2; a custom pattern has none unless stated.
 */
import type { OracleSpec, VersionFact } from '../../core/types.js';
import { compilePattern } from '../sitemap-versions.js';
import { parseDate } from '../version-text.js';
import { defineOracle, homeUrl, option, requestOptions, urlOption } from './kit.js';

const DATE = String.raw`([A-Za-z]+\.?,?\s*(?:\d{1,2},\s*)?\d{4})`;
const SCOPE = String.raw`(?:@[\w/.-]+\s*:\s*)?`;

/**
 * Banner spellings seen on product home pages, most specific first: with a date, then the
 * Experience Builder form ("Version 1.21 · July 2026"), then the frozen-line form
 * ("Version: 2.3.1 - July 9, 2024"), then a banner without a date.
 */
const BANNER_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`Current version:\s*${SCOPE}(\d+(?:\.\d+)*)\s*(?:-|\(|·)?\s*${DATE}`, 'i'),
  new RegExp(String.raw`\bVersion:?\s+(\d+(?:\.\d+)*)\s*(?:-|\(|·)\s*${DATE}`, 'i'),
  new RegExp(String.raw`Current version:\s*${SCOPE}(\d+(?:\.\d+)*)`, 'i'),
];

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  middot: '·',
  ndash: '-',
  mdash: '-',
  lt: '<',
  gt: '>',
  quot: '"',
};

/** Visible text of a page: scripts, styles and comments dropped, tags and entities resolved, whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fills `$1`..`$9` of a template from a match; a missing group becomes an empty string. */
function fill(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d)/g, (_whole, index: string) => match[Number(index)] ?? '').trim();
}

function firstMatch(patterns: readonly RegExp[], text: string): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match;
  }
  return undefined;
}

/**
 * What to match against, in order. The banner patterns read visible text only, so a version
 * inside a script or comment is never taken for the banner; a custom pattern reads markup
 * when it contains `<` or when the text has no match.
 */
function subjects(
  spec: OracleSpec,
  pattern: string | undefined,
  body: string,
  isHtml: boolean,
): string[] {
  if (!isHtml) return [body];
  const mode = option(spec, 'match') ?? (pattern?.includes('<') === true ? 'html' : 'auto');
  if (mode === 'html') return [body];
  const text = visibleText(body);
  return mode === 'text' || pattern === undefined ? [text] : [text, body];
}

/** Reads the configured page and applies the pattern; no match gives `[]`. */
export const pageRegexOracle = defineOracle(
  'page-regex',
  'website',
  async (ctx, product, spec, run) => {
    const url = urlOption(spec, product, run.line) ?? homeUrl(product, run.line);
    const isHtml = !/\.json(?:[?#]|$)/i.test(url);
    const res = await ctx.http.get({
      url,
      expect: isHtml ? 'html' : 'json',
      ttl: 'volatile',
      ...requestOptions(run),
    });

    const custom = option(spec, 'pattern');
    const compiled = custom === undefined ? undefined : compilePattern(custom);
    // An unusable registry pattern must not silently turn into the banner patterns.
    if (custom !== undefined && compiled === undefined) return [];
    const patterns = compiled === undefined ? BANNER_PATTERNS : [compiled];

    let match: RegExpExecArray | undefined;
    for (const subject of subjects(spec, custom, res.text, isHtml)) {
      match = firstMatch(patterns, subject);
      if (match !== undefined) break;
    }
    if (match === undefined) return [];

    const versionGroup = option(spec, 'versionGroup') ?? '1';
    const value = fill(option(spec, 'format') ?? `$${versionGroup}`, match).replace(/\.$/, '');
    if (value === '') return [];
    const dateGroup = option(spec, 'dateGroup') ?? (custom === undefined ? '2' : undefined);
    const dateTemplate =
      option(spec, 'date') ?? (dateGroup === undefined ? undefined : `$${dateGroup}`);
    const date = dateTemplate === undefined ? undefined : parseDate(fill(dateTemplate, match));
    const fact: VersionFact = {
      role: 'documented',
      value,
      ...(date === undefined ? {} : { date }),
      oracle: 'page-regex',
      url: res.finalUrl,
    };
    return [fact];
  },
);
