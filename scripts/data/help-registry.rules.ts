/**
 * The import rules of design section 4.6 by name, the choice of rule for a research entry,
 * and the shape of an import result.
 */
import type { AnySourceDef, Product } from '../../src/core/types.js';
import type { Entry, RulesFile } from './help-registry.schema.js';

/** The import rules of design section 4.6, one per kind of outcome. */
export const IMPORT_RULES = [
  'docesri-product',
  'standalone-help',
  'standalone-link',
  'saas-twin',
  'developer-books',
  'migrated-alias',
  'tombstone',
  'developer-tombstone-link',
  'enterprise-legacy-lines',
  'migrated-legacy',
  'pro-legacy-lines',
] as const;

/** Name of an import rule. */
export type ImportRule = (typeof IMPORT_RULES)[number];

/** Which rule consumed a research entry, and what it produced or extended. */
export interface LedgerRow {
  entry: string;
  rule: ImportRule;
  /** A product id, or `product/source` when the entry became a source. */
  target: string;
}

/** Everything the generated module exports. */
export interface HelpRegistry {
  products: Product[];
  /** Sources that belong to developer-tier products, keyed `product/source`. */
  developerSources: Record<string, AnySourceDef>;
  /** Help links for developer-tier tombstones, keyed by product id. */
  developerLinks: Record<string, { title: string; ref: string }>;
  ledger: LedgerRow[];
}

/** Decides which rule consumes an entry, from its host, status and scope and the id maps. */
export function ruleFor(entry: Entry, rules: RulesFile): ImportRule {
  const listed = (map: Record<string, unknown>): boolean => Object.hasOwn(map, entry.id);
  switch (entry.host) {
    case 'doc.esri.com':
      return 'docesri-product';
    case 'pro.arcgis.com':
      return 'pro-legacy-lines';
    case 'enterprise.arcgis.com':
      if (listed(rules.developerBooks)) return 'developer-books';
      if (entry.scope === 'versioned-on-demand') return 'enterprise-legacy-lines';
      return entry.status === 'retired' ? 'tombstone' : 'migrated-legacy';
    case 'doc.arcgis.com':
      if (entry.status === 'retired') {
        return listed(rules.developerTombstoneLinks) ? 'developer-tombstone-link' : 'tombstone';
      }
      if (entry.status === 'migrated')
        return listed(rules.tombstones) ? 'tombstone' : 'migrated-alias';
      if (listed(rules.saasTwins)) return 'saas-twin';
      if (listed(rules.developerBooks)) return 'developer-books';
      return entry.scope === 'full' ? 'standalone-help' : 'standalone-link';
  }
}
