/**
 * Dependency-free reader for sitemap index and urlset documents. Esri's sitemaps are flat
 * `<loc>` lists, so a full XML parser would be a dependency with nothing to do.
 */

/** One `<url>` or `<sitemap>` entry. */
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/** A parsed sitemap: `index` lists other sitemaps, `urlset` lists pages. */
export interface Sitemap {
  kind: 'index' | 'urlset';
  entries: SitemapEntry[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodes the five XML entities and numeric character references; unknown entities stay as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Text content of the first un-prefixed `<name>` element (so `<image:loc>` is never taken for `<loc>`). */
function elementText(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(xml);
  if (match?.[1] === undefined) return undefined;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  const text = (cdata?.[1] ?? decodeEntities(match[1])).trim();
  return text === '' ? undefined : text;
}

/**
 * Every `<tag>...</tag>` element of `xml`, in order, in time linear in the input: the opener
 * and the closer are each found by one forward search, and the scan stops at the first
 * opener without a closer (a lazy regular expression over the whole text retried that search
 * from every later opener).
 */
function elementsOf(xml: string, tag: string): string[] {
  // Attributes are bounded, so an opener without `>` cannot make the search run to the end.
  const opener = new RegExp(`<${tag}(?:\\s[^>]{0,2000})?>`, 'gi');
  const closer = new RegExp(`</${tag}\\s*>`, 'gi');
  const blocks: string[] = [];
  for (;;) {
    const open = opener.exec(xml);
    if (open === null) break;
    closer.lastIndex = opener.lastIndex;
    const close = closer.exec(xml);
    if (close === null) break;
    blocks.push(xml.slice(open.index, closer.lastIndex));
    opener.lastIndex = closer.lastIndex;
  }
  return blocks;
}

/**
 * Reads a sitemap index or urlset.
 *
 * Entries keep document order and are de-duplicated on `loc` (first occurrence wins).
 * Entities and CDATA sections are decoded and a byte-order mark is ignored. Input that is
 * not a sitemap (for example an HTML error page) gives `{ kind: 'urlset', entries: [] }`;
 * the function never throws, so callers decide what an empty result means.
 */
export function parseSitemap(xml: string): Sitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : 'urlset';
  const blocks = elementsOf(xml, kind === 'index' ? 'sitemap' : 'url');

  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const loc = elementText(block, 'loc');
    if (loc === undefined || seen.has(loc)) continue;
    seen.add(loc);
    const lastmod = elementText(block, 'lastmod');
    entries.push(lastmod === undefined ? { loc } : { loc, lastmod });
  }
  return { kind, entries };
}
