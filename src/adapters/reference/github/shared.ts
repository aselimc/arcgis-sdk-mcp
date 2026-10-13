/**
 * Small building blocks every part of the `github-repo` adapter uses: URL shapes, catalogue
 * records, render metadata, call options and a bounded parallel map.
 */
import { humanizeSlug } from '../../../core/adapter-helpers.js';
import { budgetExhausted } from '../../../core/async.js';
import { McpDocError, toMcpDocError } from '../../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import type {
  BoundSource,
  Ctx,
  GithubCallOptions,
  HttpResponse,
  ReadTarget,
  RenderMeta,
  RenderOptions,
} from '../../../core/ports.js';
import type { CatalogRecord, DocKind, DocPage, LicenseTier } from '../../../core/types.js';

/** A `github-repo` source bound to a product and version line. */
export type GithubSource = BoundSource<'github-repo'>;

/**
 * A repository opened for one enumeration or read: where it is read from and under which
 * licence. Created by `openScope` (`pin.ts`). `ref`, `pinned` and `version` change when a
 * missing release tag makes the read fall back to the default branch.
 */
export interface RepoScope {
  /** `owner/name` as written in the registry. */
  repo: string;
  defaultBranch: string;
  license: LicenseTier;
  /** Branch, tag or commit the content is read at. */
  ref: string;
  /** True when `ref` cannot move (a release tag or commit), so responses never expire. */
  pinned: boolean;
  /** The exact product version `ref` stands for, when it is a release tag. */
  version?: string;
  /** Sentences for `DocPage.notices`: a fallback that happened, an archived repository. */
  notices: string[];
}

const GITHUB = 'https://github.com';

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** The github.com URL of a file: the public ref of everything read from the raw host. */
export function blobUrl(repo: string, ref: string, path: string): string {
  return `${GITHUB}/${repo}/blob/${encodeURIComponent(ref)}/${encodePath(path)}`;
}

/** The github.com URL of a directory (`path` empty: the repository at `ref`). */
export function treeUrl(repo: string, ref: string, path = ''): string {
  const base = `${GITHUB}/${repo}/tree/${encodeURIComponent(ref)}`;
  return path === '' ? base : `${base}/${encodePath(path)}`;
}

/** The github.com URL of a wiki page; `page` may carry the directory it lives in. */
export function wikiUrl(repo: string, page: string): string {
  return `${GITHUB}/${repo}/wiki/${encodePath(page)}`;
}

/** Options of a GitHub client call: the source's budget and, for raw files, the TTL class. */
export function callOptions(src: GithubSource, scope?: RepoScope): GithubCallOptions {
  return {
    ...(src.budget === undefined ? {} : { budget: src.budget }),
    // A branch can move, which is the client's default; only a pinned ref is immutable.
    ...(scope?.pinned === true ? { ttl: 'immutable' as const } : {}),
  };
}

/** Requests the source's budget still allows; unlimited when the source is bound to none. */
export function requestsLeft(src: GithubSource): number {
  return src.budget === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, src.budget.maxRequests - src.budget.used);
}

/** `a/b/c.md` gives `a/b`; a file at the root gives the empty string. */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The last segment of a path. */
export function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Lower-case extension without the dot; empty when the file has none. */
export function extensionOf(path: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(baseOf(path))?.[1]?.toLowerCase() ?? '';
}

/**
 * A readable title from a file or directory name of any naming style: `Add 3D tiles layer`
 * is kept, `add-3d-tiles-layer` and `add_3d_tiles_layer` become `Add 3d tiles layer`,
 * `DisplayKMLNetworkLinks` becomes `Display KML network links`, `Add3DTilesLayer` becomes
 * `Add 3D tiles layer`, and a numeric ordering prefix (`01-getting-started`) is dropped.
 * A dotted name (`3DSceneLayer.cmn`, an object of a specification) is an identifier and is
 * kept as written.
 */
export function titleFromName(name: string): string {
  const base = baseOf(name).replace(/^\d{1,3}[-_](?=[A-Za-z])/, '');
  const plain = humanizeSlug(base);
  if (plain.includes(' ')) return plain;
  // An identifier keeps its own first letter, which `humanizeSlug` has capitalised.
  if (plain.includes('.')) return base.charAt(0) + plain.slice(1);
  const words = plain
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z0-9]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ');
  return words
    .map((word, index) => (index === 0 || /^[A-Z0-9]+$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}

/** Ancestor directory names as a breadcrumb; `undefined` when there are none. */
export function breadcrumbOf(names: readonly string[]): string | undefined {
  const titles = names.filter((name) => name !== '').map(titleFromName);
  return titles.length === 0 ? undefined : titles.join(BREADCRUMB_SEPARATOR);
}

/** A catalogue record with the fields every record of a repository shares. */
export function recordOf(
  src: GithubSource,
  scope: RepoScope,
  ref: string,
  kind: DocKind,
  title: string,
): CatalogRecord {
  return {
    ref,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind,
    title,
    license: scope.license,
  };
}

/**
 * What a renderer needs to know about a document of the repository. `url` is the public
 * github.com URL (never the raw one) and may carry the fragment of the request.
 */
export function metaOf(
  src: GithubSource,
  scope: RepoScope,
  url: string,
  kind: DocKind,
  res: HttpResponse,
): RenderMeta {
  return {
    url,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind,
    license: scope.license,
    res,
    ...(scope.version === undefined ? {} : { version: scope.version }),
    // The CC BY-ND attribution line names the specification, which is the product.
    ...(scope.license === 'cc-by-nd' ? { specName: src.product.name } : {}),
  };
}

/**
 * The renderer options of a read. Content under CC BY-ND is passed through unchanged, so
 * `verbatim` is set whatever the target asks for.
 */
export function renderOptionsOf(target: ReadTarget, scope: RepoScope): RenderOptions | undefined {
  const opts: RenderOptions = {
    ...(target.select === undefined ? {} : { select: target.select }),
    ...(target.detail === undefined ? {} : { detail: target.detail }),
    ...(scope.license === 'cc-by-nd' ? { verbatim: true } : {}),
  };
  return Object.keys(opts).length === 0 ? undefined : opts;
}

/** Adds the scope's notices (a branch fallback, an archived repository) to a rendered page. */
export function withNotices(page: DocPage, scope: RepoScope, extra: string[] = []): DocPage {
  const notices = [...scope.notices, ...extra];
  return notices.length === 0 ? page : { ...page, notices: [...page.notices, ...notices] };
}

/** `DOC_NOT_FOUND` for a URL of the repository that names nothing readable. */
export function notFound(url: string, what: string, why: string): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', what, { why, url, host: new URL(url).host });
}

/**
 * Decides what to do with a failure of one optional request (a snippet file, a metadata
 * file, one body of an index scan). Returns after logging when the content is simply not
 * there or upstream is failing; rethrows a defect (`INTERNAL`), because that is ours to fix.
 *
 * @returns `true` when the request budget is spent, so the caller stops asking for more.
 */
export function tolerate(ctx: Ctx, src: GithubSource, error: unknown, what: string): boolean {
  const typed = toMcpDocError(error);
  if (typed.code === 'INTERNAL') throw typed;
  ctx.logger.debug(`${what} was skipped`, {
    product: src.product.id,
    source: src.source.id,
    code: typed.code,
    url: typed.details?.url,
  });
  return src.budget !== undefined && budgetExhausted(src.budget, ctx.clock);
}

/**
 * Maps `items` with at most `limit` calls in flight, keeping the input order. The GitHub
 * client's limiter spaces the requests; this only bounds how many wait at once.
 */
export async function mapPool<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results = new Array<O>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as I, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
