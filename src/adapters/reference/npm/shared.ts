/**
 * Building blocks shared by the three npm package adapters: narrowing of untyped JSON,
 * documentation-URL templates, catalogue record defaults, failure classification and the
 * registry-declared canary.
 */
import { budgetExhausted } from '../../../core/async.js';
import { McpDocError, toMcpDocError } from '../../../core/errors.js';
import { DEVELOPERS_ORIGIN } from '../../../core/names.js';
import type {
  BoundSource,
  Ctx,
  HttpRequest,
  ProbeResult,
  ReadTarget,
  RenderOptions,
  SectionSelector,
} from '../../../core/ports.js';
import { expandTemplate } from '../../../core/source-urls.js';
import type { CatalogRecord, DocKind, LicenseTier } from '../../../core/types.js';

/** A JSON object of unknown content. */
export type Json = Record<string, unknown>;

/** True for a JSON object (not an array, not `null`). */
export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value when it is a non-empty string. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The JSON objects of an array; anything else gives an empty list. */
export function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The licence tier of a source's content: its own, else the product default. */
export function licenseOf(src: BoundSource): LicenseTier {
  return src.source.license ?? src.product.licenseTier;
}

/** The document kind of everything a source yields: its first declared kind, else `api`. */
export function kindOf(src: BoundSource): DocKind {
  return src.source.kinds[0] ?? 'api';
}

/** The `budget` property of a request, present only when the source is bound to one. */
export function budgetOf(src: BoundSource): Pick<HttpRequest, 'budget'> {
  return src.budget === undefined ? {} : { budget: src.budget };
}

/** A catalogue record of a source with the fields every record shares. */
export function baseRecord(src: BoundSource, ref: string, title: string): CatalogRecord {
  return {
    ref,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind: kindOf(src),
    title,
    license: licenseOf(src),
  };
}

/**
 * A one-line description for a catalogue record: the first sentence of the first paragraph
 * of a Markdown text, with whitespace collapsed, at most `max` characters.
 */
