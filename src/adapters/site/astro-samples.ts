/**
 * Samples of an Astro site: the cards of the JavaScript sample index page (the site ships no
 * search index for them) and the read of one sample page. The source code of a sample sits in
 * a hidden block of its page, which the `html` renderer turns into `DocPage.files`.
 */
import { load } from 'cheerio';
import { humanizeSlug, matchUrlFilter } from '../../core/adapter-helpers.js';
import { McpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx } from '../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';
import { assertLive, budgetOf, readHtmlPage, recordOf } from '../kit/index.js';

/** One card of a sample index page. */
export interface SampleCard {
  /** The sample's slug, from `data-sample-id`. */
  id: string;
  title: string;
  /** Absolute URL of the sample page. */
  url: string;
  keywords: string[];
}

/**
 * Reads the cards of a sample index page: `a[data-sample-id]` with `data-sample-title`,
 * `data-sample-keywords` (comma-separated) and an `href` relative to `pageUrl`. Cards
 * without an id or a usable link are skipped; a repeated sample keeps its first card.
 */
export function parseSampleCards(html: string, pageUrl: string): SampleCard[] {
  const $ = load(html);
  const cards = new Map<string, SampleCard>();
  $('a[data-sample-id]').each((_, element) => {
    const card = $(element);
    const id = card.attr('data-sample-id')?.trim() ?? '';
    const href = card.attr('href')?.trim() ?? '';
    if (id === '' || href === '') return;
    let url: string;
    try {
      url = new URL(href, pageUrl).href.replace(/#.*$/, '');
    } catch {
      return;
    }
    if (cards.has(url)) return;
    const title = card.attr('data-sample-title')?.trim() ?? card.text().replace(/\s+/g, ' ').trim();
    const keywords = (card.attr('data-sample-keywords') ?? '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== '');
    cards.set(url, { id, title: title === '' ? humanizeSlug(id) : title, url, keywords });
  });
  return [...cards.values()];
}

/**
 * Sample records from the index page of an `astro` source (`config.sampleIndexPage`), one
 * request. Cards that point outside the source or fail its URL filter are left out.
 *
 * @throws McpDocError from the gateway when the page cannot be fetched, and
 *   `UPSTREAM_UNAVAILABLE` (not retryable) when the page carries no sample card, which means
 *   its markup changed.
 */
export async function readSampleCards(
  ctx: Ctx,
  src: BoundSource<'astro'>,
  indexPage: string,
): Promise<CatalogRecord[]> {
  const pageUrl = src.url(indexPage);
  assertLive(src, pageUrl);
  const res = await ctx.http.get({ url: pageUrl, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const cards = parseSampleCards(res.text, res.finalUrl);
  if (cards.length === 0) {
    throw new McpDocError('UPSTREAM_UNAVAILABLE', `${pageUrl} lists no samples`, {
      why: 'The page has no a[data-sample-id] cards, so its markup may have changed',
      url: pageUrl,
      host: new URL(pageUrl).host,
      retryable: false,
    });
  }
  const root = src.url();
  const records: CatalogRecord[] = [];
  for (const card of cards) {
    if (!card.url.startsWith(root)) continue;
    if (!matchUrlFilter(card.url.slice(root.length), src.source.config)) continue;
    records.push({
      ...recordOf(src, card.url, 'sample', card.title),
      ...(card.keywords.length === 0 ? {} : { keywords: card.keywords }),
      locator: { sampleId: card.id },
    });
  }
  return records;
}

/** True for the path of a sample page relative to its site: `sample-code/<slug>/`, also below a platform directory. */
export function isSamplePath(path: string): boolean {
  return /(?:^|\/)sample-code\/[^/]+\/?$/.test(path);
}

/**
 * The bundle of one sample: its page, read as kind `sample` so the renderer separates the
 * description (`sections`) from the source files (`files`).
 */
export function readSample(
  ctx: Ctx,
  src: BoundSource<'astro'>,
  record: CatalogRecord,
): Promise<DocPage> {
  return readHtmlPage(ctx, src, { url: new URL(record.ref), record }, { kind: 'sample' });
}
