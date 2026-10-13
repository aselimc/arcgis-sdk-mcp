/**
 * Compatibility pairings from Esri's own tables (research section 3): the JavaScript
 * version matrix, the Experience Builder release table, the Arcade version matrix and the
 * package list of ArcGIS Pro's Python environment. The page is converted by the HTML
 * renderer and its largest table is read; rows for versions above the current one are kept
 * and flagged `unreleased`, because these matrices list releases ahead of time.
 *
 * A matrix can be sparse: the Arcade matrix has a row per Arcade version and a value only
 * under the products that shipped it. A column the reported row leaves empty is then
 * answered from the newest earlier row that has a value, which says so
 * (`12.2 (with Arcade 1.36)`), so every host product gets its pairing.
 *
 * The matrix also states the product's own version in the column that names it. A product
 * without a version oracle (the web map and web scene specifications follow the JavaScript
 * SDK) takes its documented version from there.
 */
import { joinSections } from '../core/budget.js';
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { Product, VersionLine } from '../core/types.js';
import { parseVersion } from '../core/version-key.js';
import { resolveUrl } from './oracles/kit.js';
import { htmlTables, largestTable, markdownTables, type TextTable } from './tables.js';
import { compareAtSharedPrecision, parseDate } from './version-text.js';

/** One compatibility statement, as in `VersionReport`. */
export type CompatibilityRow = VersionReport['products'][number]['compatibility'][number];

/** Upper bound of rows reported for one product, so a 300-row table cannot flood a result. */
const MAX_ROWS = 40;

/** Words that say nothing about which column is the product's own. */
const STOP_WORDS = new Set(['arcgis', 'esri', 'sdk', 'sdks', 'maps', 'api', 'for', 'the', 'and']);

const EMPTY_CELL = /^(?:|n\/a|na|-|—|none)$/i;

/**
 * Headers of columns that describe the row's own release ("Date released", "Release date")
 * rather than a product it pairs with. The release date is reported by the version oracles.
 */
const OWN_FACT_COLUMN = /\b(?:date|released)\b/i;

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));

/** A matrix cell as a version: `5.1.*` and `4.x` lose their wildcard. */
const cellVersion = (cell: string): string => cell.replace(/\.(?:\*|x)$/i, '').trim();
const isVersionCell = (cell: string): boolean =>
  /^v?\d+(?:\.\d+)*$/i.test(cellVersion(cell)) && parseVersion(cellVersion(cell)).length > 0;

/**
 * The column that holds the product's own versions: the header sharing the most words with
 * the product's id, name and aliases ("JS SDK", "Web map spec", "Arcade"), else the first.
 * `named` tells whether a header really names the product or the first column was assumed.
 */
function subjectOf(table: TextTable, product: Product): { column: number; named: boolean } {
  const vocabulary = words([product.id, product.name, ...product.aliases].join(' '));
  const related = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);
  let best = 0;
  let bestScore = 0;
  table.header.forEach((header, column) => {
    const score = words(header).filter((word) =>
      vocabulary.some((known) => related(known, word)),
    ).length;
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  });
  return { column: best, named: bestScore > 0 };
}

/** The column that holds the product's own versions (see {@link subjectOf}). */
export function subjectColumn(table: TextTable, product: Product): number {
  return subjectOf(table, product).column;
}

/** What {@link rowsFromTable} needs to know about the report being built. */
export interface CompatibilityContext {
  product: Product;
  /** Label of the table, used when a column has no header. */
  name: string;
  /** The page the table was read from. */
  source: string;
  /** The version the report is about: the requested one, else the current one. */
  target?: string;
  /** The current version; rows above it are `unreleased`. */
  current?: string;
  /** ISO date of the report; a row dated after it is `unreleased` whatever `current` says. */
  today?: string;
  /** Lower-case package and product names worth reporting from a name / version list. */
  wanted: ReadonlySet<string>;
}

/** One row of a matrix whose subject cell is a version. */
interface MatrixLine {
  cells: string[];
  /** The subject cell as written (`5.1.*`). */
  own: string;
  version: string;
  unreleased: boolean;
}

