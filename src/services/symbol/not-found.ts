/**
 * The `SYMBOL_NOT_FOUND` answer: nearby names, a search to try, and
 * wording that never turns "not found here" into "does not exist". A lookup that could
 * search nothing at all is not a miss and gets the error of its cause instead.
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import { symbolLookupOf } from '../../core/symbol-sources.js';
import type { Ctx, IndexState, SymbolRequest } from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { Capability, CatalogRecord } from '../../core/types.js';
import { simpleName } from '../index/symbol-map.js';
import type { IndexInternals } from '../index/types.js';
import { displayName } from './resolve.js';
import { symbolSources, type Target } from './target.js';

/** Names suggested when nothing matches. */
export const MAX_NEAREST = 5;

/** Of those, how many may be the same member name on other types. */
const MAX_INHERITED = 3;

/** A namespace segment that marks implementation detail. */
const INTERNAL = /(?:^|[.#/:])_?internal(?:[.#/:]|$)/i;

function lastSegment(name: string): string {
  return (name.split(/::|[.#/]/).at(-1) ?? name).toLowerCase();
}

/**
 * How likely the owner of a same-named member is the type a caller's type inherits it from,
 * lower first: an owner whose name contains the type's (`BasicFeatureLayer` for
 * `FeatureLayer`) or that lives in the same namespace, before unrelated ones; internal
 * namespaces last. A reference without base types (C# XML documentation) leaves only this.
 */
function kinship(record: CatalogRecord, type: CatalogRecord): number {
  const owner = record.parent ?? '';
  const typeName = displayName(type);
  const namespace = typeName.slice(0, typeName.length - lastSegment(typeName).length);
  let rank = 2;
  if (lastSegment(owner).includes(lastSegment(typeName))) rank = 0;
  else if (namespace !== '' && owner.startsWith(namespace)) rank = 1;
  return rank + (INTERNAL.test(owner) ? 3 : 0);
}

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
    // A member a type inherits is indexed under the type that declares it: the same name
    // on other types is the likeliest answer and goes first, nearest relatives leading.
    const elsewhere = targets
      .flatMap((target) => index.symbols(target.product.id, target.line.id).exact(simple))
      .filter((record) => record.parent !== undefined && record.parent !== displayName(knownType))
      .map((record, position) => ({ record, position, rank: kinship(record, knownType) }))
      .sort((a, b) => a.rank - b.rank || a.position - b.position)
      .map((entry) => displayName(entry.record));
    const inherited = [...new Set(elsewhere)].slice(0, MAX_INHERITED);
    // Nothing similar anywhere: the first members still show what the type offers.
    const names = near.length > 0 || inherited.length > 0 ? near : all.slice(0, MAX_NEAREST);
    return [...inherited, ...names.map((name) => `${displayName(knownType)}.${name}`)].slice(
      0,
      MAX_NEAREST,
    );
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
  if (state === 'unavailable') return 'not available in this configuration';
  return state === 'building' ? 'index still building' : 'upstream failing';
}

function searched(state: IndexState): boolean {
  return state.state === 'ready' || state.state === 'stale';
}

/**
 * The capabilities that are switched off among the symbol sources of the targets. A
 * `website` source also counts `site-index` when that is off: the symbol index of an API
 * reference is a file the site publishes for itself, and the adapter skips it without an
 * error, so the source's own capability alone would hide the cause.
 */
function disabledCapabilities(ctx: Ctx, targets: readonly Target[]): Capability[] {
  const off = new Set<Capability>();
  let website = false;
  for (const { product } of targets) {
    const ids = symbolSources(product, undefined);
    for (const source of product.sources) {
      if (ids !== undefined && !ids.includes(source.id)) continue;
      const { capability } = source;
      if (capability === 'website') website = true;
      if (capability !== undefined && !ctx.policy.enabled(capability)) off.add(capability);
    }
  }
  if (website && !ctx.policy.enabled('site-index')) off.add('site-index');
  return [...off];
}

/**
 * The error of a lookup that could search no reference index at all, or `undefined` when at
 * least one was searched (the lookup is then an honest miss) or when the indexes are merely
 * still building. "Not found" would be the wrong code: nothing was looked at, and the
 * recovery is to leave offline mode, to switch a capability on, or to wait for the upstream.
 */
export function unsearchedError(
  ctx: Ctx,
  req: SymbolRequest,
  targets: readonly Target[],
  states: readonly IndexState[],
): McpDocError | undefined {
  if (states.length === 0 || states.some(searched)) return undefined;
  if (states.some((state) => state.state === 'building')) return undefined;
  const products = targets.map((target) => target.product.id).join(', ');
  const sources = states.map((state) => `${state.product}/${state.source}`).join(', ');
  const what = `"${req.symbol}" could not be looked up: no reference index of ${products} is available`;

  if (ctx.policy.summary().offline) {
    return new McpDocError('OFFLINE_MISS', what, {
      why: 'Offline mode is on and the index is not in the cache, so nothing was searched',
      next: 'Unset ARCGIS_DOCS_OFFLINE to fetch it',
    });
  }
  // Nothing was searched, so a switched-off capability is the cause to report first, whether
  // the index came back unavailable or empty; "retry" would never help.
  const off = disabledCapabilities(ctx, targets);
  const [capability] = off;
  if (capability !== undefined) {
    return new McpDocError('SOURCE_DISABLED', what, {
      why: `Its reference sources need ${off.map((name) => `capability "${name}"`).join(' or ')}, which is switched off`,
      next: `Set ARCGIS_DOCS_SOURCES=+${capability}`,
      capability,
    });
  }
  if (states.every((state) => state.state === 'unavailable')) return undefined;
  return new McpDocError('UPSTREAM_UNAVAILABLE', what, {
    why: `${sources} could not be reached, so nothing was searched; this says nothing about whether the symbol exists`,
    retryable: true,
  });
}

/** Shortest query `arcgis_docs_search` accepts. */
const MIN_QUERY = 2;

/**
 * The search that continues a miss: of the API pages when a target has an API reference, of
 * the specification pages when the targets only have those, else of everything. A name too
 * short to be a query gets the product's profile instead, or no `next` (the MCP layer then
 * builds a safe recovery).
 */
function nextSearch(
  req: SymbolRequest,
  targets: readonly Target[],
  first: string | undefined,
): { next?: string } {
  const product = req.product ?? first;
  if (req.symbol.trim().length < MIN_QUERY) {
    return product === undefined
      ? {}
      : { next: formatCall(TOOLS.listProducts, { product: product.split('/')[0] }) };
  }
  const kinds = new Set(
    targets.flatMap((target) => target.product.sources.flatMap((source) => source.kinds)),
  );
  const symbols = targets.some((target) => symbolLookupOf(target.product) === 'symbols');
  const kind = symbols || kinds.has('api') ? 'api' : kinds.has('spec') ? 'spec' : undefined;
  return { next: formatCall(TOOLS.search, { query: req.symbol.trim(), product, kind }) };
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
  const pending = states.filter((state) => !searched(state));
  const transient = pending.some((state) => state.state !== 'unavailable');
  const unsearched = pending
    .map((state) => `${state.product}/${state.source} (${causeOf(state.state)})`)
    .join(', ');

  const lookups = targets.map((target) => symbolLookupOf(target.product));
  const noReference = targets.length > 0 && lookups.every((lookup) => lookup === 'none');
  let why: string;
  if (noReference) {
    why = `Not verified: ${products.join(', ')} has no API reference in this server, so names are found by search only`;
  } else if (knownType !== undefined) {
    why = `${displayName(knownType)} is documented but no member with this name was found, in the index or on its page (an inherited member is listed under the type that declares it); not verified, and this does not prove it does not exist`;
  } else if (products.length === 0) {
    why =
      'Not verified: no product could be inferred from this name, so nothing was searched. Pass "product" (arcgis_docs_list_products lists the ids). This does not prove it does not exist';
  } else if (pending.length > 0) {
    why = `Not verified: ${unsearched} could not be searched${transient ? '; retry' : ''}. This does not prove it does not exist`;
  } else {
    why = `Not verified: the reference of ${products.join(', ')} has no symbol with this name. This does not prove it does not exist`;
  }
  return new McpDocError('SYMBOL_NOT_FOUND', `No symbol "${req.symbol}" was found`, {
    why,
    ...(names.length > 0 ? { candidates: names.slice(0, MAX_NEAREST) } : {}),
    ...nextSearch(req, targets, products[0]),
    retryable: knownType === undefined && transient,
  });
}
