/**
 * Reading one page of a gatsby source. Depending on the body mode the page comes from its
 * page-data (structured or pre-rendered, see `body.ts`) or from the HTML page; a page-data
 * that is missing, unreadable or without a body always falls back to the HTML.
 */
import { toMcpDocError } from '../../../core/errors.js';
import type { BoundSource, Ctx, ReadTarget, RenderMeta } from '../../../core/ports.js';
import type { CatalogRecord, DocPage, SymbolDetail } from '../../../core/types.js';
import { assertLive, budgetOf, continueWithout, licenseOf, renderOptionsOf } from '../static.js';
import {
  bodyModeOf,
  bodyVariantOf,
  renderVariant,
  type BodyMode,
  type BodyVariant,
} from './body.js';
import { pageKind } from './catalog.js';
import { fetchPageData, type PageData } from './page-data.js';
import { rememberPrefix, storedPrefix } from './prefix.js';
import { GatsbySession } from './session.js';
import { pageKey, prefixCandidates, relativeTo, sitePrefixPath } from './site.js';

/** Requests one read may spend on page-data: one per prefix candidate. */
const MAX_PAGE_DATA_REQUESTS = 3;

/** A body found in page-data together with where it was found. */
interface FoundBody {
  variant: BodyVariant;
  pageData: PageData;
  prefix: string;
}

function decodedFragment(url: URL): string | undefined {
  const raw = url.hash.replace(/^#/, '');
  if (raw === '') return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Looks for the body of a page in its page-data. The site prefix is the remembered one, or
 * is found by trying the base and its parents; a page without page-data, a failing request
 * and a page-data without a body all give `undefined`.
 */
async function bodyFromPageData(
  ctx: Ctx,
  src: BoundSource<'gatsby'>,
  page: string,
  mode: BodyMode,
): Promise<FoundBody | undefined> {
  const base = src.url();
  const remembered = await storedPrefix(ctx, base);
  const candidates = remembered === undefined ? prefixCandidates(base) : [remembered];
  const session = new GatsbySession(ctx, src, MAX_PAGE_DATA_REQUESTS);
  for (const prefix of candidates) {
    if (relativeTo(prefix, page) === undefined) continue;
    let pageData: PageData;
    try {
      pageData = await fetchPageData(session, prefix, page);
    } catch (error) {
      // The HTML page is the next rung; only a spent budget or a defect ends the read here.
      continueWithout(ctx, src, error, `Page-data of ${page}`);
      if (toMcpDocError(error).code === 'DOC_NOT_FOUND') continue;
      return undefined;
    }
    if (remembered === undefined) await rememberPrefix(ctx, base, prefix);
    const variant = bodyVariantOf(pageData.data, mode);
    return variant === undefined ? undefined : { variant, pageData, prefix };
  }
  return undefined;
}

/** Fills what a renderer could not know: a missing title, and the breadcrumb of the record. */
function complete(page: DocPage, target: ReadTarget, title: string): DocPage {
  const breadcrumb = page.breadcrumb ?? target.record?.breadcrumb;
  const fallback = title !== '' ? title : (target.record?.title ?? '');
  return {
    ...page,
    title: page.title.trim() === '' ? fallback : page.title,
    ...(breadcrumb === undefined || breadcrumb === '' ? {} : { breadcrumb }),
  };
}

/** Renderer kinds whose input is generated API documentation. */
const API_RENDERERS: ReadonlySet<BodyVariant['renderer']> = new Set([
  'openapi',
  'typedoc',
  'sphinx',
] as const);

/**
 * Fetches and converts one page.
 *
 * The page's ref is the URL as requested, fragment included; after a redirect or
 * meta-refresh of the HTML page it is the URL that produced the body. Content of tier
 * `cc-by-nd` (specifications) is rendered verbatim and attributed to the specification.
 *
 * @throws McpDocError `LINK_ONLY` on a link-only line; otherwise what the gateway reports
 *   for the HTML page (a failing page-data request alone never fails a read).
 */
export async function readGatsby(
  ctx: Ctx,
  src: BoundSource<'gatsby'>,
  target: ReadTarget,
): Promise<DocPage> {
  assertLive(src, target.url.href);
  const page = pageKey(target.url.href);
  const rel = relativeTo(src.url(), page) ?? '';
  const mode = bodyModeOf(src.source.config);
  const found = mode === 'html' ? undefined : await bodyFromPageData(ctx, src, page, mode);

  const license = licenseOf(src);
  const base = {
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    license,
    // A specification is quoted under its own name (tier cc-by-nd).
    ...(license === 'cc-by-nd' ? { specName: src.product.name } : {}),
  };
  const options = {
    ...renderOptionsOf(target),
    ...(license === 'cc-by-nd' ? { verbatim: true } : {}),
  };
  const opts = Object.keys(options).length === 0 ? undefined : options;

  if (found === undefined) {
    const requested = new URL(target.url.href);
    requested.hash = '';
    const res = await ctx.http.get({
      url: requested.href,
      expect: 'html',
      ttl: 'page',
      ...budgetOf(src),
    });
    const landed = res.finalUrl === res.url ? requested.href : res.finalUrl.replace(/#.*$/, '');
    const family = src.source.probe.family;
    const meta: RenderMeta = {
      ...base,
      url: `${landed}${target.url.hash}`,
      kind: target.record?.kind ?? pageKind(src, rel),
      res,
    };
    const html = { html: res.text, ...(family === undefined ? {} : { familyHint: family }) };
    return complete(ctx.render.render('html', html, meta, opts), target, '');
  }

  // A page that is generated from an API description is API documentation wherever it lives.
  const symbolKind = API_RENDERERS.has(found.variant.renderer) ? 'api' : undefined;
  const meta: RenderMeta = {
    ...base,
    url: target.url.href,
    kind: target.record?.kind ?? pageKind(src, rel, { symbolKind }),
    res: found.pageData.res,
  };
  const rendered = renderVariant(ctx, found.variant, {
    meta,
    opts,
    fragment: decodedFragment(target.url),
    sitePrefix: sitePrefixPath(found.prefix),
  });
  return complete(rendered, target, found.variant.title);
}

/**
 * Renders one symbol record. A member is selected by its anchor on the type's page (the id
 * its section carries), any other anchored record by the section of that name.
 */
export function symbolGatsby(
  ctx: Ctx,
  src: BoundSource<'gatsby'>,
  record: CatalogRecord,
  detail: SymbolDetail,
): Promise<DocPage> {
  const anchor = record.locator?.anchor ?? decodedFragment(new URL(record.ref));
  const select =
    record.parent !== undefined
      ? { member: anchor ?? record.symbol ?? record.title }
      : anchor === undefined
        ? undefined
        : { section: anchor };
  return readGatsby(ctx, src, {
    url: new URL(record.ref),
    detail,
    record,
    ...(select === undefined ? {} : { select }),
  });
}
