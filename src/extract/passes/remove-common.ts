import type { Pass } from '../types.js';

/**
 * Elements that never carry documentation text. `a.anchor-link` is the heading permalink
 * (otherwise every heading ends in `[](#id)`); `wbr` is removed without inserting a space,
 * because it sits inside identifiers. Form controls and menus hold choices, not text: a
 * dropdown that is left in place prints its items run together (`GETPOST`).
 */
export const COMMON_REMOVE = [
  'script',
  'style',
  'noscript',
  'svg',
  'link',
  'template',
  'iframe',
  'calcite-icon',
  'calcite-button',
  'calcite-tooltip',
  'calcite-chip',
  'calcite-dropdown',
  'calcite-segmented-control',
  'astro-island',
  'starship-popover',
  'a.anchor-link',
  'nav',
  'form',
  'button',
  'textarea',
  'select',
  'input',
  '.table-of-contents',
  '.sidebar-container',
  'aside.supplementary-content',
  'wbr',
].join(', ');

/** Removes page chrome and non-content elements. Runs after every pass that reads them. */
export const removeCommon: Pass = ($) => {
  $(COMMON_REMOVE).remove();
};
