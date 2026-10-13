import type { AnyNode, Element } from 'domhandler';
import { isElement } from '../dom.js';
import type { Pass } from '../types.js';

const isItem = (node: AnyNode): node is Element => isElement(node) && node.tagName === 'li';

/** True for a node that shows nothing: a comment, or text that is only whitespace. */
function isBlank(node: AnyNode): boolean {
  if (isElement(node)) return false;
  return !('data' in node) || (node.type as string) !== 'text' || node.data.trim() === '';
}

/**
 * A list may hold only items, but pages put notes between them (`</li><div>..</div><li>`).
 * A browser shows such a block as part of the list without numbering it; Markdown would end
 * the list there and number the next step from the wrong count. Every stray child joins the
 * item before it, which is the step it comments on. Before the first item it stays put.
 */
export const fixLists: Pass = ($) => {
  $('ol, ul').each((_, list) => {
    let item: Element | undefined;
    for (const child of [...list.children]) {
      if (isItem(child)) item = child;
      else if (item !== undefined && !isBlank(child)) $(item).append(child);
    }
  });
};
