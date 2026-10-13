/**
 * `symbols: 'typedoc'`: API references generated from TypeDoc (ArcGIS REST JS, Experience
 * Builder). The page-data of any API page lists every page of the reference as
 * `allTypedocPage.nodes` (`{ title, url }`), with URLs of the form
 * `/api-reference/<package>/<Symbol>`; the API navigation tree names the packages.
 *
 * The manifest does not say what kind of declaration a symbol is, so the kind is read off
 * the name: TypeScript spells functions in camelCase and constants in upper case, and
 * everything else is a type (class, interface or alias).
 */
import { pageKey, relativeTo, resolveSiteUrl } from './site.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** `api-reference/<package>/<Symbol>/` relative to the site prefix. */
const SYMBOL_PAGE = /(?:^|\/)api-reference\/([^/]+)\/([^/]+)\/?$/;

function kindOf(name: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.length > 1) return 'constant';
  return /^[a-z_$]/.test(name) ? 'function' : 'type';
}

/** Symbols of a TypeDoc reference: one per API page, qualified by its package. */
export function typedocSymbols(input: SymbolInput): SymbolEntry[] {
  const { site, index, nav } = input;
  const navTitles = new Map(nav.map((entry) => [pageKey(entry.url), entry.title]));
  // Without the manifest (a page-data that lost the field) the navigation tree lists the same pages.
  const listed =
    index.typedocNodes.length > 0
      ? index.typedocNodes
      : nav.map((entry) => ({ title: entry.title, url: entry.url }));

  const entries: SymbolEntry[] = [];
  const seen = new Set<string>();
  for (const node of listed) {
    const url = resolveSiteUrl(site, node.url);
    if (url === undefined || seen.has(url)) continue;
    const match = SYMBOL_PAGE.exec(relativeTo(site.prefix, url) ?? '');
    const segment = match?.[1];
    if (match === null || segment === undefined) continue;
    seen.add(url);
    const packageUrl = url.replace(/[^/]+\/?$/, '');
    const packageName = navTitles.get(packageUrl) ?? segment;
    const symbol = node.title.trim();
    entries.push({
      url,
      symbol,
      symbolKind: kindOf(symbol),
      qualified: `${packageName}.${symbol}`,
      crumbs: [packageName],
    });
  }
  return entries;
}
