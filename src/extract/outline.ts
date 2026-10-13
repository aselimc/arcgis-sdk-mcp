/**
 * The outline of a page, taken before anything is cleaned. Every outline element is stamped
 * with its final section id and level, so the ids of a sliced read equal the ids of a full
 * read and the slicer does not have to know what a family uses as a heading.
 */
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { slugify } from '../core/url.js';
import { findIn, headingLevel, ID_ATTR, squash } from './dom.js';
import { IdAllocator } from './id-allocator.js';
import type { OutlineNode, PageView } from './types.js';

/** Attribute carrying the outline level of a stamped element. */
export const LEVEL_ATTR = 'data-md-level';

/** How a family finds its section headings, or elements it will turn into headings. */
export interface OutlineRule {
  selector: string;
  /** Level of an element; default: its heading level. Return 0 to skip the element. */
  level?(element: Element, $: CheerioAPI): number;
  /** Page id of an element; default: its `id` attribute. */
  id?(element: Element, $: CheerioAPI): string | undefined;
  /** Heading text; default: the element's text. */
  title?(element: Element, $: CheerioAPI): string;
  /** A second id the section answers to (an opaque anchor that in-page links use). */
  alias?(element: Element, $: CheerioAPI): string | undefined;
}

/** Plain `h1` to `h6`. */
export const HEADINGS: OutlineRule = { selector: 'h1, h2, h3, h4, h5, h6' };

/**
 * True for the `href` of a link that wraps a heading and leads elsewhere: such a heading is
 * the title of a card, which the link pass turns into a list item, not a section of the page.
 */
function isCardTitle(href: string | undefined): boolean {
  return href !== undefined && !href.startsWith('#');
}

/**
 * Collects the outline elements below the content root, in document order, and stamps each
 * with {@link ID_ATTR} and {@link LEVEL_ATTR}. An element matches the first rule whose
 * selector fits it; without rules, plain headings are used.
 *
 * An element without an id of its own gets a slug of its text, and repeated ids are
 * numbered. The id of the page title is reserved for the opening heading the pipeline
 * writes, and the page's own title heading is not part of the outline. Neither is the
 * heading of a card (a link around a heading): it would take the id of a real section.
 */
export function stampOutline(page: PageView, ...rules: OutlineRule[]): OutlineNode[] {
  const { $, root } = page;
  const active = rules.length === 0 ? [HEADINGS] : rules;
  const ids = new IdAllocator();
  ids.reserve(slugify(page.title));
  const nodes: OutlineNode[] = [];
  findIn($, root, active.map((rule) => rule.selector).join(', ')).each((_, el) => {
    const rule = active.find((candidate) => $(el).is(candidate.selector));
    if (rule === undefined) return;
    const level = rule.level?.(el, $) ?? headingLevel(el);
    const title = squash(rule.title?.(el, $) ?? $(el).text());
    if (level === 0 || title === '') return;
    if (level === 1 && title === page.title) return;
    if (isCardTitle($(el).closest('a[href]').attr('href'))) return;
    const own = (rule.id?.(el, $) ?? $(el).attr('id') ?? '').trim();
    const id = ids.next(own === '' ? slugify(title) : own);
    $(el).attr(ID_ATTR, id).attr(LEVEL_ATTR, String(level));
    const alias = rule.alias?.(el, $);
    nodes.push({ id, title, level, el, ...(alias === undefined ? {} : { alias }) });
  });
  return nodes;
}
