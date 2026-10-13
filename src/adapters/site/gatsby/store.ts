/**
 * The hashed files a Gatsby site publishes next to its pages: the search store
 * (`static/<hash>.store.json`, one record per page or API member) and the pagination file
 * (`static/<hash>.pagination.json`, the reading order). Their names change with every site
 * build, so the URLs always come from page-data and are never stored.
 *
 * Parsing is forgiving by record and strict by file: a record without a URL or title is
 * dropped, and a file in which no record can be read is reported as a changed shape.
 */
import { McpDocError } from '../../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import { isObject } from './shape.js';

/** One record of a search store. `url` is as published (see `resolveSiteUrl`). */
export interface StoreRecord {
  url: string;
  title: string;
  description?: string;
  keywords: string[];
  /** Breadcrumb as published, split into its levels. */
  crumbs: string[];
  /** `Topic`, `Tutorial`, `Class`, `Method`, ...; absent when blank. */
  pageType?: string;
  boost?: number;
}

/** One entry of a pagination file. */
export interface PaginationEntry {
  url: string;
  title: string;
  section?: string;
}

/** Longest description kept in a catalogue record; search excerpts are capped at 240 characters. */
const MAX_DESCRIPTION = 240;

/** Tags that sit inside a word or sentence; removing them must not add a space. */
const INLINE_TAG = /<\/?(?:a|b|code|em|i|span|strong|wbr)\b[^>]*>/gi;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Plain text of a short description: tags removed (inline ones without leaving a gap, so
 * `<b>x</b>.` stays `x.`), the common entities decoded, whitespace
 * collapsed, cut at a word boundary to the excerpt length. `undefined` when nothing is left.
 */
export function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const plain = value
    .replace(INLINE_TAG, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (plain === '') return undefined;
  if (plain.length <= MAX_DESCRIPTION) return plain;
  const cut = plain.slice(0, MAX_DESCRIPTION - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_DESCRIPTION / 2)).trimEnd()}…`;
}

/** A store is an array, or the same array serialised into a string inside page-data. */
function arrayOf(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw as unknown[];
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as unknown[]) : undefined;
  } catch {
    return undefined;
  }
}

function changedShape(url: string, what: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${what} has an unexpected shape`, {
    why: 'No record with a url and a title could be read, so the file format may have changed',
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

/**
 * Reads a search store.
 *
 * @param source URL the store was read from (or the page that embeds it), for error reports.
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when `raw` is not an array or
 *   holds records of which none has a `url` and a `title`. An empty array is a valid store.
 */
export function parseStore(raw: unknown, source: string): StoreRecord[] {
  const items = arrayOf(raw);
  if (items === undefined) throw changedShape(source, 'The search store');
  const records: StoreRecord[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const url = typeof item.url === 'string' ? item.url.trim() : undefined;
    const title = text(item.title);
    if (url === undefined || url === '' || title === undefined) continue;
    const description = plainText(item.description);
    const pageType = text(item.pageType);
    const keywords = Array.isArray(item.keywords)
      ? item.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [];
    const crumbs = (text(item.breadcrumb) ?? '')
      .split(BREADCRUMB_SEPARATOR.trim())
      .map((crumb) => crumb.trim())
      .filter((crumb) => crumb !== '');
    records.push({
      url,
      title,
      keywords,
      crumbs,
      ...(description === undefined ? {} : { description }),
      ...(pageType === undefined ? {} : { pageType }),
      ...(typeof item.boost === 'number' ? { boost: item.boost } : {}),
    });
  }
  if (records.length === 0 && items.length > 0) throw changedShape(source, 'The search store');
  return records;
}

/**
 * Reads a pagination file: an ordered array of `{ title, url, section? }`.
 *
 * @throws McpDocError as {@link parseStore}.
 */
export function parsePagination(raw: unknown, source: string): PaginationEntry[] {
  const items = arrayOf(raw);
  if (items === undefined) throw changedShape(source, 'The pagination file');
  const entries: PaginationEntry[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const url = text(item.url);
    const title = text(item.title);
    if (url === undefined || title === undefined) continue;
    const section = text(item.section);
    entries.push({ url, title, ...(section === undefined ? {} : { section }) });
  }
  if (entries.length === 0 && items.length > 0) throw changedShape(source, 'The pagination file');
  return entries;
}
