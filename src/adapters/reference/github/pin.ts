/**
 * Which ref of a repository to read: the release tag of the requested version where the
 * registry says tags are reliable (`pin: 'release-tag'`), otherwise the default branch, with
 * a fallback from a tag that does not exist to the branch.
 *
 * Tag pinning matters twice: content at a tag never changes, so it is cached for good, and
 * a sample read at `v200.8.0` matches the SDK version the project actually uses.
 */
import { isMcpDocError, toMcpDocError } from '../../../core/errors.js';
import type { Ctx, GithubCallOptions } from '../../../core/ports.js';
import type { LicenseTier } from '../../../core/types.js';
import { callOptions, type GithubSource, type RepoScope } from './shared.js';

const DEFAULT_TAG_TEMPLATE = 'v{version}';
const FULL_SHA = /^[0-9a-f]{40}$/i;
/** `v300.1.0`, `300.1.0.5042`, `3.6.0.59527`: a ref that names a release rather than a branch. */
const VERSION_TAG = /^v?\d+(?:\.\d+){1,3}$/;

/** True for a ref that cannot move: a commit SHA or a version-shaped tag. */
export function isImmutableRef(ref: string): boolean {
  return FULL_SHA.test(ref) || VERSION_TAG.test(ref);
}

/**
 * The exact version a requested version stands for in a tag: `300.1` becomes `300.1.0`,
 * a full version is kept. A bare major (`300`) or a non-numeric label names no single
 * release and gives `undefined`.
 */
export function exactVersion(version: string): string | undefined {
  const text = version.trim().replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){1,3}$/.test(text)) return undefined;
  return text.split('.').length === 2 ? `${text}.0` : text;
}

/** The tag of a version under a template such as `v{version}`. */
export function tagFor(version: string, template = DEFAULT_TAG_TEMPLATE): string {
  return template.replace('{version}', version);
}

/** The version a tag stands for under a template; the tag without a leading `v` when it does not fit. */
export function versionOfTag(tag: string, template = DEFAULT_TAG_TEMPLATE): string {
  const [before = '', after = ''] = template.split('{version}');
  const fits =
    tag.length > before.length + after.length && tag.startsWith(before) && tag.endsWith(after);
  return fits ? tag.slice(before.length, tag.length - after.length) : tag.replace(/^v/i, '');
}

/** The leading number of a version line (`v200` gives `200`); `undefined` for `latest`. */
function lineMajor(src: GithubSource): string | undefined {
  return /^v?(\d+)(?:\.|x|$)/i.exec(src.line.id)?.[1];
}

/**
 * The licence a repository's content is returned under. The registry tier `cc-by-nd` always
 * holds, because it selects the verbatim-only path and must not be relaxed by a detection
 * that fails to recognise a custom licence file; otherwise the licence GitHub reports wins
 * over the registry's expectation.
 */
function effectiveLicense(src: GithubSource, detected: LicenseTier | undefined): LicenseTier {
  const declared = src.source.license ?? src.product.licenseTier;
  return declared === 'cc-by-nd' ? declared : (detected ?? declared);
}

/**
 * Opens the repository of a source: default branch and licence from the GitHub API (cached
 * seven days by the client), without choosing a ref yet (`scope.ref` is the default branch).
 *
 * The lookup is allowed to fail: raw content does not need the API, so with a spent quota
 * or during an outage the registry's branch hint and licence tier are used and the next
 * request decides whether the operation can proceed.
 */
export async function openRepo(ctx: Ctx, src: GithubSource): Promise<RepoScope> {
  const repo = src.source.config.repo;
  const hint = src.product.repos.find(
    (candidate) => candidate.repo.toLowerCase() === repo.toLowerCase(),
  );
  const notices: string[] = [];
  let branch = hint?.defaultBranch ?? 'main';
  let detected: LicenseTier | undefined;
  try {
    const meta = await ctx.github.repoMeta(repo, callOptions(src));
    branch = meta.defaultBranch;
    detected = meta.license;
    if (meta.archived) notices.push(`The repository ${repo} is archived and no longer updated.`);
  } catch (error) {
    const typed = toMcpDocError(error);
    if (typed.code === 'INTERNAL') throw typed;
    ctx.logger.debug('GitHub repository metadata is unavailable; using the registry hints', {
      repo,
      code: typed.code,
    });
  }
  return {
    repo,
    defaultBranch: branch,
    license: effectiveLicense(src, detected),
    ref: branch,
    pinned: false,
    notices,
  };
}

/** Points the scope at a release tag. */
function pinTo(scope: RepoScope, tag: string, version: string): void {
  scope.ref = tag;
  scope.pinned = true;
  scope.version = version;
}

