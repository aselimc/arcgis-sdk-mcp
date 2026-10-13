/**
 * Which refs of a GitHub repository count as published by its owner.
 *
 * The allow-list names repository owners, but GitHub serves more under an owner's name than
 * the owner wrote: every commit of every fork is reachable as
 * `github.com/<owner>/<repo>/blob/<sha>/...`, and every pull request as `refs/pull/<n>/head`.
 * Anyone with an account can therefore produce a URL under an allowed owner that holds their
 * own text. This server reads branches and tags, and a bare commit only when the repository's
 * default branch contains it; everything else is refused.
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError, isMcpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type { CallOptions, Ctx } from '../../core/ports.js';
import type { GithubLocation } from '../../core/url.js';

const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'raw.githubusercontent.com']);

/** A ref that can only be a commit: 7 to 40 hexadecimal digits. */
const COMMIT = /^[0-9a-f]{7,40}$/i;

/** Verbs of a github.com path that are followed by a ref. */
const REF_VERBS: ReadonlySet<string> = new Set(['blob', 'raw', 'tree']);

/** Comparison results that mean "the default branch contains this commit". */
const CONTAINED: ReadonlySet<string> = new Set(['behind', 'identical']);

/** The path segments from the ref onwards, or `undefined` when the URL carries no ref. */
function refSegments(url: URL): string[] | undefined {
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (url.hostname === 'raw.githubusercontent.com') {
    return segments[0] === 'wiki' ? undefined : segments.slice(2);
  }
  return REF_VERBS.has(segments[2] ?? '') ? segments.slice(3) : undefined;
}

/**
 * The refusal for a GitHub URL whose ref is not a branch or tag by its spelling
 * (`refs/pull/7/head`, `refs/remotes/...`), or `undefined` when the spelling is acceptable.
 */
export function refusedGithubRef(url: URL): McpDocError | undefined {
  if (!GITHUB_HOSTS.has(url.hostname)) return undefined;
  const [first, second] = refSegments(url) ?? [];
  if (first?.toLowerCase() !== 'refs') return undefined;
  if (second === 'heads' || second === 'tags') return undefined;
  return new McpDocError('HOST_NOT_ALLOWED', `${url.href} is not a branch or tag`, {
    why: 'Pull-request refs and other internal refs hold content that the repository owner did not publish; only branches (refs/heads) and tags (refs/tags) are read',
    url: url.href,
    host: url.host,
  });
}

/** True when a ref has to be verified before it is read: it is spelled like a commit. */
export function isCommitRef(location: GithubLocation): boolean {
  return location.ref !== undefined && COMMIT.test(location.ref);
}

function unverified(url: URL, location: GithubLocation, why: string, branch?: string): McpDocError {
  const path = location.path === undefined ? '' : `/${location.path}`;
  return new McpDocError('LINK_ONLY', `Commit ${location.ref ?? ''} of ${location.repo} is not read`, {
    why,
    url: url.href,
    host: url.host,
    ...(branch === undefined
      ? {}
      : {
          next: formatCall(TOOLS.read, {
            ref: `https://github.com/${location.repo}/blob/${branch}${path}`,
          }),
        }),
  });
}

/**
 * Checks that the commit a GitHub URL names is part of the repository's default branch. One
 * API request, remembered like other repository metadata.
 *
 * @throws McpDocError `LINK_ONLY` when the commit is not contained in the default branch (a
 *   commit of a fork, of an unmerged pull request or of another branch) and when that cannot
 *   be established: an unverified commit is not read. `RATE_LIMITED_GITHUB` and
 *   `OFFLINE_MISS` pass through, since they name their own recovery.
 */
export async function verifyCommit(
  ctx: Ctx,
  url: URL,
  location: GithubLocation,
  call: CallOptions,
): Promise<void> {
  const options = {
    budget: call.budget,
    ...(call.signal === undefined ? {} : { signal: call.signal }),
  };
  let branch: string | undefined;
  try {
    branch = (await ctx.github.repoMeta(location.repo, options)).defaultBranch;
    const token = ctx.config.githubToken;
    const { data } = await ctx.http.getJson<{ status?: unknown }>({
      url: `https://api.github.com/repos/${location.repo}/compare/${encodeURIComponent(branch)}...${location.ref ?? ''}?per_page=1`,
      ttl: 'github-meta',
      headers: {
        accept: 'application/vnd.github+json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...options,
    });
    if (typeof data.status === 'string' && CONTAINED.has(data.status)) return;
  } catch (error) {
    if (!isMcpDocError(error)) throw error;
    if (error.code === 'RATE_LIMITED_GITHUB' || error.code === 'OFFLINE_MISS') throw error;
    throw unverified(
      url,
      location,
      `It could not be verified that this commit belongs to the repository itself (${error.code}); a commit of a fork is served under the same URL. Read the file at a branch or tag instead`,
      branch,
    );
  }
  throw unverified(
    url,
    location,
    `The commit is not part of the ${branch} branch: it may belong to a fork or to an unmerged pull request, whose content the repository owner did not publish. Read the file at a branch or tag instead`,
    branch,
  );
}
