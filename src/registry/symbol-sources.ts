/**
 * Which sources can answer `arcgis_docs_lookup_symbol`, read from their configuration.
 *
 * A source declaring the kind `api` or `spec` says what its pages are about, not that its
 * records carry symbols: a GitHub repository of `.proto` files or a help book of command
 * pages is indexed as plain pages, and a name is then found by search only. Whether a
 * source yields symbol records is decided by its adapter and the option that turns symbols
 * on, which this module states once, so that the product profile, the coverage table and
 * the registry tests make the same claim. Each rule names the adapter code it mirrors.
 */
import type { AnySourceDef, Product, SourceDef } from '../core/types.js';

/**
 * How a product's names can be looked up:
 * - `symbols`: a source indexes symbol records (classes, members, tools, operations);
 * - `titles`: no source does, but a source lists API pages that are each titled by the
 *   name they document (AutoCAD commands, Survey123 classes), which the lookup matches by
 *   title;
 * - `none`: names are found by search only.
 */
export type SymbolLookup = 'symbols' | 'titles' | 'none';

/** Adapters that read a structured reference: every one of their entries is a symbol. */
const REFERENCE_ADAPTERS = new Set<SourceDef['adapter']>([
  'openapi',
  'docc',
  'dokka',
  'dartdoc',
  'docfx-net',
  'javadoc',
  'sphinx',
  'npm-dts',
  'npm-cem',
  'npm-json',
  'xmldoc',
  'pkgdown',
]);

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * A `legacy-help` book of an earlier release names its symbols after the current release's
 * `docfx-esri` table of contents (`currentTwin` in `src/adapters/site/legacy-current.ts`):
 * only a book inside the scope of such a source has symbols.
 */
function legacyBookHasTwin(product: Product, path: string): boolean {
  const book = trimSlashes(path);
  return (product.sources as readonly AnySourceDef[]).some((candidate) => {
    if (candidate.adapter !== 'docfx-esri' || candidate.config.symbols !== 'toc') return false;
    const scope = trimSlashes(candidate.config.scope ?? '');
    return scope !== '' && (book === scope || book.startsWith(`${scope}/`));
  });
}

/**
 * True when the source's records carry symbols.
 *
 * @param product the product the source belongs to; a `legacy-help` source borrows its
 *   names from a sibling source.
 */
export function sourceYieldsSymbols(product: Product, source: SourceDef): boolean {
  const def = source as AnySourceDef;
  if (REFERENCE_ADAPTERS.has(def.adapter)) return true;
  switch (def.adapter) {
    // `symbolEntries` in src/adapters/site/gatsby/symbols.ts.
    case 'gatsby':
      return def.config.symbols !== undefined || def.config.symbolsFromSlug !== undefined;
    // `apiRecords` and `withSlugSymbol` in src/adapters/site/astro.ts.
    case 'astro':
      return (
        def.config.symbolsFromSlug !== undefined ||
        (def.config.searchIndexes ?? []).some((index) => index.role === 'api')
      );
    // `symbolOf` in src/adapters/site/docfx-esri.ts.
    case 'docfx-esri':
      return def.config.symbols === 'toc';
    case 'legacy-help':
      return def.config.books.some((book) => legacyBookHasTwin(product, book.path));
    // `documentRecords` in src/adapters/reference/github/files.ts.
    case 'github-repo':
      return def.config.symbolsFromHeadings !== undefined;
    default:
      return false;
  }
}

/**
 * The kinds of the plain pages a source lists. A `legacy-help` page is of the source's first
 * kind, whatever else it declares (`pageKind` in src/adapters/site/legacy-help.ts).
 */
function pageKinds(source: SourceDef): readonly string[] {
  return source.adapter === 'legacy-help' ? source.kinds.slice(0, 1) : source.kinds;
}

/** How names of the product can be looked up; see {@link SymbolLookup}. */
export function symbolLookupOf(product: Product): SymbolLookup {
  if (product.sources.some((source) => sourceYieldsSymbols(product, source))) return 'symbols';
  // The title match of the lookup reads API pages only (src/services/symbol/titled.ts).
  return product.sources.some((source) => pageKinds(source).includes('api')) ? 'titles' : 'none';
}
