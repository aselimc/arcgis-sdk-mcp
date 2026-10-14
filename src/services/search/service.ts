/**
 * The search pipeline: resolve the scope, make sure its indexes are
 * loaded, collect candidates from the symbol sidecar, the catalogue index, the body index,
 * the curated briefs and (when enabled) site search, fuse them by rank, apply the
 * multipliers, de-duplicate and page. Zero hits is a normal result that explains itself.
 */
import { formatCall } from '../../core/budget.js';
import { decodeCursor, encodeCursor } from '../../core/cursor.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { shortHash } from '../../core/hash.js';
import { TOOLS } from '../../core/names.js';
import type {
  Ctx,
  IndexState,
  SearchProvider,
  SearchResponse,
  SearchService,
  VersionService,
} from '../../core/ports.js';
import { rrf } from '../../core/rrf.js';
import type { SearchHit } from '../../core/types.js';
import { queryTerms } from '../index/query-terms.js';
import type { IndexInternals } from '../index/types.js';
import { anySearchable, indexNotes, scopeNote } from '../notes.js';
import { projectLine, resolveScope } from '../scope.js';
import { briefHits } from './briefs.js';
import { classifyQuery } from './classify.js';
import { coveredBySiteSearch } from './esearch/provider.js';
import { excerptOf } from './excerpt.js';
import { bestSectionPerPage, collapseRepeats, dedupe, oneSlotPerPage, rerank } from './rank.js';
import {
  SECONDARY_DEPTH,
  createSiteRetriever,
  productCards,
  symbolHits,
  type SearchTarget,
} from './retrievers.js';
import { SYNONYMS } from './synonyms.js';
import { applyVersionFacet } from './version-facet.js';
import { zeroHitNotes } from './zero-hits.js';

/** Most products a search without a `product` argument covers. */
const MAX_ROUTED_PRODUCTS = 3;

/** Candidates taken from the catalogue index before fusion. */
const CANDIDATE_DEPTH = 100;

/** Fewest query words for which "no page matches every word" is worth saying. */
const WORDS_FOR_PARTIAL_NOTE = 2;

/** Collaborators of the search service. */
export interface SearchDeps {
  ctx: Ctx;
  index: IndexInternals;
  versions: VersionService;
  provider: SearchProvider;
  /** Overrides the soft deadline of site search; tests use a few milliseconds. */
  siteSoftDeadlineMs?: number;
}

/** True when a version label is the requested version or a release of it (`5.1` for `5`). */
function sameRelease(label: string, version: string): boolean {
  const asked = version.replace(/^v(?=\d)/i, '');
  return label === asked || label.startsWith(`${asked}.`) || asked.startsWith(`${label}.`);
}

