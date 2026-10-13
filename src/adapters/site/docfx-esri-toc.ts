/**
 * Pure readers for the table-of-contents files of doc.esri.com (`toc.json`) and the rules
 * that turn their entries into Python symbols.
 *
 * A table of contents has titles and paths but no Python names, so the names of
 * geoprocessing tools and ArcPy members are derived here (design risk R5):
 *
 * - a tool is `arcpy.<toolbox alias>.<TitleWithoutSpaces>`, from the directory of its page
 *   and its title;
 * - an ArcPy class or function is `<module>.<Title>`, from the directory of its page.
 *
 * The derivation is right for most entries and wrong for a few (a tool titled
 * "Geodesic Viewshed" is called `Viewshed2`). The adapter therefore checks each tool page it
 * reads against {@link pythonSignature} and keeps the corrections ({@link VerifiedNames}).
 */

/** One entry of a table of contents, flattened in document order. */
export interface TocEntry {
  title: string;
  /** Relative to the table-of-contents file; absent on a group without a page of its own. */
  href?: string;
  /** Titles of the enclosing groups, outermost first. */
  ancestors: string[];
}

/** The symbol fields of a catalogue record, as derived from a table-of-contents entry. */
export interface SymbolFields {
  symbol: string;
  qualified: string;
  symbolKind: 'tool' | 'class' | 'function';
  keywords?: string[];
}

/**
 * What tool pages said about their own Python names, keyed by the page path relative to the
 * tool reference (`analysis/buffer.html`). `null` marks a page that turned out to document
 * no Python call. `aliases` maps a toolbox directory to the alias its pages use.
 */
export interface VerifiedNames {
  aliases: Record<string, string>;
  names: Record<string, string | null>;
}

/** Deeper nesting than any real table of contents; guards against a cyclic or hostile file. */
const MAX_DEPTH = 24;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function itemsOf(value: unknown): unknown[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : undefined;
}

/**
 * Flattens a `toc.json` document (`{ items: [{ name, href, items }] }`) depth-first.
 *
 * @returns the entries in document order, groups included; `undefined` when the document has
 *   no `items` array, which is how a renamed field or a different file shows.
 */
export function parseToc(data: unknown): TocEntry[] | undefined {
  const top = itemsOf(data);
  if (top === undefined) return undefined;
  const entries: TocEntry[] = [];
  const walk = (items: unknown[], ancestors: string[], depth: number): void => {
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const title = text((item as { name?: unknown }).name);
      const href = text((item as { href?: unknown }).href);
      if (title !== undefined) {
        entries.push(href === undefined ? { title, ancestors } : { title, href, ancestors });
      }
      const children = itemsOf(item);
      if (children !== undefined && depth < MAX_DEPTH) {
        // A group without a name contributes no breadcrumb level.
        walk(children, title === undefined ? ancestors : [...ancestors, title], depth + 1);
      }
    }
  };
  walk(top, [], 0);
  return entries;
}

/**
 * The per-book tables of contents a product's root `toc.json` points to: each top-level
 * entry names its book as `tocHref: "<book>/toc.html"`, whose JSON twin is `<book>/toc.json`.
 */
export function tocBooks(data: unknown): Array<{ title: string; toc: string }> {
  const books: Array<{ title: string; toc: string }> = [];
  for (const item of itemsOf(data) ?? []) {
    if (typeof item !== 'object' || item === null) continue;
    const title = text((item as { name?: unknown }).name);
    const tocHref = text((item as { tocHref?: unknown }).tocHref);
    if (title === undefined || tocHref?.endsWith('toc.html') !== true) continue;
    books.push({ title, toc: tocHref.replace(/\.html$/, '.json') });
  }
  return books;
}

/**
 * Python aliases of the system toolboxes, by the directory their pages live in. A directory
 * that is not listed falls back to its name without separators, and is corrected from the
 * first page of that toolbox that is read.
 */
