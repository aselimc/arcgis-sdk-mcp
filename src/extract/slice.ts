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

/**
 * True when `node` is, or contains, an outline element at `level` or above. `except` is the
 * section's own heading, which is not the start of the next one.
 */
function startsPeer(page: PageView, node: AnyNode, level: number, except?: Element): boolean {
  if (!isElement(node)) return false;
  const own = levelOf(node);
  if (own > 0 && own <= level && node !== except) return true;
  // A table never holds the next section; its header cells may carry stamped headings.
  if (node.tagName === 'table') return false;
  return (
    page
      .$(node)
      .find(`[${LEVEL_ATTR}]`)
      .filter((_, inner) => inner !== except && levelOf(inner) <= level).length > 0
  );
}

/** The first child that is an element or text with content: comments and blank text do not count. */
function firstContentChild(parent: Element): AnyNode | undefined {
  return parent.children.find((child) => {
    if (isElement(child)) return true;
    return (child.type as string) === 'text' && 'data' in child && child.data.trim() !== '';
  });
}

/** Elements that mean nothing outside their list or table; a slice never starts with one. */
const PART_OF_A_WHOLE = new Set(['li', 'dt', 'dd', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot']);

/**
 * The outermost element the section starts with: the heading itself, or a wrapper that opens
 * with it and holds no other section (`<header><h4>` in a member box and the box around
 * that, a `<section>` element, a `div` that only adds an anchor icon to the heading). Taking
 * the wrapper keeps the markup the family rules select on and the block structure inside
 * it: lifted out of a `<header>`, a kind label would run into the signature that follows.
 */
function sectionStart(page: PageView, heading: Element, level: number): Element {
  const rootEl = page.root.get(0);
  const text = squash(page.$(heading).text());
  let start = heading;
  for (;;) {
    const parent = start.parent;
    if (!isElement(parent) || parent === rootEl) return start;
    const opens = firstContentChild(parent) === start;
    const onlyHeading = squash(page.$(parent).text()) === text;
    if (!onlyHeading && (!opens || PART_OF_A_WHOLE.has(parent.tagName))) return start;
    if (startsPeer(page, parent, level, heading)) return start;
    start = parent;
  }
}

/** Wrappers the walk may open to take the part of them that precedes the next section. */
const TRANSPARENT = new Set(['div', 'section', 'article', 'main', 'header']);

/**
 * Appends `first` and its following siblings to `nodes` until the next section starts.
 * Returns true when it did start, so the caller stops as well. A layout wrapper that holds
 * the next section's heading somewhere inside is opened: what precedes that heading in it
 * still belongs to this section.
 */
function takeUntilPeer(
  page: PageView,
  first: AnyNode | null,
  level: number,
  nodes: AnyNode[],
): boolean {
  for (let node = first; node !== null; node = node.next) {
    if (!startsPeer(page, node, level)) {
      nodes.push(node);
      continue;
    }
    const own = levelOf(node);
    const isPeer = own > 0 && own <= level;
    if (!isPeer && isElement(node) && TRANSPARENT.has(node.tagName)) {
      takeUntilPeer(page, node.children[0] ?? null, level, nodes);
    }
    return true;
  }
  return false;
}

/**
 * The nodes of one section: its heading and everything after it in document order, up to
 * the next outline element of the same or a higher level.
 *
 * "After it" is not "its following siblings": a heading often sits in a wrapper of its own
 * (`<header><h4>` in a member box, `<section><h2>` followed by sibling sections that hold
 * the subsections), and the section then continues after that wrapper. The walk therefore
 * starts at the outermost wrapper the section opens (see {@link sectionStart}) and climbs:
 * when the siblings at one depth are used up, it goes on with what follows the parent, until
 * the content root.
 */
export function sliceByHeading(page: PageView, node: OutlineNode): AnyNode[] {
  const rootEl = page.root.get(0);
  const start = sectionStart(page, node.el, node.level);
  const nodes: AnyNode[] = [start];
  let at = start;
  while (!takeUntilPeer(page, at.next, node.level, nodes)) {
    const up = at.parent;
    if (!isElement(up) || up === rootEl) break;
    at = up;
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
