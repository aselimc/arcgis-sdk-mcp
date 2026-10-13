/**
 * Markdown to `DocSection[]` with the ids the page itself uses. `sectionsFromMarkdown` knows
 * only heading text; the heading rule of `turndown.ts` leaves a marker on every heading, and
 * this module trades the marker for the id the element had in the page, so `url#anchor`
 * and section ids agree.
 */
import { estimateTokens } from '../core/budget.js';
import { LEAD_SECTION_ID, sectionsFromMarkdown } from '../core/sections.js';
import type { DocSection } from '../core/types.js';
import { slugify } from '../core/url.js';
import { IdAllocator } from './id-allocator.js';
import { HEADING_MARK, HEADING_MARKS, type Converted } from './turndown.js';

/** Removes every heading marker from converted Markdown that is not split into sections. */
export function stripHeadingMarks(markdown: string): string {
  return markdown.replace(HEADING_MARKS, '');
}

/**
 * Splits converted Markdown into flat sections. A section's id is the page id of its heading
 * when it had one, else a slug of the title; repeated ids get `-1`, `-2`, ... in document
 * order. `parent` links and token estimates are recomputed for the final ids and text.
 */
export function buildSections(converted: Converted): DocSection[] {
  const ids = new IdAllocator();
  const renamed = new Map<string, string>();
  return sectionsFromMarkdown(converted.markdown).map((section) => {
    const firstLine = section.markdown.split('\n', 1)[0] ?? '';
    const mark = section.level > 0 ? HEADING_MARK.exec(firstLine) : null;
    const pageId = mark === null ? undefined : converted.headingIds[Number(mark[1])];
    const title = stripHeadingMarks(section.title).trim();
    const markdown = stripHeadingMarks(section.markdown);

    const base = section.level === 0 ? LEAD_SECTION_ID : (pageId ?? slugify(title));
    const id = ids.next(base);
    renamed.set(section.id, id);

    const parent = section.parent === undefined ? undefined : renamed.get(section.parent);
    return {
      id,
      level: section.level,
      title,
      markdown,
      tokens: estimateTokens(markdown),
      ...(parent === undefined ? {} : { parent }),
    };
  });
}
