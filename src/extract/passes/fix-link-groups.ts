import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, isElement, squash, tagged } from '../dom.js';
import type { Pass } from '../types.js';

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
/** Marks a list made from a card, so that only such lists are merged. */
const CARD_LIST = 'data-md-cards';

/** What a card says besides its title: its description, or the label in its footer. */
function cardText($: CheerioAPI, card: Cheerio<Element>): string {
  const rest = card.clone();
  rest.find(`${HEADINGS}, img, svg, picture, figure`).remove();
  // Blocks are separated by layout only: without a space their texts would run together.
  rest.find('p, div, li, span').each((_, block) => void $(block).append(' '));
  return squash(rest.text());
}

/**
 * Cards: a link wrapped around a heading, usually with an illustration and a line of text.
 * Markdown has no block-level links, so a card would print as `[`, an image, a heading that
 * opens a section of its own, a paragraph and `](url)` on five separate lines. Each card
 * becomes a list item `[title](href): text`, and neighbouring cards share one list.
 */
function cardsToLists($: CheerioAPI): void {
  $('a')
    .filter((_, link) => $(link).find(HEADINGS).length > 0)
    .each((_, el) => {
      const card = $(el);
      const href = card.attr('href');
      // A heading that links to itself is a section heading with a permalink, not a card.
      if (href === undefined || href.startsWith('#')) {
        card.replaceWith(card.contents());
        return;
      }
      const name = squash(card.find(HEADINGS).first().text());
      if (name === '') return;
      const title = tagged('a', name, `href="${escapeHtml(href)}"`);
      const text = cardText($, card);
      card.replaceWith(
        `<ul ${CARD_LIST}=""><li>${title}${text === '' ? '' : `: ${escapeHtml(text)}`}</li></ul>`,
      );
    });
  $(`ul[${CARD_LIST}] + ul[${CARD_LIST}]`).each((_, el) => {
    const list = $(el);
    list.prev().append(list.children());
    list.remove();
  });
  $(`ul[${CARD_LIST}]`).removeAttr(CARD_LIST);
}

/**
 * Links that touch (`<a>JavaScript</a><a>Kotlin</a>`, spaced by CSS only) would read as one
 * word with several targets. A comma goes between them.
 */
function separateAdjacentLinks($: CheerioAPI): void {
  $('a[href] + a[href]').each((_, link) => {
    const before = link.prev;
    if (!isElement(before) || before.tagName !== 'a') return;
    if (squash($(link).text()) === '' || squash($(before).text()) === '') return;
    $(link).before(', ');
  });
}

/**
 * Groups of links that the page lays out with CSS: card grids become lists, and chips that
 * sit side by side get a separator. Runs after the bulk removal, so that icons and buttons
 * inside a card are gone when its text is read.
 */
export const fixLinkGroups: Pass = ($) => {
  cardsToLists($);
  separateAdjacentLinks($);
};
