/**
 * The `symbols` modes of a gatsby source: how API symbols (types, members, operations,
 * glossary terms) are derived from the index files a site publishes. Each mode is a pure
 * function from the discovered index to symbol entries; the catalogue builder merges the
 * entries with the page records.
 */
import type { AdapterConfigMap, DocKind } from '../../../core/types.js';
import type { SiteIndex } from './discovery.js';
import { glossarySymbols } from './glossary.js';
import type { NavEntry } from './nav.js';
import { relativeTo, type GatsbySite } from './site.js';
import { apirefSymbols } from './symbols-apiref.js';
import { fuseSymbols } from './symbols-fuse.js';
import { openapiSymbols } from './symbols-openapi.js';
import { restSymbols } from './symbols-rest.js';
import { sphinxSymbols } from './symbols-sphinx.js';
import { typedocSymbols } from './symbols-typedoc.js';

/** Configuration of a gatsby source. */
export type GatsbyConfig = AdapterConfigMap['gatsby'];

/** A page of the source as far as the index files describe it. */
export interface PageRow {
  /** Absolute URL without fragment (`pageKey`). */
  url: string;
  title: string;
  /** Ancestor titles, outermost first. */
  crumbs: string[];
  pageType?: string;
}

/** One API symbol found by a `symbols` mode. */
export interface SymbolEntry {
  /** Absolute URL of the page that documents the symbol, with `#anchor` for a member. */
  url: string;
  /** Simple name. */
  symbol: string;
  symbolKind: string;
  qualified?: string;
  /** Qualified name of the owning type; set exactly for members. */
  parent?: string;
  /** Replaces the page title when the symbol has a better one (`GET /places/near-point`). */
  title?: string;
  crumbs?: string[];
  description?: string;
  keywords?: string[];
  /**
   * The kind of the record. The `symbols` modes default to `api`; a symbol read off a slug
   * leaves it to the page's path and the source's kinds (a specification object is `spec`).
   */
  kind?: DocKind;
  locator?: Record<string, string>;
}

/** What every `symbols` mode is given. */
export interface SymbolInput {
  site: GatsbySite;
  config: GatsbyConfig;
  index: SiteIndex;
  /** Pages of the source with the best title known for each. */
  pages: readonly PageRow[];
  /** Every navigation entry of the site, in reading order. */
  nav: readonly NavEntry[];
}

/**
 * `symbolsFromSlug`: a pattern over the page path relative to the source base whose first
 * capture group is the symbol (`^api-reference/([^/]+)/$`). A capture that spans several
 * segments gives a qualified name with dots.
 */
function slugSymbols(input: SymbolInput, source: string): SymbolEntry[] {
  let pattern: RegExp;
  try {
    pattern = new RegExp(source);
  } catch {
    // The registry check compiles every pattern; a broken one yields no symbols, not a crash.
    return [];
  }
  const entries: SymbolEntry[] = [];
  for (const page of input.pages) {
    const captured = pattern.exec(relativeTo(input.site.base, page.url) ?? '')?.[1];
    const segments = (captured ?? '').split('/').filter((segment) => segment !== '');
    const symbol = segments.at(-1);
    if (symbol === undefined) continue;
    entries.push({
      url: page.url,
      symbol,
      symbolKind: 'type',
      ...(segments.length > 1 ? { qualified: segments.join('.') } : {}),
    });
  }
  return entries;
}

/** The entries of the configured `symbols` mode; none when the source has no mode. */
function modeSymbols(input: SymbolInput): SymbolEntry[] {
  const mode = input.config.symbols;
  switch (mode) {
    case 'typedoc':
      return typedocSymbols(input);
    case 'openapi':
      return openapiSymbols(input);
    case 'fuse-store':
      return fuseSymbols(input);
    case 'sphinx-pagination':
      return sphinxSymbols(input);
    case 'apiref-nav':
      return apirefSymbols(input);
    case 'glossary':
      return glossarySymbols(input);
    case 'rest-operations':
      return restSymbols(input);
    default:
      return [];
  }
}

/** The symbols of a source: those of its `symbols` mode, then those of `symbolsFromSlug`. */
export function symbolEntries(input: SymbolInput): SymbolEntry[] {
  const entries = modeSymbols(input).map((entry): SymbolEntry => ({ kind: 'api', ...entry }));
  if (input.config.symbolsFromSlug !== undefined) {
    entries.push(...slugSymbols(input, input.config.symbolsFromSlug));
  }
  return entries;
}
