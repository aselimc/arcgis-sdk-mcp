/**
 * Builders for the pieces of a generated help product: version lines and the two kinds of
 * help source (`docfx-esri` on doc.esri.com, `legacy-help` on the three older hosts).
 * Pure functions of research entries; the import rules that decide which entry becomes
 * what are in `scripts/import-help-registry.ts`.
 */
import type { SourceDef, VersionLine } from '../../src/core/types.js';
import type { Book, Entry } from './help-registry.schema.js';

/** The line every help product has: the current documentation. */
export const LATEST_LINE: VersionLine = {
  id: 'latest',
  label: 'Current',
  current: true,
  access: 'live',
  vars: {},
};

/** A numbered line of an earlier version; `{line}` in a source base expands to its id. */
export function versionLine(
  version: string,
  access: VersionLine['access'],
  labelPrefix = '',
): VersionLine {
  return { id: version, label: `${labelPrefix}${version}`, current: false, access, vars: {} };
}

/** Orders version numbers newest first, comparing dot-separated parts numerically. */
export function compareVersionsDesc(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The research name without a trailing note in parentheses: `ArcGIS Urban (old versions)` gives `ArcGIS Urban`. */
export function officialName(researchName: string): string {
  return researchName.replace(/\s*\([^)]*\)\s*$/, '');
}

/**
 * The path of an entry's base URL as a `legacy-help` base: `/en/portal/{line}/` for
 * `https://enterprise.arcgis.com/en/portal/<version>/`.
 */
export function basePath(entry: Entry): string {
  const origin = `https://${entry.host}`;
  if (!entry.base_url.startsWith(`${origin}/`)) {
    throw new Error(`${entry.id}: base_url ${entry.base_url} is not on ${entry.host}`);
  }
  return entry.base_url.slice(origin.length).replace('<version>', '{line}');
}

/** The books of an entry; fails for the one entry (pro.arcgis.com) whose books are not a list. */
export function bookList(entry: Entry): Book[] {
  if (!Array.isArray(entry.books)) throw new Error(`${entry.id}: books is not a list`);
  return entry.books;
}

/** Half of a page count: the floor a probe or an index rebuild must reach (design section 4). */
function half(pages: number | null | undefined): { minRecords?: number } {
  return typeof pages === 'number' && pages > 1 ? { minRecords: Math.floor(pages / 2) } : {};
}

/** The help of a doc.esri.com product. `sections` are its book paths; the sitemap is the floor rung. */
export function docfxSource(
  entry: Entry,
  name: string,
  sections: string[],
  /** False when `sections` leave out books, so the research page count does not apply. */
  complete: boolean,
): SourceDef<'docfx-esri'> {
  return {
    id: 'help',
    title: `${name} help`,
    kinds: ['help'],
    adapter: 'docfx-esri',
    config: { slug: entry.url_slug, sections },
    capability: 'website',
    floor: true,
    ...(complete && typeof entry.pages_en === 'number' ? { pagesApprox: entry.pages_en } : {}),
    probe: {
      url: `https://doc.esri.com/en/${entry.url_slug}/latest/sitemap.xml`,
      expect: 'xml',
      family: 'docfx-esri',
      ...(complete ? half(entry.pages_en) : {}),
    },
  };
}

/** The English page count of a set of books, when the research counted every one of them. */
function totalPages(books: Book[]): number | undefined {
  let total = 0;
  for (const book of books) {
    if (typeof book.pages !== 'number') return undefined;
    total += book.pages;
  }
  return total;
}

/** What distinguishes one `legacy-help` source from another. */
export interface LegacyHelpSpec {
  id: string;
  title: string;
  entry: Entry;
  books: Book[];
  floor?: boolean;
  /** Versions the source exists for; they are also the version lines it is bound to. */
  versions?: string[];
  /** Versions that are fetched; defaults to `versions`. The rest are link-only lines. */
  liveVersions?: string[];
  /**
   * The book whose `flisting.htm` is the canary; defaults to the first book. Needed where the
   * first book is a directory of books, which publishes no link list of its own.
   */
  probeBook?: string;
}

/**
 * A help tree on doc.arcgis.com, enterprise.arcgis.com or pro.arcgis.com. A source with
 * `versions` is enumerated on demand only (one URL tree per version); its probe reads the
 * version whose books the research verified.
 */
export function legacyHelpSource(spec: LegacyHelpSpec): SourceDef<'legacy-help'> {
  const { entry, books, versions } = spec;
  const [firstBook] = books;
  if (firstBook === undefined) throw new Error(`${entry.id}: source ${spec.id} has no books`);
  const base = basePath(entry);
  if (base.includes('{line}') !== (versions !== undefined)) {
    throw new Error(`${entry.id}: a versioned base needs versions, and only a versioned base`);
  }
  const live = spec.liveVersions ?? versions;
  const probeVersion = entry.books_sampled_at ?? live?.[0] ?? '';
  const probeBook = spec.probeBook ?? firstBook.path;
  const pages = totalPages(books);
  return {
    id: spec.id,
    title: spec.title,
    kinds: ['help'],
    adapter: 'legacy-help',
    config: {
      host: entry.host,
      base,
      books: books.map((book) => ({
        path: book.path,
        ...(typeof book.toc_script === 'string' ? { tocScript: book.toc_script } : {}),
      })),
      ...(live === undefined ? {} : { lines: live, enumerate: 'on-demand' as const }),
    },
    capability: 'website',
    ...(spec.floor ? { floor: true } : {}),
    ...(versions === undefined ? {} : { lines: versions }),
    ...(pages === undefined ? {} : { pagesApprox: pages }),
    probe: {
      // Each book directory lists its live pages as plain links in flisting.htm.
      url: `https://${entry.host}${base.replace('{line}', probeVersion)}${probeBook}/flisting.htm`,
      expect: 'html',
      family: 'legacy-help',
      minChars: 200,
      mustContain: '.htm',
    },
  };
}
