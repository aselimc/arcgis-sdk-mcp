/**
 * Ranking after fusion (design section 6.4): the multipliers that express what an agent
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
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
