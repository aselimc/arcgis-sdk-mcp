/**
 * The catalogue service behind `arcgis_docs_list_products`: the product
 * list (pure registry data), one product's profile with in-memory source health, and a
 * source's table of contents from its catalogue index.
 */
import { formatCall } from '../core/budget.js';
import { decodeCursor, encodeCursor } from '../core/cursor.js';
import { isMcpDocError, McpDocError } from '../core/errors.js';
import { shortHash } from '../core/hash.js';
import { TOOLS } from '../core/names.js';
import type { CatalogService, Ctx } from '../core/ports.js';
import { tokenize } from '../core/tokenize.js';
import { CATEGORIES, type Product, type SourceHealth } from '../core/types.js';
import type { IndexInternals } from './index/types.js';

/** Table-of-contents entries per call when the caller sets no limit. */
export const TOC_PAGE_SIZE = 100;

/** Category of end-user product help, left out of the default list. */
const HELP_CATEGORY = 'product-help';

function isLegacy(product: Product): boolean {
  return product.status === 'deprecated' || product.status === 'retired';
}

/** A query of at least this many words is a sentence, not a name. */
const MANY_TERMS = 3;

/** Of a sentence, products scoring below this share of the best are left out. */
const RELATIVE_FLOOR = 0.3;

/**
 * Words of a sentence that say nothing about a product: "I want to build a web app that
 * shows a map" is about `web` and `map`. Without this, `with` in the name "MapLibre GL JS
 * with ArcGIS" counted as a match of the name.
 */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'build',
  'can',
  'create',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'make',
  'my',
  'need',
  'of',
  'on',
  'or',
  'our',
  'show',
  'that',
  'the',
  'this',
  'to',
  'use',
  'using',
  'want',
  'we',
  'what',
  'which',
  'with',
  'you',
]);

