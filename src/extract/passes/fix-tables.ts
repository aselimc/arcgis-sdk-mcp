import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BR_PLACEHOLDER, escapeHtml, squash, tagged } from '../dom.js';
import type { Pass, PassCounters } from '../types.js';

/** Content a GFM table cell cannot hold. */
const BLOCKY = 'pre, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6';
const EDGE_BREAKS = new RegExp(`^(?:${BR_PLACEHOLDER}\\s*)+|(?:\\s*${BR_PLACEHOLDER})+$`, 'g');

interface Grid {
  table: Cheerio<Element>;
  headerCells: Element[];
  headers: string[];
  body: Element[][];
  columns: number;
  hasHeader: boolean;
}

const cellsOf = ($: CheerioAPI, row: Element): Element[] => $(row).children('th, td').get();

function readGrid($: CheerioAPI, el: Element): Grid | undefined {
  const table = $(el);
  const rows = table
    .find('tr')
    .filter((_, row) => $(row).closest('table').get(0) === el)
    .get();
  const first = rows[0];
  if (first === undefined) return undefined;
  const firstCells = cellsOf($, first);
  const headRow =
    rows.find((row) => $(row).parent().is('thead')) ??
    (firstCells.length > 0 && firstCells.every((cell) => cell.tagName === 'th')
      ? first
      : undefined);
  const headerCells = headRow === undefined ? [] : cellsOf($, headRow);
  const body = rows.filter((row) => row !== headRow).map((row) => cellsOf($, row));
  return {
    table,
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
  // Deepest first, so that a wrapper's HTML already has its inner blocks flattened.
  for (const block of copy.find('p, div').get().reverse()) {
    const $block = $(block);
    if ($block.next().length > 0) $block.append(BR_PLACEHOLDER);
    $block.replaceWith($block.contents());
  }
  return (copy.html() ?? '')
    .replace(/\s*\n\s*/g, ' ')
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

function keyValueBullets($: CheerioAPI, grid: Grid): string {
  const items = grid.body.map(([key, value]) => {
    const term = inline($, key).replace(/\s*:\s*$/, '');
    return `<li><strong>${term}:</strong> ${inline($, value)}</li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

/** Definition style: a bold key paragraph, then the value's block content untouched. */
function definitionBlocks($: CheerioAPI, grid: Grid): string {
  const lead = grid.hasHeader ? `<p>${tagged('em', grid.headers.join(' / '))}</p>` : '';
  const rows = grid.body.map(([key, value]) => {
    const marked = key !== undefined && $(key).find('a, code').length > 0;
    const term = marked ? inline($, key) : tagged('code', squash($(key).text()));
    return `<p><strong>${term}</strong></p>${value === undefined ? '' : ($(value).html() ?? '')}`;
  });
  return `<div>${lead}${rows.join('')}</div>`;
}

/** Record list: a bold first cell, then one bullet per remaining column, labelled by header. */
function recordLists($: CheerioAPI, grid: Grid): string {
  const rows = grid.body.map((cells) => {
    const title = inline($, cells[0]) || '(row)';
    const fields = cells.slice(1).map((cell, index) => {
      const label = grid.headers[index + 1] || `Column ${index + 2}`;
      return `<li><strong>${escapeHtml(label)}:</strong> ${$(cell).html() ?? ''}</li>`;
    });
    return `<p><strong>${title}</strong></p><ul>${fields.join('')}</ul>`;
  });
  return `<div>${rows.join('')}</div>`;
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
    const complex = grid.body.some((cells) => cells.some((cell) => $(cell).find(BLOCKY).length > 0));
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
