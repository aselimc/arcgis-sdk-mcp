/**
 * The option keys of every version oracle. `OracleSpec.options` is a string map by design,
 * which leaves a misspelt key unnoticed: the oracle would silently fall back to its default.
 * This table is the one list of keys that exist. The registry schema rejects any other key,
 * and each oracle reads its options through {@link OracleOptionKey} names only, so "which
 * key does this oracle read" has one answer.
 *
 * `URL_OPTION_KEYS` are the options that hold an address; the registry lint checks their
 * hosts against the host table (invariant INV-2).
 */
import type { OracleType } from '../core/types.js';

/** The options each oracle type reads; see the module of the oracle for their meaning. */
export const ORACLE_OPTION_KEYS = {
  'npm-dist-tags': ['package', 'tags'],
  pypi: ['package'],
  // `id` is NuGet's own word for a package name.
  'nuget-flat': ['id'],
  'pub-dev': ['package'],
  'github-release': ['repo'],
  'page-regex': ['url', 'pattern', 'match', 'format', 'versionGroup', 'dateGroup', 'date'],
  'sitemap-slug': ['sitemap', 'filter', 'slug'],
  'meta-refresh-target': ['url'],
  'docesri-sitemap': ['slug'],
  'agol-rest-info': ['url'],
  static: ['version', 'ga', 'mature', 'retirement', 'url'],
  plc: ['category', 'productName', 'platform'],
} as const satisfies Record<OracleType, readonly string[]>;

/** An option key of one oracle type. */
export type OracleOptionKey<T extends OracleType = OracleType> =
  (typeof ORACLE_OPTION_KEYS)[T][number];

/** Option keys whose value is a URL or a path on developers.arcgis.com. */
export const URL_OPTION_KEYS = ['url', 'sitemap'] as const;

/** The keys of `options` that the oracle type does not read. */
export function unknownOptionKeys(type: OracleType, options: Record<string, string>): string[] {
  const known: readonly string[] = ORACLE_OPTION_KEYS[type];
  return Object.keys(options).filter((key) => !known.includes(key));
}
