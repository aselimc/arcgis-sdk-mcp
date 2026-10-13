/**
 * The last step of every structured renderer: explicit blocks become flat `DocSection`s with
 * stable ids, the selector is applied, and the page gets its provenance and diagnostics.
 */
import { estimateTokens } from '../core/budget.js';
import { McpDocError } from '../core/errors.js';
import { stepFence, type OpenFence } from '../core/fences.js';
import type { RenderMeta, RenderOptions, SectionSelector } from '../core/ports.js';
import { pageProvenance } from '../core/provenance.js';
import { LEAD_SECTION_ID, sectionSubtree, sectionsFromMarkdown } from '../core/sections.js';
import type { DocPage, DocSection, MemberEntry, SourceFile } from '../core/types.js';
import { slugify } from '../core/url.js';
import { headingText, shiftHeadings } from './md.js';

/**
 * One section as a renderer writes it. Unlike Markdown parsed by `sectionsFromMarkdown`, a
 * block names its own id, which is how a member section gets the member's anchor
 * (`queryFeatures`, `event-arcgisReady`) instead of a lower-cased slug.
 */
export interface Block {
  /** Section id; default `slugify(title)`, or the lead id for level 0. */
  id?: string;
  /** Heading level 1 to 6, or 0 for text without a heading. */
  level: number;
  title: string;
  /** Heading text when it differs from `title` (already Markdown). */
  heading?: string;
  /** Markdown below the heading. Headings inside it become child sections. */
  body: string;
}

/** What a renderer hands to {@link finishPage}. */
export interface PageParts {
  title: string;
  header?: string;
  sections: DocSection[];
  members?: MemberEntry[];
  files?: SourceFile[];
  relevantApis?: string[];
  breadcrumb?: string;
  /** Messages for the reader, for example that a declaration is shown unparsed. */
  notices?: string[];
  /** Input node types the renderer did not know; reported as `diagnostics.unknownIslands`. */
  unknown?: string[];
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 1; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** Sets `parent` to the nearest earlier section with a smaller, non-zero level. */
function linkParents(sections: DocSection[]): DocSection[] {
  const stack: Array<{ id: string; level: number }> = [];
  return sections.map((section) => {
    const { parent: _old, ...rest } = section;
    if (section.level === 0) return rest;
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= section.level) stack.pop();
    const parent = stack.at(-1)?.id;
    stack.push({ id: section.id, level: section.level });
    return parent === undefined ? rest : { ...rest, parent };
  });
}

/**
 * Converts blocks to flat sections in document order.
 *
 * - A block's id is kept as given; ids derived from titles, and ids of headings found inside
 *   a body, get `-1`, `-2`, ... when they collide with an earlier id.
 * - Headings inside a body are moved below the block's level and split off as child
 *   sections, so `markdown` always ends before the next heading (the `DocSection` contract).
 * - A block with neither heading nor body is dropped.
 */
export function buildSections(input: readonly Block[]): DocSection[] {
  const used = new Set<string>();
  // Explicit ids are reserved first so that a derived id can never take a member's anchor.
  for (const block of input) if (block.id !== undefined) used.add(block.id);
  const explicitSeen = new Set<string>();
  const sections: DocSection[] = [];

  for (const block of input) {
    const body = block.level === 0 ? block.body : shiftHeadings(block.body, block.level + 1);
    const parts = sectionsFromMarkdown(body);
    const lead = parts[0]?.level === 0 ? (parts.shift()?.markdown ?? '') : '';
    const heading =
      block.level === 0
        ? ''
        : `${'#'.repeat(block.level)} ${block.heading ?? headingText(block.title)}`;
    const markdown = [heading, lead].filter((part) => part !== '').join('\n\n');

    if (markdown !== '') {
      let id: string;
      if (block.id !== undefined && !explicitSeen.has(block.id)) {
        id = block.id;
        explicitSeen.add(id);
      } else {
        id = uniqueId(
          block.id ?? (block.level === 0 ? LEAD_SECTION_ID : slugify(block.title)),
          used,
        );
      }
      sections.push({
        id,
        level: block.level,
        title: block.title,
        markdown,
        tokens: estimateTokens(markdown),
      });
    }
    for (const child of parts) {
      sections.push({ ...child, id: uniqueId(child.id, used) });
    }
  }
  return linkParents(sections);
}

