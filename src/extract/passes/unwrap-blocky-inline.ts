import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { isElement, unwrap } from '../dom.js';
import type { Pass } from '../types.js';

/** The nearest sibling in a direction that is not whitespace-only text. */
function sibling(node: AnyNode, direction: 'prev' | 'next'): AnyNode | null {
  let current = node[direction];
  while (current !== null && current.type === 'text' && current.data.trim() === '') {
    current = current[direction];
  }
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

/**
 * Inline elements wrapped around block content cannot be written in Markdown. Emphasis
 * around blocks (`<em><p>...</p></em>`) leaves stray `_` lines, so the emphasis is dropped
 * and the blocks stay; a link around paragraphs keeps the link and loses the paragraphs.
 */
export const unwrapBlockyInline: Pass = ($) => {
  unwrap(
    $,
    $('em, i, strong, b').filter(
      (_, el) => $(el).find('p, div, ul, ol, pre, table, blockquote').length > 0,
    ),
  );
  inlineParagraphLinks($);
};
