/**
 * Zod pieces shared by several tool schemas. Each tool file composes its
 * own input and output schema from these, so a field means the same thing wherever it appears.
 */
import * as z from 'zod/v4';
import { CATEGORIES, DOC_KINDS, type DocKind } from '../core/types.js';

/** A free-form product argument; resolved server-side, deliberately not an enum. */
export function productArg(description: string): z.ZodOptional<z.ZodString> {
  return z.string().max(80).optional().describe(description);
}

/** An opaque pagination cursor issued by a previous call of the same tool. */
export function cursorArg(description: string): z.ZodOptional<z.ZodString> {
  return z.string().max(600).optional().describe(description);
}

/** A version or version-line argument. */
export function versionArg(description: string): z.ZodOptional<z.ZodString> {
  return z.string().max(24).optional().describe(description);
}

/** The token cap of a response; the upper bound is the same for every tool. */
export function maxTokensArg(min: number, fallback: number): z.ZodDefault<z.ZodNumber> {
  return z
    .number()
    .int()
    .min(min)
    .max(20_000)
    .default(fallback)
    .describe('Upper bound for this response.');
}

/**
 * A count or size in a result: an integer of zero or more. A bare `z.number().int()` is
 * published as the whole safe-integer range, negative half included, which says nothing
 * about a number of hits and reads badly in every `tools/list` payload.
 */
export function countField(): z.ZodNumber {
  return z.number().int().min(0);
}

/** The one-based position of an entry in a ranked list. */
export function rankField(): z.ZodNumber {
  return z.number().int().min(1);
}

/** `category` filter of the product list: every registry category, or all of them. */
export const CategoryFilter = z.enum([...CATEGORIES, 'all']);

/** Content types a search can be restricted to: every document kind except curated briefs. */
export const SearchKind = z.enum([
  'guide',
  'tutorial',
  'api',
  'sample',
  'release-notes',
  'spec',
  'help',
  'troubleshooting',
] as const satisfies ReadonlyArray<Exclude<DocKind, 'brief'>>);

/** Every document kind, as reported on results. */
export const ResultKind = z.enum(DOC_KINDS);

/** Human-readable remarks of a structured result: degradation rungs, scope choices, hints. */
export const Notes = z.array(z.string());
