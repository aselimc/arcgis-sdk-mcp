import { squash, unwrap } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * A disclosure label that says nothing about what it holds ("Read More", "Show details").
 * In Markdown everything is expanded, so such a label would be a stray line of button text.
 */
const TOGGLE_LABEL =
  /^(?:(?:read|show|see|view|learn|click to)\s+)?(?:more|less|details|expand|all|code)(?:\s+(?:details|info|information))?[.…:]*$/i;

/**
 * Opens every `<details>`: its content joins the page, and its `<summary>` stays as a bold
 * line unless it is only the label of the toggle. A disclosure inside a code block belongs
 * to the code passes (collapsed lines) and is left alone.
 */
export const fixDetails: Pass = ($) => {
  $('details').each((_, el) => {
    const details = $(el);
    if (details.closest('pre').length > 0) return;
    details.children('summary').each((__, child) => {
      const summary = $(child);
      const label = squash(summary.text());
      if (label === '' || TOGGLE_LABEL.test(label)) summary.remove();
      else summary.replaceWith(`<p><strong>${summary.html() ?? ''}</strong></p>`);
    });
    unwrap($, details);
  });
};
