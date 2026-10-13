/**
 * Table readers for the compatibility pages: GitHub-flavoured Markdown tables as the HTML
 * renderer emits them, and the raw `<table>` markup as the fallback of research section 8.2.
 */

/** A table as text: one header row and the data rows, cells trimmed. */
export interface TextTable {
  header: string[];
  rows: string[][];
}

/**
 * Removes inline Markdown from a cell: links keep their text, paired emphasis and code marks
 * go, backslash escapes are resolved. A lone `*` or `_` is literal (`5.1.*`, `arcgis_maps`).
 */
function plainCell(cell: string): string {
  const escaped: string[] = [];
  return (
    cell
      // Park escaped characters so that `5.1.\*` is not read as the start of emphasis.
      // The marker is a private-use character, which no documentation page contains.
      .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_whole, char: string) => {
        escaped.push(char);
        return `\uE000${escaped.length - 1}\uE000`;
      })
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, '$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\uE000(\d+)\uE000/g, (_whole, index: string) => escaped[Number(index)] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Splits a Markdown table line on unescaped pipes, without the outer ones. */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map(plainCell);
}

const isRowLine = (line: string | undefined): line is string =>
  line?.trim().startsWith('|') === true;
const isSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Every GFM table of a Markdown document, in order. */
export function markdownTables(markdown: string): TextTable[] {
  const lines = markdown.split('\n');
  const tables: TextTable[] = [];
  let index = 0;
  while (index < lines.length) {
    const headerLine = lines[index];
    const separator = lines[index + 1];
    if (!isRowLine(headerLine) || separator === undefined || !isSeparator(separator)) {
      index += 1;
      continue;
    }
    const rows: string[][] = [];
    index += 2;
    for (let line = lines[index]; isRowLine(line); line = lines[index]) {
      rows.push(splitRow(line));
      index += 1;
    }
    tables.push({ header: splitRow(headerLine), rows });
  }
  return tables;
}

const ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>' };

function htmlCellText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every `<table>` of an HTML document; the first row is taken as the header. */
export function htmlTables(html: string): TextTable[] {
  const tables: TextTable[] = [];
  for (const table of html.match(/<table\b[\s\S]*?<\/table\s*>/gi) ?? []) {
    const rows = (table.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) ?? []).map((row) =>
      [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((cell) =>
        htmlCellText(cell[1] ?? ''),
      ),
    );
    const [header, ...body] = rows.filter((row) => row.length > 0);
    if (header !== undefined) tables.push({ header, rows: body });
  }
  return tables;
}

/** The table with the most rows among those with at least two columns: the page's matrix. */
export function largestTable(tables: readonly TextTable[]): TextTable | undefined {
  let best: TextTable | undefined;
  for (const table of tables) {
    if (table.header.length < 2 || table.rows.length === 0) continue;
    if (best === undefined || table.rows.length > best.rows.length) best = table;
  }
  return best;
}
