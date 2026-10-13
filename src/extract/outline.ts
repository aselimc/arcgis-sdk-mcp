/**
 * The outline of a page, taken before anything is cleaned. Every outline element is stamped
 * with its final section id and level, so the ids of a sliced read equal the ids of a full
 * read and the slicer does not have to know what a family uses as a heading.
 */
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { slugify } from '../core/url.js';
import { headingLevel, ID_ATTR, squash } from './dom.js';
import type { OutlineNode, PageView } from './types.js';

/** Attribute carrying the outline level of a stamped element. */
export const LEVEL_ATTR = 'data-md-level';

/** How a family finds its section headings. The default is plain `h1` to `h6`. */
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

const HEADINGS: OutlineRule = { selector: 'h1, h2, h3, h4, h5, h6' };

/**
 * Collects the outline elements below the content root and stamps each with {@link ID_ATTR}
 * and {@link LEVEL_ATTR}. An element without an id of its own gets a slug of its text;
 * repeated ids get `-1`, `-2`, ... in document order, as `sectionsFromMarkdown` numbers them.
 */
export function stampOutline(page: PageView, rule: OutlineRule = HEADINGS): OutlineNode[] {
  const { $, root } = page;
  const used = new Map<string, number>();
  const nodes: OutlineNode[] = [];
  root.find(rule.selector).each((_, el) => {
    const level = rule.level?.(el, $) ?? headingLevel(el);
    const title = squash(rule.title?.(el, $) ?? $(el).text());
    if (level === 0 || title === '') return;
    const own = (rule.id?.(el, $) ?? $(el).attr('id') ?? '').trim();
    const base = own === '' ? slugify(title) : own;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    $(el).attr(ID_ATTR, id).attr(LEVEL_ATTR, String(level));
    const alias = rule.alias?.(el, $);
    nodes.push({ id, title, level, el, ...(alias === undefined ? {} : { alias }) });
  });
  return nodes;
}
