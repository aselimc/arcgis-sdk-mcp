import type { AnyNode } from 'domhandler';
import type { FamilyProfile, PageView } from '../types.js';
import { gatsby } from './gatsby.js';

/**
 * The operation's metadata block (`dl.grid`: URL template, methods, capability, version).
 * It is detached together with a wrapper that holds nothing else.
 */
function metadataBlock(page: PageView): AnyNode[] {
  const list = page.root.find('dl.grid').first();
  if (list.length === 0) return [];
  const wrapper = list.parent();
  const alone = wrapper.get(0) !== page.root.get(0) && wrapper.children().length === 1;
  return (alone ? wrapper : list).remove().get();
}

/**
 * REST reference pages: a Gatsby guide whose first block is the operation's metadata, shown
 * as the page header. Request examples sit in ARIA tabs and parameters in tables with block
 * content; both are handled by the shared passes.
 */
export const gatsbyRest: FamilyProfile = {
  ...gatsby,
  id: 'gatsby-rest',
  header: metadataBlock,
};
