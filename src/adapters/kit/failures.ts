/**
 * Deciding what a failed request means for the work it was part of. There are two cases, and
 * each has one function:
 *
 * - {@link tolerate}: one input of an enumeration (or one rung of a read) failed while
 *   another can still answer. Carrying on is right only when the failure is upstream's;
 * - {@link skipOptional}: an optional part of a result (one source file of a sample, the
 *   headings of one document) could not be fetched. The result is still worth returning.
 */
import { budgetExhausted } from '../../core/async.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx } from '../../core/ports.js';

/**
 * True when a request failed by our own decision and so says nothing about the host: the
 * gateway did not send it (the request budget of the call, the pacing of the host, a
 * cancelled call), which it marks with `details.declined`, or the budget the source is bound
 * to is spent.
 */
export function gaveUpOurselves(ctx: Ctx, src: BoundSource, error: McpDocError): boolean {
  const declined = (error.details as { declined?: unknown } | undefined)?.declined;
  if (typeof declined === 'string') return true;
  return src.budget !== undefined && budgetExhausted(src.budget, ctx.clock);
}

/**
 * Decides whether work may continue from another input or rung after one failed. Returns the
 * typed failure after logging it when the cause is upstream's (a missing, blocked, broken or
 * disabled file); rethrows when the cause is ours:
 *
 * - a request that was not sent (spent budget, pacing beyond the deadline) says nothing
 *   about the file, and a catalogue built without it would lack everything that was not
 *   fetched yet while looking complete;
 * - an unexpected exception (`INTERNAL`) is a defect, not a missing file.
 *
 * @param what the input that failed, as the subject of a sentence ("The sitemap").
 * @throws McpDocError the failure, typed.
 */
export function tolerate(ctx: Ctx, src: BoundSource, error: unknown, what: string): McpDocError {
  const typed = toMcpDocError(error);
  if (typed.code === 'INTERNAL' || gaveUpOurselves(ctx, src, typed)) throw typed;
  ctx.logger.warn(`${what} is unavailable; continuing without it`, {
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    code: typed.code,
    url: typed.details?.url,
  });
  return typed;
}

/**
 * Records that an optional part of a result was left out. Unlike {@link tolerate} this never
 * rethrows for a spent budget: what was fetched so far is returned, and the caller says what
 * is missing. A defect (`INTERNAL`) is still rethrown, because that is ours to fix.
 *
 * @returns `true` when no further request can be sent, so the caller stops asking for more.
 */
export function skipOptional(ctx: Ctx, src: BoundSource, error: unknown, what: string): boolean {
  const typed = toMcpDocError(error);
  if (typed.code === 'INTERNAL') throw typed;
  ctx.logger.debug(`${what} was skipped`, {
    product: src.product.id,
    source: src.source.id,
    code: typed.code,
    url: typed.details?.url,
  });
  return src.budget !== undefined && budgetExhausted(src.budget, ctx.clock);
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
