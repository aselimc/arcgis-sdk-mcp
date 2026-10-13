/**
 * The `dartdoc` adapter (Flutter API references) and the building blocks every API-reference
 * adapter in this directory shares: catalogue records for symbols, the `site-index` gate,
 * reading one HTML page through the gateway and renderer, and running a source's canary.
 * They live next to the simplest adapter of the family, as `static.ts` does for the site
 * adapters, because the two packages may not import each other.
 */
import { budgetExhausted } from '../../core/async.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { BREADCRUMB_SEPARATOR, DEVELOPERS_ORIGIN } from '../../core/names.js';
import type {
  BoundSource,
  Ctx,
  HttpRequest,
  HttpResponse,
  ProbeResult,
  ReadTarget,
  RenderMeta,
  RenderOptions,
  SourceAdapter,
} from '../../core/ports.js';
import { expandTemplate } from '../../core/source-urls.js';
import type { CatalogRecord, DocKind, DocPage, HtmlFamily, LicenseTier } from '../../core/types.js';

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

/** The request for one site-published index file of a source. */
export function indexRequest(
  src: BoundSource,
  url: string,
  expect: HttpRequest['expect'],
): HttpRequest {
  return { url, expect, ttl: 'index', ...budgetOf(src) };
}

/**
 * Whether site-published index files may be requested. The API references in this directory
 * have no rung below their index file, so with `site-index` off they enumerate nothing.
 */
export function siteIndexEnabled(ctx: Ctx, src: BoundSource): boolean {
  if (ctx.policy.enabled('site-index')) return true;
  ctx.logger.info('Capability "site-index" is off; the source is not enumerated', {
    product: src.product.id,
    source: src.source.id,
  });
  return false;
}

