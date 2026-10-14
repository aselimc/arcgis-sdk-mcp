/**
 * What makes a document pageable: the cursor that continues a read, and the division of
 * blocks that are larger than any budget.
 *
 * `fitSections` never cuts inside a block, which is right for a paragraph and wrong for a
 * source file of a thousand lines, a release-notes list of a thousand items or a long HTML
 * table: each is one block, and a read of it would ignore `max_tokens`. Such a block is
 * therefore divided, at line boundaries, into pieces before it is paged. A piece that starts
 * inside a code fence reopens it and the piece before closes it; a piece that starts inside
 * a table repeats the table's header row. The pieces are of a fixed size, not of the size of
 * the budget, so that the offsets a cursor holds stay valid when a caller changes
 * `max_tokens` between two pages. Where pieces meet inside one page the seam is taken out
 * again ({@link mergeChunks}), so a block that fits is returned exactly as it was.
 */
import { estimateTokens, joinSections, splitBlocks } from '../../core/budget.js';
import { encodeCursor } from '../../core/cursor.js';
import { stepFence, type OpenFence } from '../../core/fences.js';
import { shortHash } from '../../core/hash.js';
import { TOOLS } from '../../core/names.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { displaySections } from './display.js';

/**
 * Largest piece of a divided block, in characters: about 250 tokens of prose, below the
 * smallest `max_tokens` any tool accepts.
 */
export const CHUNK_CHARS = 1000;

/**
 * Marks the seams between pieces. A piece that continues a block starts with the line
 * `<MARK>open:<k>` (with `:inline` when it continues a line that was too long for one
 * piece), followed by the k lines it repeats (a fence opener, a table header); a piece that
 * is continued ends with the k lines it adds (a fence closer) and the line `<MARK>close:<k>`.
 * The invisible separators keep the marks from colliding with real text. Never part of a
 * response: {@link mergeChunks} removes them.
 */
const MARK = '\u2063\u2063chunk:';
const OPEN_LINE = /^\u2063\u2063chunk:open:(\d+)(:inline)?$/;
const CLOSE_LINE = /^\u2063\u2063chunk:close:(\d+)$/;

