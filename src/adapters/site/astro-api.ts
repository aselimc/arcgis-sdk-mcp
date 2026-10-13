/**
 * Names of the entries of an Astro API search index.
 *
 * The site stores a breadcrumb per entry, in three forms:
 *
 * | Entry | Stored breadcrumb | Page |
 * |---|---|---|
 * | the class a module exports by default | the package (`@arcgis/core`) | `references/core/layers/FeatureLayer/` |
 * | a module, or a type declared in one | the module path (`@arcgis/core/layers/types`) | `references/core/layers/types/` |
 * | a member | package and type (`@arcgis/core/FeatureLayer`) | the page of its type, with an anchor |
 *
 * The first form drops the module path, so `@arcgis/core/FeatureLayer` is neither the import
 * path nor unique. The path is recovered from the page URL: entries of the second form show
 * which URL directory stands for which breadcrumb prefix (`references/core/` for
 * `@arcgis/core`), and a default-export class is then named by its page below that
 * directory: `@arcgis/core/layers/FeatureLayer`.
 */

/** One entry of the index, with its page located. */
export interface ApiEntry {
  /** Symbol name: the stored title without call parentheses. */
  name: string;
  breadcrumb?: string;
  /** Lower-case page type (`class`, `method`, `module`), when the site states one. */
  pageType?: string;
  /** Page path relative to the source base, without fragment (`references/core/layers/FeatureLayer/`). */
  path: string;
  /** True when the stored URL has a fragment. */
  anchored: boolean;
}

/** The names derived for one entry. */
export interface ApiName {
  qualified: string;
  /** Qualified name of the owning type; set exactly for members. */
  parent?: string;
}

const segmentsOf = (path: string): string[] => path.split('/').filter((part) => part !== '');

/** The site's own qualified form: `<breadcrumb>/<name>`. */
function siteForm(entry: ApiEntry): string {
  return entry.breadcrumb === undefined ? entry.name : `${entry.breadcrumb}/${entry.name}`;
}

/** Number of trailing segments two lists share. */
function sharedTail(a: readonly string[], b: readonly string[]): number {
  let count = 0;
  while (count < a.length && count < b.length && a.at(-1 - count) === b.at(-1 - count)) count += 1;
  return count;
}

/**
 * Breadcrumb prefixes and the URL directories that stand for them, learned from the entries
 * whose breadcrumb ends like their page path. The directory most entries agree on wins.
 */
function moduleRoots(
  entries: readonly ApiEntry[],
  owners: ReadonlySet<string>,
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    // A member's breadcrumb names a type, not a module: it says nothing about directories.
    if (entry.breadcrumb === undefined || owners.has(entry.breadcrumb)) continue;
    const crumbs = segmentsOf(entry.breadcrumb);
    const page = segmentsOf(entry.path);
    const tail = sharedTail(crumbs, page);
    if (tail === 0 || tail >= crumbs.length) continue;
    const root = crumbs.slice(0, -tail).join('/');
    const directory = page.slice(0, -tail).join('/');
    const tally = votes.get(root) ?? new Map<string, number>();
    tally.set(directory, (tally.get(directory) ?? 0) + 1);
    votes.set(root, tally);
  }
  const roots = new Map<string, string>();
  for (const [root, tally] of votes) {
    const [best] = [...tally].sort((a, b) => b[1] - a[1]);
    if (best !== undefined) roots.set(root, best[0]);
  }
  return roots;
}

/**
 * The module path of an entry that has a page of its own (its page ends with its name), or
 * `undefined` when the page does not lie below a learned directory.
 */
function modulePath(entry: ApiEntry, roots: ReadonlyMap<string, string>): string | undefined {
  if (entry.breadcrumb === undefined) return undefined;
  const page = segmentsOf(entry.path);
  if (page.at(-1) !== entry.name) return undefined;
  const crumbs = segmentsOf(entry.breadcrumb);
  // The longest breadcrumb prefix with a known directory decides.
  for (let length = crumbs.length; length >= 1; length -= 1) {
    const root = crumbs.slice(0, length).join('/');
    const directory = roots.get(root);
    if (directory === undefined) continue;
    const below = segmentsOf(directory);
    const rest = crumbs.slice(length);
    const inner = page.slice(below.length);
    const underDirectory = below.every((part, index) => page[index] === part);
    const continues = rest.every((part, index) => inner[index] === part);
    return underDirectory && continues && inner.length > 0
      ? `${root}/${inner.join('/')}`
      : undefined;
  }
  return undefined;
}

/**
 * Qualified names of the entries, in order. An entry is a member when it has an anchor and
 * its breadcrumb names another (non-module) entry of the index; its owner is that entry on
 * the same page when there is one, since two modules may export a class of the same name.
 */
export function apiNames(entries: readonly ApiEntry[]): ApiName[] {
  const owners = new Set<string>();
  for (const entry of entries) if (entry.pageType !== 'module') owners.add(siteForm(entry));
  const roots = moduleRoots(entries, owners);

  const isMember = (entry: ApiEntry): boolean =>
    entry.anchored && entry.breadcrumb !== undefined && owners.has(entry.breadcrumb);
  const own = entries.map((entry) =>
    isMember(entry) ? undefined : (modulePath(entry, roots) ?? siteForm(entry)),
  );

  /** Owner names by `page` + site form, and by site form alone for the first of each. */
  const byPage = new Map<string, string>();
  const byForm = new Map<string, string>();
  entries.forEach((entry, index) => {
    const qualified = own[index];
    if (qualified === undefined || entry.pageType === 'module') return;
    const form = siteForm(entry);
    byPage.set(`${entry.path}\n${form}`, qualified);
    if (!byForm.has(form)) byForm.set(form, qualified);
  });

  return entries.map((entry, index): ApiName => {
    const qualified = own[index];
    if (qualified !== undefined) return { qualified };
    const form = entry.breadcrumb ?? '';
    const parent = byPage.get(`${entry.path}\n${form}`) ?? byForm.get(form) ?? form;
    return { qualified: `${parent}.${entry.name}`, parent };
  });
}
