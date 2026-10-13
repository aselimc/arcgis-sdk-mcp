/**
 * `symbols: 'apiref-nav'`: API references without a search store (the Enterprise SDK .NET
 * reference). Their only index is the navigation tree, which is laid out as
 *
 * ```
 * ESRI.ArcGIS.Carto            (namespace page)
 *   Interfaces                 (group folder)
 *     IAISRequest              (type page)
 *   Classes
 *     CenterAndScaleClass
 * ```
 *
 * so a type's kind is the group it is filed under and its namespace is the level above.
 */
import { relativeTo } from './site.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** Group folder titles and the symbol kind they stand for. */
const GROUP_KIND: Readonly<Record<string, string>> = {
  interfaces: 'interface',
  classes: 'class',
  coclasses: 'class',
  enumerations: 'enum',
  enums: 'enum',
  structs: 'struct',
  structures: 'struct',
  delegates: 'delegate',
  constants: 'constant',
  variables: 'variable',
  functions: 'function',
  hooks: 'function',
  types: 'type',
  'type aliases': 'type',
  components: 'component',
  namespaces: 'namespace',
  modules: 'module',
};

/** A type or namespace name: no spaces. */
const NAME = /^[A-Za-z_$@][\w$@./-]*$/;

/** Path segment that marks the API reference part of a site. */
const API_REFERENCE = /(?:^|\/)api-reference\//;

function groupKind(title: string): string | undefined {
  return GROUP_KIND[title.trim().toLowerCase()];
}

/** Type and namespace symbols read from the navigation tree of an API reference. */
export function apirefSymbols(input: SymbolInput): SymbolEntry[] {
  const references = input.nav.filter((entry) =>
    API_REFERENCE.test(relativeTo(input.site.prefix, entry.url) ?? ''),
  );
  // A page that other entries name as an ancestor is a namespace, not a type.
  const containers = new Set(references.flatMap((entry) => entry.crumbs));
  const entries: SymbolEntry[] = [];
  for (const entry of references) {
    if (!NAME.test(entry.title) || groupKind(entry.title) !== undefined) continue;
    const groupAt = entry.crumbs.findLastIndex((crumb) => groupKind(crumb) !== undefined);
    const kind = groupAt < 0 ? undefined : groupKind(entry.crumbs[groupAt] ?? '');
    const namespace = entry.crumbs
      .slice(0, groupAt < 0 ? entry.crumbs.length : groupAt)
      .findLast((crumb) => NAME.test(crumb) && groupKind(crumb) === undefined);
    const isContainer = containers.has(entry.title);
    // Ungrouped leaves of a tree that has no kind folders are still types of the reference.
    const symbolKind = kind ?? (isContainer ? 'namespace' : 'type');
    entries.push({
      url: entry.url,
      symbol: entry.title.split('.').at(-1) ?? entry.title,
      symbolKind,
      qualified:
        namespace === undefined || isContainer ? entry.title : `${namespace}.${entry.title}`,
      crumbs: entry.crumbs,
    });
  }
  return entries;
}
