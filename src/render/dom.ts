/**
 * Node types and guards for the cheerio documents the Sphinx and C# XML renderers walk.
 *
 * The imports are type-only: cheerio's node classes live in its dependency `domhandler` and
 * are not re-exported by name, and nothing here needs them at run time.
 */
import type { AnyNode, Element, Text } from 'domhandler';

/** The DOM node types of a parsed document. */
export type { AnyNode, Element };

/**
 * True for an element node (`script` and `style` included), the same test as `isElement` in
 * `src/extract/dom.ts`; the two packages may not import each other. Node kinds are compared as
 * text, not as the parser's enum.
 */
export function isElement(node: AnyNode | null | undefined): node is Element {
  const type: string | undefined = node?.type;
  return type === 'tag' || type === 'script' || type === 'style';
}

/** True for a text node. */
export function isText(node: AnyNode): node is Text {
  return (node.type as string) === 'text';
}
