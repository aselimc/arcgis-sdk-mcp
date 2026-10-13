/**
 * The symbol service: resolves a name to one catalogue record (design section 3.6), reads
 * it through its source's adapter and trims it to the requested detail. Once a record is
 * resolved the lookup no longer fails for an upstream problem: the same symbol in another
 * source, then the declared fallbacks, then a link-only answer take over.
 */
import { bindSource, defaultSymbolRead } from '../../core/adapter-helpers.js';
import { formatCall } from '../../core/budget.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  AdapterRegistry,
  CallOptions,
  Ctx,
  IndexState,
  SymbolRequest,
  SymbolResponse,
  SymbolService,
} from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { CatalogRecord, DocPage, Product, SourceDef, VersionLine } from '../../core/types.js';
import { linkOnlyPage } from '../doc/display.js';
import { simpleName } from '../index/symbol-map.js';
import type { IndexInternals } from '../index/types.js';
import { resolveScope, type Scope } from '../scope.js';
import { symbolText } from './detail.js';
import { displayName, resolveSymbol, type Candidate, type SymbolScope } from './resolve.js';

/** Names suggested when nothing matches. */
const MAX_NEAREST = 5;

/** Most products a lookup without a `product` argument covers. */
const MAX_ROUTED_PRODUCTS = 3;

/** Adapters that address versions themselves and so can answer for any released version. */
const VERSION_ADDRESSED = new Set(['npm-dts', 'npm-cem', 'npm-json', 'github-repo', 'xmldoc']);

const SITE_CAPABILITIES = new Set(['website', 'site-index']);

/** One product of the scope with the line and version being looked up. */
interface Target {
  product: Product;
  line: VersionLine;
  /** The version asked for or detected in the project, as written. */
  version?: string;
  /** True when `version` came from the caller rather than from the project. */
  explicit: boolean;
  /** True when versioned packages should answer before the site reference (design decision 7). */
  preferVersioned: boolean;
}