/** What a table says: pairings, and the product's own version when a column names it. */
export interface TableReading {
  rows: CompatibilityRow[];
  /** The subject-column version of the reported row. */
  own?: string;
}

/**
 * A version matrix: the reported row, every row above the current version, and for each
 * column the reported row leaves empty the newest earlier row that fills it.
 */
function matrixRows(table: TextTable, subject: number, about: CompatibilityContext): TableReading {
  const subjectHeader = table.header[subject] ?? about.product.name;
  const dateColumn = table.header.findIndex((header) => OWN_FACT_COLUMN.test(header));
  /**
   * A row dated later than the report describes a release that is still ahead. A date that
   * names only a month does not say whether the release has happened within that month, so
   * the current month counts as ahead: a version is never called released on a guess.
   */
  const dated = (cells: string[]): boolean => {
    const date = dateColumn < 0 ? undefined : parseDate(cells[dateColumn]);
    if (date === undefined || about.today === undefined) return false;
    const today = about.today.slice(0, date.length);
    return date.length < about.today.length ? date >= today : date > today;
  };
  const pairs = (column: number): boolean => {
    const header = table.header[column];
    return column !== subject && !(header !== undefined && OWN_FACT_COLUMN.test(header));
  };

  const lines: MatrixLine[] = [];
  for (const cells of table.rows) {
    const own = cells[subject] ?? '';
    if (!isVersionCell(own)) continue;
    const version = cellVersion(own);
    const ahead =
      about.current !== undefined && (compareAtSharedPrecision(version, about.current) ?? 0) > 0;
    lines.push({ cells, own, version, unreleased: ahead || dated(cells) });
  }
  const target = lines.find((line) =>
    about.target === undefined
      ? !line.unreleased
      : compareAtSharedPrecision(line.version, about.target) === 0,
  );

  const rows: CompatibilityRow[] = [];
  const add = (line: MatrixLine, column: number): void => {
    const cell = line.cells[column] ?? '';
    rows.push({
      with: table.header[column] ?? `${about.name} column ${column + 1}`,
      // The reported row speaks for the reported version; any other row names its own.
      value: line === target ? cell : `${cell} (with ${subjectHeader} ${line.own})`,
      unreleased: line.unreleased,
      source: about.source,
    });
  };
  const filled = (line: MatrixLine, column: number): boolean =>
    !EMPTY_CELL.test(line.cells[column] ?? '');
  const width = Math.max(table.header.length, ...lines.map((line) => line.cells.length));
  const columns = Array.from({ length: width }, (_unused, column) => column).filter(pairs);

  for (const line of lines) {
    if (line !== target && !line.unreleased) continue;
    for (const column of columns) if (filled(line, column)) add(line, column);
  }
  if (target !== undefined) {
    const earlier = lines
      .filter(
        (line) =>
          !line.unreleased && (compareAtSharedPrecision(line.version, target.version) ?? 0) < 0,
      )
      .sort((x, y) => compareAtSharedPrecision(y.version, x.version) ?? 0);
    for (const column of columns) {
      if (filled(target, column)) continue;
      const source = earlier.find((line) => filled(line, column));
      if (source !== undefined) add(source, column);
    }
  }
  return { rows, ...(target === undefined ? {} : { own: target.version }) };
}

/** A name / version list (the Pro Python environment): only the packages that matter here. */
function listRows(table: TextTable, about: CompatibilityContext): CompatibilityRow[] {
  const rows: CompatibilityRow[] = [];
  for (const cells of table.rows) {
    const name = cells[0] ?? '';
    const value = cells.slice(1).find(isVersionCell);
    if (value === undefined || !about.wanted.has(name.toLowerCase())) continue;
    rows.push({ with: name, value, unreleased: false, source: about.source });
  }
  return rows;
}

/**
 * Reads one table (see the module description). Pure. `own` is set only for a matrix one
 * of whose headers names the product: an assumed first column is not a statement about it.
 */
