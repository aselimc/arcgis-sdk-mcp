import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { themeRoot, themeTitle } from './shared.js';

/** The strips of "View in CodePen" links under code blocks are interface, not content. */
export const dropCodePenStrips: Pass = ($) => {
  $('ul.list-none')
    .filter((_, list) => $(list).find('astro-island').length > 0)
    .remove();
};

/**
 * The "Previous / Next" pager at the foot of a guide page: a block whose only children are
 * one or two links, each made of a `small` label and a `span` title. It is navigation, and
 * left in place it ends every page with two run-together links.
 */
export const dropPager: Pass = ($) => {
  $('div')
    .filter((_, block) => {
      const children = $(block).children();
      const links = children.filter('a[href]');
      if (links.length === 0 || links.length > 2 || links.length !== children.length) return false;
      return links
        .toArray()
        .every(
          (link) => $(link).children('small').length === 1 && $(link).children('span').length === 1,
        );
    })
    .remove();
};

/** Interface elements of the Astro theme that sit inside the content root. */
export const dropAstroChrome: Pass = ($, env) => {
  dropCodePenStrips($, env);
  dropPager($, env);
};

/**
 * Astro guides and tutorials on developers.arcgis.com. The title lives in the page header
 * outside the content root; `h2[id]` / `h3[id]` are direct children of the root, so a
 * section is its heading plus the following siblings.
 */
export const astro: FamilyProfile = {
  id: 'astro',
  defaultLanguage: '',
  root: themeRoot,
  title: themeTitle,
  outline: (page) => stampOutline(page),
  prepare: dropAstroChrome,
};
