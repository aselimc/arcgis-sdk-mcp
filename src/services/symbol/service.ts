/**
 * The symbol service: resolves a name to one catalogue record (design section 3.6), reads
 * it through its source's adapter and trims it to the requested detail. Once a record is
 * resolved the lookup no longer fails for an upstream problem (see `read.ts`).
 */
import { bindSource } from '../../core/adapter-helpers.js';
import { formatCall, joinSections } from '../../core/budget.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  AdapterRegistry,
  CallOptions,
  Ctx,
  IndexState,
  ProductResolution,
  SymbolRequest,
  SymbolResponse,
  SymbolService,
} from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { Capability, CatalogRecord, DocPage } from '../../core/types.js';
import { pageKey } from '../../core/url.js';
import { pagedSections, readCursor } from '../doc/paging.js';
import { resolveSection } from '../doc/section-resolve.js';
import { simpleName } from '../index/symbol-map.js';
import type { IndexInternals } from '../index/types.js';
import { resolveScope, type Scope } from '../scope.js';
import { symbolText, type SymbolText } from './detail.js';
import {
  MAX_INHERITED_CANDIDATES,
  baseTypes,
  declaredElsewhere,
  inheritedNotice,
  type BaseType,
} from './inherited.js';
import { MAX_NEAREST, nearestNames, notFoundError, unsearchedError } from './not-found.js';
import { createSymbolReader } from './read.js';
import {
  MAX_ALTERNATES,
  candidateOf,
  displayName,
  isPlainlyTitled,
  resolveSymbol,
  type Candidate,
  type Resolution,
  type Step,
  type SymbolScope,
} from './resolve.js';
import { VERSION_ADDRESSED, sourceRank, symbolSources, targetOf, type Target } from './target.js';
import { namedByTitle, titledRecords } from './titled.js';
import {
  documentsSeveralTypes,
  isTypeNamed,
  memberCandidate,
  memberEntry,
  memberOnPage,
  memberOwners,
  ownerName,
} from './type-member.js';

/** Most products a lookup without a `product` argument covers. */
const MAX_ROUTED_PRODUCTS = 3;

/** Pages of base types read while looking for the declaration of an inherited member. */
const MAX_BASE_PAGES = 4;

/** Largest `max_tokens` a tool accepts; a follow-up call never asks for more. */
const MAX_TOKENS = 20_000;

/** One product of a lookup with everything that was prepared for it. */
interface Prepared {
  resolution: ProductResolution;
  target: Target;
  /** Said of every answer from this product: why another line than the project's is read. */
  notices: string[];
}

/** What a member of a type page turned out to be. */
type FromType =
  | { winner: Candidate; page?: DocPage; documented: boolean; inheritedFrom?: string }
  | { names: string[]; severalTypes: boolean };

/** Steps that only approximate the name that was asked for. */
const LOOSE_STEPS: ReadonlySet<Step> = new Set(['case-insensitive', 'fuzzy']);

/** True when a resolution found the name only without case, by its prefix or misspelt. */
function onlyLoosely(resolution: Resolution): boolean {
  if (resolution.kind === 'found') return LOOSE_STEPS.has(resolution.winner.step);
  if (resolution.kind === 'ambiguous') {
    return resolution.candidates.every((candidate) => LOOSE_STEPS.has(candidate.step));
  }
  return false;
}

