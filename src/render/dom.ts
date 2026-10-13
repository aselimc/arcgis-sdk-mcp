/**
 * Node types and guards for the cheerio documents the Sphinx and C# XML renderers walk.
 *
 * The imports are type-only: cheerio's node classes live in its dependency `domhandler` and
 * are not re-exported by name, and nothing here needs them at run time.
 */
import type { AnyNode, Element, Text } from 'domhandler';

export type { AnyNode, Element };

/** True for an element node. Node kinds are compared as text, not as the parser's enum. */
export function isElement(node: AnyNode | undefined): node is Element {
  return node !== undefined && (node.type as string) === 'tag';
}

/** True for a text node. */
export function isText(node: AnyNode): node is Text {
  return (node.type as string) === 'text';
}
