/**
 * The canary of a source: one request for the URL the registry declares (`SourceDef.probe`)
 * and a check of what it promises.
 */
import { toMcpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx, HttpRequest, ProbeResult } from '../../core/ports.js';
import { parseSitemap } from '../../core/sitemap.js';
import { absoluteUrl, assertLive, budgetOf } from './source.js';

/** Options of {@link probeSource}. */
export interface ProbeOptions {
  /**
   * True when the canary is a site-published index file, which may only be requested while
   * `site-index` is enabled. Default `false`: a page, a sitemap, an API description and a
   * package registry need no capability beyond the source's own. See {@link isIndexCanary}.
   */
  siteIndex?: boolean;
  /** Counts the records of a body the default counter does not understand. */
  count?: (text: string) => number | undefined;
  /**
   * `base64` for a binary canary (a Sphinx inventory). The checks and `count` then see the
   * bytes as a Latin-1 string, one character per byte.
   */
  encoding?: 'base64';
  /** TTL class of the request. Default: `page` for an HTML canary, `index` otherwise. */
  ttl?: HttpRequest['ttl'];
  /**
   * True for a source that addresses versions itself (a package registry): its canary is
   * requested on a `link-only` line too, because that line stops website requests only.
   */
  versionAddressed?: boolean;
}

/**
 * True when the canary of an API reference is its index file: every canary of such a source
 * that is not an HTML page is one (an inventory, a search index, a link list in JSON).
 */
export function isIndexCanary(src: BoundSource): boolean {
  return src.source.probe.expect !== 'html';
}

/**
 * Number of records in a JSON index body: the stored documents of an Astro search file (a
 * MiniSearch dump kept as a JSON string inside the document), the paths of an API
 * description, else array length or key count.
 */
function jsonRecordCount(text: string): number | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
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

/**
 * Runs the canary a source declares in the registry with one request and checks what it
 * promises: record count of a sitemap or JSON index, length, HTML family and a marker
 * string. Never rejects: a failure is `ok: false` with the reason.
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
    if (options.versionAddressed !== true) assertLive(src, url);
    if (options.siteIndex === true && !ctx.policy.enabled('site-index')) {
      return finish({ ok: false, error: 'Capability "site-index" is switched off' });
    }
    const page = probe.expect === 'html';
    const res = await ctx.http.get({
      url,
      expect: probe.expect,
      ttl: options.ttl ?? (page ? 'page' : 'index'),
      ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
      ...budgetOf(src),
    });
    const text =
      options.encoding === 'base64' ? Buffer.from(res.text, 'base64').toString('latin1') : res.text;
    const chars = text.length;
    const family = page ? ctx.render.detectFamily(text) : undefined;
    const records =
      options.count?.(text) ??
      (probe.expect === 'xml'
        ? parseSitemap(text).entries.length
        : probe.expect === 'json'
          ? jsonRecordCount(text)
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
    } else if (probe.mustContain !== undefined && !text.includes(probe.mustContain)) {
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