function fragmentOf(ref: string): string | undefined {
  const raw = ref.includes('#') ? ref.slice(ref.indexOf('#') + 1) : '';
  if (raw === '') return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Creates the symbol service. */
export function createSymbolService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): SymbolService {
  const reader = createSymbolReader(ctx, adapters);

  /** The capabilities a product's reference sources need that are switched off. */
  const switchedOff = (target: Target, sources: readonly string[] | undefined): Capability[] => {
    const off = new Set<Capability>();
    for (const source of target.product.sources) {
      if (sources !== undefined && !sources.includes(source.id)) continue;
      const { capability } = source;
      if (capability !== undefined && !ctx.policy.enabled(capability)) off.add(capability);
    }
    return [...off];
  };

  /**
   * Loads the reference indexes of one product for the line the request is aimed at. When
   * that line has no usable source (the typings of an older version with `package-cdn` off,
   * next to a website that documents the current release only), a version the project
   * merely happens to use gives way to the current line, with a notice; one the caller
   * asked for is an error that names the capability.
   */
  const prepare = async (
    resolution: ProductResolution,
    scope: Scope,
    req: SymbolRequest,
    call: CallOptions,
    states: IndexState[],
  ): Promise<Prepared> => {
    let target = targetOf(ctx, resolution.product, scope, req);
    const sources = symbolSources(target.product, resolution.source);
    let own = await index.ensure(target.product, sources, target.line, call);
    const notices: string[] = [];
    const unusable = own.length > 0 && own.every((state) => state.state === 'unavailable');
    if (unusable && !target.line.current) {
      const [capability] = switchedOff(target, sources);
      const setting =
        capability === undefined
          ? ''
          : ` (capability "${capability}" is switched off; set ARCGIS_DOCS_SOURCES=+${capability})`;
      if (target.explicit) {
        if (capability !== undefined) {
          throw new McpDocError(
            'SOURCE_DISABLED',
            `Version ${target.version ?? ''} of ${target.product.name} cannot be looked up`,
            {
              why: `Its versioned reference needs capability "${capability}", which is switched off`,
              next: `Set ARCGIS_DOCS_SOURCES=+${capability}`,
              capability,
            },
          );
        }
      } else {
        target = { ...target, line: ctx.registry.line(target.product), preferVersioned: false };
        own = await index.ensure(target.product, sources, target.line, call);
        notices.push(
          `The reference of version ${target.version ?? ''} cannot be read in this configuration${setting}; this is the documentation of the current release.`,
        );
      }
    }
    states.push(...own);
    return { resolution, target, notices };
  };

  return {
    async lookup(req, call): Promise<SymbolResponse> {
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.symbol,
        max: MAX_ROUTED_PRODUCTS,
      });
      const states: IndexState[] = [];
      const prepared: Prepared[] = [];
      /**
       * Prepares more products. `tolerant` skips one that cannot be prepared (a version the
       * caller gave that a fallback product does not have): the lookup already has an answer
       * and only looks for a better one.
       */
      const extend = async (
        resolutions: readonly ProductResolution[],
        tolerant = false,
      ): Promise<void> => {
        for (const resolution of resolutions) {
          try {
            prepared.push(await prepare(resolution, scope, req, call, states));
          } catch (error) {
            if (!tolerant || !isMcpDocError(error)) throw error;
            ctx.logger.debug('fallback product skipped', { product: resolution.product.id, error });
          }
        }
      };
      const scopes = (): SymbolScope[] =>
        prepared.map(({ target, resolution }, position) => ({
          product: target.product.id,
          productRank: position,
          symbols: index.symbols(target.product.id, target.line.id),
          sourceRank: (record) =>
            // A scope the caller narrowed to one source has no order of sources.
            resolution.source === undefined ? sourceRank(target, record.source) : 0,
        }));

      await extend(scope.resolutions);
      let resolution = resolveSymbol(req.symbol, scopes());
      const asked = prepared.length;
      if (resolution.kind === 'none' && resolution.knownType === undefined) {
        // Nothing in the project's SDKs or the first guess: the products next in line are
        // asked before the name is reported missing.
        await extend(scope.fallbacks);
        if (prepared.length > asked) resolution = resolveSymbol(req.symbol, scopes());
      } else if (scope.origin !== 'argument' && onlyLoosely(resolution)) {
        // A guessed scope that knows the name only loosely (`Round`: the prefix of `roundUp`
        // in the JavaScript SDK) may have missed the product that has it exactly (the Arcade
        // function). The step decides before the product does, so an exact name of a
        // product next in line wins, and a loose one does not displace the first answer.
        await extend(scope.fallbacks, true);
        if (prepared.length > asked) resolution = resolveSymbol(req.symbol, scopes());
      }
      const targets = prepared.map((entry) => entry.target);
      const memberName = normalizeSymbol(req.symbol).simple;

      /** What was prepared for the product a record belongs to. */
      const placeOf = (product: string): Prepared => {
        const place = prepared.find((entry) => entry.target.product.id === product);
        if (place === undefined) {
          throw new McpDocError('INTERNAL', 'A resolved symbol has no product in scope');
        }
        return place;
      };

      /**
       * Reads `member` out of the page of a type. A reference indexes a member once, under
       * the type that declares it, and some sources index types only; the page of the type
       * still documents the member, whether it is its own or inherited. Without the member,
       * `names` holds what the page offers instead.
       */
      const readFromType = async (type: CatalogRecord, member: string): Promise<FromType> => {
        const candidate = memberCandidate(type, member);
        const read = await reader.read(placeOf(type.product).target, candidate, req.detail, call);
        // A page that could not be fetched is a placeholder titled with what was asked for.
        const unread = read.degraded?.level === 'link-only';
        const listed = unread ? undefined : memberEntry(read, member, type);
        const entry = unread ? undefined : (listed ?? memberOnPage(read, member));
        if (entry === undefined) {
          // The same name on other types of the page (a module page) is the likeliest slip.
          const elsewhere = memberOwners(read, member);
          const known = (read.members ?? []).map((item) => item.name);
          const names =
            elsewhere.length > 0
              ? elsewhere
              : nearest(member, known, MAX_NEAREST).map((name) => `${displayName(type)}.${name}`);
          return {
            names: names.slice(0, MAX_NEAREST),
            severalTypes: !unread && documentsSeveralTypes(read),
          };
        }
        if (documentsSeveralTypes(read)) {
          // The page was asked for by the bare member name, which several of its types have.
          // The entry's id is the member that was meant: its own record when the catalogue
          // has one, and in any case the anchor to read, so that the answer is that member
          // and is named as what it is.
          const { target } = placeOf(type.product);
          const indexed = index
            .symbols(type.product, target.line.id)
            .exact(entry.id)
            .find((record) => record.qualified === entry.id);
          const record = indexed ?? {
            ...memberCandidate(type, entry.name).record,
            ref: `${type.ref.split('#')[0] ?? type.ref}#${entry.id}`,
          };
          return { winner: candidateOf(record, 'member'), documented: true };
        }
        // A member found in the text of the page joins its member list, so that the detail
        // levels cut it out like any other.
        const page = listed === undefined ? { ...read, members: [...(read.members ?? []), entry] } : read;
        return {
          // The page spells the name; the caller may have differed in case.
          winner: memberCandidate(type, entry.name),
          page,
          documented: page.sections.some((section) => section.id === entry.id) || listed === undefined,
          ...(entry.inheritedFrom === undefined ? {} : { inheritedFrom: entry.inheritedFrom }),
        };
      };

      /**
       * The declaration of `member` on a type that `type` inherits it from: the same-named
       * member of another type that the page of `type` links to.
       */
      const readInherited = async (
        type: CatalogRecord,
        member: string,
      ): Promise<Candidate | undefined> => {
        const { target } = placeOf(type.product);
        const owner = displayName(type);
        const lower = member.toLowerCase();
        const candidates = index
          .symbols(type.product, target.line.id)
          .exact(member)
          .filter(
            (record) =>
              record.parent !== undefined &&
              record.parent !== owner &&
              simpleName(record).toLowerCase() === lower,
          );
        if (candidates.length === 0 || candidates.length > MAX_INHERITED_CANDIDATES) {
          return undefined;
        }
        const typePage = await reader.read(target, candidateOf(type, 'qualified'), 'full', call);
        const declared =
          declaredElsewhere(typePage, candidates) ??
          (await declaredOnBase(target, typePage, candidates));
        return declared === undefined ? undefined : candidateOf(declared, 'member');
      };

      /**
       * The candidate declared on the nearest base type of the type documented by
       * `typePage`, for references whose pages name base types but not inherited members.
       * Walks up level by level, reading at most {@link MAX_BASE_PAGES} pages of base types.
       */
      const declaredOnBase = async (
        target: Target,
        typePage: DocPage,
        candidates: readonly CatalogRecord[],
      ): Promise<CatalogRecord | undefined> => {
        const symbols = index.symbols(target.product.id, target.line.id);
        const typeNamed = (name: string): CatalogRecord[] =>
          symbols.exact(name).filter((record) => record.parent === undefined);
        // The page of each declaring type, so a link to that type identifies its member.
        const declaredAt = new Map<string, CatalogRecord>();
        for (const candidate of candidates) {
          for (const owner of typeNamed(candidate.parent ?? '')) {
            if (!declaredAt.has(pageKey(owner.ref))) declaredAt.set(pageKey(owner.ref), candidate);
          }
        }
        const visited = new Set<string>([pageKey(typePage.url)]);
        let level = baseTypes(typePage);
        let pagesRead = 0;
        while (level.length > 0) {
          const hit = level.map((base) => declaredAt.get(base.ref)).find((found) => found);
          if (hit !== undefined) return hit;
          const above: BaseType[] = [];
          for (const base of level) {
            if (visited.has(base.ref) || pagesRead >= MAX_BASE_PAGES) continue;
            visited.add(base.ref);
            const record = typeNamed(base.name).find((found) => pageKey(found.ref) === base.ref);
            if (record === undefined) continue;
            pagesRead += 1;
            const page = await reader.read(target, candidateOf(record, 'qualified'), 'full', call);
            above.push(...baseTypes(page));
          }
          level = above;
        }
        return undefined;
      };

      let winner: Candidate;
      let alternates: Candidate[] = [];
      let read: DocPage | undefined;
      let inherited: string | undefined;
      if (resolution.kind === 'none' && resolution.knownType !== undefined) {
        const { knownType } = resolution;
        // The page of the type first: it documents its own members and, in references that
        // inline them (the JavaScript reference), the inherited ones as well.
        const fromType = await readFromType(knownType, memberName);
        // A page that documents several types links to every member of each of them: such a
        // link is no statement that this type inherits the member.
        const settled =
          'winner' in fromType ? fromType.documented : fromType.severalTypes;
        const declared = settled ? undefined : await readInherited(knownType, memberName);
        if (declared !== undefined) {
          winner = declared;
          inherited = inheritedNotice(
            displayName(knownType),
            simpleName(declared.record),
            declared.record.parent ?? ownerName(declared.record),
          );
        } else if ('winner' in fromType) {
          ({ winner, page: read } = fromType);
          if (fromType.inheritedFrom !== undefined) {
            inherited = `${displayName(knownType)} inherits ${simpleName(winner.record)} from ${fromType.inheritedFrom}.`;
          }
        } else {
          const names =
            fromType.names.length > 0
              ? fromType.names
              : nearestNames(index, req, targets, knownType);
          throw notFoundError(req, targets, states, names, knownType);
        }
      } else if (resolution.kind === 'none') {
        // No symbol of that name: a reference page that is titled with it is the answer.
        const [titled, ...others] = titledRecords(index, req.symbol, targets);
        if (titled === undefined) {
          throw (
            unsearchedError(ctx, req, targets, states) ??
            notFoundError(req, targets, states, nearestNames(index, req, targets, undefined), undefined)
          );
        }
        winner = candidateOf(namedByTitle(titled.record), titled.exact ? 'simple' : 'case-insensitive');
        alternates = others
          .slice(0, MAX_ALTERNATES)
          .map((other) => candidateOf(namedByTitle(other.record), 'case-insensitive'));
      } else if (resolution.kind === 'ambiguous') {
        // Candidates of several sources of one product cannot be told apart by a name both
        // carry (`generateToken` of two REST services): the source is then part of the pair.
        const sourcesOf = new Map<string, Set<string>>();
        for (const { record } of resolution.candidates) {
          sourcesOf.set(record.product, (sourcesOf.get(record.product) ?? new Set()).add(record.source));
        }
        const pairs = resolution.candidates.map(({ record }) => ({
          symbol: displayName(record),
          product:
            (sourcesOf.get(record.product)?.size ?? 0) > 1
              ? `${record.product}/${record.source}`
              : record.product,
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
      } else {
        ({ winner, alternates } = resolution);
        // A page titled with the name but indexed without a symbol is worth a mention.
        const known = new Set([winner, ...alternates].map((candidate) => pageKey(candidate.record.ref)));
        const titled = titledRecords(index, req.symbol, targets)
          .filter(({ record }) => record.symbol === undefined && !known.has(pageKey(record.ref)))
          .map(({ record }) => candidateOf(namedByTitle(record), 'case-insensitive'));
        // The root `search` of a portal is indexed by its title alone (`search: Search`), the
        // search of a group's content by its symbol: the page titled with the bare name is the
        // operation meant, and the symbol's own page is listed next to it.
        const name = simpleName(winner.record);
        const plain = titled.find(({ record }) => isPlainlyTitled(record, name));
        if (
          plain !== undefined &&
          winner.record.symbolKind === 'operation' &&
          !isPlainlyTitled(winner.record, name)
        ) {
          alternates = [winner, ...alternates];
          winner = { ...plain, step: 'simple' };
        }
        alternates = [...alternates, ...titled.filter((candidate) => candidate !== plain || winner !== plain)];
        alternates = alternates.filter((candidate) => candidate.record !== winner.record);
        alternates = alternates.slice(0, MAX_ALTERNATES);
      }

      const { target, resolution: resolved, notices: targetNotices } = placeOf(winner.record.product);
      const versionedSource = (record: CatalogRecord): boolean => {
        const source = target.product.sources.find((candidate) => candidate.id === record.source);
        return source !== undefined && VERSION_ADDRESSED.has(source.adapter);
      };
      const notices: string[] = [...targetNotices];
      if (
        read === undefined &&
        target.preferVersioned &&
        winner.record.parent !== undefined &&
        !versionedSource(winner.record)
      ) {
        // The member is indexed from the website; the version asked for may be in the package
        // typings, under the member's type.
        const owner = ownerName(winner.record);
        const type = index
          .symbols(target.product.id, target.line.id)
          .exact(owner)
          .find((record) => isTypeNamed(record, owner) && versionedSource(record));
        const fromType =
          type === undefined ? undefined : await readFromType(type, simpleName(winner.record));
        if (fromType !== undefined && 'winner' in fromType) {
          ({ winner, page: read } = fromType);
        } else if (target.version !== undefined && target.line.current) {
          // Only the website of the current line documents the current release. The reference
          // of another line (`/v200/`) is that line's own and was read as asked.
          notices.push(
            `Version ${target.version} of this member could not be read from the package; this is the documentation of the current release.`,
          );
        }
      }

      const name = displayName(winner.record);
      // A follow-up call is made in the scope this answer came from. A REST operation is
      // named without its service (`search` of the portal, `search` of a knowledge graph),
      // so the bare product would resolve it to another one.
      const scoped =
        resolved.source !== undefined ||
        (winner.record.parent === undefined && winner.record.symbolKind === 'operation');
      const productArg = scoped
        ? `${winner.record.product}/${winner.record.source}`
        : winner.record.product;
      read ??= await reader.read(target, winner, req.detail, call);
      notices.unshift(...read.notices);
      if (inherited !== undefined) notices.push(inherited);
      if (!target.explicit && target.version !== undefined) {
        notices.push(`Version ${target.version} was detected in the project.`);
      }
      if (winner.step === 'fuzzy' || winner.step === 'case-insensitive') {
        notices.push(`"${req.symbol}" was matched to ${name}.`);
      }
      const first = scope.resolutions.map((entry) => entry.product.id);
      if (scope.origin !== 'argument' && !first.includes(target.product.id)) {
        notices.push(
          `Not found in ${first.join(', ')}; this answer is from ${target.product.id}. Pass "product" to choose.`,
        );
      } else if (scope.origin === 'query' || scope.origin === 'router') {
        notices.push(
          `The product ${target.product.id} was inferred from the name; pass "product" to look in another.`,
        );
      }
      const page = { ...read, notices };
      index.addBody(page);
      await index.flush();

      const shaped = symbolText(page, winner.record, req.detail, req.maxTokens);

      /**
       * The read call that continues a text at the offset where the budget cut it, or
       * `undefined` when a read of the page would not page over the same text. A cursor is
       * only worth issuing when it is certain to be accepted, so the page is read the way
       * `arcgis_docs_read` will read it (from the cache, since it was just fetched) and the
       * two texts are compared: an adapter's own symbol method, another source answering for
       * the URL, or sections the reader adds all make them differ.
       */
      const continuation = async (text: SymbolText): Promise<string | undefined> => {
        if (text.cutOffset === undefined) return undefined;
        const source = target.product.sources.find((candidate) => candidate.id === page.source);
        if (source === undefined) return undefined;
        const fragment =
          winner.record.parent === undefined ? undefined : fragmentOf(winner.record.ref);
        const ref = fragment === undefined ? page.url : winner.record.ref;
        try {
          const url = new URL(ref);
          const owner = ctx.registry.ownerOf(url);
          if (owner?.product.id !== target.product.id || owner.source.id !== source.id) {
            return undefined;
          }
          const record = index.record(url.href);
          const readerPage = await adapters
            .get(source.adapter)
            .read(ctx, bindSource(target.product, source, owner.line, undefined, call.budget), {
              url,
              ...(fragment === undefined ? {} : { select: { section: fragment, member: fragment } }),
              ...(record === undefined ? {} : { record }),
            });
          const all = pagedSections(readerPage, 'all');
          const shown =
            fragment === undefined ? all : resolveSection(readerPage, all, fragment)?.sections;
          if (shown === undefined || joinSections(shown) !== joinSections(text.own)) {
            return undefined;
          }
          return formatCall(TOOLS.read, {
            ref,
            view: 'full',
            cursor: readCursor(readerPage.ref, fragment, shown, text.cutOffset),
          });
        } catch (error) {
          ctx.logger.debug('no continuation cursor for a cut lookup', { ref, error });
          return undefined;
        }
      };

      let next: string | undefined;
      if (shaped.truncated && req.detail === 'signature') {
        next = formatCall(TOOLS.lookupSymbol, {
          symbol: name,
          product: productArg,
          detail: 'summary',
        });
      } else if (shaped.truncated) {
        // A cut text continues where it stopped. Asking for more detail is the next step
        // only when the level left something out; `full` of a text that `summary` showed
        // from its start would return the same words again.
        const enough = Math.min(MAX_TOKENS, Math.ceil((shaped.totalTokens + 500) / 500) * 500);
        const fuller = formatCall(TOOLS.lookupSymbol, {
          symbol: name,
          product: productArg,
          detail: 'full',
          ...(shaped.budgetCut ? { max_tokens: enough } : {}),
        });
        const restart = formatCall(TOOLS.read, { ref: winner.record.ref, view: 'full' });
        next = (await continuation(shaped)) ?? (req.detail === 'full' ? restart : fuller);
      }
      return {
        record: winner.record,
        page,
        text: shaped.text,
        alternates: alternates.map((candidate) => candidate.record),
        resolvedProduct: resolved,
        ...(next === undefined ? {} : { next }),
      };
    },
  };
}
