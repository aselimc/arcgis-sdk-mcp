/**
 * From a read target to a rendered page: the metadata and options a renderer is given, the
 * target of a symbol record, and the reading of one HTML page through the gateway.
 */
import type {
  BoundSource,
  Ctx,
  HttpResponse,
  ReadTarget,
  RenderMeta,
  RenderOptions,
} from '../../core/ports.js';
import type { CatalogRecord, DocKind, DocPage, HtmlFamily } from '../../core/types.js';
import { assertLive, budgetOf, licenseOf } from './source.js';
import { safeDecode } from './text.js';

/**
 * The metadata a renderer needs for a page of a source. The kind is the one of the record
 * that led to the page, else `kind`.
 */
export function renderMeta(
  src: BoundSource,
  target: Pick<ReadTarget, 'record'>,
  url: string,
  res?: HttpResponse,
  kind: DocKind = 'api',
): RenderMeta {
  return {
    url,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind: target.record?.kind ?? kind,
    license: licenseOf(src),
    ...(res === undefined ? {} : { res }),
  };
}

/**
 * The renderer options a read target asks for, with `extra` on top (a selector the adapter
 * derived itself, `verbatim` for content that may not be rewritten); `undefined` when
 * nothing is asked for. Undefined values of `extra` leave the target's own in place.
 */
export function renderOptionsOf(
  target: Pick<ReadTarget, 'select' | 'detail' | 'focusedCode'>,
  extra: { [K in keyof RenderOptions]?: RenderOptions[K] | undefined } = {},
): RenderOptions | undefined {
  const wanted = {
    select: target.select,
    detail: target.detail,
    focusedCode: target.focusedCode,
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
  };
  const opts = Object.fromEntries(
    Object.entries(wanted).filter(([, value]) => value !== undefined),
  ) as RenderOptions;
  return Object.keys(opts).length === 0 ? undefined : opts;
}

/**
 * The read target of a symbol record. A member that shares its page with others is selected
 * by the exact anchor the index gave (the fragment of its ref), which tells overloads apart;
 * a member with a page of its own needs no selector.
 */
export function symbolTarget(record: CatalogRecord, detail: ReadTarget['detail']): ReadTarget {
  const url = new URL(record.ref);
  const member =
    record.parent !== undefined && url.hash.length > 1 ? safeDecode(url.hash.slice(1)) : undefined;
  return {
    url,
    record,
    ...(detail === undefined ? {} : { detail }),
    ...(member === undefined ? {} : { select: { member } }),
  };
}

/** Options of {@link readHtmlPage}. */
export interface HtmlPageOptions {
  /** Kind of the page when no catalogue record led to it. Default `api`. */
  kind?: DocKind;
  /** Family hint for the renderer. Default: the family the source's canary declares. */
  family?: HtmlFamily;
}

/**
 * Fetches one HTML page and converts it with the `html` renderer.
 *
 * The page's ref is the URL as requested, fragment included; when the gateway followed a
 * redirect or meta-refresh it is the URL that produced the body, and the hops appear in
 * `DocPage.redirectedFrom`.
 *
 * @throws McpDocError `LINK_ONLY` on a link-only line, otherwise whatever the gateway reports.
 */
export async function readHtmlPage(
  ctx: Ctx,
  src: BoundSource,
  target: ReadTarget,
  options: HtmlPageOptions = {},
): Promise<DocPage> {
  assertLive(src, target.url.href);
  const requested = target.url.href.replace(/#.*$/, '');
  const res = await ctx.http.get({ url: requested, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const landed = res.finalUrl === res.url ? requested : res.finalUrl.replace(/#.*$/, '');
  const family = options.family ?? src.source.probe.family;
  return ctx.render.render(
    'html',
    { html: res.text, ...(family === undefined ? {} : { familyHint: family }) },
    renderMeta(src, target, `${landed}${target.url.hash}`, res, options.kind),
    renderOptionsOf(target),
  );
}