/** An index file that arrived but cannot be used: empty, or its fields were renamed. */
export function unusableIndex(url: string, why: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} lists no symbols`, {
    why,
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

/**
 * Called when one input of an enumeration failed while another can still answer. Returns
 * after logging when the failure is upstream's; rethrows when the cause is ours: a spent
 * request budget would otherwise yield a catalogue that silently lacks everything not fetched
 * yet, and an unexpected exception is a defect, not a missing file.
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

/** One line of text from an index entry: whitespace collapsed, capped at `max` characters. */
export function oneLine(text: unknown, max = 240): string | undefined {
  if (typeof text !== 'string') return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Optional fields of a symbol record; `breadcrumb` is given as ancestor titles, outermost first. */
export type RecordExtras = {
  [
    K in Exclude<
      keyof CatalogRecord,
      'ref' | 'product' | 'source' | 'line' | 'title' | 'license' | 'breadcrumb'
    >
  ]?: CatalogRecord[K] | undefined;
} & { breadcrumb?: readonly string[] };

/**
 * A catalogue record of a source. The kind defaults to `api`; undefined and empty extras are
 * left out, so callers pass what the index gave them without checking each field.
 */
export function recordOf(
  src: BoundSource,
  ref: string,
  title: string,
  extras: RecordExtras = {},
): CatalogRecord {
  const { breadcrumb, kind, ...rest } = extras;
  const trail = (breadcrumb ?? []).filter((part) => part !== '');
  const present = Object.entries(rest).filter(([, value]) => value !== undefined && value !== '');
  return {
    ref,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind: kind ?? 'api',
    title,
    ...(trail.length === 0 ? {} : { breadcrumb: trail.join(BREADCRUMB_SEPARATOR) }),
    ...(Object.fromEntries(present) as Partial<CatalogRecord>),
    license: licenseOf(src),
  };
}

/**
 * The metadata a renderer needs for a page of this source. The kind is the one of the record
 * that led to the page, else `kind`.
 */
export function renderMeta(
  src: BoundSource,
  target: ReadTarget,
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

/** The renderer options a read target asks for; `undefined` when it asks for nothing. */
export function renderOptionsOf(target: ReadTarget): RenderOptions | undefined {
  const opts: RenderOptions = {
    ...(target.select === undefined ? {} : { select: target.select }),
    ...(target.detail === undefined ? {} : { detail: target.detail }),
  };
  return Object.keys(opts).length === 0 ? undefined : opts;
}

/**
 * The read target of a symbol record. A member that shares its page with others is selected
 * by the exact anchor the index gave (the fragment of its ref), which tells overloads apart;
 * a member with a page of its own needs no selector.
 */
export function symbolTarget(record: CatalogRecord, detail: ReadTarget['detail']): ReadTarget {
  const url = new URL(record.ref);
  let member: string | undefined;
  if (record.parent !== undefined && url.hash.length > 1) {
    try {
      member = decodeURIComponent(url.hash.slice(1));
    } catch {
      member = url.hash.slice(1);
    }
  }
  return {
    url,
    record,
    ...(detail === undefined ? {} : { detail }),
    ...(member === undefined ? {} : { select: { member } }),
  };
}

/**
 * Fetches one HTML page and converts it with the `html` renderer. The page's ref is the URL
 * as requested, fragment included; after a redirect it is the URL that produced the body.
 *
 * @throws McpDocError `LINK_ONLY` on a link-only line, otherwise whatever the gateway reports.
 */
export async function readHtmlPage(
  ctx: Ctx,
  src: BoundSource,
  target: ReadTarget,
  family: HtmlFamily | undefined = src.source.probe.family,
  kind: DocKind = 'api',
): Promise<DocPage> {
  assertLive(src, target.url.href);
  const requested = target.url.href.replace(/#.*$/, '');
  const res = await ctx.http.get({ url: requested, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const landed = res.finalUrl === res.url ? requested : res.finalUrl.replace(/#.*$/, '');
  return ctx.render.render(
    'html',
    { html: res.text, ...(family === undefined ? {} : { familyHint: family }) },
    renderMeta(src, target, `${landed}${target.url.hash}`, res, kind),
    renderOptionsOf(target),
  );
}

/** Options of {@link probeSource}. */
export interface ProbeOptions {
  /**
   * Whether the canary is a site-published index file, which needs `site-index`. Default:
   * every canary that is not an HTML page.
   */
  siteIndex?: boolean;
  /** Counts the records of the canary body; default: entries of a JSON array or object. */
  count?: (text: string) => number | undefined;
  /**
   * `base64` for a binary canary (a Sphinx inventory). The checks and `count` then see the
   * bytes as a Latin-1 string, one character per byte.
   */
  encoding?: 'base64';
}

function jsonCount(text: string): number | undefined {
  try {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) return data.length;
    return typeof data === 'object' && data !== null ? Object.keys(data).length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs the canary a source declares in the registry with one request and checks what it
 * promises: record count, length, HTML family and a marker string. Never rejects.
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
    const expanded = expandTemplate(probe.url, src.line);
    const url = /^https?:\/\//i.test(expanded)
      ? expanded
      : expanded.startsWith('/')
        ? `${DEVELOPERS_ORIGIN}${expanded}`
        : src.url(expanded);
    assertLive(src, url);
    const page = probe.expect === 'html';
    if ((options.siteIndex ?? !page) && !ctx.policy.enabled('site-index')) {
      return finish({ ok: false, error: 'Capability "site-index" is switched off' });
    }
    const res = await ctx.http.get({
      ...indexRequest(src, url, probe.expect),
      ttl: page ? 'page' : 'index',
      ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
    });
    const text =
      options.encoding === 'base64' ? Buffer.from(res.text, 'base64').toString('latin1') : res.text;
    const chars = text.length;
    const family = page ? ctx.render.detectFamily(text) : undefined;
    const records =
      options.count?.(text) ?? (probe.expect === 'json' ? jsonCount(text) : undefined);
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
    return finish({
      ok: error === undefined,
      chars,
      ...(records === undefined ? {} : { records }),
      ...(family === undefined ? {} : { family }),
      ...(error === undefined ? {} : { error }),
    });
  } catch (thrown) {
    const typed = toMcpDocError(thrown);
    const why = typed.details?.why;
    return finish({
      ok: false,
      error: `${typed.code}: ${typed.message}${why === undefined ? '' : ` (${why})`}`,
    });
  }
}

/** One entry of a dartdoc `index.json`. */
interface DartdocEntry {
  name?: unknown;
  qualifiedName?: unknown;
  href?: unknown;
  kind?: unknown;
  desc?: unknown;
  enclosedBy?: { name?: unknown; kind?: unknown };
}

/** dartdoc's numeric `Kind` values, as far as they occur in an index. */
const DART_KINDS: Readonly<Record<number, string>> = {
  0: 'accessor',
  1: 'constant',
  2: 'constructor',
  3: 'class',
  5: 'enum',
  6: 'extension',
  7: 'extension-type',
  8: 'function',
  9: 'library',
  10: 'method',
  11: 'mixin',
  16: 'property',
  19: 'constant',
  20: 'property',
  21: 'typedef',
};

/** Kinds whose entries own members: class, enum, extension, extension type, mixin. */
const DART_CONTAINERS: ReadonlySet<unknown> = new Set([3, 5, 6, 7, 11]);

/**
 * Catalogue records of a dartdoc index. A member's qualified name is `library.Type.member`:
 * the index repeats the type name for constructors (`lib.Point.Point.fromJson`), which is
 * folded so that the name reads as it is written in Dart code.
 */
export function dartdocRecords(src: BoundSource, entries: readonly unknown[]): CatalogRecord[] {
  const base = src.url();
  const records = new Map<string, CatalogRecord>();
  for (const entry of entries as ReadonlyArray<DartdocEntry | null>) {
    const { name, qualifiedName, href } = entry ?? {};
    if (typeof name !== 'string' || typeof href !== 'string' || name === '') continue;
    const ref = new URL(href, base).href;
    if (!ref.startsWith(base) || records.has(ref)) continue;
    const full = typeof qualifiedName === 'string' ? qualifiedName : name;
    const kind = typeof entry?.kind === 'number' ? entry.kind : -1;
    const owner = entry?.enclosedBy;
    const common = { symbolKind: DART_KINDS[kind] ?? 'symbol', description: oneLine(entry?.desc) };
    if (typeof owner?.name !== 'string' || !DART_CONTAINERS.has(owner.kind)) {
      const library = typeof owner?.name === 'string' ? [owner.name] : [];
      records.set(
        ref,
        recordOf(src, ref, name, { ...common, symbol: name, qualified: full, breadcrumb: library }),
      );
      continue;
    }
    const simple = name.split('.').at(-1) ?? name;
    const parent = full.endsWith(`.${name}`)
      ? full.slice(0, -(name.length + 1))
      : full.split('.').slice(0, -1).join('.');
    records.set(
      ref,
      recordOf(src, ref, `${owner.name}.${simple}`, {
        ...common,
        symbol: simple,
        qualified: `${parent}.${simple}`,
        parent,
        breadcrumb: parent.split('.'),
      }),
    );
  }
  return [...records.values()];
}

/**
 * `dartdoc`: the flat `index.json` a dartdoc site publishes for its search box (one entry per
 * library, type and member, each with its own page), and server-rendered HTML pages.
 */
export const dartdocAdapter: SourceAdapter<'dartdoc'> = {
  type: 'dartdoc',
  maxEnumerateRequests: 1,

  async enumerate(ctx, src) {
    const url = src.url(src.source.config.index);
    assertLive(src, url);
    if (!siteIndexEnabled(ctx, src)) return [];
    const { data } = await ctx.http.getJson(indexRequest(src, url, 'json'));
    if (!Array.isArray(data)) throw unusableIndex(url, 'The index is not a list of entries');
    const records = dartdocRecords(src, data);
    if (records.length === 0) {
      throw unusableIndex(url, 'No entry of the index has a name and an href');
    }
    return records;
  },

  read: (ctx, src, target) => readHtmlPage(ctx, src, target, 'dartdoc'),
  symbol: (ctx, src, record, detail) =>
    readHtmlPage(ctx, src, symbolTarget(record, detail), 'dartdoc'),
  probe: (ctx, src) => probeSource(ctx, src),
};
