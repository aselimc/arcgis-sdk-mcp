/**
 * What makes a document pageable (design section 3.1): the cursor that continues a read,
 * and the splitting of code blocks that are larger than any budget.
 *
 * `fitSections` never cuts inside a block, which is right for a paragraph or a table and
 * wrong for a source file of a thousand lines: that is one block, and a read of it ignored
 * `max_tokens` altogether. Such a block is therefore divided, at line boundaries, into
 * several fenced blocks before it is paged. The pieces are of a fixed size, not of the size
 * of the budget, so that the offsets a cursor holds stay valid when a caller changes
 * `max_tokens` between two pages. Where pieces meet inside one page the seam is taken out
 * again, so a file that fits is returned as the one block it was.
 */
import { estimateTokens, joinSections, splitBlocks } from '../../core/budget.js';
import { encodeCursor } from '../../core/cursor.js';
import { shortHash } from '../../core/hash.js';
import { TOOLS } from '../../core/names.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { displaySections } from './display.js';

/** Largest piece of a divided code block, in characters (about 600 tokens of code). */
export const CHUNK_CHARS = 2000;

/**
 * Appended to the info string of every piece after the first; the invisible separator keeps
 * it from ever colliding with a real info string. Never part of a response.
 */
const CONTINUED = ` ${String.fromCodePoint(0x2063)}continued`;

const OPENING = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** Divides one fenced block when its code is longer than {@link CHUNK_CHARS}. */
function chunkBlock(block: string): string[] {
  const lines = block.split('\n');
  const opening = OPENING.exec(lines[0] ?? '');
  if (opening === null || block.length <= CHUNK_CHARS) return [block];
  const [, indent = '', marker = '```', info = ''] = opening;
  const last = lines.at(-1) ?? '';
  const closed = lines.length > 1 && last.trim() === marker;
  const body = lines.slice(1, closed ? -1 : undefined);

  const pieces: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of body) {
    if (current.length > 0 && size + line.length + 1 > CHUNK_CHARS) {
      pieces.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) pieces.push(current);
  if (pieces.length <= 1) return [block];
  // A piece that already carries the mark was divided before; dividing is idempotent.
  const base = info.endsWith(CONTINUED) ? info.slice(0, -CONTINUED.length) : info;
  return pieces.map((piece, position) =>
    [
      `${indent}${marker}${position === 0 ? info : `${base}${CONTINUED}`}`,
      ...piece,
      `${indent}${marker}`,
    ].join('\n'),
  );
}

/**
 * The sections with every oversized code block divided into pieces of at most
 * {@link CHUNK_CHARS}. Sections without such a block are returned as they are.
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
 * Takes the seams out of a page of text: pieces of one code block that ended up on the same
 * page become one block again, and a page that starts inside a block opens with a plain fence.
 */
export function mergeChunks(text: string): string {
  if (!text.includes(CONTINUED)) return text;
  const mark = CONTINUED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seam = new RegExp(`\\n {0,3}(\`{3,}|~{3,})\\n\\n {0,3}\\1[^\\n]*${mark}\\n`, 'g');
  return text.replace(seam, '\n').replaceAll(CONTINUED, '');
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
