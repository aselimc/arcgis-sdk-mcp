/**
 * The version oracles of design section 4.8, one per `OracleType`. Compatibility tables and
 * Knowledge Base deprecation notices are not oracles: see `../compatibility.ts` and
 * `../deprecations.ts`.
 */
import type { VersionOracle } from '../../core/ports.js';
import type { OracleType } from '../../core/types.js';
import { agolRestInfoOracle } from './agol-rest-info.js';
import { docesriSitemapOracle } from './docesri-sitemap.js';
import { githubReleaseOracle } from './github-release.js';
import type { DefinedOracle } from './kit.js';
import { metaRefreshTargetOracle } from './meta-refresh-target.js';
import { npmDistTagsOracle } from './npm-dist-tags.js';
import { nugetFlatOracle } from './nuget-flat.js';
import { pageRegexOracle } from './page-regex.js';
import { plcOracle } from './plc.js';
import { pubDevOracle } from './pub-dev.js';
import { pypiOracle } from './pypi.js';
import { sitemapSlugOracle } from './sitemap-slug.js';
import { staticOracle } from './static.js';

/** Every oracle by type. The record type makes a missing implementation a compile error. */
export const ORACLES: Readonly<Record<OracleType, DefinedOracle>> = {
  'npm-dist-tags': npmDistTagsOracle,
  pypi: pypiOracle,
  'nuget-flat': nugetFlatOracle,
  'pub-dev': pubDevOracle,
  'github-release': githubReleaseOracle,
  'page-regex': pageRegexOracle,
  'sitemap-slug': sitemapSlugOracle,
  'meta-refresh-target': metaRefreshTargetOracle,
  'docesri-sitemap': docesriSitemapOracle,
  'agol-rest-info': agolRestInfoOracle,
  static: staticOracle,
  plc: plcOracle,
};

/** All oracles as the port type, for callers that only need `read`. */
export function versionOracles(): VersionOracle[] {
  return Object.values(ORACLES);
}

export type { DefinedOracle, OracleOutcome, OracleRun } from './kit.js';
