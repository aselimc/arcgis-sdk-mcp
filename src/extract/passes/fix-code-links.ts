import { escapeHtml, squash, tagged } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * Markdown cannot nest a link inside a code span. `<code><a>X</a></code>` is turned inside
 * out to `<a><code>X</code></a>`; a `<code>` that holds links among other text (a signature
 * with linked types) becomes plain code text.
 */
export const fixCodeLinks: Pass = ($) => {
  $('code').each((_, el) => {
    const code = $(el);
    const links = code.find('a');
    if (links.length === 0 || code.closest('pre').length > 0) return;
    const text = squash(code.text());
    const link = links.first();
    if (links.length === 1 && squash(link.text()) === text) {
      const href = link.attr('href');
      const attributes = href === undefined ? '' : `href="${escapeHtml(href)}"`;
      code.replaceWith(`<a ${attributes}>${tagged('code', text)}</a>`);
    } else code.text(text);
  });
};
