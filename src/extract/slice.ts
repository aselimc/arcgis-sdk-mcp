/**
 * Cutting one section out of a page before it is cleaned. On heavy pages (a 1.7 MB API
 * reference) this is what makes a single-section read cheap.
 */
import type { AnyNode, Element } from 'domhandler';
import { isElement, squash } from './dom.js';
import { LEVEL_ATTR } from './outline.js';
import type { OutlineNode, PageView } from './types.js';

function levelOf(node: AnyNode): number {
  return isElement(node) ? Number(node.attribs[LEVEL_ATTR] ?? 0) : 0;
}

/** True when `node` is, or contains, an outline element at `level` or above. */
function startsPeer(page: PageView, node: AnyNode, level: number): boolean {
  if (!isElement(node)) return false;
  const own = levelOf(node);
  if (own > 0 && own <= level) return true;
  // A table never holds the next section; its header cells may carry stamped headings.
  if (node.tagName === 'table') return false;
  return (
    page
      .$(node)
      .find(`[${LEVEL_ATTR}]`)
      .filter((_, inner) => levelOf(inner) <= level).length > 0
  );
}

/**
 * The heading's outermost wrapper that holds nothing but the heading (anchor icons aside),
 * so that the sibling walk starts where the section's content is.
 */
function sectionStart(page: PageView, heading: Element): Element {
  const rootEl = page.root.get(0);
  const text = squash(page.$(heading).text());
  let start = heading;
  for (;;) {
    const parent = start.parent;
    if (!isElement(parent) || parent === rootEl) return start;
    if (squash(page.$(parent).text()) !== text) return start;
    start = parent;
  }
}

/**
 * The nodes of one section: its heading and everything after it up to the next outline
 * element of the same or a higher level. When the heading opens a `<section>` element, that
 * element is the section.
 */
export function sliceByHeading(page: PageView, node: OutlineNode): AnyNode[] {
  const start = sectionStart(page, node.el);
  const parent = start.parent;
  if (
    isElement(parent) &&
    parent !== page.root.get(0) &&
    parent.tagName === 'section' &&
    parent.children.find(isElement) === start
  ) {
    return [parent];
  }
  const nodes: AnyNode[] = [start];
  for (let next = start.next; next !== null; next = next.next) {
    if (startsPeer(page, next, node.level)) break;
    nodes.push(next);
  }
  return nodes;
}

/** `element` and its following siblings up to (not including) the first one `stop` accepts. */
export function sliceUntil(element: Element, stop: (node: AnyNode) => boolean): AnyNode[] {
  const nodes: AnyNode[] = [element];
  for (let next = element.next; next !== null; next = next.next) {
    if (stop(next)) break;
    nodes.push(next);
  }
  return nodes;
}
