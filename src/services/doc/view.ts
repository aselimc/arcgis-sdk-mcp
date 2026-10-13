/**
 * View rules of `arcgis_docs_read` (design section 3.5).
 *
 * - `auto`: everything when it fits the budget; otherwise the header block, the opening
 *   capped at a quarter of the budget, the outline and a suggestion for the next section.
 *   A document with nothing to outline is paged instead, and so is a section asked for by
 *   name whose own text does not fit the opening.
 * - `outline`: the structure only, at most 600 tokens unless the caller set a budget of its
 *   own; sections that do not fit are still named, by id.
 * - `full`: sections in order, continued from a character offset; cuts fall between
 *   sections, or inside an oversized one at a paragraph or fence boundary.
 */
import { estimateTokens, fitSections, joinSections } from '../../core/budget.js';
import { LEAD_SECTION_ID, outlineOf, type OutlineEntry } from '../../core/sections.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { mergeChunks } from './paging.js';

/** Upper bound of an outline whose size the caller did not choose. */
export const MAX_OUTLINE_TOKENS = 600;

/** Share of an outline's budget kept for the bare ids of the rows it has no room for. */
const ID_SHARE = 1 / 3;

/** Share of the budget the opening of a large document may take in `auto`. */
const LEAD_SHARE = 0.25;

/** A section this small is a heading without text of its own. */
const BARE_HEADING_TOKENS = 30;

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
  /** True when `shown` is one section the caller asked for by name. */
  selected?: boolean;
  /**
   * Budget of `view: "outline"` when the caller passed `max_tokens` itself; the default is
   * {@link MAX_OUTLINE_TOKENS}.
   */
  outlineTokens?: number;
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
 * every member; an outline over the budget drops to one level, then gives the rows that
 * still do not fit as bare ids on one line. A section is never left unnamed: an id the
 * agent cannot see is a part of the document it cannot ask for.
 *
 * @param limit the cap of the outline; `maxTokens` applies below it.
 */
export function renderOutline(
  page: DocPage,
  sections: readonly DocSection[],
  maxTokens: number,
  limit: number = MAX_OUTLINE_TOKENS,
): string {
  const budget = Math.min(maxTokens, limit);
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
  if (estimateTokens(text()) > budget) {
    // One level is only worth showing when the document has several top-level sections.
    const shallow = build(1);
    if (shallow.length > 2) rows = shallow;
  }
  if (estimateTokens(text()) > budget) {
    const all = rows;
    const ids = all.map((line) => /`([^`]+)`/.exec(line)?.[1] ?? '');
    const whole = 'pass max_tokens with view "outline" for all of them';
    const more = (kept: number, named: readonly string[]): string => {
      const dropped = all.length - kept;
      if (named.length === 0) return `- ... ${dropped} more sections; ${whole}`;
      const list = named.map((id) => `\`${id}\``).join(', ');
      const unnamed = dropped - named.length;
      return `- ... ${dropped} more sections: ${list}${unnamed > 0 ? ` and ${unnamed} more; ${whole}` : ''}`;
    };
    // Full rows first, with a share of the budget kept for the ids of the rows that go.
    const reserve = Math.floor(budget * ID_SHARE);
    let kept = all.length;
    do {
      kept -= 1;
      rows = [...all.slice(0, kept), more(kept, [])];
    } while (kept > 1 && estimateTokens(text()) > budget - reserve);
    let named = ids.slice(kept).filter((id) => id !== '');
    for (;;) {
      rows = [...all.slice(0, kept), more(kept, named)];
      if (named.length === 0 || estimateTokens(text()) <= budget) break;
      named = named.slice(0, Math.floor(named.length * 0.8));
    }
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
  const narrower = candidates.filter((entry) => entry.tokens < whole);
  // One section below a bare title is no choice either: a source file under its name.
  if (candidates.length === 1 && sections.length === 2) return undefined;
  return narrower.sort((a, b) => b.tokens - a.tokens)[0]?.id;
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
      text: joinParts([
        `# ${page.title}`,
        renderOutline(page, shown, maxTokens, request.outlineTokens ?? MAX_OUTLINE_TOKENS),
      ]),
      truncated: false,
      ...(suggest === undefined ? {} : { suggest }),
    };
  }

  const whole = joinSections(shown);
  if (view === 'auto' && offset === 0) {
    if (estimateTokens(joinParts([header, whole])) <= maxTokens) {
      return { text: joinParts([header, mergeChunks(whole)]), truncated: false };
    }
    const suggest = largestSection(page, shown);
    const [lead, second] = shown;
    if (suggest !== undefined && lead !== undefined) {
      // A lead that is only its heading says nothing: the section below it is the opening.
      const bare = lead.tokens <= BARE_HEADING_TOKENS && second !== undefined;
      const opening = fitSections(
        bare ? [lead, second] : [lead],
        Math.floor(maxTokens * LEAD_SHARE),
      );
      // A section asked for by name whose own text is cut is paged instead: its outline
      // lists only the sub-sections, which would leave the rest of that text unreachable.
      if (request.selected !== true || opening.cutInside !== lead.id) {
        const used = estimateTokens(joinParts([header, opening.text]));
        const outline = renderOutline(page, shown, Math.max(MIN_CONTENT_TOKENS, maxTokens - used));
        return {
          text: joinParts([header, mergeChunks(opening.text), outline]),
          truncated: true,
          suggest,
        };
      }
    }
    // Nothing to choose between (one long section): fall through to paging.
  }

  const fit = fitSections(shown, budget, offset);
  return {
    text: joinParts([header, mergeChunks(fit.text)]),
    truncated: fit.nextOffset !== undefined,
    ...(fit.nextOffset === undefined ? {} : { nextOffset: fit.nextOffset }),
  };
}
