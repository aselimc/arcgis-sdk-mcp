import { unwrap } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * Inline emphasis wrapped around block content (`<em><p>...</p></em>`) cannot be written in
 * Markdown and leaves stray `_` lines: the emphasis is dropped, the blocks stay.
 */
export const unwrapBlockyInline: Pass = ($) => {
  unwrap(
    $,
    $('em, i, strong, b').filter(
      (_, el) => $(el).find('p, div, ul, ol, pre, table, blockquote').length > 0,
    ),
  );
};
