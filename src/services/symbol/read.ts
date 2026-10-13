/**
 * Reads the page of a resolved symbol and walks the content ladder (design section 6.6)
 * when a source cannot answer: the same symbol in another source, the declared fallbacks of
 * its source, and finally a link-only page built from the catalogue record. It throws only
 * for a version the caller named that does not exist (`VERSION_UNAVAILABLE`).
 */
import { bindSource, defaultSymbolRead } from '../../core/adapter-helpers.js';
import { formatCall } from '../../core/budget.js';
import { McpDocError, isMcpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type { AdapterRegistry, CallOptions, Ctx } from '../../core/ports.js';
import type { CatalogRecord, DocPage, SourceDef, SymbolDetail } from '../../core/types.js';
import { linkOnlyPage } from '../doc/display.js';
import type { Candidate } from './resolve.js';
import type { Target } from './target.js';

const SITE_CAPABILITIES: ReadonlySet<string> = new Set(['website', 'site-index']);

/** Reads symbol pages for the symbol service. */
export interface SymbolReader {
  /** The page of the winning candidate, or the best lower rung. */
  read(
    target: Target,
    winner: Candidate,
    detail: SymbolDetail,
    call: CallOptions,
  ): Promise<DocPage>;
}

/** Creates the reader. */
export function createSymbolReader(ctx: Ctx, adapters: AdapterRegistry): SymbolReader {
  /** Reads a record through one source's adapter; `undefined` when that source may not be used. */
  const readVia = async (
    target: Target,
    source: SourceDef,
    record: CatalogRecord,
    detail: SymbolDetail,
    call: CallOptions,
  ): Promise<DocPage | undefined> => {
    const { capability } = source;
    if (capability !== undefined && !ctx.policy.enabled(capability)) return undefined;
    // The pages of a link-only line are never fetched; versioned packages still answer.
    const siteSource = capability !== undefined && SITE_CAPABILITIES.has(capability);
    if (target.line.access === 'link-only' && siteSource) return undefined;

    const adapter = adapters.get(source.adapter);
    const bound = bindSource(target.product, source, target.line, target.version, call.budget);
    const page =
      adapter.symbol === undefined
        ? await defaultSymbolRead(adapter)(ctx, bound, record, detail)
        : await adapter.symbol(ctx, bound, record, detail);
    return {
      ...page,
      product: target.product.id,
      source: source.id,
      line: page.line ?? target.line.id,
    };
  };

  return {
    async read(target, winner, detail, call) {
      const sourceOf = (record: CatalogRecord): SourceDef | undefined =>
        target.product.sources.find((source) => source.id === record.source);

      const attempts: Array<{ source: SourceDef; record: CatalogRecord }> = [];
      for (const record of [winner.record, ...winner.twins]) {
        const source = sourceOf(record);
        if (source !== undefined) attempts.push({ source, record });
      }
      for (const id of sourceOf(winner.record)?.fallbacks ?? []) {
        const source = target.product.sources.find((candidate) => candidate.id === id);
        if (source !== undefined && !attempts.some((attempt) => attempt.source.id === id)) {
          attempts.push({ source, record: winner.record });
        }
      }

      let reason = 'no source that documents it can be used in this configuration';
      for (const [position, attempt] of attempts.entries()) {
        try {
          const page = await readVia(target, attempt.source, attempt.record, detail, call);
          if (page === undefined) continue;
          if (position === 0) return page;
          const notice = `Read from ${attempt.source.title}: ${reason}.`;
          return { ...page, notices: [...page.notices, notice] };
        } catch (error) {
          if (isMcpDocError(error)) {
            // A version the caller asked for and no package has is the caller's to correct. The
            // ladder below is for upstream trouble: a link-only page labelled with the current
            // version would read as an answer.
            if (error.code === 'VERSION_UNAVAILABLE' && target.explicit) {
              throw new McpDocError(error.code, error.message, {
                ...error.details,
                next:
                  error.details?.next ??
                  formatCall(TOOLS.getVersions, { product: target.product.id }),
              });
            }
            reason = `${error.code}: ${error.message}`;
          } else {
            ctx.logger.error('symbol read failed unexpectedly', { ref: attempt.record.ref, error });
            reason = 'an internal error occurred while reading it';
          }
        }
      }

      const { record } = winner;
      const page = linkOnlyPage(
        {
          url: record.ref,
          product: record.product,
          source: record.source,
          line: record.line,
          kind: record.kind,
          license: record.license,
          retrievedAt: ctx.clock.iso(),
        },
        record.title,
        reason,
      );
      const known =
        record.description === undefined ? [] : [`From the index: ${record.description}`];
      return { ...page, notices: [...page.notices, ...known] };
    },
  };
}
