/**
 * Ranking helpers of the sample search (design section 3.7): does a sample mention an API,
 * does its metadata or code confirm it, does it fit a platform, and in which order hits go.
 */
import { estimateTokens } from '../../core/budget.js';
import type { SampleHit } from '../../core/ports.js';
import { normalizeSymbol, tokenize } from '../../core/tokenize.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';

/** An API named by `uses_api`, split into the names a sample may list it under. */
export interface ApiName {
  /** As normalised: `FeatureLayer.applyEdits`. */
  full: string;
  /** The last part: `applyEdits`. */
  simple: string;
  /** The owning type when the input named a member: `FeatureLayer`. */
  type?: string;
}

/** Parses the `uses_api` argument; `undefined` when it names nothing. */
export function parseApi(usesApi: string | undefined): ApiName | undefined {
  if (usesApi === undefined) return undefined;
  const { parts, simple } = normalizeSymbol(usesApi);
  if (simple === '') return undefined;
  const type = parts.length > 1 ? parts.at(-2) : undefined;
  return { full: parts.join('.'), simple, ...(type === undefined ? {} : { type }) };
}

/** True when the record's own text (title, keywords, description, headings) names the API. */
export function mentionsApi(record: CatalogRecord, api: ApiName): boolean {
  const terms = new Set(
    tokenize(
      [
        record.title,
        record.description ?? '',
        ...(record.keywords ?? []),
        ...(record.headings ?? []),
      ].join(' '),
    ),
  );
  const wanted = [api.simple, ...(api.type === undefined ? [] : [api.type])].map((name) =>
    name.toLowerCase(),
  );
  return wanted.every((name) => terms.has(name));
}

function sameName(listed: string, api: ApiName): boolean {
  const { parts, simple } = normalizeSymbol(listed);
  const lower = simple.toLowerCase();
  if (parts.join('.').toLowerCase() === api.full.toLowerCase()) return true;
  // A sample that lists the type demonstrates its members only loosely: require the member
  // when one was asked for, and accept the type alone when the type was asked for.
  if (api.type === undefined) return lower === api.simple.toLowerCase();
  return (
    lower === api.simple.toLowerCase() && parts.at(-2)?.toLowerCase() === api.type.toLowerCase()
  );
}

function identifierIn(text: string, name: string): boolean {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${name.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\p{L}\\p{N}_])`,
    'u',
  ).test(text);
}

/**
 * True when a sample's page confirms that it uses the API: its relevant-API metadata lists
 * it, or its main source file contains the identifiers (the member, and the type when given).
 */
export function confirmsApi(page: DocPage, api: ApiName): boolean {
  if ((page.relevantApis ?? []).some((listed) => sameName(listed, api))) return true;
  const code = page.files?.[0]?.text;
  if (code === undefined) return false;
  return identifierIn(code, api.simple) && (api.type === undefined || identifierIn(code, api.type));
}

/** True when a sample is for the requested platform or framework variant. */
export function matchesPlatform(record: CatalogRecord, platform: string): boolean {
  const wanted = platform.trim().toLowerCase();
  if (wanted === '') return true;
  if (record.platform?.toLowerCase() === wanted) return true;
  if (record.platform !== undefined)
    return record.platform
      .toLowerCase()
      .split(/[\s,/]+/)
      .includes(wanted);
  // Repositories keep one directory per platform: `.../MAUI/...`, `.../wpf/...`.
  return new RegExp(`[/_.-]${wanted.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')}(?:[/_.-]|$)`, 'i').test(
    record.ref,
  );
}

/** True when a sample record points into a GitHub repository rather than at a site page. */
export function isGithubSample(record: CatalogRecord): boolean {
  return /^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\//.test(record.ref);
}

const titleKey = (record: CatalogRecord): string =>
  record.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const samePlatform = (a: CatalogRecord, b: CatalogRecord): boolean =>
  a.platform === undefined ||
  b.platform === undefined ||
  a.platform.toLowerCase() === b.platform.toLowerCase();

