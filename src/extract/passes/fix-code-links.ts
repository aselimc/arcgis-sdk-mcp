import { escapeHtml, squash, tagged } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * Markdown cannot nest anything inside a code span. `<code><a>X</a></code>` is turned inside
 * out to `<a><code>X</code></a>`; a `<code>` that holds links among other text (a signature
 * with linked types) becomes plain code text, and so does one whose parts are styled
 * (`<code>Promise&lt;<em>any</em>&gt;</code>` would print as `Promise<_any_>`).
 */
export const fixCodeLinks: Pass = ($) => {
  $('code').each((_, el) => {
    const code = $(el);
    if (code.closest('pre').length > 0 || code.children().length === 0) return;
    const links = code.find('a');
    const text = squash(code.text());
    const link = links.first();
    if (links.length === 1 && squash(link.text()) === text) {
      const href = link.attr('href');
      const attributes = href === undefined ? '' : `href="${escapeHtml(href)}"`;
      code.replaceWith(`<a ${attributes}>${tagged('code', text)}</a>`);
    } else code.text(text);
  });
};