/** One form for the inflections of a word: `points` and `point`, `clustered` and `cluster`. */
function fold(term: string): string {
  if (term.length > 5 && term.endsWith('ing')) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

/** The terms of a text as {@link relevance} compares them. */
function folded(text: string): string[] {
  return tokenize(text)
    .map(fold)
    .filter((term) => !FILLER.has(term));
}

/** Share of the query's words found in what the registry says about a product; id and name count double. */
function relevance(product: Product, terms: readonly string[]): number {
  const strong = new Set(folded([product.id, product.name, ...product.aliases].join(' ')));
  const weak = new Set(
    folded(
      [
        product.summary,
        ...product.keywords,
        ...product.languages,
        ...product.sources.map((s) => s.title),
      ].join(' '),
    ),
  );
  let score = 0;
  for (const term of terms) {
    if (strong.has(term)) score += 2;
    else if (weak.has(term)) score += 1;
  }
  return score;
}

/** Reads the offset of a cursor, attaching the call that restarts the listing. */
function offsetOf(
  cursor: string | undefined,
  key: string,
  validator: string,
  restart: string,
): number {
  if (cursor === undefined) return 0;
  try {
    return decodeCursor(cursor, TOOLS.listProducts, { k: key, e: validator }).o;
  } catch (error) {
    if (!isMcpDocError(error)) throw error;
    throw new McpDocError(error.code, error.message, { ...error.details, next: restart });
  }
}

/** Creates the catalogue service. */
export function createCatalogService(ctx: Ctx, index: IndexInternals): CatalogService {
  return {
    list(req) {
      const category = req.category;
      const terms = [...new Set(folded(req.query ?? ''))];
      const order = new Map<string, number>(CATEGORIES.map((name, position) => [name, position]));

      const scored = ctx.registry
        .all()
        .filter((product) => {
          if (category === 'all') return true;
          return category === undefined
            ? product.category !== HELP_CATEGORY
            : product.category === category;
        })
        .filter((product) => req.includeLegacy || !isLegacy(product))
        .map((product) => ({ product, score: terms.length === 0 ? 0 : relevance(product, terms) }))
        .filter((entry) => terms.length === 0 || entry.score > 0);
      // A sentence shares a common word with nearly every product ("map", "data"): of a
      // query of several words, products far below the best match are not matches at all.
      const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
      const floor = terms.length >= MANY_TERMS ? best * RELATIVE_FLOOR : 0;
      const matching = scored
        .filter((entry) => entry.score >= floor)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (order.get(a.product.category) ?? 0) - (order.get(b.product.category) ?? 0) ||
            a.product.name.localeCompare(b.product.name),
        )
        .map((entry) => entry.product);

      const args = {
        query: req.query,
        category: req.category,
        include_legacy: req.includeLegacy || undefined,
      };
      const key = shortHash(
        JSON.stringify([req.query ?? '', req.category ?? '', req.includeLegacy]),
      );
      const validator = shortHash(matching.map((product) => product.id).join('\n'));
      const offset = offsetOf(req.cursor, key, validator, formatCall(TOOLS.listProducts, args));
      const end = offset + req.limit;
      return {
        products: matching.slice(offset, end),
        total: matching.length,
        ...(end < matching.length
          ? {
              nextCursor: encodeCursor({
                v: 1,
                t: TOOLS.listProducts,
                k: key,
                e: validator,
                o: end,
              }),
            }
          : {}),
      };
    },

    profile(input) {
      const resolution = ctx.registry.resolve(input);
      const { product } = resolution;
      const health: Record<string, SourceHealth> = {};
      const known = new Map(
        index
          .health()
          .filter((entry) => entry.product === product.id)
          .map(({ product: _product, source, ...rest }) => [source, rest]),
      );
      for (const source of product.sources) {
        const off = source.capability !== undefined && !ctx.policy.enabled(source.capability);
        health[source.id] = off
          ? {
              state: 'disabled',
              lastError: `capability "${source.capability ?? ''}" is switched off`,
            }
          : (known.get(source.id) ?? { state: 'unknown' });
      }
      return { resolution, health };
    },

    async toc(input, section, cursor, call, limit = TOC_PAGE_SIZE) {
      const { product } = ctx.registry.resolve(input);
      const wanted = section.trim().toLowerCase();
      const source = product.sources.find((candidate) => candidate.id.toLowerCase() === wanted);
      if (source === undefined) {
        throw new McpDocError('SECTION_NOT_FOUND', `${product.id} has no section "${section}"`, {
          why: 'A section is one of the source ids listed in the product profile',
          candidates: product.sources.map((candidate) => candidate.id),
          next: formatCall(TOOLS.listProducts, { product: product.id }),
        });
      }
      // A source that exists only for older version lines (the help of earlier releases) is
      // listed on the newest line it has; on the current line it has no pages at all, and
      // its table of contents stayed empty whatever the caller did.
      const current = ctx.registry.line(product);
      const own = source.lines;
      const line =
        own === undefined || own.includes(current.id)
          ? current
          : (product.lines.find((candidate) => own.includes(candidate.id)) ?? current);
      const { capability } = source;
      if (capability !== undefined && !ctx.policy.enabled(capability)) {
        // An empty list would read as "nothing there yet"; the source is switched off.
        throw new McpDocError(
          'SOURCE_DISABLED',
          `${product.name}: ${source.title} is switched off`,
          {
            why: `Its table of contents needs capability "${capability}"`,
            next: `Set ARCGIS_DOCS_SOURCES=+${capability}`,
            capability,
          },
        );
      }
      await index.ensure(product, [source.id], line, call);
      // Pages under the same ancestors are listed together, in catalogue order; a stable
      // sort keeps that order inside a group, and so across the pages of a paged listing.
      const entries = [...index.toc(product.id, source.id, line.id)].sort((a, b) =>
        (a.breadcrumb ?? '').localeCompare(b.breadcrumb ?? '', 'en'),
      );

      const args = { product: product.id, section: source.id };
      const key = shortHash(JSON.stringify(['toc', product.id, source.id, line.id]));
      const validator = index.validator({
        products: [product.id],
        sources: [source.id],
        line: line.id,
      });
      const offset = offsetOf(cursor, key, validator, formatCall(TOOLS.listProducts, args));
      const end = offset + Math.max(1, limit);
      return {
        entries: entries.slice(offset, end),
        total: entries.length,
        ...(end < entries.length
          ? {
              nextCursor: encodeCursor({
                v: 1,
                t: TOOLS.listProducts,
                k: key,
                e: validator,
                o: end,
              }),
            }
          : {}),
      };
    },
  };
}
