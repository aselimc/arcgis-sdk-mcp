/**
 * The `astro` adapter: Esri's Astro documentation sites (JavaScript, Swift, Kotlin, .NET, Qt,
 * Flutter, Java guides and the web map specification).
 *
 * A site is listed from up to three places, merged by URL with the richer source winning:
 * the sitemap (every page, slug titles), the sample index page, and the site's search index
 * files. A search file is `{ options, index }` where `index` is a serialised MiniSearch
 * document as a JSON **string**; only its `storedFields` (title, URL, breadcrumb, page type)
 * are read, never the inverted index.
 */
import { classifyUrl, humanizeSlug, matchUrlFilter } from '../../core/adapter-helpers.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../core/ports.js';
import type { AdapterConfigMap, CatalogRecord, DocKind, DocPage } from '../../core/types.js';
import { apiNames, type ApiEntry } from './astro-api.js';
import { isSamplePath, readSample, readSampleCards } from './astro-samples.js';
import { readSitemap, sitemapRecords } from './sitemap.js';
import {
  assertLive,
  budgetOf,
  fragmentOf,
  probeSource,
  readHtmlPage,
  recordOf,
  tolerate,
} from '../kit/index.js';

type AstroSource = BoundSource<'astro'>;
type SearchIndex = NonNullable<AdapterConfigMap['astro']['searchIndexes']>[number];

/** One sitemap (or a one-file index), the sample page and seven search files fit in this. */
const MAX_ENUMERATE_REQUESTS = 10;
const SITEMAP_REQUESTS = 2;
/** Symbol indexes are several megabytes; the gateway default for pages would cut them off. */
const INDEX_MAX_BYTES = 32 * 1024 * 1024;

/** A document of a search index, as stored by the site. */
export interface StoredDoc {
  title: string;
  /** Relative to the site base, with or without a leading slash; may carry a `#fragment`. */
  url: string;
  description?: string;
  breadcrumb?: string;
  boost?: number;
  pageType?: string;
}

function malformed(url: string, why: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} is not a readable search index`, {
    why,
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Extracts the stored documents of an Astro search file.
 *
 * @param data the parsed file: `{ index: "<JSON string>" }`; an `index` that is already an
 *   object is accepted too.
 * @param url the file's URL, for error details.
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the envelope, the inner
 *   document or `storedFields` is missing, when the index is empty, or when no entry has
 *   both `title` and `url` (a renamed field).
 */
export function parseSearchIndex(data: unknown, url: string): StoredDoc[] {
  let inner = (data as { index?: unknown } | null)?.index;
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner) as unknown;
    } catch {
      throw malformed(url, 'The "index" member is not valid JSON');
    }
  }
  const stored = (inner as { storedFields?: unknown } | null | undefined)?.storedFields;
  if (typeof stored !== 'object' || stored === null) {
    throw malformed(url, 'The file has no "index.storedFields" object');
  }
  const entries = Object.values(stored) as Array<Record<string, unknown> | null>;
  if (entries.length === 0) throw malformed(url, 'The search index holds no documents');

  const docs: StoredDoc[] = [];
  for (const entry of entries) {
    const title = text(entry?.title);
    const target = text(entry?.url);
    if (entry === null || title === undefined || target === undefined) continue;
    const description = text(entry.description);
    const breadcrumb = text(entry.breadcrumb);
    const pageType = text(entry.pageType);
    const boost = entry.boost;
    docs.push({
      title,
      url: target,
      ...(description === undefined ? {} : { description }),
      ...(breadcrumb === undefined ? {} : { breadcrumb }),
      ...(pageType === undefined ? {} : { pageType }),
      ...(typeof boost === 'number' && Number.isFinite(boost) && boost > 0 ? { boost } : {}),
    });
  }
  if (docs.length === 0) {
    throw malformed(
      url,
      'No stored document has both "title" and "url"; the fields may be renamed',
    );
  }
  return docs;
}

/**
 * The absolute ref of a stored URL and its path relative to the source base, or `undefined`
 * when the URL is unusable or filtered out. Directory-style paths get their trailing slash
 * (sample entries are stored without one), files such as `class.html` are left alone.
 */
function locate(src: AstroSource, stored: string): { ref: string; path: string } | undefined {
  const [rawPath = '', ...fragment] = stored.replace(/^\/+/, '').split('#');
  const lastSegment = rawPath.split('/').at(-1) ?? '';
  const path =
    rawPath === '' || rawPath.endsWith('/') || lastSegment.includes('.') ? rawPath : `${rawPath}/`;
  if (!matchUrlFilter(path, src.source.config)) return undefined;
  const hash = fragment.length === 0 ? '' : `#${fragment.join('#')}`;
  try {
    return { ref: new URL(`${src.url(path)}${hash}`).href, path };
  } catch {
    return undefined;
  }
}

