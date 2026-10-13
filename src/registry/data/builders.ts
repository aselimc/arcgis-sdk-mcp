/**
 * The small builders every registry data file uses, so that the same thing is written the
 * same way in each of them: the one version line of an unversioned product, the version
 * banner and life-cycle oracles, an Apache-2.0 repository, and the canary of a repository.
 *
 * Builders that describe one family of products (a native SDK, a Gatsby sub-site of the
 * REST reference) stay in the data file of that family.
 */
import { DEVELOPERS_ORIGIN } from '../../core/names.js';
import type { OracleSpec, Probe, RepoRef, VersionLine } from '../../core/types.js';

/** `https://developers.arcgis.com`, the origin most registry URLs are written against. */
export const D = DEVELOPERS_ORIGIN;

/** The line of a product whose documentation is not versioned: one line, always current. */
export const LATEST: VersionLine = {
  id: 'latest',
  label: 'Current',
  current: true,
  access: 'live',
  vars: {},
};

/**
 * The "Current version: X - date" banner of a product home page on developers.arcgis.com.
 *
 * @param path the home page, as a path on that host.
 */
export function banner(path: string): OracleSpec {
  return {
    type: 'page-regex',
    options: { url: `${D}${path}` },
    provides: ['documented', 'released'],
  };
}

/**
 * Release, maturity and retirement dates from Esri's product life cycle service, which lists
 * the product under its registry name. Read only with the opt-in capability `lifecycle-api`.
 */
export const LIFECYCLE: OracleSpec = {
  type: 'plc',
  options: { category: 'Developer' },
  provides: ['lifecycle'],
};

/** An Apache-2.0 repository; the licence is a hint that the adapter confirms at run time. */
export function apacheRepo(repo: string, role: RepoRef['role'], defaultBranch: string): RepoRef {
  return { repo, role, license: 'apache-2.0', defaultBranch };
}

/** The canary of a repository source: the metadata call the adapter makes first anyway. */
export function githubRepoProbe(repo: string): Probe {
  return {
    url: `https://api.github.com/repos/${repo}`,
    expect: 'json',
    mustContain: 'full_name',
  };
}