/** Creates the symbol service. */
export function createSymbolService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): SymbolService {
  const targetOf = (product: Product, scope: Scope, req: SymbolRequest): Target => {
    const detected = scope.workspace.find((sdk) => sdk.product === product.id)?.version;
    const version = req.version ?? detected;
    const explicit = req.version !== undefined;
    const base = { product, explicit, ...(version === undefined ? {} : { version }) };
    try {
      const line = ctx.registry.line(product, version);
      return {
        ...base,
        line,
        preferVersioned: version !== undefined && (explicit || !line.current),
      };
    } catch (error) {
      // A version without a documentation line can still be read from versioned packages;
      // a detected one that fits no line just means "use the current docs".
      const versioned = product.sources.some((source) => VERSION_ADDRESSED.has(source.adapter));
      if (explicit && !versioned) throw error;
      return { ...base, line: ctx.registry.line(product), preferVersioned: explicit };
    }
  };

  const symbolSources = (product: Product, scoped: SourceDef | undefined): string[] | undefined => {
    if (scoped !== undefined) return [scoped.id];
    const reference = product.sources.filter(
      (source) => source.kinds.includes('api') || source.kinds.includes('spec'),
    );
    return reference.length === 0 ? undefined : reference.map((source) => source.id);
  };

  const sourceOf = (product: Product, record: CatalogRecord): SourceDef | undefined =>
    product.sources.find((source) => source.id === record.source);

  /** Reads a record through one source's adapter; `undefined` when that source may not be used. */
  const readVia = async (
    target: Target,
    source: SourceDef,
    record: CatalogRecord,
    req: SymbolRequest,
    call: CallOptions,
  ): Promise<DocPage | undefined> => {
    const { capability } = source;
    if (capability !== undefined && !ctx.policy.enabled(capability)) return undefined;
    if (
      target.line.access === 'link-only' &&
      capability !== undefined &&
      SITE_CAPABILITIES.has(capability)
    ) {
      return undefined;
    }
    const adapter = adapters.get(source.adapter);
    const bound = bindSource(target.product, source, target.line, target.version, call.budget);
    const page =
      adapter.symbol === undefined
        ? await defaultSymbolRead(adapter)(ctx, bound, record, req.detail)
        : await adapter.symbol(ctx, bound, record, req.detail);
    return {
      ...page,
      product: target.product.id,
      source: source.id,
      line: page.line ?? target.line.id,
    };
  };

  /** The page of the winning record, walking the content ladder on failure. */
  const fetchPage = async (
    target: Target,
    winner: Candidate,
    req: SymbolRequest,
    call: CallOptions,
  ): Promise<DocPage> => {
    const attempts: Array<{ source: SourceDef; record: CatalogRecord }> = [];
    for (const record of [winner.record, ...winner.twins]) {
      const source = sourceOf(target.product, record);
      if (source !== undefined) attempts.push({ source, record });
    }
    const primary = sourceOf(target.product, winner.record);
    for (const id of primary?.fallbacks ?? []) {
      const source = target.product.sources.find((candidate) => candidate.id === id);
      if (source !== undefined && !attempts.some((attempt) => attempt.source.id === id)) {
        attempts.push({ source, record: winner.record });
      }
    }

    let reason = 'no source that documents it can be used in this configuration';
    for (const [position, attempt] of attempts.entries()) {
      try {
        const page = await readVia(target, attempt.source, attempt.record, req, call);
        if (page === undefined) continue;
        if (position === 0) return page;
        return {
          ...page,
          notices: [...page.notices, `Read from ${attempt.source.title}: ${reason}.`],
        };
      } catch (error) {
        if (!isMcpDocError(error)) {
          ctx.logger.error('symbol read failed unexpectedly', { ref: attempt.record.ref, error });
          reason = 'an internal error occurred while reading it';
          continue;
        }
        reason = `${error.code}: ${error.message}`;
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
    const known = record.description === undefined ? [] : [`From the index: ${record.description}`];
    return { ...page, notices: [...page.notices, ...known] };
  };

  const notFound = (
    req: SymbolRequest,
    targets: Target[],
    states: IndexState[],
    names: string[],
    knownType: CatalogRecord | undefined,
  ): McpDocError => {
    const products = targets.map((target) => target.product.id);
    const pending = states.filter(
      (state) => state.state === 'building' || state.state === 'unavailable',
    );
    const why =
      knownType !== undefined
        ? `${displayName(knownType)} is documented but no member with this name was found; not verified, and this does not prove it does not exist`
        : pending.length > 0
          ? `The reference index of ${pending.map((s) => `${s.product}/${s.source}`).join(', ')} is not ready (building or unavailable); retry`
          : `Not verified: the reference of ${products.join(', ') || 'no product'} has no symbol with this name. This does not prove it does not exist`;
    return new McpDocError('SYMBOL_NOT_FOUND', `No symbol "${req.symbol}" was found`, {
      why,
      ...(names.length > 0 ? { candidates: names.slice(0, MAX_NEAREST) } : {}),
      next: formatCall(TOOLS.search, {
        query: req.symbol,
        product: req.product ?? products[0],
        kind: 'api',
      }),
      retryable: pending.length > 0,
    });
  };

  /** Names to suggest when nothing resolved: members of a known type, else what the text index finds. */
  const nearestNames = (
    req: SymbolRequest,
    targets: Target[],
    knownType: CatalogRecord | undefined,
  ): string[] => {
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
    const hits = index.query({
      text: req.symbol,
      products: targets.map((target) => target.product.id),
      kind: 'api',
      limit: MAX_NEAREST * 2,
      offset: 0,
    }).hits;
    const names = hits
      .map((hit) => index.record(hit.ref))
      .filter((record) => record !== undefined)
      .map(displayName);
    return [...new Set(names.filter((name) => name !== ''))].slice(0, MAX_NEAREST);
  };

  return {
    async lookup(req, call): Promise<SymbolResponse> {
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.symbol,
        max: MAX_ROUTED_PRODUCTS,
      });
      const targets = scope.resolutions.map((resolution) =>
        targetOf(resolution.product, scope, req),
      );
      const states: IndexState[] = [];
      const scopes: SymbolScope[] = [];
      for (const [position, target] of targets.entries()) {
        const scoped = scope.resolutions[position]?.source;
        states.push(
          ...(await index.ensure(
            target.product,
            symbolSources(target.product, scoped),
            target.line,
            call,
          )),
        );
        scopes.push({
          product: target.product.id,
          productRank: position,
          symbols: index.symbols(target.product.id, target.line.id),
          sourceRank: (record) => {
            const rank = target.product.sources.findIndex((source) => source.id === record.source);
            const source = target.product.sources[rank];
            // Decision 7: the site reference answers for the current docs, versioned packages
            // when a particular version is wanted.
            const versioned = source !== undefined && VERSION_ADDRESSED.has(source.adapter);
            return target.preferVersioned && versioned
              ? rank - target.product.sources.length
              : rank;
          },
        });
      }

      const resolution = resolveSymbol(req.symbol, scopes);
      if (resolution.kind === 'none') {
        throw notFound(
          req,
          targets,
          states,
          nearestNames(req, targets, resolution.knownType),
          resolution.knownType,
        );
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

      let page = await fetchPage(target, winner, req, call);
      if (!target.explicit && target.version !== undefined) {
        page = {
          ...page,
          notices: [...page.notices, `Version ${target.version} was detected in the project.`],
        };
      }
      if (winner.step === 'fuzzy' || winner.step === 'case-insensitive') {
        page = {
          ...page,
          notices: [
            ...page.notices,
            `"${req.symbol}" was matched to ${displayName(winner.record)}.`,
          ],
        };
      }
      index.addBody(page);
      await index.flush();

      const { text, truncated } = symbolText(page, winner.record, req.detail, req.maxTokens);
      const name = displayName(winner.record);
      const next = !truncated
        ? undefined
        : req.detail === 'full'
          ? formatCall(TOOLS.read, { ref: winner.record.ref, view: 'full' })
          : formatCall(TOOLS.lookupSymbol, {
              symbol: name,
              product: winner.record.product,
              detail: req.detail === 'signature' ? 'summary' : 'full',
            });
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
