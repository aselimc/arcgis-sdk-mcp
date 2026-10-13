import { escapeHtml } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * Glossary popovers: keep only the term. Without this pass every glossary definition and its
 * "Learn more" link is injected into the prose next to the term it explains.
 */
export const fixGlossary: Pass = ($) => {
  $('calcite-tooltip, .term-tooltip-wrapper').remove();
  $('span[data-term]').each((_, el) => {
    const term = $(el).find('a.term').first();
    $(el).replaceWith(escapeHtml(term.length > 0 ? term.text() : $(el).text()));
  });
  $('a.term').each((_, el) => {
    $(el).replaceWith(escapeHtml($(el).text()));
  });
};