/** Creates the search service. */
export function createSearchService(deps: SearchDeps): SearchService {
  const { ctx, index, versions } = deps;
  const site = createSiteRetriever(ctx, deps.provider, deps.siteSoftDeadlineMs);

  const labelsOf = async (targets: SearchTarget[]): Promise<Map<string, string | undefined>> => {
    const labels = new Map<string, string | undefined>();
    for (const { product, line } of targets) {
      try {
        labels.set(`${product.id}/${line.id}`, await versions.label(product, line));
      } catch (error) {
        ctx.logger.debug('version label unavailable', { product: product.id, error });
      }
    }
    return labels;
  };

  /**
   * The version label of each hit's source. A source a version oracle does not describe (a
   * hosted REST service next to the Enterprise reference) gets none, so the label of its
   * product line is not printed on it.
   */
  const sourceLabels = async (
    hits: readonly SearchHit[],
    labels: ReadonlyMap<string, string | undefined>,
  ): Promise<Map<string, string | undefined>> => {
    const bySource = new Map<string, string | undefined>();
    for (const hit of hits) {
      const key = `${hit.product}/${hit.line}/${hit.source}`;
      if (bySource.has(key)) continue;
      const product = ctx.registry.get(hit.product);
      const line = product?.lines.find((candidate) => candidate.id === hit.line);
      const source = product?.sources.find((candidate) => candidate.id === hit.source);
      let label = labels.get(`${hit.product}/${hit.line}`);
      if (product !== undefined && line !== undefined && source !== undefined) {
        try {
          label = await versions.label(product, line, source);
        } catch (error) {
          ctx.logger.debug('version label unavailable', { product: product.id, error });
        }
      }
      bySource.set(key, label);
    }
    return bySource;
  };

  const labelled = (
    hits: SearchHit[],
    labels: ReadonlyMap<string, string | undefined>,
  ): SearchHit[] =>
    hits.map((hit) => {
      const version =
        hit.version ??
        labels.get(`${hit.product}/${hit.line}/${hit.source}`) ??
        (labels.has(`${hit.product}/${hit.line}/${hit.source}`)
          ? undefined
          : labels.get(`${hit.product}/${hit.line}`));
      const excerpt = excerptOf(hit.excerpt);
      const { excerpt: _dropped, ...rest } = hit;
      return {
        ...rest,
        ...(version === undefined ? {} : { version }),
        ...(excerpt === undefined ? {} : { excerpt }),
      };
    });

  return {
    async search(req, call): Promise<SearchResponse> {
      const scope = await resolveScope(ctx, {
        product: req.product,
        query: req.query,
        max: MAX_ROUTED_PRODUCTS,
      });
      const notes: string[] = [];
      const versionGiven = req.version !== undefined;

      const targets: SearchTarget[] = [];
      let lineError: McpDocError | undefined;
      /** True when a line other than the current one is searched, by request or for the project. */
      let lineChosen = versionGiven;
      for (const resolution of scope.resolutions) {
        try {
          const { product } = resolution;
          const own = projectLine(ctx, product, scope.workspace);
          const line = versionGiven ? ctx.registry.line(product, req.version) : own.line;
          if (!versionGiven && own.pinned) {
            lineChosen = true;
            notes.push(
              `The project uses ${product.id} ${own.version ?? ''}: the ${line.label} documentation (line "${line.id}") is searched. Pass "version": "${ctx.registry.line(product).id}" for the current release.`,
            );
          } else if (!versionGiven && own.unreadable) {
            notes.push(
              `The project uses ${product.id} ${own.version ?? ''}, whose documentation pages are not fetched: these results describe the current release. arcgis_docs_lookup_symbol answers for the project's version.`,
            );
          }
          const sources = resolution.source === undefined ? undefined : [resolution.source.id];
          targets.push({ product, line, ...(sources === undefined ? {} : { sources }) });
        } catch (error) {
          // A routed product without the requested line is left out; a named one is an error.
          if (scope.origin === 'argument' || !isMcpDocError(error)) throw error;
          lineError ??= error;
        }
      }
      if (targets.length === 0 && lineError !== undefined) throw lineError;

      const products = targets.map((target) => target.product.id);
      const sources = targets.length === 1 ? targets[0]?.sources : undefined;
      const lineIds = [...new Set(targets.map((target) => target.line.id))];
      const responseScope: SearchResponse['scope'] = {
        products,
        ...(sources === undefined ? {} : { sources }),
        // No product searched means nothing was resolved: there is no origin to report.
        ...(scope.origin === 'argument'
          ? { resolvedFrom: req.product ?? '' }
          : scope.origin === 'none'
            ? {}
            : { resolvedFrom: scope.origin }),
        ...(req.kind === undefined ? {} : { kind: req.kind }),
        line:
          lineIds.length === 1
            ? (lineIds[0] ?? '')
            : targets.map((t) => `${t.product.id}:${t.line.id}`).join(', '),
      };
      const siteEnabled = targets.some((target) =>
        coveredBySiteSearch(ctx, target.product, target.line, target.sources),
      );
      const mode = siteEnabled ? 'local+site' : 'local';
      // Briefs are this project's own notes; those of no product answer only an open question.
      const briefs =
        req.kind === undefined
          ? briefHits(ctx, req.query, products, scope.origin !== 'argument')
          : [];

      if (targets.length === 0) {
        if (briefs.length === 0)
          notes.push(...zeroHitNotes(ctx, index, req, products, siteEnabled));
        const hits = labelled(briefs.slice(0, req.limit), new Map());
        return { query: req.query, scope: responseScope, mode, total: hits.length, hits, notes };
      }

      const states: IndexState[] = [];
      for (const target of targets) {
        states.push(...(await index.ensure(target.product, target.sources, target.line, call)));
      }

      const restart = formatCall(TOOLS.search, {
        query: req.query,
        product: req.product,
        kind: req.kind,
        version: req.version,
      });
      const key = shortHash(
        JSON.stringify([req.query, products, sources, req.kind, req.version, lineIds]),
      );
      const validator = index.validator({ products, sources });
      let offset = 0;
      if (req.cursor !== undefined) {
        try {
          offset = decodeCursor(req.cursor, TOOLS.search, { k: key, e: validator }).o;
        } catch (error) {
          if (!isMcpDocError(error)) throw error;
          throw new McpDocError(error.code, error.message, { ...error.details, next: restart });
        }
      }

      const query = classifyQuery(req.query);
      const lineOf = new Map(targets.map((target) => [target.product.id, target.line.id]));
      const inScope = (hit: SearchHit): boolean =>
        (req.kind === undefined ||
          hit.kind === req.kind ||
          // Named spec objects count as API reference, as in the catalogue query.
          (req.kind === 'api' && hit.kind === 'spec' && hit.symbolKind !== undefined)) &&
        (sources === undefined || sources.includes(hit.source)) &&
        (!lineChosen || hit.line === '' || hit.line === lineOf.get(hit.product));

      const onlyLine = lineIds.length === 1 ? lineIds[0] : undefined;
      const catalogue = index.query({
        text: req.query,
        products,
        ...(sources === undefined ? {} : { sources }),
        ...(lineChosen && onlyLine !== undefined ? { line: onlyLine } : {}),
        ...(req.kind === undefined ? {} : { kind: req.kind }),
        limit: CANDIDATE_DEPTH,
        offset: 0,
        synonyms: SYNONYMS,
      });
      const names =
        query.shape === 'symbol' ? symbolHits(index, query.names, targets, req.kind) : [];
      const lists: SearchHit[][] = [
        names,
        catalogue.hits.filter(inScope),
        bestSectionPerPage(
          index
            .queryBodies({
              text: req.query,
              products,
              ...(req.kind === undefined ? {} : { kind: req.kind }),
              limit: SECONDARY_DEPTH,
            })
            .filter(inScope),
        ),
        briefs,
        siteEnabled ? (await site.hits(key, req, targets, call, notes)).filter(inScope) : [],
      ];

      const workspace = new Set(scope.workspace.map((sdk) => sdk.product));
      const fused = oneSlotPerPage(
        dedupe(
          rerank(rrf(lists), {
            query: req.query,
            versionGiven: lineChosen,
            lines: lineOf,
            products: new Map(targets.map((target) => [target.product.id, target.product])),
            workspace,
          }),
          primarySource,
        ),
      );
      const faceted = applyVersionFacet(fused, req.version);
      let ranked = collapseRepeats(faceted.hits, query.shape === 'text');

      const note = scopeNote(scope.origin, products);
      if (note !== undefined) notes.push(note);
      notes.push(...indexNotes(states, (product, source) => index.reason(product, source)));

      const labels = await labelsOf(targets);
      if (req.version !== undefined && faceted.narrowedTo === undefined) {
        for (const target of targets) {
          const label = labels.get(`${target.product.id}/${target.line.id}`);
          const named = req.version === target.line.id || req.version === target.line.label;
          if (label !== undefined && !named && !sameRelease(label, req.version)) {
            notes.push(
              `${target.product.id} has no documentation of its own for version ${req.version}: these results describe ${label}.`,
            );
          }
        }
      }

      const words = queryTerms(req.query, SYNONYMS).length;
      if (
        ranked.length > 0 &&
        names.length === 0 &&
        catalogue.complete === 0 &&
        words >= WORDS_FOR_PARTIAL_NOTE
      ) {
        notes.push(
          'No page matches every word of the query: these are partial matches, so check a hit before relying on it. Fewer or different words may find the page.',
        );
      }
      if (catalogue.total > CANDIDATE_DEPTH) {
        // The total below is what can be listed; the index matched more than was ranked.
        notes.push(
          `About ${catalogue.total} catalogue records match at least half of the words; the best ${CANDIDATE_DEPTH} were ranked. Narrow the query, or pass "kind" or "product/section", to reach others.`,
        );
      }

      if (ranked.length === 0) {
        if (!anySearchable(states)) {
          // Nothing could be searched: answer with the products' entry links and say so.
          ranked = productCards(targets);
          notes.push(
            'degraded: no search index is available for this scope; showing the entry links of the products instead.',
          );
        }
        notes.push(...zeroHitNotes(ctx, index, req, products, siteEnabled));
      }

      const page = ranked.slice(offset, offset + req.limit);
      const more = offset + req.limit < ranked.length;
      return {
        query: req.query,
        scope: responseScope,
        mode,
        // The number of hits that paging reaches: an agent told of 4,600 cannot get to them.
        total: ranked.length,
        hits: labelled(page, await sourceLabels(page, labels)),
        ...(more
          ? {
              nextCursor: encodeCursor({
                v: 1,
                t: TOOLS.search,
                k: key,
                e: validator,
                o: offset + req.limit,
              }),
            }
          : {}),
        notes,
      };
    },
  };
}
