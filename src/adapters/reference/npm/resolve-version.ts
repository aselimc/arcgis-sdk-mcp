/**
 * Which version of an npm package to read. In order:
 *
 * 1. the copy installed in the project's `node_modules`, when it satisfies the request;
 * 2. the published version matching the requested one (jsDelivr resolves partial versions
 *    and ranges, and confirms that an exact version exists);
 * 3. the registry's dist-tags: the highest release among `latest` and the `lts*` tags;
 * 4. jsDelivr's `latest`, when the registry cannot be asked.
 *
 * The answer is always an exact version, so every file read after it is pinned.
 */
import { formatCall } from '../../../core/budget.js';
import { McpDocError, toMcpDocError } from '../../../core/errors.js';
import { TOOLS } from '../../../core/names.js';
import type { BoundSource, Ctx } from '../../../core/ports.js';
import { compareVersions, isPrerelease, parseVersion } from '../../../core/version-key.js';
import { isExactVersion, resolveSpecifier } from './jsdelivr.js';
import { findLocalPackage, type LocalPackage } from './local-packages.js';
import { budgetOf, isRecord, shapeError, str, tolerate } from './shared.js';

/** A package pinned to one exact version, and how that version was chosen. */
export interface ResolvedPackage {
  name: string;
  /** Exact version (`5.1.27`). */
  version: string;
  /**
   * - `local`: installed in the project;
   * - `requested`: the published version matching `BoundSource.version`;
   * - `dist-tag`: the registry's current release;
   * - `cdn-latest`: jsDelivr's `latest`, used when the registry could not be asked.
   */
  how: 'local' | 'requested' | 'dist-tag' | 'cdn-latest';
  /** The dist-tag that supplied the version (`latest`, `lts-v4.x`). */
  tag?: string;
  /** The installed copy; its files are read before the network. */
  local?: LocalPackage;
}

/** The dist-tags endpoint of the npm registry (design section 4.8). */
export function distTagsUrl(name: string): string {
  return `https://registry.npmjs.org/-/package/${name}/dist-tags`;
}

/**
 * The current release according to a dist-tag map: the highest version among `latest` and
 * the long-term-support tags (`lts`, `lts-v4.x`). Pre-releases are skipped, so a `latest`
 * that was moved to a patch of an older line never hides a newer supported release, and
 * `next` or `rc` never win.
 *
 * @returns `undefined` when the map names no release under those tags.
 */
export function pickDistTag(tags: unknown): { tag: string; version: string } | undefined {
  if (!isRecord(tags)) return undefined;
  let best: { tag: string; version: string } | undefined;
  for (const [tag, value] of Object.entries(tags)) {
    const version = str(value);
    if (tag !== 'latest' && !/^lts(?:$|[-_.])/i.test(tag)) continue;
    if (version === undefined || !isExactVersion(version) || isPrerelease(version)) continue;
    if (best === undefined || compareVersions(version, best.version) > 0) best = { tag, version };
  }
  return best;
}

/**
 * True when an installed version is what a request asks for:
 *
 * - an exact version (`5.1.27`) must be equal;
 * - a partial version (`4.33`, `4`, `4.33.x`) must be a prefix of a release;
 * - `^`, `~` and `>=` ranges follow npm's rules for releases.
 *
 * Anything else (compound ranges, tags) is not decided locally.
 */
export function satisfiesRequest(installed: string, requested: string): boolean {
  const match = /^(\^|~|>=|=)?\s*v?(\d[\w.*+-]*)$/i.exec(requested.trim());
  if (match === null) return false;
  const operator = match[1] ?? '';
  const base = (match[2] ?? '').replace(/(?:\.[x*])+$/i, '');
  if ((operator === '' || operator === '=') && isExactVersion(base)) return installed === base;

  const wanted = parseVersion(base);
  const have = parseVersion(installed);
  if (wanted.length === 0 || have.length === 0 || isPrerelease(installed)) return false;
  const sameUpTo = (count: number): boolean =>
    wanted.slice(0, count).every((part, index) => have[index] === part);
  const atLeast = compareVersions(installed, base) >= 0;
  switch (operator) {
    case '^':
      // Below 1.0 a caret range does not cross minor versions.
      return atLeast && sameUpTo(wanted[0] === 0 ? 2 : 1);
    case '~':
      return atLeast && sameUpTo(2);
    case '>=':
      return atLeast;
    default:
      return sameUpTo(wanted.length);
  }
}