/** `A > B` with the project's separator, whatever spacing the site used. */
function breadcrumbOf(value: string): string {
  return value
    .split('>')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(BREADCRUMB_SEPARATOR);
}

function pageRecords(src: AstroSource, docs: StoredDoc[], index: SearchIndex): CatalogRecord[] {
  const fallback = src.source.kinds[0] ?? 'guide';
  const records: CatalogRecord[] = [];
  for (const doc of docs) {
    const at = locate(src, doc.url);
    if (at === undefined) continue;
    const kind =
      index.role === 'sample' ? 'sample' : classifyUrl(at.path, src.source.config, fallback);
    records.push({
      ...recordOf(src, at.ref, kind, doc.title),
      ...(doc.description === undefined ? {} : { description: doc.description }),
      ...(doc.breadcrumb === undefined ? {} : { breadcrumb: breadcrumbOf(doc.breadcrumb) }),
      ...(doc.boost === undefined ? {} : { boost: doc.boost }),
      ...(index.platform === undefined ? {} : { platform: index.platform }),
    });
  }
  return records;
}

/** `queryFeatures()` is stored with call parentheses; the symbol is the bare name. */
function symbolName(title: string): string {
  return title.replace(/\(\)$/, '').trim();
}

/** A stored document as the naming rules of `astro-api.ts` see it. */
function apiEntry(doc: StoredDoc): ApiEntry {
  const [path = '', ...fragment] = doc.url.replace(/^\/+/, '').split('#');
  return {
    name: symbolName(doc.title),
    ...(doc.breadcrumb === undefined ? {} : { breadcrumb: doc.breadcrumb }),
    ...(doc.pageType === undefined ? {} : { pageType: doc.pageType.toLowerCase() }),
    path,
    anchored: fragment.length > 0,
  };
}

/**
 * Symbol records of an API index, named by {@link apiNames}: a member has `parent` and is
 * qualified as `<parent>.<name>`, everything else is a top-level symbol. A document whose
 * title is not a name stays a plain page.
 */
function apiRecords(src: AstroSource, docs: StoredDoc[]): CatalogRecord[] {
  const entries = docs.map(apiEntry);
  const names = apiNames(entries);
  const records: CatalogRecord[] = [];
  docs.forEach((doc, index) => {
    const at = locate(src, doc.url);
    const entry = entries[index];
    const named = names[index];
    if (at === undefined || entry === undefined || named === undefined) return;
    // A member is found under its type, which is also where a reader looks for it.
    const breadcrumb = named.parent ?? doc.breadcrumb;
    const record: CatalogRecord = {
      ...recordOf(src, at.ref, 'api', doc.title),
      ...(breadcrumb === undefined ? {} : { breadcrumb }),
      ...(doc.boost === undefined ? {} : { boost: doc.boost }),
    };
    if (entry.pageType !== undefined && !/\s/.test(entry.name)) {
      record.symbol = entry.name;
      record.symbolKind = entry.pageType;
      record.qualified = named.qualified;
      if (named.parent !== undefined) record.parent = named.parent;
    }
    records.push(record);
  });
  return records;
}

async function searchIndexRecords(
  ctx: Ctx,
  src: AstroSource,
  index: SearchIndex,
): Promise<CatalogRecord[]> {
  const url = src.url(index.url);
  const { data } = await ctx.http.getJson({
    url,
    ttl: 'index',
    maxBytes: INDEX_MAX_BYTES,
    ...budgetOf(src),
  });
  const docs = parseSearchIndex(data, url);
  return index.role === 'api' ? apiRecords(src, docs) : pageRecords(src, docs, index);
}

