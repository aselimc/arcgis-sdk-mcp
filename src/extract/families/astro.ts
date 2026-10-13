import { escapeHtml, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { dropLandingChrome, themeRoot, themeTitle } from './shared.js';

/** The strips of "View in CodePen" links under code blocks are interface, not content. */
const dropCodePenStrips: Pass = ($) => {
  $('ul.list-none')
    .filter((_, list) => $(list).find('astro-island').length > 0)
    .remove();
};

/**
 * The "Previous / Next" pager at the foot of a guide page: a block whose only children are
 * one or two links, each made of a `small` label and a `span` title. It is navigation, and
 * left in place it ends every page with two run-together links.
 */
const dropPager: Pass = ($) => {
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

/**
 * The button row that opens a native sample page: a platform switcher ("View in MAUI / WinUI
 * / WPF") and buttons to the repository and the app stores. The switcher's items print as
 * one run of words; the row becomes a line of links to the other platforms' pages and to
 * the source on GitHub, which are refs a reader can follow.
 */
const linkButtonRows: Pass = ($) => {
  $('div.button-group').each((_, el) => {
    const row = $(el);
    const platforms = row
      .find('calcite-segmented-control-item[data-url]')
      .filter((__, item) => $(item).attr('checked') === undefined)
      .map((__, item) =>
        tagged('a', squash($(item).text()), `href="${escapeHtml($(item).attr('data-url') ?? '')}"`),
      )
      .get();
    const source = row
      .find('calcite-button[href*="github.com"]')
      .map((__, button) =>
        tagged('a', squash($(button).text()), `href="${escapeHtml($(button).attr('href') ?? '')}"`),
      )
      .get();
    const parts = [
      platforms.length === 0 ? '' : `Also available for: ${platforms.join(', ')}`,
      ...source,
    ].filter((part) => part !== '');
    row.replaceWith(parts.length === 0 ? '' : `<p>${parts.join(' \u00b7 ')}</p>`);
  });
};

/** Interface elements of the Astro theme that sit inside the content root. */
export const dropAstroChrome: Pass = ($, env) => {
  dropCodePenStrips($, env);
  dropPager($, env);
  dropLandingChrome($, env);
  linkButtonRows($, env);
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
