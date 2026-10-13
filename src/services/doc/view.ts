/**
 * View rules of `arcgis_docs_read` (design section 3.5).
 *
 * - `auto`: everything when it fits the budget; otherwise the header block, the opening
 *   capped at a quarter of the budget, the outline and a suggestion for the next section.
 *   A document with nothing to outline is paged instead.
 * - `outline`: the structure only, at most 600 tokens.
 * - `full`: sections in order, continued from a character offset; cuts fall between
 *   sections, or inside an oversized one at a paragraph or fence boundary.
 */
import { estimateTokens, fitSections, joinSections } from '../../core/budget.js';
import { LEAD_SECTION_ID, outlineOf, type OutlineEntry } from '../../core/sections.js';
import type { DocPage, DocSection } from '../../core/types.js';

/** Upper bound of an outline. */
export const MAX_OUTLINE_TOKENS = 600;

/** Share of the budget the opening of a large document may take in `auto`. */
const LEAD_SHARE = 0.25;

/** Outline depth below the shallowest heading. */
const OUTLINE_DEPTH = 2;

/** A page listing more member sections than this shows their counts instead. */
const MEMBER_HEAVY = 25;

/** Smallest budget left for content after the header block. */
const MIN_CONTENT_TOKENS = 100;

/** What to render. */
export interface ViewRequest {
  page: DocPage;
  /** The sections to show: the whole document as displayed, or the resolved selection. */
  shown: readonly DocSection[];
  view: 'auto' | 'outline' | 'full';
  maxTokens: number;
  /** Character offset into `joinSections(shown)`; non-zero when continuing from a cursor. */
  offset: number;
}

/** The rendered body. */
export interface ViewResult {
  text: string;
  /** True when part of `shown` was left out. */
  truncated: boolean;
  /** Where the next page starts, when the view is paged and has more. */
  nextOffset?: number;
  /** A section worth reading next, when the view answered with an outline. */
  suggest?: string;
}

function joinParts(parts: ReadonlyArray<string | undefined>): string {
  return parts
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .join('\n\n');
}

function row(entry: OutlineEntry, top: number): string {
  const indent = '  '.repeat(Math.max(0, entry.level - top));
  const title = entry.title === '' ? 'Introduction' : entry.title;
  return `${indent}- \`${entry.id}\` ${title} (~${entry.tokens} tokens)`;
}

/**
 * The outline as text: one row per section with its id, title and the token size of its
 * subtree, two levels deep. A member-heavy API page lists member counts by kind instead of
 * every member; an outline over `maxTokens` drops to one level, then is cut with a count.
 */
export function renderOutline(
  page: DocPage,
  sections: readonly DocSection[],
  maxTokens: number,
): string {
  const budget = Math.min(maxTokens, MAX_OUTLINE_TOKENS);
  const memberIds = new Set((page.members ?? []).map((member) => member.id));
  const top = sections.filter((s) => s.level > 0).reduce((min, s) => Math.min(min, s.level), 6);
  const heading = 'Outline (pass an id as "section" to read that part):';

  let summary: string | undefined;
  const build = (depth: number): string[] => {
    let entries = outlineOf(sections, depth);
    const memberRows = entries.filter((entry) => memberIds.has(entry.id));
    if (memberRows.length > MEMBER_HEAVY) {
      entries = entries.filter((entry) => !memberIds.has(entry.id));
      const counts = new Map<string, number>();
      for (const member of page.members ?? [])
        counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1);
      const kinds = [...counts].map(([kind, count]) => `${count} ${kind}`).join(', ');
      summary = `Members: ${kinds}. Pass a member name as "section" to read one, or "members" for the index.`;
    }
    return entries.map((entry) => row(entry, top));
  };

  let rows = build(OUTLINE_DEPTH);
  const text = (): string => joinParts([heading, rows.join('\n'), summary]);
  if (estimateTokens(text()) > budget) rows = build(1);
  if (estimateTokens(text()) > budget) {
    const total = rows.length;
    while (rows.length > 1 && estimateTokens(text()) > budget) rows.pop();
    rows.push(`- ... ${total - rows.length} more sections; ask for one by its heading text`);
  }
  return text();
}

/** The largest section below the opening: the most likely next read after an outline. */
function largestSection(page: DocPage, sections: readonly DocSection[]): string | undefined {
  const memberIds = new Set((page.members ?? []).map((member) => member.id));
  const candidates = outlineOf(sections, OUTLINE_DEPTH).filter(
    (entry, position) => position > 0 && entry.id !== LEAD_SECTION_ID && !memberIds.has(entry.id),
  );
  // A section that is the whole document (a single top-level heading) is no narrowing.
  const whole = sections.reduce((sum, section) => sum + section.tokens, 0);
  return candidates.filter((entry) => entry.tokens < whole).sort((a, b) => b.tokens - a.tokens)[0]
    ?.id;
}

/** Renders one view of a page within `maxTokens`. */
export function renderView(request: ViewRequest): ViewResult {
  const { page, shown, view, maxTokens, offset } = request;
  const header = offset === 0 ? page.header?.trim() : undefined;
  const headerTokens = header === undefined || header === '' ? 0 : estimateTokens(header);
  const budget = Math.max(MIN_CONTENT_TOKENS, maxTokens - headerTokens);

  if (view === 'outline') {
    const suggest = largestSection(page, shown);
    return {
      text: joinParts([`# ${page.title}`, renderOutline(page, shown, maxTokens)]),
      truncated: false,
      ...(suggest === undefined ? {} : { suggest }),
    };
  }

  const whole = joinSections(shown);
  if (view === 'auto' && offset === 0) {
    if (estimateTokens(joinParts([header, whole])) <= maxTokens) {
      return { text: joinParts([header, whole]), truncated: false };
    }
    const suggest = largestSection(page, shown);
    const [lead] = shown;
    if (suggest !== undefined && lead !== undefined) {
      const opening = fitSections([lead], Math.floor(maxTokens * LEAD_SHARE)).text;
      const used = estimateTokens(joinParts([header, opening]));
      const outline = renderOutline(page, shown, Math.max(MIN_CONTENT_TOKENS, maxTokens - used));
      return { text: joinParts([header, opening, outline]), truncated: true, suggest };
    }
    // Nothing to choose between (one long section): fall through to paging.
  }

  const fit = fitSections(shown, budget, offset);
  return {
    text: joinParts([header, fit.text]),
    truncated: fit.nextOffset !== undefined,
    ...(fit.nextOffset === undefined ? {} : { nextOffset: fit.nextOffset }),
  };
}
