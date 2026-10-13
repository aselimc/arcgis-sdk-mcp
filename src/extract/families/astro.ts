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
  prepare: dropCodePenStrips,
};
