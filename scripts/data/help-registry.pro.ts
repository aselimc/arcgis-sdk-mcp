/**
 * The books of earlier ArcGIS Pro releases on pro.arcgis.com, as the import assigns them to
 * `legacy-help` sources.
 *
 * That host has no listing above the book: `/en/pro-app/3.6/arcpy/` and `/tool-reference/`
 * are directories of books, and only a book (`arcpy/functions`, `tool-reference/analysis`)
 * publishes `flisting.htm` and a table-of-contents script. A source therefore names
 *
 * - **sections**, the top-level directories it owns as a whole. A section is listed through
 *   the table-of-contents script of its `main` book, which exists for every section and
 *   holds the section's entry pages; this also keeps every page below the section
 *   attributed to the product, on the link-only lines too;
 * - **books**, each with the script id the research recorded, so that listing a book costs
 *   one request. The index build of a source has a request budget, which is why the 48
 *   toolboxes are split over two sources and why the end-user help lists a chosen subset.
 */
import type { Book, Entry, RulesFile } from './help-registry.schema.js';
import { basePath } from './help-registry.sources.js';

type ProRules = RulesFile['pro'];

/**
 * Books one source may list. An index build may issue 30 requests
 * (`limits.requestsPerIndexBuild`); a book costs one, and a book whose script id went stale
 * costs up to three more, so a few requests are kept in reserve.
 */
export const MAX_PRO_BOOKS_PER_SOURCE = 27;

/** The books of one release and the id of each book's table-of-contents script. */
export interface ProCatalog {
  /** Book paths relative to the release root, in research order. */
  books: string[];
  scripts: Readonly<Record<string, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the book catalogue of one release from the research entry of pro.arcgis.com.
 *
 * @throws Error when the entry has no book list for `version` or no script ids.
 */
export function proCatalog(entry: Entry, version: string): ProCatalog {
  const sampled = isRecord(entry.books) ? entry.books[version] : undefined;
  if (!isRecord(sampled)) throw new Error(`${entry.id}: no books at version ${version}`);
  const books = [
    ...new Set(
      Object.values(sampled).flatMap((paths) =>
        Array.isArray(paths) ? paths.filter((path) => typeof path === 'string') : [],
      ),
    ),
  ];
  const scripts = isRecord(entry.books) ? entry.books.toc_scripts : undefined;
  if (!isRecord(scripts)) throw new Error(`${entry.id}: books.toc_scripts is missing`);
  const ids: Record<string, number> = {};
  for (const [path, id] of Object.entries(scripts)) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error(`${entry.id}: books.toc_scripts["${path}"] is not a script id`);
    }
    ids[path] = id;
  }
  return { books, scripts: ids };
}

/** The top-level directory of a book path. */
const sectionOf = (path: string): string => path.split('/')[0] ?? path;

/**
 * The books of every source `rules.sources` describes, keyed `product/source`.
 *
 * @throws Error for a section or book the research does not list, a book without a script
 *   id, a book two sources list, a book of a complete section that no source lists, and a
 *   source with more books than one index build can request.
 */
export function proSourceBooks(
  entry: Entry,
  catalog: ProCatalog,
  rules: ProRules,
): Map<string, Book[]> {
  const base = basePath(entry);
  const known = new Set(catalog.books);
  const sections = new Set(catalog.books.map(sectionOf));
  const script = (bookPath: string, scriptDir = bookPath): string | undefined => {
    const id = catalog.scripts[scriptDir];
    return id === undefined ? undefined : `${base}${scriptDir}/${id}.js`;
  };

  // Explicit lists are settled first: "rest" means whatever they leave over.
  const claimed = new Map<string, string>();
  for (const [target, rule] of Object.entries(rules.sources)) {
    for (const path of rule.books === 'rest' ? [] : rule.books) {
      if (!known.has(path)) throw new Error(`${entry.id}: no book "${path}" (${target})`);
      const other = claimed.get(path);
      if (other !== undefined) {
        throw new Error(`${entry.id}: book "${path}" is listed by ${other} and ${target}`);
      }
      claimed.set(path, target);
    }
  }

  const result = new Map<string, Book[]>();
  for (const [target, rule] of Object.entries(rules.sources)) {
    for (const section of rule.sections) {
      if (!sections.has(section)) throw new Error(`${entry.id}: no section "${section}"`);
    }
    // A section that is one book (`get-started`) has its own script; the others are listed
    // through their `main` book.
    const sectionBooks: Book[] = rule.sections.map((section) => ({
      path: section,
      toc_script: script(section, known.has(section) ? section : `${section}/main`),
    }));
    const covered = (path: string): boolean =>
      rule.sections.some((section) => path === section || path === `${section}/main`);
    const listed =
      rule.books === 'rest'
        ? catalog.books.filter(
            (path) =>
              rule.sections.includes(sectionOf(path)) && !covered(path) && !claimed.has(path),
          )
        : rule.books;
    const books = [
      ...sectionBooks,
      ...listed.map((path): Book => {
        const tocScript = script(path);
        if (tocScript === undefined) {
          throw new Error(`${entry.id}: book "${path}" has no table-of-contents script id`);
        }
        claimed.set(path, target);
        return { path, toc_script: tocScript };
      }),
    ];
    if (books.length > MAX_PRO_BOOKS_PER_SOURCE) {
      throw new Error(
        `${entry.id}: ${target} lists ${books.length} books; an index build can request at most ${MAX_PRO_BOOKS_PER_SOURCE}`,
      );
    }
    if (!books.some((book) => book.path === rule.probeBook)) {
      throw new Error(`${entry.id}: ${target} probes "${rule.probeBook}", which it does not list`);
    }
    result.set(target, books);
  }

  const owned = new Set([...Object.values(rules.sources)].flatMap((rule) => rule.sections));
  for (const section of rules.completeSections) {
    if (!owned.has(section)) throw new Error(`${entry.id}: no source owns section "${section}"`);
    const missing = catalog.books.filter(
      (path) => sectionOf(path) === section && path !== `${section}/main` && !claimed.has(path),
    );
    if (missing.length > 0) {
      throw new Error(`${entry.id}: no source lists ${missing.join(', ')}`);
    }
  }
  return result;
}
