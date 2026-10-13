import { escapeHtml } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * Table cells whose only content is an icon: the meaning lives in `aria-label` (the
 * "Required" column of parameter tables, support matrices). Writes it as text before SVGs
 * are removed: `Supported` becomes `yes`, `Not supported` becomes `no`, anything else stays.
 */
export const iconLabelsToText: Pass = ($) => {
  $('td svg[aria-label], th svg[aria-label]').each((_, el) => {
    const label = ($(el).attr('aria-label') ?? '').trim();
    let text = label;
    if (/^not\b/i.test(label)) text = 'no';
    else if (/^supported$/i.test(label)) text = 'yes';
    $(el).replaceWith(escapeHtml(text));
  });
};
