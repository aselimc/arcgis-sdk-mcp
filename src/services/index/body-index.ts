/**
 * The fetched-pages body index (design section 6.4): full-text search over the sections of
 * pages this user's agent has already read. One small MiniSearch per product, at most 3,000
 * sections, least recently read pages dropped first, persisted under `derived/bodies/`.
 * Nothing is ever fetched to fill it.
 */
import MiniSearch from 'minisearch';
import type { Ctx } from '../../core/ports.js';
import { LEAD_SECTION_ID } from '../../core/sections.js';
import { tokenize } from '../../core/tokenize.js';
import type { DocKind, DocPage, LicenseTier, SearchHit } from '../../core/types.js';
import { plainText } from '../search/excerpt.js';
import { matchOptions, termQuery } from './minisearch-index.js';
import { queryTerms } from './query-terms.js';
import type { BodyQuery } from './types.js';

/** Sections kept per product. */
export const MAX_BODY_SECTIONS = 3000;

/** Characters of each section that are indexed. */
export const BODY_SECTION_CHARS = 2000;

const BODY_SCHEMA_VERSION = 1;
const EXCERPT_CHARS = 200;

interface StoredSection {
  id: string;
  heading: string;
  text: string;
}

interface StoredPage {
  url: string;
  title: string;
  source: string;
  line: string;
  kind: DocKind;
  license: LicenseTier;
  usedAt: number;
  sections: StoredSection[];
}

interface StoredBodies {
  v: number;
  pages: StoredPage[];
}

interface ProductBodies {
  pages: Map<string, StoredPage>;
  engine: MiniSearch<{ id: string; heading: string; text: string }>;
  sections: number;
  dirty: boolean;
  loaded: boolean;
}

/** The body index of every product. */
export interface BodyIndex {
  /** Indexes the sections of a page that has a product. Synchronous; persisted by `flush`. */
  add(page: DocPage): void;
  query(q: BodyQuery): SearchHit[];
  /** Merges the persisted index of a product into memory, once. Never rejects. */
  load(product: string): Promise<void>;
  /** Persists every product changed since the last flush. Never rejects. */
  flush(): Promise<void>;
  /** Sections currently held for a product. */
  size(product: string): number;
}

const SEPARATOR = '\u0000';

