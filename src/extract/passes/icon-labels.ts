import { escapeHtml, squash } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * The member-kind icon of the converted ArcObjects references (`bitmaps/Method.gif`,
 * `../bitmaps/Property.gif`). The page links it relative to the type page.
 */
const KIND_ICON = 'td > img[src*="bitmaps/"]';

/**
 * Table cells whose only content is an icon. Writes the meaning as text before SVGs and
 * decorative images are removed:
 *
 * - an SVG with an `aria-label` (the "Required" column of parameter tables, support
 *   matrices): `Supported` becomes `yes`, `Not supported` becomes `no`, anything else stays;
 * - the member-kind icon of the ArcObjects member tables: its alternative text ("Method",
 *   "Property"). As an image it is a URL per row that says nothing.
 *
 * Shared rather than part of one family: the same reference reaches the pipeline as a full
 * Gatsby page and as a bare body taken from the site's page data, converted generically.
 */
export const iconLabelsToText: Pass = ($) => {
  $('td svg[aria-label], th svg[aria-label]').each((_, el) => {
    const label = ($(el).attr('aria-label') ?? '').trim();
    let text = label;
    if (/^not\b/i.test(label)) text = 'no';
    else if (/^supported$/i.test(label)) text = 'yes';
    $(el).replaceWith(escapeHtml(text));
  });
  $(KIND_ICON).each((_, icon) => {
    $(icon).replaceWith(escapeHtml(squash($(icon).attr('alt') ?? '')));
  });
};
