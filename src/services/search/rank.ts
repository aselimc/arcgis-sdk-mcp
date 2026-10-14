/**
 * Ranking after fusion: the multipliers that express what an agent
 * most likely wants (the current version, the project's own SDK, a page whose title is the
 * query) and de-duplication on the canonical URL.
 */
import type { Product, SearchHit } from '../../core/types.js';
import { canonicalize } from '../../core/url.js';

/** Weight of a hit from a version line other than the current one, when no version was asked for. */
export const OTHER_LINE_WEIGHT = 0.4;
/** Weight of a product that is listed but only linked to. */
export const LINK_TIER_WEIGHT = 0.8;
/** Weight of a deprecated or retired product. */
export const LEGACY_WEIGHT = 0.2;
/** Weight of a product found in the user's project. */
export const WORKSPACE_WEIGHT = 1.3;
/** Weight of a hit whose title equals the query. */
export const EXACT_TITLE_WEIGHT = 2.0;
/** Weight of a curated brief inside the AI product. */
export const BRIEF_WEIGHT = 1.5;

/**
 * Weight of a hit that only the body index found. That index holds the pages this cache
 * happens to have read, so it is evidence for those pages and none against the others: in
 * rank fusion its first hit weighed as much as the best title match and went ahead of it.
 */
export const BODY_ONLY_WEIGHT = 0.9;

/** Product in which briefs are the primary content. */
const BRIEF_PRODUCT = 'ai-agents';

/** What the multipliers need to know about the call. */
export interface RankContext {
  query: string;
  /** True when the caller named a version line; other lines are then not down-weighted. */
  versionGiven: boolean;
  /** Product id to the id of the line being searched (the current one unless a version was given). */
  lines: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, Product>;
  /** Product ids detected in the user's project. */
  workspace: ReadonlySet<string>;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The product of the multipliers that apply to one hit. */
export function multiplier(hit: SearchHit, context: RankContext): number {
  const product = context.products.get(hit.product);
  let weight = 1;
  const line = context.lines.get(hit.product);
  if (!context.versionGiven && line !== undefined && hit.line !== '' && hit.line !== line) {
    weight *= OTHER_LINE_WEIGHT;
  }
  if (product?.tier === 'link') weight *= LINK_TIER_WEIGHT;
  if (product?.status === 'deprecated' || product?.status === 'retired') weight *= LEGACY_WEIGHT;
  if (context.workspace.has(hit.product)) weight *= WORKSPACE_WEIGHT;
  if (normalise(hit.title) === normalise(context.query)) weight *= EXACT_TITLE_WEIGHT;
  if (hit.kind === 'brief' && hit.product === BRIEF_PRODUCT) weight *= BRIEF_WEIGHT;
  if (hit.match === 'body') weight *= BODY_ONLY_WEIGHT;
  return weight;
}

/** Applies the multipliers and sorts best first; equal scores keep their fused order. */
export function rerank(hits: readonly SearchHit[], context: RankContext): SearchHit[] {
  return hits
    .map((hit) => ({ ...hit, score: hit.score * multiplier(hit, context) }))
    .sort((a, b) => b.score - a.score);
}

function canonicalRef(ref: string): string {
  try {
    return canonicalize(ref);
  } catch {
    // `brief:` refs and anything else that is not a URL are compared as written.
    return ref;
  }
}

/** Keeps the first (best) hit for each canonical URL; member anchors stay distinct. */
export function dedupe(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = canonicalRef(hit.ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Keeps the best section of each page. The body index returns sections, and rank fusion
 * gives the fourth section of one tutorial the weight of the fourth-best page, so a single
 * page that was read before took four of the first eight places of a result.
 */
export function bestSectionPerPage(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const page = hit.ref.replace(/#.*$/, '');
    if (seen.has(page)) return false;
    seen.add(page);
    return true;
  });
}

/**
 * Gives a page one place in a fused list. A section that only the body index found
 * ("Add a feature layer: Add a line feature layer") is left out when the page itself, or
 * another of its sections, is listed above it: the catalogue and the body index both found
 * the tutorial, and the list showed it twice in the first eight. Anchored entries of the
 * catalogue (API members, named sections of a specification) are entries of their own.
 */
export function oneSlotPerPage(hits: readonly SearchHit[]): SearchHit[] {
  const pages = new Set<string>();
  return hits.filter((hit) => {
    const anchored = hit.ref.includes('#');
    if (anchored && hit.match !== 'body') return true;
    const page = canonicalRef(hit.ref.replace(/#.*$/, ''));
    if (pages.has(page) && hit.match === 'body') return false;
    pages.add(page);
    return true;
  });
}

/** Members of one name listed for a query in plain words, before the rest is left out. */
export const MAX_SAME_NAME = 2;

/**
 * Leaves out hits that repeat one above them. Two overloads of a member on pages of their
 * own are one line twice (same title, same place); they are collapsed for every query. For
 * a query in plain words, a member name shared by many types (`highlightIds`, `x`) is
 * listed at most {@link MAX_SAME_NAME} times: more of them tell the agent nothing new and
 * push the guides off the page. A query that is itself a name keeps every owner.
 */
export function collapseRepeats(hits: readonly SearchHit[], plainWords: boolean): SearchHit[] {
  const lines = new Set<string>();
  const names = new Map<string, number>();
  return hits.filter((hit) => {
    if (hit.kind !== 'api' || hit.symbolKind === undefined) return true;
    const line = [
      hit.product,
      hit.source,
      hit.line,
      hit.title,
      hit.symbolKind,
      hit.breadcrumb ?? '',
    ].join('\n');
    if (lines.has(line)) return false;
    lines.add(line);
    if (!plainWords) return true;
    const name = `${hit.product}\n${hit.title.toLowerCase()}\n${hit.symbolKind}`;
    const count = (names.get(name) ?? 0) + 1;
    names.set(name, count);
    return count <= MAX_SAME_NAME;
  });
}