export const GP_TOOLBOX_ALIASES: Readonly<Record<string, string>> = {
  '3d-analyst': 'ddd',
  analysis: 'analysis',
  aviation: 'aviation',
  'big-data-analytics': 'geoanalytics',
  'business-analyst': 'ba',
  cartography: 'cartography',
  conversion: 'conversion',
  'crime-analysis': 'ca',
  'data-interoperability': 'interop',
  'data-management': 'management',
  defense: 'defense',
  editing: 'edit',
  'feature-analysis': 'sfa',
  geoai: 'geoai',
  'geoanalytics-desktop': 'gapro',
  geocoding: 'geocoding',
  'geostatistical-analyst': 'ga',
  'image-analyst': 'ia',
  'indoor-positioning': 'indoorpositioning',
  indoors: 'indoors',
  intelligence: 'intelligence',
  'linear-referencing': 'lr',
  'location-referencing': 'locref',
  maritime: 'maritime',
  multidimension: 'md',
  'network-analyst': 'na',
  'network-diagram': 'nd',
  'oriented-imagery': 'oi',
  parcel: 'parcel',
  'public-transit': 'transit',
  'raster-analysis': 'ra',
  'ready-to-use': 'agolservices',
  'reality-mapping': 'reality',
  server: 'server',
  'space-time-pattern-mining': 'stpm',
  'spatial-analyst': 'sa',
  'spatial-statistics': 'stats',
  'territory-design': 'td',
  'topographic-production': 'topographic',
  'trace-network': 'tn',
  'utility-networks': 'un',
};

/** Python modules of the ArcPy reference, by the directory their pages live in. */
const ARCPY_MODULES: Readonly<Record<string, string>> = {
  functions: 'arcpy',
  classes: 'arcpy',
  charts: 'arcpy.charts',
  'data-access': 'arcpy.da',
  geocoding: 'arcpy.geocoding',
  'image-analyst': 'arcpy.ia',
  mapping: 'arcpy.mp',
  metadata: 'arcpy.metadata',
  'network-analyst': 'arcpy.nax',
  sharing: 'arcpy.sharing',
  'spatial-analyst': 'arcpy.sa',
  'utility-network': 'arcpy.un',
};

/** Words a tool title may spell in lower case ("Split Line at Point"). */
const SMALL_WORDS = new Set(
  'a an and as at by for from in into of on or per the to via with within'.split(' '),
);

