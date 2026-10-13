/**
 * What the current release knows about a book of an earlier one.
 *
 * ArcGIS Pro documents its current release on doc.esri.com (`docfx-esri`) and keeps the
 * earlier ones on pro.arcgis.com in the older layout (`legacy-help`). The two are the same
 * books: a topic keeps its path from release to release, `arcpy/data-access/searchcursor-class`
 * with `.html` here and `.htm` there. The registry describes the current release with what
 * its Python references need (`symbols: 'toc'`: a class or tool per page), and the earlier
 * ones as plain help. This module carries that knowledge over:
 *
 * - {@link symbolNamer}: the symbol a topic of an earlier release documents, by the naming
 *   rule of its current twin, so that `arcpy.da.SearchCursor` can be looked up in a version;
 * - {@link listFromCurrent}: the topics of a book as the current release lists them, for a
 *   release that publishes no listing of its own.
 */
import { bindSource } from '../../core/adapter-helpers.js';
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type { BoundSource, Ctx } from '../../core/ports.js';
import type { AnySourceDef, CatalogRecord } from '../../core/types.js';
import { tocCatalogue, tocSymbolNamer } from './docfx-esri.js';

/** The fields of a record that name a symbol; a listing of topics has none of them. */
export type SymbolFields = Pick<
  CatalogRecord,
  'symbol' | 'qualified' | 'symbolKind' | 'keywords' | 'language'
>;

/** A topic of a book, as a listing gives it. */
export interface ListedTopic {
  ref: string;
  title: string;
  /** Titles of the groups the topic sits under, outermost first. */
  ancestors: string[];
  /** Present when the listing names the symbol the topic documents. */
  symbol?: SymbolFields;
}

/** The current release of a book: the source that documents it, and the book's place in it. */
export interface CurrentTwin {
  source: BoundSource<'docfx-esri'>;
  /** The base URL of the source's scope, which topic paths are relative to. */
  scopeUrl: string;
  /** The book's directory below that scope, with a trailing slash; empty for the scope itself. */
  within: string;
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * The source of the same product that documents the current release of a book: a
 * `docfx-esri` source whose `scope` is the book's directory or a directory above it, bound
 * to the product's current line.
 */
export function currentTwin(src: BoundSource, bookPath: string): CurrentTwin | undefined {
  const book = trimSlashes(bookPath);
  const current = src.product.lines.find((line) => line.current);
  if (current === undefined) return undefined;
  for (const candidate of src.product.sources as readonly AnySourceDef[]) {
    if (candidate.adapter !== 'docfx-esri') continue;
    const scope = trimSlashes(candidate.config.scope ?? '');
    if (scope === '' || (book !== scope && !book.startsWith(`${scope}/`))) continue;
    const source = bindSource(src.product, candidate, current, undefined, src.budget);
    const within = book === scope ? '' : `${book.slice(scope.length + 1)}/`;
    return { source, scopeUrl: source.url(`${scope}/`), within };
  }
  return undefined;
}

/** `mapping/map-class.htm` as the current release spells it. */
function currentPath(path: string): string {
  return path.replace(/\.htm(?=$|[?#])/, '.html');
}

/** `mapping/map-class.html` as an earlier release spells it. */
function earlierPath(path: string): string {
  return path.replace(/\.html(?=$|[?#])/, '.htm');
}

/**
 * The naming rule of a book's current twin, for topics of the earlier release: given a
 * topic and its path below the twin's scope (`data-access/searchcursor-class.htm`), the
 * symbol it documents, or `undefined` for a topic that documents none. No request is made;
 * names the current release corrected from its own pages are honoured.
 */
export async function symbolNamer(
  ctx: Ctx,
  twin: CurrentTwin,
): Promise<
  (topic: Pick<ListedTopic, 'title' | 'ancestors'>, path: string) => SymbolFields | undefined
> {
  const name = await tocSymbolNamer(ctx, twin.source);
  return (topic, path) => {
    const fields = name({ title: topic.title, ancestors: topic.ancestors }, currentPath(path));
    return fields === undefined ? undefined : { ...fields, language: 'python' };
  };
}

/**
 * The topics of a book as its current twin lists them, addressed in the earlier release
 * (`base` is the book's directory there). A page that was added since is listed too and
 * answers "not found" when it is read: that is the price of a release without a listing,
 * and only pages the release never had pay it.
 *
 * @param onFailure decides whether a table of contents that cannot be read may be skipped.
 */
export async function listFromCurrent(
  ctx: Ctx,
  twin: CurrentTwin,
  base: string,
  onFailure: (error: unknown, what: string) => void,
): Promise<ListedTopic[]> {
  const from = `${twin.scopeUrl}${twin.within}`;
  const topics: ListedTopic[] = [];
  for (const record of await tocCatalogue(ctx, twin.source, onFailure)) {
    if (!record.ref.startsWith(from) || record.ref === from) continue;
    const { symbol, qualified, symbolKind, keywords, language } = record;
    topics.push({
      ref: `${base}${earlierPath(record.ref.slice(from.length))}`,
      title: record.title,
      ancestors: record.breadcrumb?.split(BREADCRUMB_SEPARATOR) ?? [],
      ...(symbol === undefined
        ? {}
        : {
            symbol: {
              symbol,
              ...(qualified === undefined ? {} : { qualified }),
              ...(symbolKind === undefined ? {} : { symbolKind }),
              ...(keywords === undefined ? {} : { keywords }),
              ...(language === undefined ? {} : { language }),
            },
          }),
    });
  }
  return topics;
}