export function summaryOf(text: unknown, max = 200): string | undefined {
  const paragraph = str(text)?.trim().split(/\n\s*\n/)[0];
  if (paragraph === undefined) return undefined;
  const line = paragraph.replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  if (sentence === '') return undefined;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/**
 * A `docUrl` template of the registry made absolute for a bound source: line variables are
 * substituted and a path is placed on developers.arcgis.com. The adapter placeholders
 * (`{pkg}`, `{tag}`, `{tagShort}`, `{path}`) are left for {@link fillTemplate}.
 */
export function docTemplate(src: BoundSource, docUrl: string): string {
  const expanded = expandTemplate(docUrl, src.line);
  if (/^https?:\/\//i.test(expanded)) return expanded;
  return `${DEVELOPERS_ORIGIN}/${expanded.replace(/^\/+/, '')}`;
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Substitutes the placeholders of a template that `values` names; the others stay. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

/**
 * Reads the placeholder values back from a URL that has the shape of a template, ignoring
 * fragment, query and a trailing slash. `{path}` spans several path segments; every other
 * placeholder stands for exactly one.
 *
 * @returns `undefined` when the URL does not have the template's shape.
 */
export function matchTemplate(template: string, url: string): Record<string, string> | undefined {
  const seen = new Set<string>();
  let source = '';
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    source += escapeRegExp(template.slice(last, match.index));
    // A placeholder used twice must have the same value both times.
    if (seen.has(name)) source += `\\k<${name}>`;
    else source += name === 'path' ? `(?<${name}>[^?#]+?)` : `(?<${name}>[^/?#]+)`;
    seen.add(name);
    last = match.index + match[0].length;
  }
  source += escapeRegExp(template.slice(last).replace(/\/+$/, ''));
  const match = new RegExp(`^${source}/?$`).exec(url.replace(/[?#].*$/, ''));
  if (match === null) return undefined;
  return Object.fromEntries(
    Object.entries(match.groups ?? {}).map(([name, value]) => [name, safeDecode(value)]),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** Percent-decoding that returns the input unchanged when it holds a malformed escape. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The decoded fragment of a URL without its `#`; `undefined` when there is none. */
export function fragmentOf(url: URL): string | undefined {
  return url.hash.length > 1 ? safeDecode(url.hash.slice(1)) : undefined;
}

/**
 * What part of an entry a read asks for. The entries of a package artefact are addressed by
 * fragment (`…/arcgis-map/#zoom`, `…/text_functions/#concatenate`), so a fragment selects
 * that member when the caller gave no selector of its own. A member that does not exist
 * leaves the page whole, as {@link SectionSelector} requires.
 */
export function selectorOf(target: ReadTarget): SectionSelector | undefined {
  if (target.select !== undefined) return target.select;
  const fragment = fragmentOf(target.url);
  return fragment === undefined ? undefined : { member: fragment };
}

/** The renderer options of a read; `undefined` when it asks for nothing. */
export function renderOptionsOf(target: ReadTarget): RenderOptions | undefined {
  const select = selectorOf(target);
  const opts: RenderOptions = {
    ...(select === undefined ? {} : { select }),
    ...(target.detail === undefined ? {} : { detail: target.detail }),
    ...(target.focusedCode === undefined ? {} : { focusedCode: target.focusedCode }),
  };
  return Object.keys(opts).length === 0 ? undefined : opts;
}

/**
 * The failure for a file that arrived intact but no longer has the structure this package
 * reads (a renamed or removed field). Repeating the call cannot help, so it is not retryable.
 */
export function shapeError(url: string, what: string): McpDocError {
  const host = new URL(url).host;
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${host} returned ${what} of an unknown shape`, {
    why: 'The file format changed upstream and this version of the server cannot read it',
    url,
    host,
    retryable: false,
  });
}

/** The failure for a URL or record that names nothing in a package artefact. */
export function notFound(url: string, what: string, why: string, next?: string): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', what, {
    why,
    url,
    host: new URL(url).host,
    ...(next === undefined ? {} : { next }),
  });
}

/**
 * Decides whether work may continue from another rung after one input failed. Returns the
 * typed failure after logging it when the cause is upstream's (a missing, blocked, broken or
 * disabled file); rethrows when the cause is ours: a spent request budget would make every
 * further attempt fail the same way, and an unexpected exception is a defect, not a missing
 * file.
 *
 * @throws McpDocError the failure, typed.
 */
export function tolerate(ctx: Ctx, src: BoundSource, error: unknown, what: string): McpDocError {
  const typed = toMcpDocError(error);
  if (typed.code === 'INTERNAL') throw typed;
  if (src.budget !== undefined && budgetExhausted(src.budget, ctx.clock)) throw typed;
  ctx.logger.warn(`${what} is unavailable; continuing without it`, {
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    code: typed.code,
    url: typed.details?.url,
  });
  return typed;
}

/** Number of entries of a JSON index body: array length, else key count. */
function entryCount(text: string): number | undefined {
  try {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) return data.length;
    return isRecord(data) ? Object.keys(data).length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs the canary a source declares in the registry (`SourceDef.probe`) with one request and
 * checks what it promises: entry count of a JSON body, length and a marker string. Never
 * rejects: a failure is `ok: false` with the reason.
 */
export async function probeDeclared(ctx: Ctx, src: BoundSource): Promise<ProbeResult> {
  const started = ctx.clock.now();
  const finish = (result: Omit<ProbeResult, 'ms'>): ProbeResult => ({
    ...result,
    ms: ctx.clock.now() - started,
  });
  const probe = src.source.probe;
  try {
    const res = await ctx.http.get({
      url: docTemplate(src, probe.url),
      expect: probe.expect,
      ttl: 'volatile',
      ...budgetOf(src),
    });
    const chars = res.text.length;
    const count = probe.expect === 'json' ? entryCount(res.text) : undefined;
    const measured = { chars, ...(count === undefined ? {} : { records: count }) };
    let error: string | undefined;
    if (probe.minRecords !== undefined && (count ?? 0) < probe.minRecords) {
      error = `Expected at least ${probe.minRecords} records, found ${count ?? 0}`;
    } else if (probe.minChars !== undefined && chars < probe.minChars) {
      error = `Expected at least ${probe.minChars} characters, found ${chars}`;
    } else if (probe.mustContain !== undefined && !res.text.includes(probe.mustContain)) {
      error = `The response does not contain "${probe.mustContain}"`;
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
