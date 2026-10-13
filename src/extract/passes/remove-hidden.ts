import type { Pass } from '../types.js';

/**
 * Elements a browser does not show: the `hidden` attribute, `aria-hidden="true"` and the
 * utility classes that move text off screen for screen readers only.
 */
const HIDDEN = [
  '[hidden]',
  '[aria-hidden="true"]',
  'input[type=hidden]',
  '.visually-hidden',
  '.sr-only',
  '.screen-reader-only',
  '.screen-reader-text',
].join(', ');

/**
 * Inline styles that take an element out of sight. A zero is matched only when no digit or
 * decimal point follows, so `opacity: 0.8` and `font-size: 0.9em` stay.
 */
const HIDING_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|(?:font-size|opacity)\s*:\s*0(?![.\d]))/i;

/**
 * Removes content a reader of the rendered page cannot see. Such text is never part of the
 * documentation, and it is where instructions aimed at a model rather than at a person would
 * be placed, so it must not reach the agent under the publisher's name (R12, SECURITY.md).
 *
 * Runs after the passes that reveal what the page hides on purpose: every tab panel but the
 * selected one, the collapsed blocks of a code switcher, the full source of a sample.
 * Styles set by a stylesheet are not evaluated; only the markup itself is read.
 */
export const removeHidden: Pass = ($) => {
  $(HIDDEN).remove();
  $('[style]')
    .filter((_, el) => HIDING_STYLE.test($(el).attr('style') ?? ''))
    .remove();
};
