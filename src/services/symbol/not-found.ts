/**
 * The `SYMBOL_NOT_FOUND` answer (design section 3.6): nearby names, a search to try, and
 * wording that never turns "not found here" into "does not exist".
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type { IndexState, SymbolRequest } from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { CatalogRecord } from '../../core/types.js';
import { simpleName } from '../index/symbol-map.js';
import type { IndexInternals } from '../index/types.js';
import { displayName } from './resolve.js';
import type { Target } from './target.js';

/** Names suggested when nothing matches. */
export const MAX_NEAREST = 5;

/**
 * Names to suggest when nothing resolved: members of the type when only the member is
 * unknown, else what the text index finds for the name.
 */
export function nearestNames(
  index: IndexInternals,
  req: SymbolRequest,
  targets: readonly Target[],
  knownType: CatalogRecord | undefined,
): string[] {
  const { simple } = normalizeSymbol(req.symbol);
  if (knownType !== undefined) {
    const members = targets.flatMap((target) =>
      index.symbols(target.product.id, target.line.id).members(displayName(knownType)),
    );
    const all = [...new Set(members.map(simpleName))];
    const near = nearest(simple, all, MAX_NEAREST);
    // Nothing similar: the first members still show what the type offers.
    const names = near.length > 0 ? near : all.slice(0, MAX_NEAREST);
    return names.map((name) => `${displayName(knownType)}.${name}`);
  }
  const { hits } = index.query({
    text: req.symbol,
    products: targets.map((target) => target.product.id),
    kind: 'api',
    limit: MAX_NEAREST * 2,
    offset: 0,
  });
  const names = hits
    .map((hit) => index.record(hit.ref))
    .filter((record) => record !== undefined)
    .map(displayName);
  return [...new Set(names.filter((name) => name !== ''))].slice(0, MAX_NEAREST);
}

/** Why a source's index could not be searched, in a few words. */
function causeOf(state: IndexState['state']): string {
  if (state === 'unavailable') return 'switched off or link-only';
  return state === 'building' ? 'index still building' : 'upstream failing';
}

/**
 * Builds the error. It is `retryable` when a reference index was building or failing, since
 * the same call may then succeed later.
 */
export function notFoundError(
  req: SymbolRequest,
  targets: readonly Target[],
  states: readonly IndexState[],
  names: readonly string[],
  knownType: CatalogRecord | undefined,
): McpDocError {
  const products = targets.map((target) => target.product.id);
  // Without an enumerated index (fresh or stale) a miss says nothing about the symbol.
  const pending = states.filter((state) => state.state !== 'ready' && state.state !== 'stale');
  const transient = pending.some((state) => state.state !== 'unavailable');
  const unsearched = pending
    .map((state) => `${state.product}/${state.source} (${causeOf(state.state)})`)
    .join(', ');

  let why: string;
  if (knownType !== undefined) {
    why = `${displayName(knownType)} is documented but no member with this name was found; not verified, and this does not prove it does not exist`;
  } else if (pending.length > 0) {
    why = `Not verified: ${unsearched} could not be searched${transient ? '; retry' : ''}. This does not prove it does not exist`;
  } else {
    why = `Not verified: the reference of ${products.join(', ') || 'no product'} has no symbol with this name. This does not prove it does not exist`;
  }
  return new McpDocError('SYMBOL_NOT_FOUND', `No symbol "${req.symbol}" was found`, {
    why,
    ...(names.length > 0 ? { candidates: names.slice(0, MAX_NEAREST) } : {}),
    next: formatCall(TOOLS.search, {
      query: req.symbol,
      product: req.product ?? products[0],
      kind: 'api',
    }),
    retryable: knownType === undefined && transient,
  });
}
