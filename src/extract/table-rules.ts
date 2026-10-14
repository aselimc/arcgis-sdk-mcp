/**
 * Linear-time Turndown rules for plain tables.
 *
 * The GFM plugin's table rules read `table.rows` inside loops (the alignment vote of every
 * column, the column count of every heading row). Turndown's DOM answers `rows` with a live
 * list that walks the table again on every index, so one table costs columns x rows^2 node
 * visits: 250 rows took a second, 4 000 rows minutes, and conversion is synchronous, so a
 * long reference table blocked the process.
 *
 * Every table the pipeline converts has already been rewritten by `fixTables` into a plain
 * grid (one header row, inline cells). These rules take over such tables, reading each one
 * once; a table they do not recognise as plain (block content or a nested table in a cell,
 * a single cell) is left to the plugin, which keeps or flattens it as before.
 */
import type TurndownService from 'turndown';

/** The part of Turndown's DOM these rules read. */
interface TableNode {
  nodeName: string;
  nodeType: number;
  childNodes: ArrayLike<TableNode>;
  parentNode: TableNode | null;
  previousSibling: TableNode | null;
  textContent: string | null;
  getAttribute?(name: string): string | null;
}

/** What one reading of a plain table found. */
interface PlainTable {
  /** Most cells in one row. */
  columns: number;
  /** Markdown border of each column (`---`, `:---`, `---:`, `:---:`). */
  borders: string[];
  /** The row that heads the table, when it has one. */
  heading?: TableNode;
  /** Index of every cell in its row. */
  cellIndex: Map<TableNode, number>;
}

const ELEMENT = 1;
const SECTIONS = new Set(['THEAD', 'TBODY', 'TFOOT']);
const CELLS = new Set(['TH', 'TD']);
/** Content that makes the plugin keep a table as HTML or flatten it. */
const NOT_PLAIN = new Set('TABLE PRE UL OL H1 H2 H3 H4 H5 H6 HR BLOCKQUOTE'.split(' '));
const ALIGN_BORDER: Record<string, string> = { left: ':---', right: '---:', center: ':---:' };

const asNode = (node: unknown): TableNode => node as TableNode;
const elementsOf = (node: TableNode): TableNode[] =>
  Array.from(node.childNodes).filter((child) => child.nodeType === ELEMENT);

/** True when an element or any of its descendants is block content a cell cannot hold. */
function holdsBlocks(node: TableNode): boolean {
  const stack = elementsOf(node);
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (NOT_PLAIN.has(current.nodeName)) return true;
    stack.push(...elementsOf(current));
  }
  return false;
}

/** Alignment of a cell: its `align` attribute, else the `text-align` of its style. */
function alignmentOf(cell: TableNode): string {
  const align = cell.getAttribute?.('align') ?? '';
  if (align !== '') return align.toLowerCase();
  const style = cell.getAttribute?.('style') ?? '';
  return (/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i.exec(style)?.[1] ?? '').toLowerCase();
}

/** The rows of a table in order: its own and those of its sections. */
function rowsOf(table: TableNode): TableNode[] {
  return elementsOf(table).flatMap((child) => {
    if (child.nodeName === 'TR') return [child];
    return SECTIONS.has(child.nodeName)
      ? elementsOf(child).filter((row) => row.nodeName === 'TR')
      : [];
  });
}

/**
 * The heading row as the plugin defines it: the first row of a `thead`, or the first row of
 * the table or of its first section when every cell of it is a `th`.
 */
function headingRow(table: TableNode, rows: readonly TableNode[]): TableNode | undefined {
  const first = rows[0];
  if (first === undefined) return undefined;
  if (first.parentNode?.nodeName === 'THEAD') return first;
  const cells = elementsOf(first);
  const allHeaders = cells.length > 0 && cells.every((cell) => cell.nodeName === 'TH');
  const opensTable =
    first.parentNode === table ||
    elementsOf(table).find((child) => SECTIONS.has(child.nodeName)) === first.parentNode;
  return allHeaders && opensTable ? first : undefined;
}

/** The text of a table's caption, which the plugin writes as a line above the table. */
function captionOf(table: TableNode): string {
  const caption = elementsOf(table).find((child) => child.nodeName === 'CAPTION');
  return (caption?.textContent ?? '').trim();
}

