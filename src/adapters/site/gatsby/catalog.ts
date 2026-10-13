/**
 * Builds the catalogue of a gatsby source from what was gathered: sitemap URLs, navigation
 * trees, search-store records and manifests. Each of them may be missing; a page is listed
 * when any of them names it, and takes its title from the best one that does
 * (store, manifest, navigation, then the URL slug).
 */
import { classifyUrl, humanizeSlug } from '../../../core/adapter-helpers.js';
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import type { BoundSource } from '../../../core/ports.js';
import type { CatalogRecord, DocKind } from '../../../core/types.js';
import { recordOf } from '../static.js';
import type { SiteIndex } from './discovery.js';
import { flattenNav, type NavEntry } from './nav.js';
import { isObject } from './shape.js';
import { ownsPage, pageKey, relativeTo, resolveSiteUrl, type GatsbySite } from './site.js';
import { symbolEntries, type PageRow, type SymbolEntry } from './symbols.js';

/** What is known about one page before it becomes a record. */
interface Draft {
  url: string;
  title?: string;
  crumbs?: string[];
  description?: string;
  keywords?: string[];
  pageType?: string;
  boost?: number;
}

/**
 * Every navigation entry of the index, in reading order. When a source spans several
 * trees (the sections of the developer guide, the services under `/rest/`) the root title
 * of each becomes the first breadcrumb level, so entries of different sections stay apart.
 */
export function navEntries(site: GatsbySite, index: SiteIndex): NavEntry[] {
  const several = index.navTrees.length > 1;
  return index.navTrees.flatMap((tree) =>
    flattenNav(site, tree).map((entry) =>
      several && entry.root !== '' ? { ...entry, crumbs: [entry.root, ...entry.crumbs] } : entry,
    ),
  );
}

/**
 * The pages the index files describe, as page keys. Enumeration compares this with the
 * sitemap to decide whether another section's index is worth a request.
 */
export function describedPages(site: GatsbySite, index: SiteIndex): Set<string> {
  const urls: unknown[] = [
    ...index.navTrees.flatMap((tree) => flattenNav(site, tree).map((entry) => entry.url)),
    ...index.store.map((record) => record.url),
    ...index.pagination.map((entry) => entry.url),
    ...index.typedocNodes.map((node) => node.url),
    ...index.mdxPages.map((page) => page.url),
    ...index.glossaryTerms.map((term) => (isObject(term) ? term.url : undefined)),
  ];
  const described = new Set<string>();
  for (const raw of urls) {
    const url = resolveSiteUrl(site, raw);
    if (url !== undefined) described.add(pageKey(url));
  }
  return described;
}

/**
 * The document kind of a page: the first matching `classify` rule of the source, else the
 * kind of the symbol the page documents, else what its store page type and path say, else
 * the first kind of the source.
 *
 * @param rel path of the page relative to the source base.
 */
export function pageKind(
  src: BoundSource<'gatsby'>,
  rel: string,
  hint: { pageType?: string | undefined; symbolKind?: DocKind | undefined } = {},
): DocKind {
  return classifyUrl(
    rel,
    src.source.config,
    hint.symbolKind ?? kindFromPath(src, rel, hint.pageType),
  );
}