/** `dir/file.html` split into its two parts; `undefined` for any other depth. */
function splitPagePath(path: string): { dir: string; file: string } | undefined {
  const parts = path.replace(/[?#].*$/, '').split('/');
  const [dir, file] = parts;
  if (parts.length !== 2 || dir === undefined || file === undefined) return undefined;
  return dir === '' || file === '' ? undefined : { dir, file };
}

function pascalCase(words: string): string {
  return words
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * The Python function name of a geoprocessing tool, from its title: parenthesised additions
 * are dropped and the remaining words are joined in Pascal case (`Split Line at Point` gives
 * `SplitLineAtPoint`). A title that does not start with a letter (`80-20 Analysis`) is
 * replaced by the page slug (`eighty-twenty-analysis`).
 */
export function gpToolName(title: string, slug: string): string | undefined {
  const fromTitle = pascalCase(title.replace(/\([^)]*\)/g, ' '));
  if (/^[A-Za-z]/.test(fromTitle)) return fromTitle;
  const fromSlug = pascalCase(slug.replace(/\.html?$/i, ''));
  return /^[A-Za-z]/.test(fromSlug) ? fromSlug : undefined;
}

/** The Python alias of a toolbox directory: verified, else known, else the bare directory name. */
export function gpToolboxAlias(dir: string, verified?: VerifiedNames): string {
  return verified?.aliases[dir] ?? GP_TOOLBOX_ALIASES[dir] ?? dir.replace(/[^A-Za-z0-9]+/g, '');
}

/** Tool titles capitalise every word except a few small ones; topic titles are sentences. */
function isToolTitle(title: string): boolean {
  if (/^(?:An overview of|Introduction to)\b/i.test(title)) return false;
  // A lower-case start followed by capitals is a format name ("Table To dBASE"), not prose.
  return title
    .split(/\s+/)
    .every(
      (word) => /^(?:[A-Z0-9(]|[a-z]{1,3}[A-Z])/.test(word) || SMALL_WORDS.has(word.toLowerCase()),
    );
}

/**
 * The symbol a tool-reference entry stands for, or `undefined` when the entry is not a tool.
 *
 * An entry is a tool when its page is `<toolbox>/<tool>.html`, it sits inside a group named
 * "... toolbox" and outside any "... concepts" group, and its title is spelled like a tool
 * name. Measured against the page types of the live site this finds every tool the table of
 * contents lists, with a handful of topic pages besides; those are dropped again once read
 * (`verified.names[path] === null`).
 *
 * @param path the page path relative to the tool reference, for example `analysis/buffer.html`.
 */
export function gpToolSymbol(
  entry: TocEntry,
  path: string,
  verified?: VerifiedNames,
): SymbolFields | undefined {
  const page = splitPagePath(path);
  if (page === undefined) return undefined;
  if (!entry.ancestors.some((group) => /\btoolbox$/i.test(group))) return undefined;
  if (entry.ancestors.some((group) => /\bconcepts$/i.test(group))) return undefined;
  if (!isToolTitle(entry.title)) return undefined;

  const corrected = verified?.names[path];
  if (corrected === null) return undefined;
  const alias = gpToolboxAlias(page.dir, verified);
  const name = gpToolName(entry.title, page.file);
  const qualified = corrected ?? (name === undefined ? undefined : `arcpy.${alias}.${name}`);
  if (qualified === undefined) return undefined;

  const [, usedAlias = alias, symbol = qualified] = qualified.split('.');
  // `Buffer_analysis` is the older spelling of the same call; the directory name is what the
  // design's derivation rule (`arcpy.<toolbox-slug>.<Title>`) would search for.
  const keywords = [...new Set([`${symbol}_${usedAlias}`, page.dir])].filter(
    (keyword) => keyword !== usedAlias,
  );
  return { symbol, qualified, symbolKind: 'tool', keywords };
}

/**
 * The symbol an ArcPy-reference entry stands for, or `undefined` when the entry is a topic.
 *
 * Reference pages are titled with the bare identifier (`SearchCursor`, `ListFields`), topics
 * with a phrase, so an identifier-shaped title is the test. The module comes from the page
 * directory (`data-access` is `arcpy.da`; the legacy Network Analyst pages are `arcpy.na`),
 * the kind from the nearest enclosing "Classes" or "Functions" group.
 *
 * @param path the page path relative to the ArcPy reference, for example `mapping/map-class.html`.
 */
export function arcpySymbol(entry: TocEntry, path: string): SymbolFields | undefined {
  const page = splitPagePath(path);
  if (page === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.title)) return undefined;

  const legacyNetworkAnalyst =
    page.dir === 'network-analyst' && entry.ancestors.some((group) => /^legacy$/i.test(group));
  const module = legacyNetworkAnalyst
    ? 'arcpy.na'
    : (ARCPY_MODULES[page.dir] ?? `arcpy.${page.dir.replace(/[^A-Za-z0-9]+/g, '_')}`);

  let symbolKind: SymbolFields['symbolKind'] | undefined;
  for (const group of [...entry.ancestors].reverse()) {
    if (/\bclass(?:es)?\b/i.test(group)) symbolKind = 'class';
    else if (/\bfunctions?\b/i.test(group)) symbolKind = 'function';
    if (symbolKind !== undefined) break;
  }
  symbolKind ??= /-(?:class|object)\.html?$/i.test(page.file) ? 'class' : 'function';
  return { symbol: entry.title, qualified: `${module}.${entry.title}`, symbolKind };
}

/**
 * The Python call a tool page documents, read from its text (HTML or converted Markdown).
 *
 * The syntax line comes before the code samples, so the first `arcpy.<alias>.<Name>(` names
 * the tool. Its alias is taken from the most frequent spelling that is a valid Python
 * identifier, because the syntax line of a few pages shows a display alias that is not
 * (`arcpy.3d.Viewshed2`) while their samples use the real one (`arcpy.ddd.Viewshed2`).
 */
export function pythonSignature(page: string): { name: string; alias?: string } | undefined {
  const calls = [...page.matchAll(/\barcpy\.([A-Za-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\\?\(/g)];
  const name = calls[0]?.[2];
  if (name === undefined) return undefined;
  const counts = new Map<string, number>();
  for (const [, alias, called] of calls) {
    if (called !== name || alias === undefined || !/^[A-Za-z_]/.test(alias)) continue;
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [alias, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) best = alias;
  }
  return best === undefined ? { name } : { name, alias: best };
}