/**
 * Lists a sample once when both Esri's site and its GitHub repository have it. The
 * repository copy is kept (Apache-2.0, with metadata and source files) at the better of the
 * two ranks, and takes the description and location from the site page when it has none.
 * Samples are twins when their titles agree and their platforms do not differ.
 */
export function mergeSampleTwins(ranked: readonly CatalogRecord[]): CatalogRecord[] {
  const groups = new Map<string, { site: CatalogRecord[]; github: CatalogRecord[] }>();
  for (const record of ranked) {
    const key = titleKey(record);
    const group = groups.get(key) ?? { site: [], github: [] };
    (isGithubSample(record) ? group.github : group.site).push(record);
    groups.set(key, group);
  }
  const enrich = (record: CatalogRecord): CatalogRecord => {
    const page = groups
      .get(titleKey(record))
      ?.site.find((candidate) => samePlatform(candidate, record));
    if (page === undefined) return record;
    const description = record.description ?? page.description;
    const breadcrumb = record.breadcrumb ?? page.breadcrumb;
    return {
      ...record,
      ...(description === undefined ? {} : { description }),
      ...(breadcrumb === undefined ? {} : { breadcrumb }),
    };
  };

  const merged: CatalogRecord[] = [];
  const placed = new Set<string>();
  const place = (record: CatalogRecord): void => {
    if (placed.has(record.ref)) return;
    placed.add(record.ref);
    merged.push(enrich(record));
  };
  for (const record of ranked) {
    if (isGithubSample(record)) {
      place(record);
      continue;
    }
    const twins = (groups.get(titleKey(record))?.github ?? []).filter((candidate) =>
      samePlatform(candidate, record),
    );
    if (twins.length === 0) merged.push(record);
    // The repository copies take the place of the page they duplicate.
    else twins.forEach(place);
  }
  return merged;
}

/** Tokens the rank, the bracketed tags, the labels and the indentation of one listed hit take. */
const HIT_OVERHEAD_TOKENS = 30;

/** Tokens one hit takes in a listing: title, ref, summary, location, APIs and a line per source file. */
export function hitTokens(hit: SampleHit): number {
  const text = [
    hit.record.title,
    hit.record.ref,
    hit.summary,
    hit.record.breadcrumb ?? '',
    (hit.relevantApis ?? []).join(', '),
    ...(hit.files ?? []).map((file) => `File: ${file.name} ${file.ref}`),
  ].join('\n');
  return estimateTokens(text) + HIT_OVERHEAD_TOKENS;
}

/**
 * Makes a listing fit `maxTokens` by leaving out the file lists of the lowest-ranked hits
 * first. A file list is one long URL per file and is the only part of a hit that can be had
 * again by reading the hit, so it goes before any hit does. The top hit keeps its files.
 *
 * @returns the hits to list, their size, and how many lost their file list.
 */
export function fitListing(
  hits: readonly SampleHit[],
  maxTokens: number,
): { hits: SampleHit[]; tokens: number; trimmed: number } {
  const fitted = [...hits];
  let tokens = fitted.reduce((total, hit) => total + hitTokens(hit), 0);
  let trimmed = 0;
  for (let index = fitted.length - 1; index >= 1 && tokens > maxTokens; index -= 1) {
    const hit = fitted[index];
    if (hit?.files === undefined) continue;
    const { files: _files, ...withoutFiles } = hit;
    tokens -= hitTokens(hit) - hitTokens(withoutFiles);
    fitted[index] = withoutFiles;
    trimmed += 1;
  }
  return { hits: fitted, tokens, trimmed };
}

/** Cuts source text at a line boundary within `maxTokens`. */
export function fitCode(text: string, maxTokens: number): { text: string; truncated: boolean } {
  // Code tokenises at about 3.5 characters per token (design section 3.1).
  if (estimateTokens(`\`\`\`\n${text}\n\`\`\``) <= maxTokens) return { text, truncated: false };
  const limit = Math.max(0, Math.floor(maxTokens * 3.5));
  const cut = text.slice(0, limit);
  const lastLine = cut.lastIndexOf('\n');
  return { text: lastLine > 0 ? cut.slice(0, lastLine) : cut, truncated: true };
}
