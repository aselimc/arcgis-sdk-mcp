/**
 * The contract between the `npm-json` adapter and its mappers. The adapter pins the package
 * and loads the file; a mapper knows the structure of one kind of file and turns it into
 * catalogue records and pages.
 */
import type { BoundSource, Ctx, ReadTarget } from '../../../core/ports.js';
import type { CatalogRecord, DocPage, SymbolDetail } from '../../../core/types.js';
import { JSDELIVR_CDN } from './jsdelivr.js';
import type { PackageJson } from './package-file.js';
import { withVersionNotice, type ResolvedPackage } from './resolve-version.js';
import { docTemplate } from './shared.js';

/** A source of the `npm-json` adapter bound to a product and line. */
export type JsonSrc = BoundSource<'npm-json'>;

/** The loaded file of an `npm-json` source with the package version it was read from. */
export interface LoadedFile {
  pkg: ResolvedPackage;
  file: PackageJson;
}

/** Reads one kind of JSON reference file. Pure apart from the call into `ctx.render`. */
export interface JsonMapper {
  /**
   * Catalogue records of the file.
   *
   * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the file has another shape.
   */
  records(src: JsonSrc, loaded: LoadedFile): CatalogRecord[];
  /**
   * The page a read names.
   *
   * @throws McpDocError `DOC_NOT_FOUND` when the target names nothing in the file.
   */
  page(ctx: Ctx, src: JsonSrc, loaded: LoadedFile, target: ReadTarget): DocPage;
  /**
   * The page of one symbol record, when the mapper can do better than reading the record's
   * page with the member selected; `undefined` to fall back to that.
   */
  symbol?(
    ctx: Ctx,
    src: JsonSrc,
    loaded: LoadedFile,
    record: CatalogRecord,
    detail: SymbolDetail,
  ): DocPage | undefined;
}

/**
 * The unversioned jsDelivr URL of the source's file. It is the ref of entries that have no
 * documentation page: stable across releases, inside the URL prefix the source owns, and
 * never requested (reads are pinned to the resolved version).
 */
export function fileRef(src: JsonSrc): string {
  const { config } = src.source;
  return `${JSDELIVR_CDN}/${config.package}/${config.file}`;
}

/** The source's documentation root with a trailing slash, when it declares a `docUrl`. */
export function docRoot(src: JsonSrc): string | undefined {
  const { docUrl } = src.source.config;
  return docUrl === undefined ? undefined : `${docTemplate(src, docUrl).replace(/\/+$/, '')}/`;
}

/**
 * Labels a page with the package its content was read from, and adds the notice of a page
 * that is not of the current release. The Arcade mappers use it: Arcade is documented in
 * the coding components of the JavaScript SDK, whose bare version number (5.x) would read
 * as a version of Arcade (1.x).
 */
export function fromPackage(page: DocPage, pkg: ResolvedPackage): DocPage {
  return withVersionNotice({ ...page, version: `${pkg.name} ${pkg.version}` }, pkg);
}
