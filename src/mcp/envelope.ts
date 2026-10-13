/**
 * The envelope of every text result (design section 3.1): status line, body, at most one
 * `Next:` line, then the `Source:` line. Presenters build an {@link Envelope} and never
 * concatenate these parts themselves, so the order and the attribution cannot vary by tool.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { ESRI_TERMS_URL } from '../core/attribution.js';
import type { LicenseTier } from '../core/types.js';

/**
 * Where the content of a result comes from. The field is mandatory on {@link Envelope}, so a
 * presenter has to state it; only `project` (registry data and this project's briefs)
 * produces no `Source:` line.
 */
export type Attribution =
  /** One document: the line its adapter built with `core/attribution.ts`. */
  | { kind: 'page'; line: string }
  /** A list of refs from several documents (search hits, samples, version facts). */
  | { kind: 'listing'; licenses: readonly LicenseTier[]; retrievedOn: string }
  /** This project's own data. */
  | { kind: 'project' };

/** The parts of one text result. */
export interface Envelope {
  /** First line: what was resolved (product, version, kind, cache state). */
  status: string;
  body: string;
  /** Remarks shown under the status line, one per line. */
  notes?: readonly string[];
  /** The most useful follow-up call, from `formatCall`; with or without the `Next:` prefix. */
  next?: string | undefined;
  attribution: Attribution;
}

const NEXT_PREFIX = 'Next: ';

/**
 * Joins the facts of a status line with ` | `, skipping absent ones. A lower rung of a
 * degradation ladder (design section 6.6) is stated last, as `degraded: <reason>`.
 */
export function statusLine(
  parts: ReadonlyArray<string | undefined>,
  degraded?: string | undefined,
): string {
  const shown = parts.filter((part): part is string => part !== undefined && part.length > 0);
  if (degraded !== undefined && degraded.length > 0) shown.push(`degraded: ${degraded}`);
  return shown.join(' | ');
}

/** The `Source:` line for an attribution, or an empty string when there is none to state. */
export function sourceLine(attribution: Attribution): string {
  switch (attribution.kind) {
    case 'page':
      return attribution.line;
    case 'project':
      return '';
    case 'listing':
      if (attribution.licenses.every((tier) => tier === 'project')) return '';
      return `Source: Esri documentation at the refs above (retrieved ${attribution.retrievedOn.slice(0, 10)}). Copyright (c) Esri and respective authors. Use subject to Esri's terms: ${ESRI_TERMS_URL}`;
  }
}

/** Renders the envelope as the text of `content[0]`. */
export function renderEnvelope(envelope: Envelope): string {
  const head = [envelope.status, ...(envelope.notes ?? []).map((note) => `Note: ${note}`)];
  const footer: string[] = [];
  if (envelope.next !== undefined && envelope.next.length > 0) {
    footer.push(
      envelope.next.startsWith(NEXT_PREFIX) ? envelope.next : `${NEXT_PREFIX}${envelope.next}`,
    );
  }
  const source = sourceLine(envelope.attribution);
  if (source.length > 0) footer.push(source);
  return [head.join('\n'), envelope.body.trim(), footer.join('\n')]
    .filter((block) => block.length > 0)
    .join('\n\n');
}

/** A text-only tool result (`arcgis_docs_read`, `arcgis_docs_lookup_symbol`). */
export function textResult(envelope: Envelope, meta?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: renderEnvelope(envelope) }] };
  if (meta !== undefined) result._meta = meta;
  return result;
}

/**
 * A result with `structuredContent` and a compact Markdown rendering of the same facts
 * (the four tools that declare an `outputSchema`).
 */
export function structuredResult(
  envelope: Envelope,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: 'text', text: renderEnvelope(envelope) }],
    structuredContent,
  };
}
