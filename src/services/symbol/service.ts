/**
 * The symbol service: resolves a name to one catalogue record (design section 3.6), reads
 * it through its source's adapter and trims it to the requested detail. Once a record is
 * resolved the lookup no longer fails for an upstream problem (see `read.ts`).
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  AdapterRegistry,
  Ctx,
  IndexState,
  SymbolResponse,
  SymbolService,
} from '../../core/ports.js';
import type { IndexInternals } from '../index/types.js';
import { resolveScope } from '../scope.js';
import { symbolText } from './detail.js';
import { nearestNames, notFoundError } from './not-found.js';
import { createSymbolReader } from './read.js';
import { displayName, resolveSymbol, type SymbolScope } from './resolve.js';
import { sourceRank, symbolSources, targetOf } from './target.js';

/** Most products a lookup without a `product` argument covers. */
const MAX_ROUTED_PRODUCTS = 3;

/** Creates the symbol service. */
export function createSymbolService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): SymbolService {
  const reader = createSymbolReader(ctx, adapters);

  return {
    async lookup(req, call): Promise<SymbolResponse> {
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.symbol,
        max: MAX_ROUTED_PRODUCTS,
      });
      const targets = scope.resolutions.map((resolution) =>
        targetOf(ctx, resolution.product, scope, req),
      );
      const states: IndexState[] = [];
      const scopes: SymbolScope[] = [];
      for (const [position, target] of targets.entries()) {
        const sources = symbolSources(target.product, scope.resolutions[position]?.source);
        states.push(...(await index.ensure(target.product, sources, target.line, call)));
        scopes.push({
          product: target.product.id,
          productRank: position,
          symbols: index.symbols(target.product.id, target.line.id),
          sourceRank: (record) => sourceRank(target, record.source),
        });
      }

      const resolution = resolveSymbol(req.symbol, scopes);
      if (resolution.kind === 'none') {
        const names = nearestNames(index, req, targets, resolution.knownType);
        throw notFoundError(req, targets, states, names, resolution.knownType);
      }
      if (resolution.kind === 'ambiguous') {
        const pairs = resolution.candidates.map((candidate) => ({
          symbol: displayName(candidate.record),
          product: candidate.record.product,
        }));
        throw new McpDocError(
          'AMBIGUOUS_SYMBOL',
          `"${req.symbol}" matches ${pairs.length} symbols equally well`,
          {
            why: 'Several API entities share this name; pick one by its qualified name and product',
            candidates: pairs.map((pair) => JSON.stringify(pair)),
            next: formatCall(TOOLS.lookupSymbol, { ...pairs[0], detail: req.detail }),
          },
        );
      }

      const { winner, alternates } = resolution;
      const position = targets.findIndex((target) => target.product.id === winner.record.product);
      const target = targets[position];
      const resolved = scope.resolutions[position];
      if (target === undefined || resolved === undefined) {
        throw new McpDocError('INTERNAL', 'A resolved symbol has no product in scope');
      }

      const name = displayName(winner.record);
      const read = await reader.read(target, winner, req.detail, call);
      const notices = [...read.notices];
      if (!target.explicit && target.version !== undefined) {
        notices.push(`Version ${target.version} was detected in the project.`);
      }
      if (winner.step === 'fuzzy' || winner.step === 'case-insensitive') {
        notices.push(`"${req.symbol}" was matched to ${name}.`);
      }
      const page = { ...read, notices };
      index.addBody(page);
      await index.flush();

      const { text, truncated } = symbolText(page, winner.record, req.detail, req.maxTokens);
      let next: string | undefined;
      if (truncated && req.detail === 'full') {
        next = formatCall(TOOLS.read, { ref: winner.record.ref, view: 'full' });
      } else if (truncated) {
        next = formatCall(TOOLS.lookupSymbol, {
          symbol: name,
          product: winner.record.product,
          detail: req.detail === 'signature' ? 'summary' : 'full',
        });
      }
      return {
        record: winner.record,
        page,
        text,
        alternates: alternates.map((candidate) => candidate.record),
        resolvedProduct: resolved,
        ...(next === undefined ? {} : { next }),
      };
    },
  };
}
