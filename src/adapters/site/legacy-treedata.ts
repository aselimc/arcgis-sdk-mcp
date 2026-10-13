/**
 * Pure readers for the three listings a book of the older help sites publishes
 * (doc.arcgis.com, enterprise.arcgis.com, pro.arcgis.com):
 *
 * - the table-of-contents script `<book>/<NNNN>.js`, a list of assignments
 *   `treedata.data["id"] = { "parent": ..., "label": ..., "url": ..., "children": [...] }`;
 * - `<book>/flisting.htm`, a plain list of links for browsers without scripts;
 * - the `<script src>` of a topic page that names the table-of-contents script.
 *
 * The script is JavaScript, but each assigned value is a JSON object literal. It is located
 * with a regular expression and a brace scan and parsed with `JSON.parse`; nothing is ever
 * evaluated.
 */

/** One node of a table-of-contents script. */
export interface TreeNode {
  id: string;
  parent?: string;
  label?: string;
  /** Site-absolute path of the topic; absent on a heading that only groups topics. */
  url?: string;
  children: string[];
}

/** One topic of a book, in reading order. */
export interface TreePage {
  url: string;
  title: string;
  /** Labels of the enclosing headings, outermost first. */
  ancestors: string[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  reg: '®',
  trade: '™',
  copy: '©',
};

/** Decodes numeric character references and the named entities that occur in topic titles. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The index just past the `}` that closes the object literal starting at `open`, or -1 when
 * the literal is not closed. Braces inside string literals are skipped.
 */
function objectEnd(source: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== undefined) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Reads the nodes of a table-of-contents script, in file order.
 *
 * Assignments whose value is not a JSON object (the alias `treedata.data["root_1"] =
 * treedata.data["root"]`, anything hand-edited into invalid JSON) are skipped, so a script
 * of another format yields an empty map rather than an exception.
 */
export function parseTreedata(script: string): Map<string, TreeNode> {
  const nodes = new Map<string, TreeNode>();
  const assignment = /treedata\.data\[\s*(["'])([^"'\]]+)\1\s*\]\s*=\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(script)) !== null) {
    const id = match[2];
    const open = assignment.lastIndex - 1;
    const end = objectEnd(script, open);
    if (id === undefined || end === -1) continue;
    assignment.lastIndex = end;
    let value: unknown;
    try {
      value = JSON.parse(script.slice(open, end));
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const raw = value as { parent?: unknown; label?: unknown; url?: unknown; children?: unknown };
    const parent = stringOf(raw.parent);
    const label = stringOf(raw.label);
    const url = stringOf(raw.url);
    nodes.set(id, {
      id,
      ...(parent === undefined ? {} : { parent }),
      ...(label === undefined ? {} : { label: decodeEntities(label) }),
      ...(url === undefined ? {} : { url }),
      children: Array.isArray(raw.children)
        ? raw.children.filter((child): child is string => typeof child === 'string')
        : [],
    });
  }
  return nodes;
}

/**
 * The topics of a parsed table of contents in reading order, with the headings above each.
 *
 * Order follows each node's `children` list; a node that names a parent without being listed
 * by it is appended to that parent's children, and nodes whose parent is unknown are roots.
 * A node is visited once, so a cyclic script cannot loop.
 */
export function treePages(nodes: ReadonlyMap<string, TreeNode>): TreePage[] {
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of nodes.values()) {
    childrenOf.set(
      node.id,
      node.children.filter((child) => nodes.has(child)),
    );
  }
  for (const node of nodes.values()) {
    const siblings = node.parent === undefined ? undefined : childrenOf.get(node.parent);
    if (siblings === undefined) roots.push(node.id);
    else if (!siblings.includes(node.id)) siblings.push(node.id);
  }

  const pages: TreePage[] = [];
  const visited = new Set<string>();
  // Depth-first with an explicit stack: the tool reference of ArcGIS Pro has 11,000 nodes.
  const stack = roots.reverse().map((id) => ({ id, ancestors: [] as string[] }));
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const node = nodes.get(next.id);
    if (node === undefined || visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.url !== undefined) {
      pages.push({ url: node.url, title: node.label ?? '', ancestors: next.ancestors });
    }
    const ancestors = node.label === undefined ? next.ancestors : [...next.ancestors, node.label];
    const children = childrenOf.get(node.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const id = children[index];
      if (id !== undefined) stack.push({ id, ancestors });
    }
  }
  return pages;
}

/**
 * The links of a `flisting.htm` page, in document order: `href` as written (relative to the
 * page) and the link text with markup removed.
 */
export function parseFileListing(html: string): Array<{ href: string; title: string }> {
  const links: Array<{ href: string; title: string }> = [];
  const anchor = /<a\s[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const [, , href = '', inner = ''] of html.matchAll(anchor)) {
    const target = decodeEntities(href).trim();
    if (target === '' || target.startsWith('#')) continue;
    const title = decodeEntities(inner.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    links.push({ href: target, title });
  }
  return links;
}

/**
 * The `src` of every script of a topic page whose file name is a number: the book's
 * table-of-contents script (`/en/<product>/<book>/1893.js`). The number differs per book
 * and changes when a book is rebuilt, so it is read from a page rather than remembered.
 */
export function findTocScripts(html: string): string[] {
  const scripts = html.matchAll(/<script\s[^>]*?src\s*=\s*(["'])([^"']*\/\d+\.js)\1/gi);
  return [...new Set([...scripts].map((match) => match[2] ?? ''))].filter((src) => src !== '');
}
