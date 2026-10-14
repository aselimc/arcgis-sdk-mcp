/**
 * Building blocks shared by the three npm package adapters: narrowing of untyped JSON,
 * documentation-URL templates, the selector a fragment stands for, and the failures of a
 * package artefact. Everything an adapter of any kind needs comes from the adapter kit.
 */
import { McpDocError, type ErrorDetails } from '../../../core/errors.js';
import { DEVELOPERS_ORIGIN } from '../../../core/names.js';
import type {
  BoundSource,
  Ctx,
  ProbeResult,
  ReadTarget,
  RenderOptions,
  SectionSelector,
} from '../../../core/ports.js';
import { expandTemplate } from '../../../core/source-urls.js';
import type { CatalogRecord, DocKind } from '../../../core/types.js';
import {
  escapeRegExp,
  fragmentOf,
  probeSource,
  recordOf,
  renderOptionsOf,
  safeDecode,
} from '../../kit/index.js';
import { isRecord as isJsonObject } from '../../../core/json.js';

/** A JSON object of unknown content. */
export type Json = Record<string, unknown>;

/** True for a JSON object (not an array, not `null`). */
export const isRecord: (value: unknown) => value is Json = isJsonObject;

/** The value when it is a non-empty string. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The JSON objects of an array; anything else gives an empty list. */
export function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The document kind of everything a source yields: its first declared kind, else `api`. */
export function kindOf(src: BoundSource): DocKind {
  return src.source.kinds[0] ?? 'api';
}

/** A catalogue record of a package source: its kind is the source's ({@link kindOf}). */
export function baseRecord(src: BoundSource, ref: string, title: string): CatalogRecord {
  return recordOf(src, ref, kindOf(src), title);
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

/** The renderer options of a read of a package entry: the target's, with {@link selectorOf}. */
export function entryRenderOptions(target: ReadTarget): RenderOptions | undefined {
  return renderOptionsOf(target, { select: selectorOf(target) });
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

/**
 * The failure for a URL or record that names nothing in a package artefact, with the way
 * forward: a complete call (`next`) or the refs that do exist (`candidates`).
 */
export function notFound(
  url: string,
  what: string,
  why: string,
  recovery: Pick<ErrorDetails, 'next' | 'candidates'>,
): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', what, { why, url, host: new URL(url).host, ...recovery });
}

/**
 * The canary of a package source: a registry lookup, which is not cached for long and is
 * requested whatever the version line, because packages address versions themselves.
 */
export function probeDeclared(ctx: Ctx, src: BoundSource): Promise<ProbeResult> {
  return probeSource(ctx, src, { ttl: 'volatile', versionAddressed: true });
}
