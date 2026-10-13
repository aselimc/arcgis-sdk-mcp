/**
 * Token budgeting (design section 3.1). Text is cut only at section, paragraph, fence or
 * table boundaries, and a cut is always resumable from a character offset.
 */
import { stepFence, type OpenFence } from './fences.js';
import type { DocSection } from './types.js';

/** Separator between blocks and between sections in the canonical text. */
const BLOCK_SEPARATOR = '\n\n';

/** Character counts of a text: total, and the part inside code fences (fence lines included). */
function measure(text: string): { chars: number; fenced: number } {
  let fenced = 0;
  let open: OpenFence;
  for (const line of text.split('\n')) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.fenced) fenced += line.length + 1;
  }
  return { chars: text.length, fenced: Math.min(fenced, text.length) };
}

function tokensFor(chars: number, fenced: number): number {
  // Code tokenises less efficiently than prose, so code-heavy text gets the smaller divisor.
  return Math.ceil(chars / (fenced * 2 > chars ? 3.5 : 4));
}

/**
 * Estimated token count of a text: `ceil(chars / 4)`, or `ceil(chars / 3.5)` when more than
 * half of it is inside code fences.
 */
export function estimateTokens(text: string): number {
  const { chars, fenced } = measure(text);
  return tokensFor(chars, fenced);
}

/**
 * Splits Markdown into the atomic blocks that a budget cut may fall between: paragraphs,
 * lists and tables separated by blank lines, and whole code fences (blank lines inside a
 * fence do not split it; an unclosed fence runs to the end). Blocks carry no surrounding
 * blank lines; joining them with a blank line gives the normalised text.
 */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let open: OpenFence;
  const flush = (): void => {
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const wasOpen = open !== undefined;
    open = stepFence(line, open).open;
    // Lines are kept verbatim: trailing spaces are Markdown hard line breaks.
    if (!wasOpen && open === undefined && line.trim() === '') flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

/**
 * The canonical text of a section list: every block of every section, joined by one blank
 * line. Offsets used by {@link fitSections} and stored in cursors index into this string.
 */
export function joinSections(sections: readonly DocSection[]): string {
  return sections.flatMap((section) => splitBlocks(section.markdown)).join(BLOCK_SEPARATOR);
}

/** Result of {@link fitSections}. */
export interface FitResult {
  /** The page: a slice of the canonical text that starts and ends on block boundaries. */
  text: string;
  /** `estimateTokens(text)`. */
  used: number;
  /** Offset to continue from; absent when the page reaches the end. */
  nextOffset?: number;
  /** Id of the section the cut falls inside; absent when the cut is between sections or there is none. */
  cutInside?: string;
}

const HEADING_ONLY = /^ {0,3}#{1,6}[ \t]+\S.*$/;

/**
 * Fills one page of at most `maxTokens` from the canonical text of `sections`, starting at
 * character offset `startOffset` (0, or a `nextOffset` from an earlier page).
 *
 * Guarantees:
 * - a code fence or table is never split, because cuts fall only between blocks;
 * - successive pages joined with a blank line equal `joinSections(sections)` exactly;
 * - every page holds at least one block, so paging always terminates. A single block larger
 *   than the budget is returned whole, which is the only case where `used > maxTokens`;
 * - a page does not end on a bare heading when its content would start the next page.
 *
 * An offset that is not on a block boundary (a stale or altered cursor) moves forward to
 * the next boundary; an offset at or past the end gives an empty page.
 */
export function fitSections(
  sections: readonly DocSection[],
  maxTokens: number,
  startOffset = 0,
): FitResult {
  const blocks: Array<{ text: string; start: number; section: string; first: boolean }> = [];
  let offset = 0;
  for (const section of sections) {
    splitBlocks(section.markdown).forEach((text, index) => {
      blocks.push({ text, start: offset, section: section.id, first: index === 0 });
      offset += text.length + BLOCK_SEPARATOR.length;
    });
  }

  const from = blocks.findIndex((block) => block.start >= startOffset);
  if (from === -1) return { text: '', used: 0 };

  let chars = 0;
  let fenced = 0;
  let end = from;
  for (; end < blocks.length; end++) {
    const block = blocks[end];
    if (block === undefined) break;
    const size = measure(block.text);
    const nextChars = chars + size.chars + (end > from ? BLOCK_SEPARATOR.length : 0);
    if (end > from && tokensFor(nextChars, fenced + size.fenced) > maxTokens) break;
    chars = nextChars;
    fenced += size.fenced;
  }

  // Keep a heading with the content it introduces rather than stranding it at a page end.
  const last = blocks[end - 1];
  if (end < blocks.length && end - from > 1 && last !== undefined && HEADING_ONLY.test(last.text)) {
    end -= 1;
  }

  const text = blocks
    .slice(from, end)
    .map((block) => block.text)
    .join(BLOCK_SEPARATOR);
  const result: FitResult = { text, used: estimateTokens(text) };
  const next = blocks[end];
  if (next !== undefined) {
    result.nextOffset = next.start;
    if (!next.first) result.cutInside = next.section;
  }
  return result;
}

/**
 * A complete tool call as copyable text: `arcgis_docs_read({"ref":"...","section":"..."})`.
 * Properties whose value is `undefined` are omitted. This is the format of every `next`
 * string in service responses and error details.
 */
export function formatCall(tool: string, args: Record<string, unknown>): string {
  return `${tool}(${JSON.stringify(args)})`;
}

/**
 * The `Next:` line that must end a truncated response: the call that returns the rest.
 *
 * @example truncationNext('arcgis_docs_read', { ref, cursor })
 * // 'Next: arcgis_docs_read({"ref":"https://...","cursor":"eyJ2Ijox..."})'
 */
export function truncationNext(tool: string, args: Record<string, unknown>): string {
  return `Next: ${formatCall(tool, args)}`;
}
