import type { OracleType } from '../../../src/core/types.js';

/**
 * The oracle types of design section 4.8, written out so that the test fails when the
 * oracle table and the design drift apart (`satisfies` keeps the list itself honest).
 */
export const ORACLE_TYPES_UNDER_TEST = [
  'npm-dist-tags',
  'pypi',
  'nuget-flat',
  'pub-dev',
  'github-release',
  'page-regex',
  'sitemap-slug',
  'meta-refresh-target',
  'docesri-sitemap',
  'agol-rest-info',
  'static',
  'plc',
] as const satisfies readonly OracleType[];
