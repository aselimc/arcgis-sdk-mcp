/**
 * Ranking helpers of the sample search (design section 3.7): does a sample mention an API,
 * does its metadata or code confirm it, does it fit a platform, and in which order hits go.
 */
import { estimateTokens } from '../../core/budget.js';
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

/** Cuts source text at a line boundary within `maxTokens`. */
export function fitCode(text: string, maxTokens: number): { text: string; truncated: boolean } {
  // Code tokenises at about 3.5 characters per token (design section 3.1).
  if (estimateTokens(`\`\`\`\n${text}\n\`\`\``) <= maxTokens) return { text, truncated: false };
  const limit = Math.max(0, Math.floor(maxTokens * 3.5));
  const cut = text.slice(0, limit);
  const lastLine = cut.lastIndexOf('\n');
  return { text: lastLine > 0 ? cut.slice(0, lastLine) : cut, truncated: true };
}
