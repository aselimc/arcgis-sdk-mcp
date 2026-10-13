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
  ProductResolution,
  SymbolResponse,
  SymbolService,
} from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';
import { simpleName } from '../index/symbol-map.js';
import type { IndexInternals } from '../index/types.js';
import { resolveScope } from '../scope.js';
import { symbolText } from './detail.js';
import { MAX_NEAREST, nearestNames, notFoundError } from './not-found.js';
import { createSymbolReader } from './read.js';
import { displayName, resolveSymbol, type Candidate, type SymbolScope } from './resolve.js';
import { VERSION_ADDRESSED, sourceRank, symbolSources, targetOf, type Target } from './target.js';
import { isTypeNamed, memberCandidate, memberEntry, ownerName } from './type-member.js';

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
      const memberName = normalizeSymbol(req.symbol).simple;
      /** The target and resolution of the product a record belongs to. */
      const placeOf = (product: string): { target: Target; resolved: ProductResolution } => {
        const position = targets.findIndex((target) => target.product.id === product);
        const target = targets[position];
        const resolved = scope.resolutions[position];
        if (target === undefined || resolved === undefined) {
          throw new McpDocError('INTERNAL', 'A resolved symbol has no product in scope');
        }
        return { target, resolved };
      };
      /**
       * Reads `member` out of the page of a type whose source lists no members. `undefined`
       * when the page has no such member; `names` then holds the members it does have.
       */
      const readFromType = async (
        type: CatalogRecord,
        member: string,
      ): Promise<{ winner: Candidate; page: DocPage } | { names: string[] }> => {
        const candidate = memberCandidate(type, member);
        const page = await reader.read(placeOf(type.product).target, candidate, req.detail, call);
        const entry = memberEntry(page, member);
        if (entry === undefined) {
          const known = (page.members ?? []).map((item) => item.name);
          return { names: nearest(member, known, MAX_NEAREST) };
        }
        // The page spells the name; the caller may have differed in case.
        return { winner: memberCandidate(type, entry.name), page };
      };

      let winner: Candidate;
      let alternates: Candidate[] = [];
      let read: DocPage | undefined;
      if (resolution.kind === 'none') {
        const { knownType } = resolution;
        const listed =
          knownType === undefined
            ? []
            : index
                .symbols(knownType.product, placeOf(knownType.product).target.line.id)
                .members(displayName(knownType));
        // A source that lists types only (package typings) still documents their members.
        const fromType =
          knownType !== undefined && listed.length === 0
            ? await readFromType(knownType, memberName)
            : undefined;
        if (fromType === undefined || 'names' in fromType) {
          const names =
            fromType !== undefined && knownType !== undefined && fromType.names.length > 0
              ? fromType.names.map((name) => `${displayName(knownType)}.${name}`)
              : nearestNames(index, req, targets, knownType);
          throw notFoundError(req, targets, states, names, knownType);
        }
        ({ winner, page: read } = fromType);
      } else if (resolution.kind === 'ambiguous') {
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
      } else {
        ({ winner, alternates } = resolution);
      }

      const { target, resolved } = placeOf(winner.record.product);
      const versionedSource = (record: CatalogRecord): boolean => {
        const source = target.product.sources.find((candidate) => candidate.id === record.source);
        return source !== undefined && VERSION_ADDRESSED.has(source.adapter);
      };
      const notices: string[] = [];
      if (
        read === undefined &&
        target.preferVersioned &&
        winner.record.parent !== undefined &&
        !versionedSource(winner.record)
      ) {
        // The member is indexed from the website, which documents the current release only;
        // the version asked for is in the package typings, under the member's type.
        const owner = ownerName(winner.record);
        const type = index
          .symbols(target.product.id, target.line.id)
          .exact(owner)
          .find((record) => isTypeNamed(record, owner) && versionedSource(record));
        const fromType =
          type === undefined ? undefined : await readFromType(type, simpleName(winner.record));
        if (fromType !== undefined && 'winner' in fromType) {
          ({ winner, page: read } = fromType);
        } else if (target.version !== undefined) {
          notices.push(
            `Version ${target.version} of this member could not be read from the package; this is the documentation of the current release.`,
          );
        }
      }

      const name = displayName(winner.record);
      read ??= await reader.read(target, winner, req.detail, call);
      notices.unshift(...read.notices);
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