/**
 * The version a bound source was asked for, when it names one. `latest` and the id or label
 * of the bound line mean "the current release", which is what an absent version means too.
 */
function requestedVersion(src: BoundSource): string | undefined {
  const version = src.version?.trim();
  if (version === undefined || version === '' || version.toLowerCase() === 'latest') {
    return undefined;
  }
  return version === src.line.id || version === src.line.label ? undefined : version;
}

async function resolveRequested(
  ctx: Ctx,
  src: BoundSource,
  name: string,
  requested: string,
): Promise<ResolvedPackage> {
  const specifier = requested.replace(/^v(?=\d)/i, '');
  const version = await resolveSpecifier(ctx, src, name, specifier);
  if (version !== undefined) return { name, version, how: 'requested' };
  throw new McpDocError('VERSION_UNAVAILABLE', `${name} has no published version "${requested}"`, {
    why: 'No release on npm matches that version',
    next: formatCall(TOOLS.getVersions, { product: src.product.id }),
  });
}

async function resolveCurrent(ctx: Ctx, src: BoundSource, name: string): Promise<ResolvedPackage> {
  let failure: McpDocError | undefined;
  // Without capability `registries` the registry is not asked at all; the CDN rung answers.
  if (ctx.policy.enabled('registries')) {
    const url = distTagsUrl(name);
    try {
      const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...budgetOf(src) });
      const picked = pickDistTag(data);
      if (picked !== undefined) return { name, version: picked.version, how: 'dist-tag', ...picked };
      failure = shapeError(url, 'a dist-tag list');
    } catch (error) {
      failure = tolerate(ctx, src, error, `The dist-tag list of ${name}`);
    }
  }
  let version: string | undefined;
  try {
    version = await resolveSpecifier(ctx, src, name, 'latest');
  } catch (error) {
    // The registry's answer explains the situation better than the fallback's.
    throw failure ?? toMcpDocError(error);
  }
  if (version !== undefined) return { name, version, how: 'cdn-latest', tag: 'latest' };
  throw (
    failure ??
    new McpDocError('VERSION_UNAVAILABLE', `${name} has no published release`, {
      why: 'Neither the npm registry nor jsDelivr names a current version',
      next: formatCall(TOOLS.getVersions, { product: src.product.id }),
    })
  );
}

/**
 * Pins a package to an exact version for a bound source (see the module description for the
 * order). At most two requests, both cached by the gateway; none when the package is installed.
 *
 * @throws McpDocError `VERSION_UNAVAILABLE` when the requested version was never published;
 *   otherwise what the gateway reports for the registry or jsDelivr.
 */
export async function resolvePackageVersion(
  ctx: Ctx,
  src: BoundSource,
  name: string,
): Promise<ResolvedPackage> {
  const requested = requestedVersion(src);
  const local = await findLocalPackage(ctx, name);
  if (
    local !== undefined &&
    isExactVersion(local.version) &&
    (requested === undefined || satisfiesRequest(local.version, requested))
  ) {
    return { name, version: local.version, how: 'local', local };
  }
  return requested === undefined
    ? resolveCurrent(ctx, src, name)
    : resolveRequested(ctx, src, name, requested);
}

/**
 * A notice for answers that do not describe the current release, so the agent knows which
 * build it is reading; `undefined` when the version is the current one.
 */
export function versionNotice(pkg: ResolvedPackage): string | undefined {
  if (pkg.how === 'local') {
    return `Read from ${pkg.name} ${pkg.version} as installed in the project's node_modules.`;
  }
  if (pkg.how === 'requested') {
    return `Read from ${pkg.name} ${pkg.version}, the published release matching the requested version.`;
  }
  return undefined;
}
