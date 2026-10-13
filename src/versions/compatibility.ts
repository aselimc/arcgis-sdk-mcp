/**
 * Compatibility pairings from Esri's own tables (research section 3): the JavaScript
 * version matrix, the Experience Builder release table, the Arcade version matrix and the
 * package list of ArcGIS Pro's Python environment. The page is converted by the HTML
 * renderer and its largest table is read; rows for versions above the current one are kept
 * and flagged `unreleased`, because these matrices list releases ahead of time.
 */
import { joinSections } from '../core/budget.js';
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { Product, VersionLine } from '../core/types.js';
import { parseVersion } from '../core/version-key.js';
import { resolveUrl } from './oracles/kit.js';
import { htmlTables, largestTable, markdownTables, type TextTable } from './tables.js';
import { compareAtSharedPrecision } from './version-text.js';

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
 */
export function subjectColumn(table: TextTable, product: Product): number {
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
  return best;
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
  /** Lower-case package and product names worth reporting from a name / version list. */
  wanted: ReadonlySet<string>;
}

/** A version matrix: the target row, plus every row above the current version. */
function matrixRows(
  table: TextTable,
  subject: number,
  about: CompatibilityContext,
): CompatibilityRow[] {
  const subjectHeader = table.header[subject] ?? about.product.name;
  const rows: CompatibilityRow[] = [];
  let targetSeen = false;
  for (const cells of table.rows) {
    const own = cells[subject] ?? '';
    if (!isVersionCell(own)) continue;
    const version = cellVersion(own);
    const unreleased =
      about.current !== undefined && (compareAtSharedPrecision(version, about.current) ?? 0) > 0;
    const isTarget: boolean =
      !targetSeen &&
      (about.target === undefined
        ? !unreleased
        : compareAtSharedPrecision(version, about.target) === 0);
    if (!isTarget && !unreleased) continue;
    targetSeen ||= isTarget;
    cells.forEach((cell, column) => {
      const header = table.header[column];
      if (column === subject || EMPTY_CELL.test(cell)) return;
      if (header !== undefined && OWN_FACT_COLUMN.test(header)) return;
      rows.push({
        with: header ?? `${about.name} column ${column + 1}`,
        // The target row speaks for the reported version; any other row names its own.
        value: isTarget ? cell : `${cell} (with ${subjectHeader} ${own})`,
        unreleased,
        source: about.source,
      });
    });
  }
  return rows;
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

/** Reads one table as compatibility rows (see the module description). Pure. */
export function rowsFromTable(table: TextTable, about: CompatibilityContext): CompatibilityRow[] {
  const subject = subjectColumn(table, about.product);
  const versioned = table.rows.filter((cells) => isVersionCell(cells[subject] ?? '')).length;
  const rows =
    versioned * 2 >= table.rows.length ? matrixRows(table, subject, about) : listRows(table, about);
  return rows.slice(0, MAX_ROWS);
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

/**
 * Fetches every page listed in `Product.compatibility` and extracts its rows. A page that
 * cannot be read contributes a notice instead of failing the report.
 */
export async function readCompatibility(
  ctx: Ctx,
  product: Product,
  request: CompatibilityRequest,
): Promise<{ rows: CompatibilityRow[]; notices: string[] }> {
  const rows: CompatibilityRow[] = [];
  const notices: string[] = [];
  if (!ctx.policy.enabled('website')) return { rows, notices };
  const wanted = wantedNames(ctx, product);

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
      rows.push(
        ...rowsFromTable(table, {
          product,
          name: entry.name,
          source: res.finalUrl,
          wanted,
          ...(request.target === undefined ? {} : { target: request.target }),
          ...(request.current === undefined ? {} : { current: request.current }),
        }),
      );
    } catch (error) {
      if (!isMcpDocError(error)) throw error;
      notices.push(`Compatibility table "${entry.name}" could not be read (${error.code}): ${url}`);
    }
  }
  return { rows: rows.slice(0, MAX_ROWS), notices };
}
