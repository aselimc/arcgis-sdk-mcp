/**
 * Reading one file of a pinned package: from the installed copy when there is one, else from
 * jsDelivr. Callers get the content together with where it came from, in the form the
 * renderers need for provenance.
 */
import type { BoundSource, Ctx, HttpResponse, RenderMeta } from '../../../core/ports.js';
import { fetchPackageJson, fetchPackageText, jsdelivrFileUrl } from './jsdelivr.js';
import { readLocalFile } from './local-packages.js';
import type { ResolvedPackage } from './resolve-version.js';
import { kindOf, licenseOf } from './shared.js';

/** Where the content of a package file came from. */
export interface PackageFileOrigin {
  /** The pinned jsDelivr URL of the file, also when the installed copy was read. */
  url: string;
  /** The response, for content fetched through the gateway. */
  res?: HttpResponse;
  /** ISO timestamp, for content read from the installed copy. */
  retrievedAt?: string;
}

/** A text file of a package. */
export interface PackageText extends PackageFileOrigin {
  text: string;
}

/** A parsed JSON file of a package. */
export interface PackageJson extends PackageFileOrigin {
  data: unknown;
}

/**
 * Reads a text file of a pinned package.
 *
 * @throws McpDocError as the gateway reports; `DOC_NOT_FOUND` when the version has no such file.
 */
export async function loadPackageText(
  ctx: Ctx,
  src: BoundSource,
  pkg: ResolvedPackage,
  path: string,
): Promise<PackageText> {
  const url = jsdelivrFileUrl(pkg.name, pkg.version, path);
  if (pkg.local !== undefined) {
    const text = await readLocalFile(pkg.local, path, ctx.config.limits.pageMaxBytes);
    if (text !== undefined) return { text, url, retrievedAt: ctx.clock.iso() };
  }
  const res = await fetchPackageText(ctx, src, pkg.name, pkg.version, path);
  return { text: res.text, url, res };
}

/** What the memo keeps of a parsed file: the data, and the response without its body. */
interface ParsedFile {
  data: unknown;
  res?: HttpResponse;
}

async function parseLocal(ctx: Ctx, pkg: ResolvedPackage, path: string) {
  if (pkg.local === undefined) return undefined;
  const text = await readLocalFile(pkg.local, path, ctx.config.limits.indexMaxBytes);
  if (text === undefined) return undefined;
  try {
    return { data: JSON.parse(text) as unknown, chars: text.length };
  } catch {
    // A damaged installed copy is not the last word: the published file is tried next.
    return undefined;
  }
}

/**
 * Reads and parses a JSON file of a pinned package. A component manifest is megabytes of
 * JSON and is read once per member lookup, so the parsed value is kept in the in-memory memo
 * under its pinned URL (the content of a published version never changes).
 *
 * @throws McpDocError as the gateway reports.
 */
export async function loadPackageJson(
  ctx: Ctx,
  src: BoundSource,
  pkg: ResolvedPackage,
  path: string,
): Promise<PackageJson> {
  const url = jsdelivrFileUrl(pkg.name, pkg.version, path);
  let fetchedNow = false;
  const parsed = await ctx.cache.memo<ParsedFile>(`npm-file:${url}`, async () => {
    const local = await parseLocal(ctx, pkg, path);
    if (local !== undefined) return { value: { data: local.data }, bytes: local.chars * 2 };
    const { data, res } = await fetchPackageJson(ctx, src, pkg.name, pkg.version, path);
    fetchedNow = true;
    // Two bytes per UTF-16 code unit approximates the parsed size; the body itself is not kept.
    return { value: { data, res: { ...res, text: '' } }, bytes: res.text.length * 2 };
  });
  if (parsed.res === undefined) return { data: parsed.data, url, retrievedAt: ctx.clock.iso() };
  // A value served from the memo was not fetched for this call.
  const cache = fetchedNow || parsed.res.cache === 'stale' ? parsed.res.cache : 'hit';
  return { data: parsed.data, url, res: { ...parsed.res, cache } };
}

/**
 * The render metadata of an entry read from a package file: the public ref, the exact
 * version and package for the attribution line, and the origin of the content.
 */
export function packageMeta(
  src: BoundSource,
  pkg: ResolvedPackage,
  origin: PackageFileOrigin,
  url: string,
): RenderMeta {
  return {
    url,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    version: pkg.version,
    kind: kindOf(src),
    license: licenseOf(src),
    packageName: pkg.name,
    ...(origin.res === undefined
      ? { retrievedAt: origin.retrievedAt ?? '' }
      : { res: origin.res }),
  };
}
