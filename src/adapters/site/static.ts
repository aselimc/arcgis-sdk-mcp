/**
 * The `static` adapter (a fixed list of pages written in the registry) and the page-level
 * building blocks every HTML site adapter in this package shares: reading one page through
 * the gateway and renderer, running a source's canary, and deciding whether an enumeration
 * may continue from a lower rung after a failure.
 */
import { budgetExhausted } from '../../core/async.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { DEVELOPERS_ORIGIN } from '../../core/names.js';
import type {
  BoundSource,
  Ctx,
  HttpRequest,
  ProbeResult,
  ReadTarget,
  RenderOptions,
  SourceAdapter,
} from '../../core/ports.js';
import { parseSitemap } from '../../core/sitemap.js';
import { expandTemplate } from '../../core/source-urls.js';
import type { CatalogRecord, DocKind, DocPage, LicenseTier } from '../../core/types.js';

/**
 * Makes a registry URL absolute for a bound source: line variables are substituted, a full
 * URL is kept, a path starting with `/` belongs to developers.arcgis.com, and anything else
 * is relative to the source root.
 */
export function absoluteUrl(value: string, src: BoundSource): string {
  const expanded = expandTemplate(value, src.line);
  if (/^https?:\/\//i.test(expanded)) return expanded;
  return expanded.startsWith('/') ? `${DEVELOPERS_ORIGIN}${expanded}` : src.url(expanded);
}

/** The licence tier of a source's content: its own, else the product default. */
export function licenseOf(src: BoundSource): LicenseTier {
  return src.source.license ?? src.product.licenseTier;
}

/** The `budget` property of a request, present only when the source is bound to one. */
export function budgetOf(src: BoundSource): Pick<HttpRequest, 'budget'> {
  return src.budget === undefined ? {} : { budget: src.budget };
}

/**
 * Refuses to fetch for a `link-only` version line: its pages live on a host that is never
 * requested, so the answer is the link itself.
 *
 * @throws McpDocError `LINK_ONLY` with the URL in `details.url`.
 */
export function assertLive(src: BoundSource, url: string): void {
  if (src.line.access !== 'link-only') return;
  throw new McpDocError('LINK_ONLY', `${src.product.name} ${src.line.label} is not fetched`, {
    why: `Documentation of version line "${src.line.id}" is available as a link only`,
    url,
    host: new URL(url).host,
  });
}

/** A catalogue record of a source with the fields every record shares. */
export function recordOf(
  src: BoundSource,
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
    license: licenseOf(src),
  };
}

/** The renderer options a read target asks for; `undefined` when it asks for nothing. */
export function renderOptionsOf(target: ReadTarget): RenderOptions | undefined {
  const opts: RenderOptions = {
    ...(target.select === undefined ? {} : { select: target.select }),
    ...(target.detail === undefined ? {} : { detail: target.detail }),
    ...(target.focusedCode === undefined ? {} : { focusedCode: target.focusedCode }),
  };
  return Object.keys(opts).length === 0 ? undefined : opts;
}

/**
 * Fetches one HTML page and converts it with the `html` renderer.
 *
 * The page's ref is the URL as requested, fragment included; when the gateway followed a
 * redirect or meta-refresh it is the URL that produced the body, and the hops appear in
 * `DocPage.redirectedFrom`. The source's `probe.family` is passed as the family hint.
 *
 * @throws McpDocError `LINK_ONLY` on a link-only line, otherwise whatever the gateway reports.
 */
export async function readHtmlPage(
  ctx: Ctx,
  src: BoundSource,
  target: ReadTarget,
  kind: DocKind,
): Promise<DocPage> {
  assertLive(src, target.url.href);
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
  return ctx.render.render(
    'html',
    { html: res.text, ...(family === undefined ? {} : { familyHint: family }) },
    {
      url: `${landed}${target.url.hash}`,
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      kind,
      license: licenseOf(src),
      res,
    },
    renderOptionsOf(target),
  );
}

/**
 * Called when one input of an enumeration failed while another rung can still answer.
 * Returns after logging when the failure is upstream's (a missing, blocked, broken or
 * disabled file); rethrows when the cause is ours: a spent request budget would otherwise
 * turn into a catalogue that silently lacks everything not fetched yet, and an unexpected
 * exception is a defect, not a missing file.
 *
 * @throws McpDocError the failure, typed.
 */
export function continueWithout(ctx: Ctx, src: BoundSource, error: unknown, what: string): void {
  const typed = toMcpDocError(error);
  if (typed.code === 'INTERNAL') throw typed;
  if (src.budget !== undefined && budgetExhausted(src.budget, ctx.clock)) throw typed;
  ctx.logger.warn(`${what} is unavailable; enumerating without it`, {
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    code: typed.code,
    url: typed.details?.url,
  });
}