export function readTable(table: TextTable, about: CompatibilityContext): TableReading {
  const subject = subjectOf(table, about.product);
  const versioned = table.rows.filter((cells) =>
    isVersionCell(cells[subject.column] ?? ''),
  ).length;
  if (versioned * 2 < table.rows.length) {
    return { rows: listRows(table, about).slice(0, MAX_ROWS) };
  }
  const matrix = matrixRows(table, subject.column, about);
  return {
    rows: matrix.rows.slice(0, MAX_ROWS),
    ...(subject.named && matrix.own !== undefined ? { own: matrix.own } : {}),
  };
}

/** The compatibility rows of one table (see {@link readTable}). Pure. */
export function rowsFromTable(table: TextTable, about: CompatibilityContext): CompatibilityRow[] {
  return readTable(table, about).rows;
}

/** Names to pick out of a package list: Python itself, this product and its related products. */
function wantedNames(ctx: Ctx, product: Product): Set<string> {
  const names = new Set(['python']);
  const related = product.related
    .map((id) => ctx.registry.get(id))
    .filter((entry): entry is Product => entry !== undefined);
  for (const entry of [product, ...related]) {
    names.add(entry.id.toLowerCase());
    for (const ref of entry.packages) names.add(ref.name.toLowerCase());
  }
  for (const alias of product.aliases) names.add(alias.toLowerCase());
  return names;
}

/** Options of {@link readCompatibility}. */
export interface CompatibilityRequest {
  line?: VersionLine;
  target?: string;
  current?: string;
  call?: CallOptions;
}

/** Outcome of {@link readCompatibility}. */
export interface CompatibilityReading {
  rows: CompatibilityRow[];
  notices: string[];
  /** The product's own version as a matrix states it, and the page that does. */
  own?: { version: string; source: string };
}

/**
 * Fetches every page listed in `Product.compatibility` and extracts its rows. A page that
 * cannot be read contributes a notice instead of failing the report.
 */
export async function readCompatibility(
  ctx: Ctx,
  product: Product,
  request: CompatibilityRequest,
): Promise<CompatibilityReading> {
  const rows: CompatibilityRow[] = [];
  const notices: string[] = [];
  if (!ctx.policy.enabled('website')) return { rows, notices };
  const wanted = wantedNames(ctx, product);
  const today = new Date(ctx.clock.now()).toISOString().slice(0, 10);
  let own: CompatibilityReading['own'];

  for (const entry of product.compatibility ?? []) {
    const url = resolveUrl(entry.url, request.line);
    try {
      const res = await ctx.http.get({
        url,
        expect: 'html',
        ...(request.call?.budget === undefined ? {} : { budget: request.call.budget }),
        ...(request.call?.signal === undefined ? {} : { signal: request.call.signal }),
      });
      const page = ctx.render.render(
        'html',
        { html: res.text },
        {
          url: res.finalUrl,
          product: product.id,
          kind: 'guide',
          license: product.licenseTier,
          res,
        },
      );
      const table =
        largestTable(markdownTables(joinSections(page.sections))) ??
        // A renderer that flattened the table still leaves the markup to read.
        largestTable(htmlTables(res.text));
      if (table === undefined) {
        notices.push(`No compatibility table was found on ${url}; open it to check ${entry.name}.`);
        continue;
      }
      const reading = readTable(table, {
        product,
        name: entry.name,
        source: res.finalUrl,
        wanted,
        today,
        ...(request.target === undefined ? {} : { target: request.target }),
        ...(request.current === undefined ? {} : { current: request.current }),
      });
      rows.push(...reading.rows);
      if (reading.own !== undefined) own ??= { version: reading.own, source: res.finalUrl };
    } catch (error) {
      if (!isMcpDocError(error)) throw error;
      notices.push(`Compatibility table "${entry.name}" could not be read (${error.code}): ${url}`);
    }
  }
  return { rows: rows.slice(0, MAX_ROWS), notices, ...(own === undefined ? {} : { own }) };
}