/** Pages whose path matches `symbolsFromSlug` document one type each: its name is the first capture. */
function withSlugSymbol(src: AstroSource, record: CatalogRecord, pattern: RegExp): CatalogRecord {
  if (record.symbol !== undefined || record.ref.includes('#')) return record;
  const captured = pattern.exec(record.ref.slice(src.url().length))?.[1];
  if (captured === undefined || captured === '') return record;
  const parts = captured.split('/').filter((part) => part !== '');
  const symbol = parts.at(-1);
  if (symbol === undefined) return record;
  // A title made from the slug would change the case of the name (`layerDefinition`).
  const title = record.title === humanizeSlug(symbol) ? symbol : record.title;
  return { ...record, title, kind: 'api', symbol, qualified: parts.join('.'), symbolKind: 'type' };
}

async function enumerate(ctx: Ctx, src: AstroSource): Promise<CatalogRecord[]> {
  const config = src.source.config;
  assertLive(src, src.url());
  const merged = new Map<string, CatalogRecord>();
  let firstFailure: McpDocError | undefined;
  const collect = async (what: string, load: () => Promise<CatalogRecord[]>): Promise<void> => {
    try {
      // First occurrence of a ref inside one input wins; a later input replaces earlier ones.
      const fresh = new Map<string, CatalogRecord>();
      for (const record of await load()) if (!fresh.has(record.ref)) fresh.set(record.ref, record);
      for (const [ref, record] of fresh) merged.set(ref, record);
    } catch (error) {
      firstFailure ??= toMcpDocError(error);
      tolerate(ctx, src, error, what);
    }
  };

  const sitemap = config.sitemap;
  if (sitemap !== undefined) {
    await collect('The sitemap', async () => {
      const locs = await readSitemap(ctx, src, src.url(sitemap), SITEMAP_REQUESTS);
      return sitemapRecords(src, locs, [src.url()], config, src.source.kinds[0] ?? 'guide').map(
        (record) =>
          isSamplePath(record.ref.slice(src.url().length)) ? { ...record, kind: 'sample' } : record,
      );
    });
  }
  const indexPage = config.sampleIndexPage;
  if (indexPage !== undefined) {
    await collect('The sample index page', () => readSampleCards(ctx, src, indexPage));
  }
  // Search files are site-published index files: without the capability the sitemap rung answers.
  if (ctx.policy.enabled('site-index')) {
    const room = MAX_ENUMERATE_REQUESTS - SITEMAP_REQUESTS - 1;
    for (const index of (config.searchIndexes ?? []).slice(0, room)) {
      await collect(`Search index ${index.url}`, () => searchIndexRecords(ctx, src, index));
    }
  }

  if (merged.size === 0 && firstFailure !== undefined) throw firstFailure;
  const records = [...merged.values()];
  if (config.symbolsFromSlug === undefined) return records;
  const pattern = new RegExp(config.symbolsFromSlug);
  return records.map((record) => withSlugSymbol(src, record, pattern));
}

function kindOf(src: AstroSource, target: ReadTarget): DocKind {
  if (target.record !== undefined) return target.record.kind;
  const root = src.url();
  const href = target.url.href.replace(/#.*$/, '');
  const path = href.startsWith(root) ? href.slice(root.length) : '';
  if (isSamplePath(path)) return 'sample';
  return classifyUrl(path, src.source.config, src.source.kinds[0] ?? 'guide');
}

function read(ctx: Ctx, src: AstroSource, target: ReadTarget): Promise<DocPage> {
  return readHtmlPage(ctx, src, target, { kind: kindOf(src, target) });
}

/**
 * `astro`: sitemap, sample index page and MiniSearch `storedFields` for the catalogue; HTML
 * pages for content. A symbol is read from its page with the record's anchor as the member
 * selector, which the renderer resolves to the member card (or the whole page).
 */
export const astroAdapter: SourceAdapter<'astro'> = {
  type: 'astro',
  maxEnumerateRequests: MAX_ENUMERATE_REQUESTS,
  enumerate,
  read,

  symbol(ctx, src, record, detail) {
    const url = new URL(record.ref);
    const member =
      (fragmentOf(url) ?? '') || (record.parent === undefined ? '' : (record.symbol ?? ''));
    return read(ctx, src, {
      url,
      detail,
      record,
      ...(member === '' ? {} : { select: { member } }),
    });
  },

  sample: readSample,

  // A JSON canary is a search index file; a sitemap or page canary needs no extra capability.
  probe: (ctx, src) => probeSource(ctx, src, { siteIndex: src.source.probe.expect === 'json' }),
};