/**
 * Chooses the ref of a scope when the request does not name one:
 *
 * 1. `config.ref`, when the registry fixes one;
 * 2. with `pin: 'release-tag'`, the tag of `src.version`, or of the latest release when the
 *    source is bound to the current line without a version;
 * 3. the default branch: for `pin: 'branch'`, for a version that names no single release,
 *    for a non-current line whose release is unknown, and when the release lookup fails.
 */
export async function chooseRef(ctx: Ctx, src: GithubSource, scope: RepoScope): Promise<void> {
  const config = src.source.config;
  if (config.ref !== undefined) {
    scope.ref = config.ref;
    scope.pinned = isImmutableRef(config.ref);
    return;
  }
  if (config.pin !== 'release-tag') return;

  if (src.version !== undefined) {
    const version = exactVersion(src.version);
    if (version !== undefined) {
      pinTo(scope, tagFor(version, config.tagTemplate), version);
      return;
    }
  }

  let release: Awaited<ReturnType<Ctx['github']['latestRelease']>>;
  try {
    release = await ctx.github.latestRelease(scope.repo, callOptions(src));
  } catch (error) {
    const typed = toMcpDocError(error);
    if (typed.code === 'INTERNAL') throw typed;
    ctx.logger.debug('The latest release is unavailable; reading the default branch', {
      repo: scope.repo,
      code: typed.code,
    });
    return;
  }
  if (release === undefined) return;
  const version = versionOfTag(release.tag, config.tagTemplate);
  // The latest release belongs to the current line. A request for another line, or for a
  // major version, is pinned only when that release is part of it.
  const major = /^v?(\d+)(?:\.|$)/i.exec(src.version?.trim() ?? '')?.[1] ?? lineMajor(src);
  if (major !== undefined && !version.startsWith(`${major}.`)) {
    scope.notices.push(
      `No release tag of ${scope.repo} is known for ${src.line.label}; showing branch ${scope.defaultBranch}.`,
    );
    return;
  }
  pinTo(scope, release.tag, version);
}

/** {@link openRepo} followed by {@link chooseRef}: the scope of an enumeration or a read without a ref. */
export async function openScope(ctx: Ctx, src: GithubSource): Promise<RepoScope> {
  const scope = await openRepo(ctx, src);
  await chooseRef(ctx, src, scope);
  return scope;
}

/**
 * The scope of a read whose URL names a ref. A requested version wins over the URL's ref
 * where tags are reliable, because catalogue records carry the ref they were enumerated at
 * while the caller asks for the version of its project; the URL's ref is then the fallback.
 */
export async function openScopeAt(ctx: Ctx, src: GithubSource, urlRef: string): Promise<RepoScope> {
  const scope = await openRepo(ctx, src);
  const config = src.source.config;
  const version = src.version === undefined ? undefined : exactVersion(src.version);
  if (config.pin === 'release-tag' && version !== undefined) {
    pinTo(scope, tagFor(version, config.tagTemplate), version);
    // A branch named in the URL is a better fallback than the default one.
    if (!isImmutableRef(urlRef)) scope.defaultBranch = urlRef;
    return scope;
  }
  scope.ref = urlRef;
  scope.pinned = isImmutableRef(urlRef);
  if (VERSION_TAG.test(urlRef)) scope.version = versionOfTag(urlRef, config.tagTemplate);
  return scope;
}

/**
 * Runs `fetch` at the scope's ref. When that ref is a pinned tag and GitHub does not know
 * it (`DOC_NOT_FOUND`), runs it again at the default branch and, if that works, moves the
 * scope there and records a notice. A path that is missing on both keeps the first error.
 */
export async function atRef<V>(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  fetch: (ref: string, opts: GithubCallOptions) => Promise<V>,
): Promise<V> {
  try {
    return await fetch(scope.ref, callOptions(src, scope));
  } catch (error) {
    const missing = isMcpDocError(error) && error.code === 'DOC_NOT_FOUND';
    if (!missing || !scope.pinned || scope.ref === scope.defaultBranch) throw error;
    let value: V;
    try {
      value = await fetch(scope.defaultBranch, callOptions(src));
    } catch {
      throw error;
    }
    const tag = scope.ref;
    scope.ref = scope.defaultBranch;
    scope.pinned = false;
    delete scope.version;
    scope.notices.push(
      `Tag ${tag} was not found in ${scope.repo}; showing branch ${scope.defaultBranch} instead.`,
    );
    ctx.logger.info('Release tag not found; fell back to the default branch', {
      repo: scope.repo,
      tag,
      branch: scope.defaultBranch,
    });
    return value;
  }
}
