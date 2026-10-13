/**
 * Limits on the shape of a document the pipeline converts. Conversion is synchronous, so it
 * cannot be interrupted by a deadline: what bounds its cost has to be checked before it
 * starts. Two things make it expensive far beyond the size of the page:
 *
 * - depth: the DOM helpers and the Markdown converter recurse once per level, and a few
 *   thousand nested elements end in a stack overflow after seconds of work;
 * - width: the selector engine and the converter both do work quadratic in the number of
 *   children of one element.
 *
 * The limits are far above anything a documentation page reaches (a 1.5 MB reference page
 * has some 25 000 elements, 30 levels and no element with more than a few hundred children)
 * and far below what a hostile document of a few megabytes can hold.
 */
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Deepest nesting converted. */
export const MAX_DEPTH = 256;
/** Most children of one element. */
export const MAX_CHILDREN = 10_000;
/** Most nodes (elements, text, comments) in the document. */
export const MAX_NODES = 300_000;
/**
 * Open elements in the markup beyond which the document is not even parsed: the HTML parser
 * itself slows down quadratically with the depth of the open-element stack. Counted loosely
 * (see {@link openTagDepth}), hence well above {@link MAX_DEPTH}.
 */
export const MAX_OPEN_TAGS = 2_000;

/** Elements without an end tag, and elements whose end tag HTML lets authors leave out. */
const NEVER_NESTED = new Set(
  (
    'area base br col embed hr img input link meta param source track wbr ' +
    'li p dt dd td th tr thead tbody tfoot option optgroup colgroup caption'
  ).split(' '),
);
const TAG_START = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/g;

/**
 * The deepest run of opened and not yet closed tags in HTML text: an upper estimate of the
 * nesting depth, taken without parsing. One linear scan; tags inside scripts and attribute
 * values are counted too, which is why the limit for it is generous.
 */
export function openTagDepth(html: string): number {
  let depth = 0;
  let deepest = 0;
  TAG_START.lastIndex = 0;
  for (let tag = TAG_START.exec(html); tag !== null; tag = TAG_START.exec(html)) {
    if (NEVER_NESTED.has((tag[2] ?? '').toLowerCase())) continue;
    if (tag[1] === '/') depth = Math.max(0, depth - 1);
    else {
      depth += 1;
      if (depth > deepest) deepest = depth;
    }
  }
  return deepest;
}

/**
 * Why a parsed document is not converted, or `undefined` when it is within the limits. The
 * walk is iterative and stops at the first limit it passes.
 */
export function shapeProblem($: CheerioAPI): string | undefined {
  let nodes = 0;
  const stack: Array<{ node: AnyNode; depth: number }> = [];
  for (const node of $.root().get()) stack.push({ node, depth: 0 });
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    nodes += 1;
    if (nodes > MAX_NODES) return `it has more than ${MAX_NODES} nodes`;
    if (entry.depth > MAX_DEPTH) return `its elements are nested more than ${MAX_DEPTH} deep`;
    const children = 'children' in entry.node ? entry.node.children : [];
    if (children.length > MAX_CHILDREN) {
      return `one of its elements has more than ${MAX_CHILDREN} children`;
    }
    for (const child of children) stack.push({ node: child, depth: entry.depth + 1 });
  }
  return undefined;
}
