/**
 * `symbols: 'fuse-store'`: sites whose search store lists API types and members next to
 * guide pages (the game-engine SDKs). A member record points at an anchor of its type's page
 * and carries the path to it as a breadcrumb:
 *
 * ```
 * { "title": "changeAspectRatio", "pageType": "Method",
 *   "url": "/api-reference/gameengine/geometry/arcgisenvelopebuilder/#changeaspectratio",
 *   "breadcrumb": "GameEngine > Geometry > ArcGISEnvelopeBuilder > changeAspectRatio" }
 * ```
 */
import { resolveSiteUrl } from './site.js';
import type { StoreRecord } from './store.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** Page types of prose pages; every other page type names a kind of API symbol. */
const PROSE_PAGE_TYPE = /^(?:topic|tutorial|sample|guide|page|article|overview|release ?notes?)$/i;

/** A name that can be part of a qualified name: no spaces, starts with a letter, `_` or `$`. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `Type.member` as some stores write it into the description. */
const QUALIFIED_MEMBER = /^([\w$.]+)\.[\w$]+$/;

/** The record's breadcrumb without its own title, which API records repeat as the last level. */
function ancestors(record: StoreRecord): string[] {
  return record.crumbs.at(-1) === record.title ? record.crumbs.slice(0, -1) : record.crumbs;
}

/** Type and member symbols listed in the search store. */
export function fuseSymbols(input: SymbolInput): SymbolEntry[] {
  const titles = new Map(input.pages.map((page) => [page.url, page.title]));
  const entries: SymbolEntry[] = [];
  for (const record of input.index.store) {
    const url = resolveSiteUrl(input.site, record.url);
    if (url === undefined) continue;
    const [page = url, anchor] = url.split('#');
    // Prose pages and the headings inside them are in the store too; they are not symbols.
    if (record.pageType === undefined || PROSE_PAGE_TYPE.test(record.pageType)) continue;
    const symbolKind = record.pageType.toLowerCase();
    const crumbs = ancestors(record);
    const path = crumbs.filter((crumb) => IDENTIFIER.test(crumb));
    const shared = { url, symbol: record.title, symbolKind, crumbs };

    if (anchor === undefined) {
      const qualified = [...path, record.title].join('.');
      entries.push({ ...shared, ...(path.length > 0 ? { qualified } : {}) });
      continue;
    }
    // The owner is the breadcrumb path; without one, the `Type.member` some stores put in
    // the description, and failing that the title of the page the anchor is on.
    const described = QUALIFIED_MEMBER.exec(record.description ?? '')?.[1];
    const owner = path.length > 0 ? path.join('.') : (described ?? titles.get(page));
    if (owner === undefined || owner === '') {
      entries.push({ ...shared, locator: { anchor } });
      continue;
    }
    entries.push({
      ...shared,
      qualified: `${owner}.${record.title}`,
      parent: owner,
      locator: { anchor },
    });
  }
  return entries;
}
