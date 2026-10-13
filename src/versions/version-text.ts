/**
 * Text-level helpers shared by the oracles and the merge rules: the same release is written
 * `300.1.0` (NuGet), `v300.1.0` (Git tag), `300.1.0+5042` (pub.dev), `300.1.0.5042` (Flutter
 * tag), `300-1` (URL slug) and `300.1` (banner), and dates come as "June 2026",
 * "September 22, 2026" or ISO timestamps.
 */
import { parseVersion } from '../core/version-key.js';
import type { VersionLine } from '../core/types.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (value: number | string): string => String(value).padStart(2, '0');

/**
 * Reduces a tag or registry version to the release it names: `v2.4.4` and
 * `@esri/arcgis-rest-request@4.11.1` lose their prefix, `300.1.0+5042` its build metadata and
 * `300.1.0.5042` its fourth (build) segment. A pre-release suffix is kept.
 */
export function normalizeVersion(raw: string): string {
  const trimmed = raw.trim();
  const text = trimmed
    .slice(trimmed.lastIndexOf('@') + 1)
    .replace(/^[A-Za-z_-]*(?=\d)/, '')
    .replace(/\+.*$/, '');
  return /^(\d+\.\d+\.\d+)\.\d+$/.exec(text)?.[1] ?? text;
}

/** The first `count` numeric components of a version, dotted: `5.1.27` at 2 gives `5.1`. */
export function truncateVersion(version: string, count: number): string {
  const numbers = parseVersion(normalizeVersion(version));
  return numbers.length === 0 ? version : numbers.slice(0, count).join('.');
}

/**
 * Compares two versions on the components both state, so that a banner (`5.1`) and a registry
 * (`5.1.27`) agree. Returns `undefined` when either does not parse.
 */
export function compareAtSharedPrecision(a: string, b: string): number | undefined {
  const left = parseVersion(normalizeVersion(a));
  const right = parseVersion(normalizeVersion(b));
  const shared = Math.min(left.length, right.length);
  if (shared === 0) return undefined;
  for (let i = 0; i < shared; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** The numbers a line id or label starts with: `v200` gives `[200]`, `2.3` gives `[2, 3]`, `latest` gives `[]`. */
export function lineNumbers(line: VersionLine): number[] {
  const fromId = parseVersion(line.id.replace(/^[A-Za-z_-]+(?=\d)/, ''));
  if (fromId.length > 0) return fromId;
  const inLabel = /\d+(?:\.\d+)*/.exec(line.label)?.[0];
  return inLabel === undefined ? [] : parseVersion(inLabel);
}

/** True when `version` starts with the numbers of the line (`200.8.3` belongs to `v200`). */
export function belongsToLine(version: string, line: VersionLine): boolean {
  const prefix = lineNumbers(line);
  const numbers = parseVersion(normalizeVersion(version));
  return prefix.length > 0 && prefix.every((value, index) => numbers[index] === value);
}

/** How a URL slug spells a version: separated (`300-1`, `2-4-0`, `1.20`) or run together (`244`). */
export type SlugStyle = 'auto' | 'compact';

/** `244` is 2.4.4 and `100` is 1.0.0: one digit each for major and minor, the rest is the patch. */
function fromCompactDigits(digits: string): string {
  return `${digits.charAt(0)}.${digits.charAt(1)}.${Number(digits.slice(2))}`;
}

const DATED = /^(?:19|20)\d{2}-\d{2}(?:-\d{2})?$/;

/**
 * A version as a URL slug writes it, in dotted form: `300-1` gives `300.1`, a run of three
 * or more digits is read as compact (`244` gives `2.4.4`), a date-named release
 * (`2026-07-21`) and anything already dotted stay as written.
 */
export function versionFromSlugText(text: string): string {
  const value = text.trim();
  if (DATED.test(value)) return value;
  if (/^\d{3,}$/.test(value)) return fromCompactDigits(value);
  return value.replaceAll('-', '.');
}

/** The release date of a version that is named after its date (`2026-07-21`, `2026-07`). */
export function dateOfVersion(version: string): string | undefined {
  return DATED.test(version) ? version : undefined;
}

function versionInSegment(segment: string, style: SlugStyle): string | undefined {
  const name = segment.replace(/\.(?:html?|md)$/i, '');
  if (style === 'compact') {
    const digits = /(\d{3,})$/.exec(name)?.[1];
    return digits === undefined ? undefined : fromCompactDigits(digits);
  }
  const date = /(?:^|[^\d])((?:19|20)\d{2}-\d{2}(?:-\d{2})?)$/.exec(name)?.[1];
  if (date !== undefined) return date;
  const separated = /\d+(?:[-.]\d+)+/.exec(name)?.[0];
  if (separated !== undefined) return separated.replaceAll('-', '.');
  // A bare number is a version only when it is the whole segment (`/v2/`, `/12/`).
  return /^v?(\d+)$/i.exec(name)?.[1];
}

/**
 * The version a documentation URL names, read from its path segments, last one first:
 * `/net/release-notes/release-notes-for-300-1/` gives `300.1`, `/guide/1.20/whats-new/` gives
 * `1.20`, `/release-notes/2026-07-21/` stays a date, and with style `compact`
 * `/guide/release-notes-244/` gives `2.4.4`. `undefined` when no segment carries a version.
 */
export function versionFromUrl(url: string, style: SlugStyle = 'auto'): string | undefined {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL: treat the text as a path.
  }
  const segments = path.split('/').filter((part) => part.length > 0);
  for (const segment of segments.reverse()) {
    const version = versionInSegment(segment, style);
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * Reads a date as Esri pages and registries write it and returns it in ISO form at the
 * precision given: `September 22, 2026` gives `2026-09-22`, `June 2026` and `August, 2026`
 * give `2026-06` and `2026-08`, `8/5/2026` gives `2026-08-05`, and an ISO timestamp is cut to
 * its date. `undefined` for anything else.
 */
export function parseDate(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  if (iso !== null) return iso[3] === undefined ? `${iso[1]}-${iso[2]}` : iso[0];
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (numeric?.[1] !== undefined && numeric[2] !== undefined) {
    return `${numeric[3]}-${pad(numeric[1])}-${pad(numeric[2])}`;
  }
  const named = /^([A-Za-z]{3,})\.?,?\s*(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})\b/.exec(value);
  if (named?.[1] === undefined) return undefined;
  const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
  if (month < 0) return undefined;
  const yearMonth = `${named[3]}-${pad(month + 1)}`;
  return named[2] === undefined ? yearMonth : `${yearMonth}-${pad(named[2])}`;
}
