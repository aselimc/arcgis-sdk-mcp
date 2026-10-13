/**
 * The curated briefs as search candidates. Only the briefs of the AI product are part of a
 * source's catalogue; the others (which SDK to choose, authentication, 4.x to 5.x, 200 and
 * 300, what not to use) belong to no product and were reachable only by knowing their slug.
 * They answer exactly the questions an agent asks in plain words, so a query that is mostly
 * the title or the headings of a brief lists it.
 */
import { matchesAnyGlob } from '../../core/glob.js';
import type { Ctx } from '../../core/ports.js';
import { tokenize } from '../../core/tokenize.js';
import type { SearchHit } from '../../core/types.js';
import { share } from '../index/minisearch-index.js';
import { queryTerms } from '../index/query-terms.js';
import { SYNONYMS } from './synonyms.js';

/** Share of the query's words a brief's title, slug and headings must hold. */
const MIN_SHARE = 0.6;

/** Fewest query words: one word is a subject, not a question a brief answers. */
const MIN_TERMS = 2;

const HEADING = /^#{1,3}\s+(.+)$/gm;

/** The first paragraph of a brief that is prose, for the excerpt. */
function opening(markdown: string): string | undefined {
  return markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !/^(?:#|>|-|\*|\||`{3})/.test(block));
}

/**
 * Briefs that answer `query`, best first.
 *
 * @param owned product ids in scope: a brief that a product's `brief` source lists is
 *   offered only with that product.
 * @param unowned whether briefs that belong to no product are offered; false when the
 *   caller narrowed the search to a product.
 */
export function briefHits(
  ctx: Ctx,
  query: string,
  owned: readonly string[],
  unowned: boolean,
): SearchHit[] {
  const terms = queryTerms(query, SYNONYMS);
  if (terms.length < MIN_TERMS) return [];
  /** The product whose `brief` source lists a slug, as the doc service decides it. */
  const ownerOf = (slug: string): { product: string; source: string } | undefined => {
    for (const product of ctx.registry.all()) {
      const source = product.sources.find(
        (candidate) =>
          candidate.adapter === 'brief' && matchesAnyGlob(slug, candidate.config.slugs),
      );
      if (source !== undefined) return { product: product.id, source: source.id };
    }
    return undefined;
  };

  const hits: SearchHit[] = [];
  for (const brief of ctx.registry.briefs()) {
    const owner = ownerOf(brief.slug);
    if (owner === undefined ? !unowned : !owned.includes(owner.product)) continue;
    const headings = [...brief.markdown.matchAll(HEADING)].map((match) => match[1] ?? '');
    const words = new Set(tokenize([brief.title, brief.slug, ...headings].join(' ')));
    const covered = share(terms, words);
    if (covered < MIN_SHARE) continue;
    const excerpt = opening(brief.markdown);
    hits.push({
      ref: `brief:${brief.slug}`,
      title: brief.title,
      product: owner?.product ?? '',
      source: owner?.source ?? '',
      line: '',
      kind: 'brief',
      ...(excerpt === undefined ? {} : { excerpt }),
      match: 'title',
      score: covered,
      license: 'project',
    });
  }
  return hits.sort((a, b) => b.score - a.score);
}
