import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BR_PLACEHOLDER, escapeHtml, firstNonEmpty, squash, tagged, unwrap } from '../dom.js';
import type { Pass, PassCounters } from '../types.js';

/** Content a GFM table cell cannot hold. */
const BLOCKY = 'pre, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6';
const EDGE_BREAKS = new RegExp(`^(?:${BR_PLACEHOLDER}\\s*)+|(?:\\s*${BR_PLACEHOLDER})+$`, 'g');
/** Line-break marks separated by nothing but whitespace. */
const BREAK_RUNS = new RegExp(`\\s*${BR_PLACEHOLDER}(?:\\s*${BR_PLACEHOLDER})*\\s*`, 'g');
const BREAKS = new RegExp(BR_PLACEHOLDER, 'g');
/** Children that make the content of a cell a sequence of blocks. */
const BLOCK_CHILDREN = `p, div, section, figure, ${BLOCKY}`;
/** A first cell longer than this is prose, not the key of its row. */
const LABEL_MAX_CHARS = 80;
/** A key that is one bare name (`where`, `f`, `out_fields`, `layer.id`) is written as code. */
const IDENTIFIER = /^[\w$.[\]<>:*/#@-]+$/;

interface Grid {
  headerCells: Element[];
  headers: string[];
  body: Element[][];
  columns: number;
  hasHeader: boolean;
}

const cellsOf = ($: CheerioAPI, row: Element): Element[] => $(row).children('th, td').get();

function readGrid($: CheerioAPI, el: Element): Grid | undefined {
  const rows = $(el)
    .find('tr')
    .filter((_, row) => $(row).closest('table').get(0) === el)
    .get();
  const first = rows[0];
  if (first === undefined) return undefined;
  const firstCells = cellsOf($, first);
  // Generated reference tables (Sphinx list tables) have no header markup: their first row
  // is a header when every cell of it is bold from start to end.
  const allBold = (cell: Element): boolean => {
    const text = squash($(cell).text());
    return text !== '' && text === squash($(cell).find('strong, b').text());
  };
  const headRow =
    rows.find((row) => $(row).parent().is('thead')) ??
    (firstCells.length > 0 &&
    (firstCells.every((cell) => cell.tagName === 'th') ||
      (rows.length > 1 && firstCells.length > 1 && firstCells.every(allBold)))
      ? first
      : undefined);
  const headerCells = headRow === undefined ? [] : cellsOf($, headRow);
  const body = rows.filter((row) => row !== headRow).map((row) => cellsOf($, row));
  return {
    headerCells,
    headers: headerCells.map((cell) => squash($(cell).text())),
    body,
    columns: Math.max(headerCells.length, ...body.map((cells) => cells.length)),
    hasHeader: headRow !== undefined,
  };
}

/** A cell as one line of inline HTML: paragraphs and `<br>` become line-break placeholders. */
function inline($: CheerioAPI, cell: Element | undefined): string {
  if (cell === undefined) return '';
  const copy = $(cell).clone();
  copy.find('br').replaceWith(BR_PLACEHOLDER);
  // A block starts and ends a line: mark both edges, then merge the marks that meet.
  copy.find('p, div').each((_, block) => {
    $(block).prepend(BR_PLACEHOLDER).append(BR_PLACEHOLDER);
  });
  unwrap($, copy.find('p, div'));
  return (copy.html() ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(BREAK_RUNS, BR_PLACEHOLDER)
    .trim()
    .replace(EDGE_BREAKS, '');
}

function gfm($: CheerioAPI, grid: Grid): string {
  const pad = (cells: string[], tag: string): string[] => {
    while (cells.length < grid.columns) cells.push(`<${tag}></${tag}>`);
    return cells;
  };
  const head = pad(
    grid.headerCells.map((cell) => `<th>${inline($, cell)}</th>`),
    'th',
  );
  const rows = grid.body.map(
    (cells) =>
      `<tr>${pad(
        cells.map((cell) => `<td>${inline($, cell)}</td>`),
        'td',
      ).join('')}</tr>`,
  );
  return `<table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** A cell as one line of inline HTML for use outside a table: its line breaks become spaces. */
function inlineText($: CheerioAPI, cell: Element | undefined): string {
  return inline($, cell).replace(BREAKS, ' ');
}

/**
 * True when a first cell can head its row as one bold line: it holds no block content and is
 * a name or a short phrase. A cell with a code block, a list or a note, or a sentence of
 * prose, is content like any other cell; flattening it to a bold line would join the lines
 * of its code and put list markers and line-break marks into running text.
 */
function isLabel($: CheerioAPI, cell: Element | undefined): boolean {
  if (cell === undefined) return true;
  if ($(cell).find(BLOCKY).length > 0 || $(cell).find('img').length > 0) return false;
  const text = squash($(cell).text());
  return text.length <= LABEL_MAX_CHARS && !/[.!?]$/.test(text);
}

/** The content of a cell as blocks; bare inline content becomes a paragraph. */
function cellBlocks($: CheerioAPI, cell: Element | undefined): string {
  if (cell === undefined) return '';
  const html = ($(cell).html() ?? '').trim();
  if (html === '') return '';
  return $(cell).children(BLOCK_CHILDREN).length > 0 ? `<div>${html}</div>` : `<p>${html}</p>`;
}

function keyValueBullets($: CheerioAPI, grid: Grid): string {
  const items = grid.body.map(([key, value]) => {
    const term = inlineText($, key).replace(/\s*:\s*$/, '');
    // A line break inside a list item is a real one; the placeholder is for table cells only.
    return `<li><strong>${term}:</strong> ${inline($, value).replace(BREAKS, '<br>')}</li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

/**
 * Definition style: a bold key paragraph, then the value's block content untouched. A row
 * whose first cell is content rather than a key (see {@link isLabel}) is a layout row: its
 * cells follow each other as blocks.
 */
function definitionBlocks($: CheerioAPI, grid: Grid): string {
  const lead = grid.hasHeader ? `<p>${tagged('em', grid.headers.join(' / '))}</p>` : '';
  const rows = grid.body.map(([key, value]) => {
    if (!isLabel($, key)) return cellBlocks($, key) + cellBlocks($, value);
    const marked = key !== undefined && $(key).find('a, code').length > 0;
    const text = key === undefined ? '' : squash($(key).text());
    // A bare name is code; a phrase is text. Either way the key is one bold line.
    let term = escapeHtml(text);
    if (marked) term = inlineText($, key);
    else if (IDENTIFIER.test(text)) term = tagged('code', text);
    return `${term === '' ? '' : `<p><strong>${term}</strong></p>`}${value === undefined ? '' : ($(value).html() ?? '')}`;
  });
  return `<div>${lead}${rows.join('')}</div>`;
}

/**
 * Record list: a bold first cell, then one bullet per remaining column, labelled by header.
 * A row whose first cell holds block content has no one-line title: every cell of it is
 * written as blocks under its column header, and a rule closes the row.
 */
function recordLists($: CheerioAPI, grid: Grid): string {
  const labelOf = (index: number): string =>
    escapeHtml(firstNonEmpty(grid.headers[index], `Column ${index + 1}`));
  const rows = grid.body.map((cells) => {
    if (!isLabel($, cells[0])) {
      const parts = cells.map((cell, index) => {
        const content = cellBlocks($, cell);
        return content === '' ? '' : `<p><strong>${labelOf(index)}:</strong></p>${content}`;
      });
      return `${parts.join('')}<hr>`;
    }
    const title = inlineText($, cells[0]) || '(row)';
    const fields = cells
      .slice(1)
      .map(
        (cell, index) => `<li><strong>${labelOf(index + 1)}:</strong> ${$(cell).html() ?? ''}</li>`,
      );
    return `<p><strong>${title}</strong></p><ul>${fields.join('')}</ul>`;
  });
  return `<div>${rows.join('').replace(/<hr>$/, '')}</div>`;
}

function count(counters: PassCounters, strategy: string): void {
  counters.tables[strategy] = (counters.tables[strategy] ?? 0) + 1;
}

/**
 * Table normaliser. The GFM plugin keeps any table with block content as raw HTML, so every
 * table is rewritten into a shape that converts cleanly:
 *
 * - simple table: cells flattened to one line, short rows padded (`gfm`);
 * - simple headerless two-column table: `- **Key:** value` bullets (`key-value`);
 * - table with block content and two columns: definition blocks, so fenced code inside
 *   cells survives (`definition`);
 * - table with block content and three or more columns: one record list per row (`records`).
 *
 * In the last two shapes the first cell is the one-line key of its row only when it is one:
 * a first cell that holds a code block, a list, a note or a sentence of prose is written as
 * blocks like the other cells, so code keeps its lines and lists stay lists.
 *
 * A caption becomes a bold paragraph before the table. `colspan` and `rowspan` are ignored.
 */
export const fixTables: Pass = ($, env) => {
  // Innermost first, so that a nested table is rewritten before its parent is classified.
  for (const el of $('table').get().reverse()) {
    const table = $(el);
    table.find('caption').each((_, caption) => {
      if ($(caption).closest('table').get(0) !== el) return;
      const text = squash($(caption).text());
      if (text !== '') table.before(`<p>${tagged('strong', text)}</p>`);
      $(caption).remove();
    });
    table.find('colgroup, col').remove();

    const grid = readGrid($, el);
    if (grid === undefined) {
      table.remove();
      continue;
    }
    const complex = grid.body.some((cells) =>
      cells.some((cell) => $(cell).find(BLOCKY).length > 0),
    );
    if (!complex && !grid.hasHeader && grid.columns === 2) {
      count(env.counters, 'key-value');
      table.replaceWith(keyValueBullets($, grid));
    } else if (!complex) {
      count(env.counters, 'gfm');
      table.replaceWith(gfm($, grid));
    } else if (grid.columns === 2) {
      count(env.counters, 'definition');
      table.replaceWith(definitionBlocks($, grid));
    } else {
      count(env.counters, 'records');
      table.replaceWith(recordLists($, grid));
    }
  }
};
