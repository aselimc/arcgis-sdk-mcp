/**
 * jsDelivr access for npm packages: one file of a package at a pinned version, the file list
 * of a version, and the resolution of a version specifier. URL shapes are the ones verified
 * in the research (`js-web.md` section 2); every request goes through the gateway.
 */
import { McpDocError } from '../../../core/errors.js';
import type { BoundSource, Ctx, HttpResponse } from '../../../core/ports.js';
import { budgetOf } from '../../kit/index.js';
import { isRecord, records, shapeError, str } from './shared.js';

/** Base of single-file URLs: `<base>/<package>@<version>/<path>`. */
export const JSDELIVR_CDN = 'https://cdn.jsdelivr.net/npm';

/** Base of the metadata API: `<base>/<package>@<version>` and `<base>/<package>/resolved`. */
export const JSDELIVR_API = 'https://data.jsdelivr.com/v1/packages/npm';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** True for a complete version number (`5.1.27`, `5.2.0-next.145`), false for ranges and tags. */
export function isExactVersion(version: string): boolean {
  return EXACT_VERSION.test(version);
}

/**
 * Only pinned URLs are ever requested: they are immutable, so they can be cached for good,
 * and the answer states exactly which release it describes.
 */
function assertPinned(name: string, version: string): void {
  if (isExactVersion(version)) return;
  throw new McpDocError('INTERNAL', 'Internal error', {
    why: `"${version}" of ${name} is not an exact version; package files are read pinned`,
  });
}

/**
 * The URL of one file of a package at an exact version.
 *
 * @throws McpDocError `INTERNAL` when `version` is a range or a tag: a caller forgot to resolve it.
 */
export function jsdelivrFileUrl(name: string, version: string, path: string): string {
  assertPinned(name, version);
  return `${JSDELIVR_CDN}/${name}@${version}/${encodeURI(path.replace(/^\/+/, ''))}`;
}

/**
 * Fetches one text file (a declaration file) of a package at an exact version.
 *
 * @throws McpDocError as the gateway reports; `DOC_NOT_FOUND` when the version has no such file.
 */
export function fetchPackageText(
  ctx: Ctx,
  src: BoundSource,
  name: string,
  version: string,
  path: string,
): Promise<HttpResponse> {
  return ctx.http.get({
    url: jsdelivrFileUrl(name, version, path),
    expect: 'text',
    ttl: 'immutable',
    ...budgetOf(src),
  });
}

/**
 * Fetches and parses one JSON file of a package at an exact version. Manifests of the larger
 * component packages are several megabytes, so the index size cap applies.
 *
 * @throws McpDocError as the gateway reports.
 */
export function fetchPackageJson(
  ctx: Ctx,
  src: BoundSource,
  name: string,
  version: string,
  path: string,
): Promise<{ data: unknown; res: HttpResponse }> {
  return ctx.http.getJson({
    url: jsdelivrFileUrl(name, version, path),
    ttl: 'immutable',
    maxBytes: ctx.config.limits.indexMaxBytes,
    ...budgetOf(src),
  });
}

/**
 * Every file of a package version, as paths relative to the package root (no leading slash).
 * One request, whatever the size of the package.
 *
 * @throws McpDocError as the gateway reports; `UPSTREAM_UNAVAILABLE` (not retryable) when the
 *   listing has no `files` array.
 */
export async function listPackageFiles(
  ctx: Ctx,
  src: BoundSource,
  name: string,
  version: string,
): Promise<Array<{ path: string; size?: number }>> {
  assertPinned(name, version);
  const url = `${JSDELIVR_API}/${name}@${version}?structure=flat`;
  const { data } = await ctx.http.getJson({
    url,
    ttl: 'immutable',
    maxBytes: ctx.config.limits.indexMaxBytes,
    ...budgetOf(src),
  });
  if (!isRecord(data) || !Array.isArray(data.files)) throw shapeError(url, 'a file listing');
  return records(data.files).flatMap((file) => {
    const path = str(file.name)?.replace(/^\/+/, '');
    if (path === undefined || path === '') return [];
    return [{ path, ...(typeof file.size === 'number' ? { size: file.size } : {}) }];
  });
}

/**
 * Resolves a version specifier of a package (`4.33`, `^5.1.0`, `latest`) to the highest
 * published version it matches.
 *
 * @returns the exact version, or `undefined` when no published version matches.
 * @throws McpDocError as the gateway reports; `DOC_NOT_FOUND` for a package jsDelivr does not know.
 */
export async function resolveSpecifier(
  ctx: Ctx,
  src: BoundSource,
  name: string,
  specifier: string,
): Promise<string | undefined> {
  const url = `${JSDELIVR_API}/${name}/resolved?specifier=${encodeURIComponent(specifier)}`;
  const { data } = await ctx.http.getJson({
    url,
    // An exact version either exists or does not, for good; a range moves with every release.
    ttl: isExactVersion(specifier) ? 'immutable' : 'volatile',
    ...budgetOf(src),
  });
  if (!isRecord(data) || !('version' in data)) throw shapeError(url, 'a version resolution');
  const version = str(data.version);
  return version !== undefined && isExactVersion(version) ? version : undefined;
}
