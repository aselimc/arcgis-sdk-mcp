import { escapeHtml, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { themeRoot, themeTitle } from './shared.js';

/**
 * Illustration cards (`a.group` wrapping an icon, an `h3` and a description) become list
 * items `[title](href): description`. As links they would each open a section of their own.
 */
export const cardsToList: Pass = ($) => {
  $('a.group')
    .filter((_, card) => $(card).children('h3').length > 0)
    .each((_, el) => {
      const card = $(el);
      const href = card.attr('href');
      const title = tagged('a', squash(card.children('h3').first().text()), `href="${escapeHtml(href ?? '#')}"`);
      const description = squash(card.find('p').text());
      card.replaceWith(`<ul><li>${title}${description === '' ? '' : `: ${escapeHtml(description)}`}</li></ul>`);
    });
};

/** Consecutive one-card lists (see {@link cardsToList}) are merged into one list. */
export const mergeCardLists: Pass = ($) => {
  $('ul + ul').each((_, el) => {
    const list = $(el);
    const previous = list.prev('ul');
    if (previous.length === 0 || list.children().length !== 1) return;
    if (list.children('li').children('a').length === 0) return;
    previous.append(list.children());
    list.remove();
  });
};

/**
 * Gatsby MDX guides on developers.arcgis.com (Arcade, the Python guide, Calcite,
 * `/documentation`). Same shell as the Astro sites; code blocks are react-syntax-highlighter
 * blocks, handled by the shared `fixGatsbyCode` pass.
 */
export const gatsby: FamilyProfile = {
  id: 'gatsby',
  defaultLanguage: '',
  root: themeRoot,
  title: themeTitle,
  outline: (page) => stampOutline(page),
  prepare: cardsToList,
  clean: mergeCardLists,
};
