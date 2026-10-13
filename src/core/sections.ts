/**
 * Markdown to sections. Every renderer and the HTML pipeline end here, so section ids,
 * hierarchy and token estimates mean the same thing for every document.
 */
import { estimateTokens } from './budget.js';
import { stepFence, type OpenFence } from './fences.js';
import type { DocSection } from './types.js';
import { slugify } from './url.js';

/** Id of a lead section that has no heading of its own. */
export const LEAD_SECTION_ID = '_lead';

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
/** `## Title {#custom-id}`: an explicit anchor wins over the slug of the text. */
const EXPLICIT_ID = /\s*\{#([A-Za-z0-9_.:-]+)\}\s*$/;
const BYTE_ORDER_MARK = /^\uFEFF/;
/** A private-use character that cannot occur in documentation text; brackets parked escapes. */
const PARK = '\uE000';
const PARKED = /\uE000(\d+)\uE000/g;

/** Heading text without inline Markdown: link targets, images, code ticks, emphasis, raw tags. */
function plainTitle(raw: string): string {
  // Backslash-escaped punctuation is literal text: park it so the passes below cannot read
  // it as markup, then put the bare characters back.
  const literals: string[] = [];
  const parked = raw.replace(/\\([\\`*_{}[\]()#+.!|~<>-])/g, (_whole, char: string) => {
    literals.push(char);
    return `${PARK}${literals.length - 1}${PARK}`;
  });
  return parked
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`+/g, '')
    .replace(/(\*\*|__|\*|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(PARKED, (_whole, index: string) => literals[Number(index)] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Draft {
  level: number;
  title: string;
  explicitId?: string;
  lines: string[];
}

/** Cuts the text at every ATX heading that is outside a code fence. */
function draftSections(md: string): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft = { level: 0, title: '', lines: [] };
  let open: OpenFence;

  for (const line of md.replace(BYTE_ORDER_MARK, '').replace(/\r\n?/g, '\n').split('\n')) {
    const step = stepFence(line, open);
    open = step.open;
    const heading = step.fenced ? null : ATX_HEADING.exec(line);
    if (heading === null) {
      current.lines.push(line);
      continue;
    }
    drafts.push(current);
    const rawTitle = heading[2] ?? '';
    const explicitId = EXPLICIT_ID.exec(rawTitle)?.[1];
    current = {
      level: (heading[1] ?? '#').length,
      title: plainTitle(rawTitle.replace(EXPLICIT_ID, '')),
      lines: [line],
      ...(explicitId === undefined ? {} : { explicitId }),
    };
  }
  drafts.push(current);
  return drafts;
}

/**
 * Splits Markdown into flat sections at ATX headings (`#` to `######`), ignoring headings
 * inside code fences.
 *
 * - Each section's `markdown` starts with its heading line and ends before the next heading
 *   of any level; surrounding blank lines are removed.
 * - Text before the first heading becomes a lead section with id {@link LEAD_SECTION_ID},
 *   level 0 and an empty title. Whitespace-only leads are dropped.
 * - Ids are `slugify(title)`, or the explicit `{#id}` suffix when the heading has one;
 *   repeated ids get `-1`, `-2`, ... in document order.
 * - `parent` is the nearest earlier section with a smaller, non-zero level.
 * - `tokens` estimates the section's own `markdown`, not its descendants.
 */
export function sectionsFromMarkdown(md: string): DocSection[] {
  const sections: DocSection[] = [];
  const used = new Map<string, number>();
  /** Open ancestors, outermost first. */
  const stack: Array<{ id: string; level: number }> = [];

  for (const draft of draftSections(md)) {
    const markdown = draft.lines
      .join('\n')
      .replace(/^(?:[ \t]*\n)+/, '')
      .trimEnd();
    if (markdown === '') continue;

    const base = draft.level === 0 ? LEAD_SECTION_ID : (draft.explicitId ?? slugify(draft.title));
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;

    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= draft.level) stack.pop();
    const parent = draft.level === 0 ? undefined : stack.at(-1)?.id;
    if (draft.level > 0) stack.push({ id, level: draft.level });

    sections.push({
      id,
      level: draft.level,
      title: draft.title,
      markdown,
      tokens: estimateTokens(markdown),
      ...(parent === undefined ? {} : { parent }),
    });
  }
  return sections;
}

/**
 * The section with the given id followed by all of its descendants, in document order.
 * This is what "read section X" returns. A lead section without a heading has no
 * descendants. Empty when the id is unknown.
 */
export function sectionSubtree(sections: readonly DocSection[], id: string): DocSection[] {
  const start = sections.findIndex((section) => section.id === id);
  const root = sections[start];
  if (root === undefined) return [];
  const subtree = [root];
  if (root.level === 0) return subtree;
  for (const section of sections.slice(start + 1)) {
    if (section.level <= root.level) break;
    subtree.push(section);
  }
  return subtree;
}

/** One outline row. `tokens` covers the section **and its descendants**. */
export interface OutlineEntry {
  id: string;
  title: string;
  level: number;
  tokens: number;
}

/**
 * The outline of a document: one row per section in document order, each with the token
 * size of its whole subtree, which is what reading that section would cost.
 *
 * @param maxDepth keep only sections at most this many levels below the shallowest heading
 *   (1 = top level only). Deeper sections still count towards their ancestors' `tokens`.
 */
export function outlineOf(sections: readonly DocSection[], maxDepth?: number): OutlineEntry[] {
  const top = sections
    .filter((section) => section.level > 0)
    .reduce((min, section) => Math.min(min, section.level), 6);
  return sections
    .filter(
      (section) => maxDepth === undefined || section.level === 0 || section.level - top < maxDepth,
    )
    .map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      tokens: sectionSubtree(sections, section.id).reduce((sum, part) => sum + part.tokens, 0),
    }));
}
