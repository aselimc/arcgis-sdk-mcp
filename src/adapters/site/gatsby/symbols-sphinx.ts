/**
 * `symbols: 'sphinx-pagination'`: the ArcGIS API for Python reference is Sphinx output
 * inside a Gatsby shell, and its pagination file is a flat list of every documented object:
 *
 * ```
 * { "title": "arcgis.gis module", "url": "/python/latest/api-reference/arcgis.gis.toc.html" }
 * { "title": "GIS",        "url": "…/arcgis.gis.toc.html#arcgis.gis.GIS",       "section": "GIS" }
 * { "title": "GIS.map()",  "url": "…/arcgis.gis.toc.html#arcgis.gis.GIS.map",   "section": "GIS" }
 * { "title": "geocode",    "url": "…/arcgis.geocoding.html#geocode", "section": "arcgis.geocoding module" }
 * ```
 *
 * An anchor with dots is the object's qualified name. An anchor without dots is a heading
 * slug; its qualified name is the module of the page plus the title.
 */
import { resolveSiteUrl } from './site.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** A dotted Python name. */
const DOTTED_NAME = /^[A-Za-z_][\w.]*$/;

/** The module a reference page documents: `arcgis.gis.toc.html` is `arcgis.gis`. */
function moduleOf(pageUrl: string): string | undefined {
  const file = new URL(pageUrl).pathname
    .split('/')
    .filter((segment) => segment !== '')
    .at(-1);
  const name = file?.replace(/\.html?$/i, '').replace(/\.toc$/i, '');
  return name !== undefined && DOTTED_NAME.test(name) ? name : undefined;
}

function kindOf(symbol: string, member: boolean, callable: boolean): string {
  if (member) return callable ? 'method' : 'property';
  return /^[A-Z]/.test(symbol) ? 'class' : 'function';
}

/** Symbols of a Sphinx reference, one per pagination entry, de-duplicated on qualified name. */
export function sphinxSymbols(input: SymbolInput): SymbolEntry[] {
  /** `dotted` records whether the entry came from an object anchor rather than a heading slug. */
  const byQualified = new Map<string, { entry: SymbolEntry; dotted: boolean }>();
  for (const item of input.index.pagination) {
    const url = resolveSiteUrl(input.site, item.url);
    if (url === undefined) continue;
    const [page = url, anchor] = url.split('#');
    const module = moduleOf(page);
    if (anchor === undefined) {
      if (module === undefined) continue;
      const symbol = module.split('.').at(-1) ?? module;
      byQualified.set(module, {
        entry: { url, symbol, qualified: module, symbolKind: 'module' },
        dotted: true,
      });
      continue;
    }
    const callable = item.title.endsWith('()');
    const name = item.title.replace(/\(\)$/, '').trim();
    if (!DOTTED_NAME.test(name)) continue;
    const dotted = anchor.includes('.');
    const qualified = dotted ? anchor : module === undefined ? name : `${module}.${name}`;
    const existing = byQualified.get(qualified);
    // A class appears twice: as a heading slug and as the object anchor. Keep the object.
    if (existing !== undefined && (existing.dotted || !dotted)) continue;

    const symbol = name.split('.').at(-1) ?? name;
    // `Type.member` in the title marks a member; its owner is the qualified name minus the last part.
    const member = name.includes('.');
    const parent = member ? qualified.split('.').slice(0, -1).join('.') : '';
    byQualified.set(qualified, {
      entry: {
        url,
        symbol,
        qualified,
        title: item.title,
        symbolKind: kindOf(symbol, member, callable),
        locator: { anchor },
        ...(parent === '' ? {} : { parent }),
        ...(item.section === undefined ? {} : { crumbs: [item.section] }),
      },
      dotted,
    });
  }
  return [...byQualified.values()].map(({ entry }) => entry);
}
