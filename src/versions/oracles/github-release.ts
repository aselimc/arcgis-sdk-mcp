/**
 * Oracle `github-release`: the latest non-pre-release release of a repository, through the
 * GitHub client so that the call counts against the quota and the request budget.
 *
 * Options: `repo` (`owner/name`; default: the product's first repository with role `source`,
 * then `toolkit`). Sample repositories are never a default: their releases lag the SDK.
 */
import type { Product } from '../../core/types.js';
import { normalizeVersion, parseDate } from '../version-text.js';
import { defineOracle, option, requestOptions } from './kit.js';

function defaultRepo(product: Product): string | undefined {
  return (
    product.repos.find((ref) => ref.role === 'source') ??
    product.repos.find((ref) => ref.role === 'toolkit')
  )?.repo;
}

/** Reads `GET /repos/<owner>/<name>/releases/latest`. */
export const githubReleaseOracle = defineOracle(
  'github-release',
  'github',
  async (ctx, product, spec, run) => {
    const repo = option(spec, 'repo') ?? defaultRepo(product);
    if (repo === undefined) return [];
    const release = await ctx.github.latestRelease(repo, requestOptions(run));
    if (release === undefined) return [];
    const value = normalizeVersion(release.tag);
    // A tag that names no version (`nightly`) says nothing about the release number.
    if (!/^\d/.test(value)) return [];
    const date = parseDate(release.publishedAt);
    return [
      {
        role: 'installable',
        value,
        ...(date === undefined ? {} : { date }),
        tag: release.tag,
        registry: 'github',
        package: repo,
        oracle: 'github-release',
        url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag)}`,
      },
    ];
  },
);