/** Number of records in a JSON index body, for the shapes this package reads. */
function jsonRecordCount(text: string): number | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
    // Astro search files hold the MiniSearch dump as a JSON string inside the JSON document.
    const inner = (data as { index?: unknown } | null)?.index;
    if (typeof inner === 'string')
      data = (JSON.parse(inner) as { storedFields?: unknown }).storedFields;
  } catch {
    return undefined;
  }
  if (Array.isArray(data)) return data.length;
  if (typeof data !== 'object' || data === null) return undefined;
  const paths = (data as { paths?: unknown }).paths;
  return Object.keys(typeof paths === 'object' && paths !== null ? paths : data).length;
}

/** Options of {@link probeSource}. */
export interface ProbeOptions {
  /** True when the canary URL is a site-published index file, which needs `site-index`. */
  siteIndex?: boolean;
  /** Counts the records of a body the default counter does not understand. */
  count?: (text: string) => number | undefined;
}

/**
 * Runs the canary a source declares in the registry (`SourceDef.probe`) with one request and
 * checks what it promises: record count of a sitemap or JSON index, page length, HTML family
 * and a marker string. Never rejects: a failure is `ok: false` with the reason.
 */
export async function probeSource(
  ctx: Ctx,
  src: BoundSource,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const started = ctx.clock.now();
  const finish = (result: Omit<ProbeResult, 'ms'>): ProbeResult => ({
    ...result,
    ms: ctx.clock.now() - started,
  });
  const probe = src.source.probe;
  try {
    const url = absoluteUrl(probe.url, src);
    assertLive(src, url);
    if (options.siteIndex === true && !ctx.policy.enabled('site-index')) {
      return finish({ ok: false, error: 'Capability "site-index" is switched off' });
    }
    const res = await ctx.http.get({
      url,
      expect: probe.expect,
      ttl: probe.expect === 'html' ? 'page' : 'index',
      ...budgetOf(src),
    });
    const chars = res.text.length;
    const family = probe.expect === 'html' ? ctx.render.detectFamily(res.text) : undefined;
    const records =
      options.count?.(res.text) ??
      (probe.expect === 'xml'
        ? parseSitemap(res.text).entries.length
        : probe.expect === 'json'
          ? jsonRecordCount(res.text)
          : undefined);
    const measured = {
      chars,
      ...(records === undefined ? {} : { records }),
      ...(family === undefined ? {} : { family }),
    };

    let error: string | undefined;
    if (probe.minRecords !== undefined && (records ?? 0) < probe.minRecords) {
      error = `Expected at least ${probe.minRecords} records, found ${records ?? 0}`;
    } else if (probe.minChars !== undefined && chars < probe.minChars) {
      error = `Expected at least ${probe.minChars} characters, found ${chars}`;
    } else if (probe.mustContain !== undefined && !res.text.includes(probe.mustContain)) {
      error = `The response does not contain "${probe.mustContain}"`;
    } else if (probe.family !== undefined && family !== undefined && family !== probe.family) {
      error = `Expected page family ${probe.family}, detected ${family}`;
    }
    return finish(
      error === undefined ? { ok: true, ...measured } : { ok: false, ...measured, error },
    );
  } catch (thrown) {
    const typed = toMcpDocError(thrown);
    const why = typed.details?.why;
    return finish({
      ok: false,
      error: `${typed.code}: ${typed.message}${why === undefined ? '' : ` (${why})`}`,
    });
  }
}

/** The entry of a `static` source that a URL names, compared without fragment. */
function entryFor(src: BoundSource<'static'>, url: URL): { kind: DocKind } | undefined {
  const wanted = url.href.replace(/#.*$/, '');
  return src.source.config.entries.find((entry) => absoluteUrl(entry.url, src) === wanted);
}

/**
 * `static`: pages listed one by one in the registry, for products whose documentation is a
 * handful of known URLs (tombstones, single help pages). Enumeration needs no request.
 */
export const staticAdapter: SourceAdapter<'static'> = {
  type: 'static',
  // Enumeration reads registry data only; the contract asks for a positive budget.
  maxEnumerateRequests: 1,

  enumerate(_ctx, src) {
    const records = new Map<string, CatalogRecord>();
    for (const entry of src.source.config.entries) {
      const ref = absoluteUrl(entry.url, src);
      if (!records.has(ref)) records.set(ref, recordOf(src, ref, entry.kind, entry.title));
    }
    return Promise.resolve([...records.values()]);
  },

  read(ctx, src, target) {
    const kind =
      target.record?.kind ?? entryFor(src, target.url)?.kind ?? src.source.kinds[0] ?? 'guide';
    return readHtmlPage(ctx, src, target, kind);
  },

  probe: (ctx, src) => probeSource(ctx, src),
};