/**
 * Applies a selector with the exact-match semantics of `SectionSelector`: a known section id
 * gives that section and its descendants, a known member name or id gives the member's
 * section, anything else leaves the sections untouched.
 */
export function selectSections(
  sections: DocSection[],
  members: readonly MemberEntry[] | undefined,
  select: SectionSelector | undefined,
): DocSection[] {
  if (select?.section !== undefined) {
    const subtree = sectionSubtree(sections, select.section);
    if (subtree.length > 0) return subtree;
  }
  if (select?.member !== undefined) {
    const wanted = select.member;
    const member = members?.find((entry) => entry.id === wanted || entry.name === wanted);
    const subtree = sectionSubtree(sections, member?.id ?? wanted);
    if (subtree.length > 0) return subtree;
  }
  return sections;
}

const HTML_TAG =
  /<\/?(?:div|span|table|thead|tbody|tr|td|th|p|a|ul|ol|li|pre|code|img|h[1-6]|section|article|dl|dt|dd|details|summary|em|strong|b|i|u|sup|sub|font|center)\b[^>]*>/gi;

interface TextStats {
  fences: number;
  fencesWithLanguage: number;
  tables: number;
  htmlTags: number;
}

/** Counts fences, GFM tables and raw HTML tags (outside code) in rendered Markdown. */
function measure(markdown: string): TextStats {
  const stats: TextStats = { fences: 0, fencesWithLanguage: 0, tables: 0, htmlTags: 0 };
  let open: OpenFence;
  for (const line of markdown.split('\n')) {
    const before = open;
    const step = stepFence(line, open);
    open = step.open;
    if (before === undefined && open !== undefined) {
      stats.fences += 1;
      if (line.trim().replace(/^[`~]+/, '') !== '') stats.fencesWithLanguage += 1;
    }
    if (step.fenced) continue;
    if (/^\|(?: *:?-{3,}:? *\|)+\s*$/.test(line.trim())) stats.tables += 1;
    stats.htmlTags += (line.replace(/`[^`]*`/g, '').match(HTML_TAG) ?? []).length;
  }
  return stats;
}

/**
 * Assembles the `DocPage` of a structured renderer: provenance from `pageProvenance(meta)`,
 * the selector applied to the sections, and diagnostics measured on the final text.
 */
export function finishPage(
  renderer: string,
  meta: RenderMeta,
  parts: PageParts,
  opts?: RenderOptions,
): DocPage {
  const sections = selectSections(parts.sections, parts.members, opts?.select);
  const stats = measure(
    [parts.header ?? '', ...sections.map((section) => section.markdown)].join('\n\n'),
  );
  return {
    ...pageProvenance(meta),
    title: parts.title,
    ...(parts.breadcrumb === undefined ? {} : { breadcrumb: parts.breadcrumb }),
    ...(parts.header === undefined || parts.header === '' ? {} : { header: parts.header }),
    sections,
    ...(parts.members === undefined ? {} : { members: parts.members }),
    ...(parts.files === undefined ? {} : { files: parts.files }),
    ...(parts.relevantApis === undefined ? {} : { relevantApis: parts.relevantApis }),
    diagnostics: {
      family: 'structured',
      renderer,
      fences: stats.fences,
      fencesWithLanguage: stats.fencesWithLanguage,
      tablesByStrategy: stats.tables === 0 ? {} : { gfm: stats.tables },
      unknownIslands: [...new Set(parts.unknown ?? [])],
      leftoverHtmlTags: stats.htmlTags,
      redirectHops: meta.res?.aliasChain.length ?? 0,
      ms: 0,
    },
    notices: parts.notices ?? [],
  };
}

/**
 * The error for input a renderer cannot use at all (not an object, the named entry is
 * absent). Upstream content of the wrong shape is a missing document, as in the HTTP
 * contract; the caller can fall back to the HTML page.
 */
export function invalidInput(renderer: string, meta: RenderMeta, why: string): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', `No ${renderer} content could be read for ${meta.url}`, {
    why,
    url: meta.url,
  });
}