const FENCE_OPENING = /^( {0,3})(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HTML_TABLE_OPEN = /<table\b/gi;
const HTML_TABLE_CLOSE = /<\/table\s*>/gi;

/** One unit a piece is built from: a line, or a part of a line too long for one piece. */
interface Unit {
  text: string;
  /** True when the unit continues the line of the unit before it. */
  inline: boolean;
  /** Lines a piece starting at this unit repeats from before it. */
  reopen: readonly string[];
  /** Lines a piece ending just before this unit adds after its text. */
  close: readonly string[];
  /** Whether a cut before this unit keeps a list item or paragraph line whole. */
  clean: boolean;
}

/** The opening of an HTML table up to and including its first row. */
function htmlTableHead(fromTable: string): string {
  const end = /<\/tr\s*>/i.exec(fromTable);
  return end === null ? fromTable : fromTable.slice(0, end.index + end[0].length);
}

function countOf(line: string, pattern: RegExp): number {
  return line.match(pattern)?.length ?? 0;
}

/** A line of more than {@link CHUNK_CHARS} in parts, cut after a space or comma where there is one. */
function lineParts(line: string): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > CHUNK_CHARS) {
    const window = rest.slice(0, CHUNK_CHARS);
    const space = Math.max(window.lastIndexOf(' '), window.lastIndexOf(','));
    const cut = space > CHUNK_CHARS / 2 ? space + 1 : CHUNK_CHARS;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

/** The units of a block, each with what a cut before it must repeat and add. */
function unitsOf(lines: readonly string[]): Unit[] {
  const units: Unit[] = [];
  let open: OpenFence;
  let fenceOpener = '';
  let tableHeader: string[] | undefined;
  let htmlHead = '';
  let htmlDepth = 0;
  lines.forEach((line, position) => {
    let reopen: string[] = [];
    let close: string[] = [];
    if (open !== undefined) {
      reopen = [fenceOpener];
      close = [`${FENCE_OPENING.exec(fenceOpener)?.[1] ?? ''}${open}`];
    } else if (htmlDepth > 0) {
      reopen = [htmlHead];
      close = ['</table>'];
    } else if (tableHeader !== undefined && TABLE_ROW.test(line)) {
      reopen = tableHeader;
    }
    const clean = open !== undefined || !/^\s/.test(line) || LIST_ITEM.test(line);
    lineParts(line).forEach((text, part) => {
      units.push({ text, inline: part > 0, reopen, close, clean: part === 0 && clean });
    });

    // The state after this line.
    const wasOpen = open !== undefined;
    open = stepFence(line, open).open;
    if (!wasOpen && open !== undefined) fenceOpener = line;
    if (wasOpen || open !== undefined) return;
    if (!TABLE_ROW.test(line)) tableHeader = undefined;
    else if (tableHeader === undefined && TABLE_DELIMITER.test(lines[position + 1] ?? '')) {
      tableHeader = [line, lines[position + 1] ?? ''];
    }
    if (!line.trimStart().startsWith('<')) return;
    const opens = countOf(line, HTML_TABLE_OPEN);
    if (htmlDepth === 0 && opens > 0) htmlHead = htmlTableHead(line.slice(line.search(/<table\b/i)));
    htmlDepth = Math.max(0, htmlDepth + opens - countOf(line, HTML_TABLE_CLOSE));
  });
  return units;
}

/** Where to cut the units into pieces of about {@link CHUNK_CHARS}: the first unit of each later piece. */
function cutsOf(units: readonly Unit[]): number[] {
  const cuts: number[] = [];
  let start = 0;
  let size = 0;
  units.forEach((unit, index) => {
    if (index > start && size + unit.text.length + 1 > CHUNK_CHARS) {
      // A clean cut in the second half of the piece, else here.
      let cut = index;
      while (cut > start && units[cut]?.clean !== true) cut -= 1;
      if (cut - start < (index - start) / 2) cut = index;
      cuts.push(cut);
      start = cut;
      size = units.slice(cut, index).reduce((sum, u) => sum + u.text.length + 1, 0);
    }
    size += unit.text.length + 1;
  });
  return cuts;
}

/** Divides one block when it is longer than {@link CHUNK_CHARS}. */
function chunkBlock(block: string): string[] {
  // A block that carries a mark was divided before: dividing is idempotent.
  if (block.length <= CHUNK_CHARS || block.includes(MARK)) return [block];
  const units = unitsOf(block.split('\n'));
  const cuts = cutsOf(units);
  if (cuts.length === 0) return [block];

  const bounds = [0, ...cuts, units.length];
  const pieces: string[] = [];
  for (let piece = 0; piece + 1 < bounds.length; piece++) {
    const from = bounds[piece] ?? 0;
    const to = bounds[piece + 1] ?? units.length;
    const head = units[from];
    const tail = units[to];
    const lines: string[] = [];
    if (piece > 0 && head !== undefined) {
      lines.push(`${MARK}open:${head.reopen.length}${head.inline ? ':inline' : ''}`);
      lines.push(...head.reopen);
    }
    let text = '';
    units.slice(from, to).forEach((unit, position) => {
      if (position > 0 && !unit.inline) {
        lines.push(text);
        text = '';
      }
      text += unit.text;
    });
    lines.push(text);
    if (tail !== undefined) lines.push(...tail.close, `${MARK}close:${tail.close.length}`);
    pieces.push(lines.join('\n'));
  }
  return pieces;
}

/**
 * The sections with every oversized block divided into pieces of about {@link CHUNK_CHARS}.
 * Sections without such a block are returned as they are.
 */
export function chunkFences(sections: readonly DocSection[]): DocSection[] {
  return sections.map((section) => {
    if (section.markdown.length <= CHUNK_CHARS) return section;
    const blocks = splitBlocks(section.markdown);
    const divided = blocks.flatMap(chunkBlock);
    if (divided.length === blocks.length) return section;
    const markdown = divided.join('\n\n');
    return { ...section, markdown, tokens: estimateTokens(markdown) };
  });
}

/**
 * Takes the seams out of a page of text: pieces of one block that ended up on the same page
 * become one block again, a page that ends inside a block closes what the block opened, and
 * a page that starts inside one repeats its fence opener or table header.
 */
export function mergeChunks(text: string): string {
  if (!text.includes(MARK)) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const close = CLOSE_LINE.exec(line);
    if (close !== null) {
      const open = lines[index + 1] === '' ? OPEN_LINE.exec(lines[index + 2] ?? '') : null;
      if (open !== null) {
        // A seam: drop what this piece added and what the next one repeats.
        out.length -= Math.min(out.length, Number(close[1]));
        index += 2 + Number(open[1]);
        if (open[2] !== undefined && index + 1 < lines.length) {
          index += 1;
          out.push(`${out.pop() ?? ''}${lines[index] ?? ''}`);
        }
      }
      continue;
    }
    if (!OPEN_LINE.test(line)) out.push(line);
  }
  return out.join('\n');
}

/** The sections `arcgis_docs_read` pages over when no section is selected. */
export function pagedSections(page: DocPage, scope: 'default' | 'all'): DocSection[] {
  return chunkFences(displaySections(page, scope));
}

/** The key that ties a read cursor to its document and selection. */
export function readKey(pageRef: string, selected: string | undefined): string {
  return shortHash(JSON.stringify([pageRef.replace(/#.*$/, ''), selected ?? '']));
}

/** The validator of a read cursor: the text it pages over, so a changed page restarts. */
export function readValidator(shown: readonly DocSection[]): string {
  return shortHash(joinSections(shown));
}

/** The cursor that continues a read of `shown` at a character offset. */
export function readCursor(
  pageRef: string,
  selected: string | undefined,
  shown: readonly DocSection[],
  offset: number,
): string {
  return encodeCursor({
    v: 1,
    t: TOOLS.read,
    k: readKey(pageRef, selected),
    e: readValidator(shown),
    o: offset,
  });
}
