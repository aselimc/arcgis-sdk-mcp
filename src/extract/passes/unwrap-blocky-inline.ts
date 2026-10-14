import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { isElement, unwrap } from '../dom.js';
import type { Pass } from '../types.js';

/** True for a text node that holds nothing but whitespace. */
function isBlankText(node: AnyNode): boolean {
  // `type` is an enum of the parser package; its values are plain strings.
  const type: string = node.type;
  return type === 'text' && 'data' in node && node.data.trim() === '';
}

/** The nearest sibling in a direction that is not whitespace-only text. */
function sibling(node: AnyNode, direction: 'prev' | 'next'): AnyNode | null {
  let current = node[direction];
  while (current !== null && isBlankText(current)) current = current[direction];
  return current;
}

const isParagraph = (node: AnyNode | null): node is Element =>
  isElement(node) && node.tagName === 'p';

/**
 * A link written around a paragraph (`<p>See <a><p>the guide</p></a>.</p>` in the page
 * source) is split by the HTML parser into three siblings, which Markdown would print as a
 * link broken over several lines between two orphan paragraphs. The link text is made
 * inline again and the link rejoins the paragraph it was cut out of, together with the
 * punctuation that followed it.
 */
function inlineParagraphLinks($: CheerioAPI): void {
  const links = $('a[href]').filter((_, link) => {
    const children = $(link).children();
    return children.length > 0 && children.not('p').length === 0;
  });
  links.each((_, link) => {
    const $link = $(link);
    $link.children('p').each((position, paragraph) => {
      if (position > 0) $(paragraph).before(' ');
    });
    unwrap($, $link.children('p'));

    const before = sibling(link, 'prev');
    if (!isParagraph(before)) return;
    const after = sibling(link, 'next');
    const $before = $(before);
    if (!/\s$/.test($before.text())) $before.append(' ');
    $before.append($link);
    // Only a paragraph that continues the sentence belongs to it; a new sentence stays apart.
    if (isParagraph(after) && /^\s*[.,;:!?)]/.test($(after).text())) {
      $before.append($(after).contents());
      $(after).remove();
    }
  });
}

const BLOCKS = 'p, div, section, article, header, footer, figure, ul, ol, li, blockquote';

/**
 * A link around any other block content (`<a><div><img></div><div>text</div></a>`) would
 * print as `[`, the blocks on lines of their own, and `](url)`. Its blocks are opened, with
 * a space where one ended, so the link is one line again.
 */
function inlineBlockLinks($: CheerioAPI): void {
  $('a[href]')
    .filter((_, link) => $(link).find(BLOCKS).length > 0)
    .each((_, link) => {
      // Innermost first: an outer block is replaced by contents that are already inline.
      for (const block of $(link).find(BLOCKS).get().reverse()) {
        const $block = $(block);
        if (block.next !== null) $block.after(' ');
        $block.replaceWith($block.contents());
      }
    });
}

/** Emphasis inside emphasis of the same kind, outermost first. */
const NESTED_EMPHASIS = ['em em, em i, i em, i i', 'strong strong, strong b, b strong, b b'];

/**
 * Inline elements wrapped around block content cannot be written in Markdown. Emphasis
 * around blocks (`<em><p>...</p></em>`) leaves stray `_` lines, so the emphasis is dropped
 * and the blocks stay; a link around blocks keeps the link and loses the blocks.
 *
 * Emphasis of one kind inside the same kind adds nothing a reader sees, and Markdown cannot
 * nest it: `<em>a <em>b</em> c</em>` would print `_a _b_ c_`, which closes early. The inner
 * element goes.
 */
export const unwrapBlockyInline: Pass = ($) => {
  unwrap(
    $,
    $('em, i, strong, b').filter(
      (_, el) => $(el).find('p, div, ul, ol, pre, table, blockquote').length > 0,
    ),
  );
  for (const nested of NESTED_EMPHASIS) unwrap($, $(nested));
  inlineParagraphLinks($);
  inlineBlockLinks($);
};
