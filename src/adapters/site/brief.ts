/**
 * The `brief` adapter: curated briefs written by this project and embedded in the registry
 * at build time. Nothing is fetched; a brief is addressed as `brief:<slug>`.
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError } from '../../core/errors.js';
import { matchesAnyGlob } from '../../core/glob.js';
import { BRIEF_PREFIX, TOOLS } from '../../core/names.js';
import type { BoundSource, Ctx, Registry, SourceAdapter } from '../../core/ports.js';
import { sectionsFromMarkdown } from '../../core/sections.js';
import { nearest } from '../../core/text-distance.js';
import type { CatalogRecord } from '../../core/types.js';
import { splitRef } from '../../core/url.js';
import { renderOptionsOf } from '../kit/index.js';

type Brief = ReturnType<Registry['briefs']>[number];

/** The briefs a source lists: those whose slug matches one of its globs. */
function briefsOf(ctx: Ctx, src: BoundSource<'brief'>): Brief[] {
  return ctx.registry
    .briefs()
    .filter((brief) => matchesAnyGlob(brief.slug, src.source.config.slugs));
}

function notFound(ctx: Ctx, ref: string, slug: string | undefined): McpDocError {
  const slugs = ctx.registry.briefs().map((brief) => brief.slug);
  const candidates = slug === undefined ? [] : nearest(slug, slugs, 5);
  const [best] = candidates;
  return new McpDocError('DOC_NOT_FOUND', `There is no brief "${slug ?? ref}"`, {
    why: 'Briefs are bundled with the server and addressed as brief:<slug>',
    next:
      best === undefined
        ? formatCall(TOOLS.search, { query: (slug ?? ref).replace(/[/_-]+/g, ' ') })
        : formatCall(TOOLS.read, { ref: `${BRIEF_PREFIX}${best}` }),
    ...(candidates.length === 0 ? {} : { candidates }),
    url: ref,
  });
}

/**
 * `brief`: bundled Markdown, licence tier `project` (no attribution line). The headings of a
 * brief are indexed with its record so that a search for one of its topics finds it.
 */
export const briefAdapter: SourceAdapter<'brief'> = {
  type: 'brief',
  // Nothing is requested; the contract asks for a positive budget.
  maxEnumerateRequests: 1,

  enumerate(ctx, src) {
    const records = briefsOf(ctx, src).map((brief): CatalogRecord => {
      const headings = sectionsFromMarkdown(brief.markdown)
        .filter((section) => section.level > 1)
        .map((section) => section.title);
      return {
        ref: `${BRIEF_PREFIX}${brief.slug}`,
        product: src.product.id,
        source: src.source.id,
        line: src.line.id,
        kind: 'brief',
        title: brief.title,
        ...(headings.length === 0 ? {} : { headings }),
        license: 'project',
      };
    });
    return Promise.resolve(records);
  },

  /**
   * Any bundled brief can be read, also one this source does not list: `brief:` refs belong
   * to no URL prefix, so the caller may arrive here with whichever brief source it has.
   */
  async read(ctx, src, target) {
    // Resolved first so that a renderer failure rejects instead of throwing synchronously.
    await Promise.resolve();
    const ref = target.url.href;
    let slug: string | undefined;
    try {
      slug = splitRef(ref).brief;
    } catch {
      slug = undefined;
    }
    const brief = ctx.registry.briefs().find((candidate) => candidate.slug === slug);
    if (brief === undefined) throw notFound(ctx, ref, slug);

    const page = ctx.render.render(
      'markdown',
      { markdown: brief.markdown },
      {
        url: `${BRIEF_PREFIX}${brief.slug}${target.url.hash}`,
        product: src.product.id,
        source: src.source.id,
        line: src.line.id,
        kind: 'brief',
        license: 'project',
        // Bundled content has no response; the time of reading stands in for a fetch time.
        retrievedAt: ctx.clock.iso(),
      },
      renderOptionsOf(target),
    );
    return {
      ...page,
      title: page.title === '' ? brief.title : page.title,
      notices: [
        ...page.notices,
        `Curated brief written for this server; verified on ${brief.verifiedOn}.`,
      ],
    };
  },

  probe(ctx, src) {
    const started = ctx.clock.now();
    const records = briefsOf(ctx, src).length;
    const ms = ctx.clock.now() - started;
    return Promise.resolve(
      records > 0
        ? { ok: true, records, ms }
        : {
            ok: false,
            records,
            error: `No bundled brief matches ${src.source.config.slugs.join(', ')}`,
            ms,
          },
    );
  },
};
