/**
 * Consistency checks of a help import (design section 4.6: "every entry is consumed by
 * exactly one rule").
 */
import type { HelpRegistry } from './help-registry.rules.js';
import type { RulesFile, SourceFile } from './help-registry.schema.js';

/**
 * Cross-checks one import run: every research entry consumed once, no unused rule input, no
 * name clash, every reference resolvable. Returns the problems found, empty when there are none.
 */
export function findProblems(
  registry: HelpRegistry,
  source: SourceFile,
  rules: RulesFile,
  /** Ids of `rules.products` that a rule asked for. */
  usedMeta: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const generated = new Set(registry.products.map((product) => product.id));
  const entryIds = new Set(source.entries.map((entry) => entry.id));
  const ledgerIds = registry.ledger.map((row) => row.entry);
  if (ledgerIds.length !== entryIds.size || new Set(ledgerIds).size !== entryIds.size) {
    problems.push(`${ledgerIds.length} ledger rows for ${entryIds.size} research entries`);
  }
  const maps = {
    standalone: rules.standalone,
    saasTwins: rules.saasTwins,
    developerBooks: rules.developerBooks,
    splitBooks: rules.splitBooks,
    migratedAliases: rules.migratedAliases,
    tombstones: rules.tombstones,
    developerTombstoneLinks: rules.developerTombstoneLinks,
    migratedLegacy: rules.migratedLegacy,
  };
  for (const [name, map] of Object.entries(maps)) {
    for (const key of Object.keys(map)) {
      if (!entryIds.has(key)) problems.push(`rules.${name}: unknown research entry "${key}"`);
    }
  }
  for (const id of Object.keys(rules.products)) {
    if (!usedMeta.has(id)) problems.push(`rules.products: "${id}" is not generated`);
  }
  const developerIds = new Set(rules.developerIds);
  const names = new Map<string, string>();
  for (const product of registry.products) {
    for (const name of [product.id, ...product.aliases]) {
      const owner = developerIds.has(name) ? 'a developer product' : names.get(name);
      if (owner !== undefined) problems.push(`"${name}" of ${product.id} is also ${owner}`);
      names.set(name, product.id);
    }
  }
  const resolves = (id: string): boolean => generated.has(id) || developerIds.has(id);
  for (const product of registry.products) {
    const refs = [
      ...product.related,
      ...(product.successor === undefined ? [] : [product.successor]),
    ];
    for (const ref of refs) {
      if (!resolves(ref)) problems.push(`${product.id}: unknown product "${ref}"`);
    }
  }
  const developerTargets = [
    ...Object.keys(registry.developerSources).map((key) => key.split('/')[0] ?? ''),
    ...Object.keys(registry.developerLinks),
  ];
  for (const target of developerTargets) {
    if (!developerIds.has(target)) problems.push(`"${target}" is not a developer product`);
  }
  return problems;
}
