/**
 * Navigation trees. A Gatsby site carries its table of contents as a tree of
 * `{ title, url, type, children }` nodes, in page-data or in a static query; REST sites also
 * publish their resource hierarchy as `{ name, url, children }`. Both are flattened here to
 * a list of pages with their ancestor titles, which is what breadcrumbs and symbols need.
 */
import { isObject, textOf as text } from './shape.js';
import { resolveSiteUrl, type GatsbySite } from './site.js';

/** One navigation tree as published, with the key it is told apart by. */
export interface NavTree {
  /** Distinguishes trees of different sections; equal for the same tree seen on two pages. */
  key: string;
  /** Title of the root node, for example the name of a documentation section. */
  title: string;
  /** The root's children, unvalidated. */
  children: unknown[];
}

/** A page of a navigation tree. */
export interface NavEntry {
  /** Absolute URL; may carry a fragment. */
  url: string;
  title: string;
  /** Titles of the ancestors inside the tree, outermost first, without the root. */
  crumbs: string[];
  /** Title of the tree's root. */
  root: string;
}

/** Nodes nested deeper than this are ignored; published trees are four to six levels deep. */
const MAX_DEPTH = 12;

/**
 * Reads a navigation root (`{ title?, children: [...] }`). Returns `undefined` when the
 * value has no `children` array, which is how a renamed field shows up.
 */
export function navTreeOf(root: unknown): NavTree | undefined {
  if (!isObject(root) || !Array.isArray(root.children)) return undefined;
  const title = text(root.title);
  const first = root.children.find(isObject);
  const key = [title, root.children.length, text(first?.title), text(first?.url)].join('|');
  return { key, title, children: root.children };
}

/**
 * Reads a REST resource hierarchy (an array of `{ name, url, children }` roots) as a tree.
 * Returns `undefined` for any other shape.
 */
export function hierarchyTreeOf(raw: unknown): NavTree | undefined {
  if (!Array.isArray(raw) || !raw.some(isObject)) return undefined;
  const first = raw.find(isObject);
  return { key: `hierarchy|${raw.length}|${text(first?.name)}`, title: '', children: raw };
}

/**
 * Every page of a tree in reading order. Folders without a URL contribute a breadcrumb
 * level only; dividers, placeholders and nodes without a title are skipped; a page listed
 * twice keeps its first position.
 */
export function flattenNav(site: GatsbySite, tree: NavTree): NavEntry[] {
  const entries: NavEntry[] = [];
  const seen = new Set<string>();
  const walk = (nodes: unknown[], crumbs: string[], depth: number): void => {
    for (const node of nodes) {
      if (!isObject(node) || node.type === 'divider') continue;
      // Resource hierarchies name their nodes `name`; navigation trees use `title`.
      const title = text(node.title) || text(node.name);
      const url = resolveSiteUrl(site, node.url);
      if (title !== '' && url !== undefined && !seen.has(url)) {
        seen.add(url);
        entries.push({ url, title, crumbs, root: tree.title });
      }
      if (Array.isArray(node.children) && depth < MAX_DEPTH) {
        walk(node.children, title === '' ? crumbs : [...crumbs, title], depth + 1);
      }
    }
  };
  walk(tree.children, [], 0);
  return entries;
}