function sectionText(markdown: string): string {
  // The heading is indexed as its own field; the body starts after it.
  return markdown
    .replace(/^ {0,3}#{1,6}[ \t]+.*(?:\n|$)/, '')
    .trim()
    .slice(0, BODY_SECTION_CHARS);
}

/**
 * The opening of a section as one line of plain text. A notice that opens it (a deprecation
 * callout in a block quote) is said about the page, not what the section covers, so the
 * excerpt starts at the first block after it. Markdown is removed while the text still has
 * its lines: quote and list markers are only recognisable at the start of one, and a link
 * cut in the middle of its URL can no longer be reduced to its label.
 */
function excerptOf(text: string): string {
  const blocks = text.split(/\n\s*\n/);
  const start = blocks.findIndex((block) => !/^ {0,3}>/.test(block));
  const body = start > 0 ? blocks.slice(start).join('\n\n') : text;
  return plainText(body).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
}

/** Creates the body index. */
export function createBodyIndex(ctx: Ctx): BodyIndex {
  const products = new Map<string, ProductBodies>();

  const bodiesOf = (product: string): ProductBodies => {
    let found = products.get(product);
    if (found === undefined) {
      found = {
        pages: new Map(),
        engine: new MiniSearch({
          idField: 'id',
          fields: ['heading', 'text'],
          tokenize,
          processTerm: (term) => term,
        }),
        sections: 0,
        dirty: false,
        loaded: false,
      };
      products.set(product, found);
    }
    return found;
  };

  const remove = (bodies: ProductBodies, url: string): void => {
    const page = bodies.pages.get(url);
    if (page === undefined) return;
    // `remove` takes the document as it was indexed and is synchronous; `discard` would
    // schedule a background vacuum that cannot run while pages are being added.
    bodies.engine.removeAll(
      page.sections.map((section) => ({
        id: `${url}${SEPARATOR}${section.id}`,
        heading: section.heading,
        text: section.text,
      })),
    );
    bodies.sections -= page.sections.length;
    bodies.pages.delete(url);
  };

  const insert = (bodies: ProductBodies, page: StoredPage): void => {
    remove(bodies, page.url);
    bodies.pages.set(page.url, page);
    bodies.sections += page.sections.length;
    bodies.engine.addAll(
      page.sections.map((section) => ({
        id: `${page.url}${SEPARATOR}${section.id}`,
        heading: section.heading,
        text: section.text,
      })),
    );
    // Least recently read pages make room; the page just added always stays.
    const oldestFirst = [...bodies.pages.values()].sort((a, b) => a.usedAt - b.usedAt);
    for (const candidate of oldestFirst) {
      if (bodies.sections <= MAX_BODY_SECTIONS) break;
      if (candidate.url !== page.url) remove(bodies, candidate.url);
    }
  };

  const load = async (product: string): Promise<void> => {
    const bodies = bodiesOf(product);
    if (bodies.loaded) return;
    bodies.loaded = true;
    try {
      const stored = await ctx.cache.getDerived<StoredBodies>('bodies', product);
      if (stored?.v !== BODY_SCHEMA_VERSION || !Array.isArray(stored.pages)) return;
      // Pages read in this process are newer than their persisted copies.
      const fresh = new Set(bodies.pages.keys());
      for (const page of [...stored.pages].sort((a, b) => a.usedAt - b.usedAt)) {
        if (!fresh.has(page.url)) insert(bodies, page);
      }
    } catch (error) {
      ctx.logger.warn('body index could not be read', { product, error });
    }
  };

  return {
    add(page) {
      if (page.product === undefined || page.degraded?.level === 'link-only') return;
      const sections = page.sections
        .map((section) => ({
          id: section.id,
          heading: section.title,
          text: sectionText(section.markdown),
        }))
        .filter((section) => section.text !== '' || section.heading !== '')
        .slice(0, MAX_BODY_SECTIONS);
      if (sections.length === 0) return;
      const bodies = bodiesOf(page.product);
      // A read of one section must not forget the other sections of the page read earlier.
      const fresh = new Set(sections.map((section) => section.id));
      const earlier = bodies.pages.get(page.url)?.sections ?? [];
      sections.push(...earlier.filter((section) => !fresh.has(section.id)));
      insert(bodies, {
        url: page.url,
        title: page.title,
        source: page.source ?? '',
        line: page.line ?? '',
        kind: page.kind,
        license: page.license,
        usedAt: ctx.clock.now(),
        sections,
      });
      bodies.dirty = true;
    },

    query({ text, products: wanted, kind, limit }) {
      const terms = queryTerms(text);
      if (terms.length === 0) return [];
      const hits: SearchHit[] = [];
      for (const product of wanted) {
        const bodies = products.get(product);
        if (bodies === undefined) continue;
        const results = bodies.engine.search(termQuery(terms, 'and'), {
          ...matchOptions('and'),
          boost: { heading: 3 },
        });
        for (const result of results) {
          const [url = '', sectionId = ''] = (result.id as string).split(SEPARATOR);
          const page = bodies.pages.get(url);
          const section = page?.sections.find((candidate) => candidate.id === sectionId);
          if (page === undefined || section === undefined) continue;
          if (kind !== undefined && page.kind !== kind) continue;
          const lead = sectionId === LEAD_SECTION_ID || page.sections[0]?.id === sectionId;
          hits.push({
            ref: lead ? page.url : `${page.url}#${sectionId}`,
            title:
              lead || section.heading === '' ? page.title : `${page.title}: ${section.heading}`,
            product,
            source: page.source,
            line: page.line,
            kind: page.kind,
            excerpt: excerptOf(section.text),
            match: 'body',
            score: result.score,
            license: page.license,
          });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    load,

    async flush() {
      for (const [product, bodies] of products) {
        if (!bodies.dirty) continue;
        await load(product);
        bodies.dirty = false;
        try {
          const stored: StoredBodies = {
            v: BODY_SCHEMA_VERSION,
            pages: [...bodies.pages.values()],
          };
          await ctx.cache.putDerived('bodies', product, stored);
        } catch (error) {
          ctx.logger.warn('body index could not be written', { product, error });
        }
      }
    },

    size: (product) => products.get(product)?.sections ?? 0,
  };
}