/** Reads a table once; `undefined` when it is not plain. */
function readTable(table: TableNode): PlainTable | undefined {
  const rows = rowsOf(table);
  const cellIndex = new Map<TableNode, number>();
  const votes: Array<Record<string, number>> = [];
  let columns = 0;
  for (const row of rows) {
    const cells = elementsOf(row).filter((cell) => CELLS.has(cell.nodeName));
    columns = Math.max(columns, cells.length);
    for (const [index, cell] of cells.entries()) {
      if (holdsBlocks(cell)) return undefined;
      cellIndex.set(cell, index);
      const vote = (votes[index] ??= {});
      const alignment = alignmentOf(cell);
      vote[alignment] = (vote[alignment] ?? 0) + 1;
    }
  }
  // A table of one cell is not a table; the plugin writes its content as paragraphs.
  if (rows.length === 0 || (rows.length === 1 && columns <= 1)) return undefined;
  const borders = Array.from({ length: columns }, (_, index) => {
    const vote = votes[index] ?? {};
    // The most frequent alignment wins; ties go to the one seen first, as in the plugin.
    let best = '';
    for (const [alignment, count] of Object.entries(vote)) {
      if (count > (vote[best] ?? 0)) best = alignment;
    }
    return ALIGN_BORDER[best] ?? '---';
  });
  const heading = headingRow(table, rows);
  return { columns, borders, cellIndex, ...(heading === undefined ? {} : { heading }) };
}

/** The table an element belongs to, `undefined` when it is outside one. */
function tableOf(node: TableNode): TableNode | undefined {
  for (let parent = node.parentNode; parent !== null; parent = parent.parentNode) {
    if (parent.nodeName === 'TABLE') return parent;
  }
  return undefined;
}

/** One Markdown cell; `first` opens the row with its pipe. */
function cellText(content: string, first: boolean, colspan: number): string {
  let text = content.trim().replace(/\n\r?/g, '<br>').replace(/\|+/g, '\\|');
  text = text.padEnd(3, ' ');
  for (let extra = 1; extra < colspan; extra += 1) text += ' |    ';
  return `${first ? '| ' : ' '}${text} |`;
}

/** The line under the heading row: one border per column. */
function borderRow(plain: PlainTable): string {
  return plain.borders.map((line, index) => cellText(line, index === 0, 1)).join('');
}

/**
 * Adds the table rules to a converter that already uses the GFM plugin; added later, they
 * are asked first.
 */
export function addLinearTableRules(service: TurndownService): void {
  const tables = new WeakMap<TableNode, PlainTable | null>();
  const plainOf = (table: TableNode | undefined): PlainTable | undefined => {
    if (table === undefined) return undefined;
    let known = tables.get(table);
    if (known === undefined) {
      known = readTable(table) ?? null;
      tables.set(table, known);
    }
    return known ?? undefined;
  };

  service.addRule('linearTableCell', {
    filter: (node) =>
      CELLS.has(asNode(node).nodeName) && plainOf(tableOf(asNode(node))) !== undefined,
    replacement: (content, node) => {
      const cell = asNode(node);
      const index = plainOf(tableOf(cell))?.cellIndex.get(cell) ?? 0;
      const colspan = Number(cell.getAttribute?.('colspan') ?? '1');
      return cellText(content, index === 0, Number.isFinite(colspan) ? colspan : 1);
    },
  });

  service.addRule('linearTableRow', {
    filter: (node) =>
      asNode(node).nodeName === 'TR' && plainOf(tableOf(asNode(node))) !== undefined,
    replacement: (content, node) => {
      const plain = plainOf(tableOf(asNode(node)));
      if (plain?.heading !== asNode(node)) return `\n${content}`;
      return `\n${content}\n${borderRow(plain)}`;
    },
  });

  service.addRule('linearTable', {
    filter: (node) => asNode(node).nodeName === 'TABLE' && plainOf(asNode(node)) !== undefined,
    replacement: (content, node) => {
      const plain = plainOf(asNode(node));
      if (plain === undefined) return content;
      const body = content.replace(/\n+/g, '\n');
      // A table without a heading row gets an empty one: Markdown has no headerless table.
      const empty =
        plain.heading === undefined
          ? `|${'     |'.repeat(plain.columns)}\n${borderRow(plain)}`
          : '';
      const caption = captionOf(asNode(node));
      const table = `${empty}${body}`.trimStart();
      return `\n\n${caption === '' ? '' : `${caption}\n\n`}${table}\n\n`;
    },
  });
}