function kindFromPath(src: BoundSource<'gatsby'>, rel: string, pageType = ''): DocKind {
  if (/tutorial/i.test(pageType)) return 'tutorial';
  if (/sample/i.test(pageType)) return 'sample';
  if (/(?:^|\/)(?:release-notes|whats-new|what-s-new|changelog)(?:\/|$)/.test(rel)) {
    return 'release-notes';
  }
  if (/(?:^|\/)tutorials?\//.test(rel)) return 'tutorial';
  if (/(?:^|\/)(?:sample-code|samples)\/./.test(rel)) return 'sample';
  if (/(?:^|\/)api-reference\//.test(rel)) return 'api';
  return src.source.kinds[0] ?? 'guide';
}

function titleOf(src: BoundSource<'gatsby'>, rel: string, draft: Draft): string {
  return draft.title ?? ((rel === '' ? '' : humanizeSlug(rel)) || src.source.title);
}

/** Collects the pages of the source, first mention first, best title winning. */
function draftPages(
  src: BoundSource<'gatsby'>,
  site: GatsbySite,
  sitemapPages: readonly string[],
  index: SiteIndex,
  nav: readonly NavEntry[],
): Map<string, Draft> {
  const filter = src.source.config;
  const drafts = new Map<string, Draft>();
  /** The draft of a page of this source; `undefined` for anchors and foreign pages. */
  const draftOf = (raw: unknown): Draft | undefined => {
    const url = resolveSiteUrl(site, raw);
    if (url === undefined || url.includes('#') || !ownsPage(site, filter, url)) return undefined;
    let draft = drafts.get(url);
    if (draft === undefined) drafts.set(url, (draft = { url }));
    return draft;
  };

  // Navigation first: its order is the reading order a table of contents wants.
  for (const entry of nav) {
    const draft = draftOf(entry.url);
    if (draft === undefined) continue;
    draft.title ??= entry.title;
    draft.crumbs ??= entry.crumbs;
  }
  for (const page of sitemapPages) draftOf(page);
  for (const page of [...index.mdxPages, ...index.typedocNodes]) {
    const draft = draftOf(page.url);
    if (draft !== undefined) draft.title = page.title;
  }
  for (const record of index.store) {
    const draft = draftOf(record.url);
    if (draft === undefined) continue;
    draft.title = record.title;
    const crumbs =
      record.crumbs.at(-1) === record.title ? record.crumbs.slice(0, -1) : record.crumbs;
    if (crumbs.length > 0) draft.crumbs ??= crumbs;
    if (record.description !== undefined) draft.description = record.description;
    if (record.keywords.length > 0) draft.keywords = record.keywords;
    if (record.pageType !== undefined) draft.pageType = record.pageType;
    if (record.boost !== undefined) draft.boost = record.boost;
  }
  // The resource hierarchy of a REST site says where an operation sits, which the reading
  // order does not; it replaces the navigation breadcrumb for the pages it lists.
  for (const tree of index.hierarchies) {
    for (const entry of flattenNav(site, tree)) {
      const draft = drafts.get(pageKey(entry.url));
      if (draft !== undefined && entry.crumbs.length > 0) draft.crumbs = entry.crumbs;
    }
  }
  return drafts;
}

function applySymbol(record: CatalogRecord, entry: SymbolEntry): void {
  record.symbol = entry.symbol;
  record.symbolKind = entry.symbolKind;
  if (entry.qualified !== undefined) record.qualified = entry.qualified;
  if (entry.parent !== undefined) record.parent = entry.parent;
  if (entry.title !== undefined) record.title = entry.title;
  if (entry.description !== undefined) record.description = entry.description;
  if (entry.keywords !== undefined) record.keywords = entry.keywords;
  if (entry.locator !== undefined) record.locator = entry.locator;
  if (entry.crumbs !== undefined && entry.crumbs.length > 0) {
    record.breadcrumb ??= entry.crumbs.join(BREADCRUMB_SEPARATOR);
  }
}

/**
 * The catalogue records of a source: one per page, plus one per symbol that has its own
 * anchor. A symbol documented by a whole page is merged into that page's record, so every
 * ref occurs once.
 */
export function buildCatalog(
  src: BoundSource<'gatsby'>,
  site: GatsbySite,
  sitemapPages: readonly string[],
  index: SiteIndex,
): CatalogRecord[] {
  const config = src.source.config;
  const nav = navEntries(site, index);
  const drafts = draftPages(src, site, sitemapPages, index, nav);
  const relOf = (url: string): string => relativeTo(site.base, url) ?? '';

  const pages: PageRow[] = [...drafts.values()].map((draft) => ({
    url: draft.url,
    title: titleOf(src, relOf(draft.url), draft),
    crumbs: draft.crumbs ?? [],
    ...(draft.pageType === undefined ? {} : { pageType: draft.pageType }),
  }));
  const symbols = symbolEntries({ site, config, index, pages, nav });
  const pageSymbols = new Map<string, SymbolEntry>();
  for (const entry of symbols) {
    if (!entry.url.includes('#') && !pageSymbols.has(entry.url)) pageSymbols.set(entry.url, entry);
  }

  const records = new Map<string, CatalogRecord>();
  for (const draft of drafts.values()) {
    const rel = relOf(draft.url);
    const symbol = pageSymbols.get(draft.url);
    const kind = pageKind(src, rel, {
      pageType: draft.pageType,
      symbolKind: symbol?.kind,
    });
    const record = recordOf(src, draft.url, kind, titleOf(src, rel, draft));
    if (draft.crumbs !== undefined && draft.crumbs.length > 0) {
      record.breadcrumb = draft.crumbs.join(BREADCRUMB_SEPARATOR);
    }
    if (draft.description !== undefined) record.description = draft.description;
    if (draft.keywords !== undefined) record.keywords = draft.keywords;
    if (draft.boost !== undefined) record.boost = draft.boost;
    if (symbol !== undefined) applySymbol(record, symbol);
    records.set(draft.url, record);
  }

  for (const entry of symbols) {
    const page = entry.url.split('#')[0] ?? entry.url;
    if (records.has(entry.url) || !ownsPage(site, config, page)) continue;
    const kind = pageKind(src, relOf(page), { symbolKind: entry.kind });
    const record = recordOf(src, entry.url, kind, entry.title ?? entry.symbol);
    applySymbol(record, entry);
    records.set(entry.url, record);
  }
  return [...records.values()];
}
