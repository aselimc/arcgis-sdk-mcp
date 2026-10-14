import { describe, expect, it } from 'vitest';
import { parseSitemap } from '../../src/core/sitemap.js';

const urlset = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;

describe('parseSitemap', () => {
  it('reads a urlset in document order', () => {
    const xml = urlset(`
      <url><loc>https://developers.arcgis.com/widgets/</loc></url>
      <url>
        <loc>https://developers.arcgis.com/widgets/get-started/</loc>
        <lastmod>2026-09-30</lastmod>
        <changefreq>weekly</changefreq>
      </url>`);
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      entries: [
        { loc: 'https://developers.arcgis.com/widgets/' },
        { loc: 'https://developers.arcgis.com/widgets/get-started/', lastmod: '2026-09-30' },
      ],
    });
  });

  it('reads a sitemap index', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://developers.arcgis.com/widgets/sitemap-0.xml</loc><lastmod>2026-10-01T00:00:00Z</lastmod></sitemap>
      <sitemap><loc>https://developers.arcgis.com/widgets/sitemap-1.xml</loc></sitemap>
    </sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'index',
      entries: [
        {
          loc: 'https://developers.arcgis.com/widgets/sitemap-0.xml',
          lastmod: '2026-10-01T00:00:00Z',
        },
        { loc: 'https://developers.arcgis.com/widgets/sitemap-1.xml' },
      ],
    });
  });

  it('decodes entities, numeric references and CDATA', () => {
    const xml = urlset(`
      <url><loc>https://h.example/a?x=1&amp;y=2</loc></url>
      <url><loc>https://h.example/b?q=&lt;tag&gt;&quot;&apos;</loc></url>
      <url><loc>https://h.example/c&#38;d&#x26;e</loc></url>
      <url><loc><![CDATA[https://h.example/d?x=1&y=2]]></loc></url>
      <url><loc>https://h.example/e&unknown;&#0;&#x110000;</loc></url>`);
    expect(parseSitemap(xml).entries.map((entry) => entry.loc)).toEqual([
      'https://h.example/a?x=1&y=2',
      'https://h.example/b?q=<tag>"\'',
      'https://h.example/c&d&e',
      'https://h.example/d?x=1&y=2',
      'https://h.example/e&unknown;&#0;&#x110000;',
    ]);
  });

  it('de-duplicates on loc, keeping the first entry', () => {
    const xml = urlset(`
      <url><loc>https://h.example/a</loc><lastmod>2026-01-01</lastmod></url>
      <url><loc>https://h.example/b</loc></url>
      <url><loc> https://h.example/a </loc><lastmod>2026-02-02</lastmod></url>`);
    expect(parseSitemap(xml).entries).toEqual([
      { loc: 'https://h.example/a', lastmod: '2026-01-01' },
      { loc: 'https://h.example/b' },
    ]);
  });

  it('takes the page loc, not an image or alternate-language loc', () => {
    const xml = urlset(`
      <url>
        <image:image><image:loc>https://h.example/picture.png</image:loc></image:image>
        <xhtml:link rel="alternate" hreflang="de" href="https://h.example/de/a"/>
        <loc>https://h.example/a</loc>
      </url>`);
    expect(parseSitemap(xml).entries).toEqual([{ loc: 'https://h.example/a' }]);
  });

  it('tolerates a byte-order mark, attributes, upper case and single-line documents', () => {
    const xml = `\uFEFF<URLSET><URL priority="1"><LOC>https://h.example/a</LOC></URL><url><loc>https://h.example/b</loc></url></URLSET>`;
    expect(parseSitemap(xml).entries.map((entry) => entry.loc)).toEqual([
      'https://h.example/a',
      'https://h.example/b',
    ]);
  });

  it('skips entries without a usable loc', () => {
    const xml = urlset(`
      <url><lastmod>2026-01-01</lastmod></url>
      <url><loc>   </loc></url>
      <url><loc>https://h.example/ok</loc></url>`);
    expect(parseSitemap(xml).entries).toEqual([{ loc: 'https://h.example/ok' }]);
  });

  it('gives an empty urlset for input that is not a sitemap and never throws', () => {
    for (const input of [
      '',
      '<!doctype html><html><body>Not found</body></html>',
      '{"a":1}',
      '<urlset>',
    ]) {
      expect(parseSitemap(input), input).toEqual({ kind: 'urlset', entries: [] });
    }
  });

  it('handles a large flat sitemap quickly', () => {
    const body = Array.from(
      { length: 20_000 },
      (_, i) => `<url><loc>https://h.example/page-${i}/</loc></url>`,
    ).join('');
    const started = performance.now();
    const { entries } = parseSitemap(urlset(body));
    expect(entries).toHaveLength(20_000);
    expect(entries.at(-1)?.loc).toBe('https://h.example/page-19999/');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('stays linear on openers that are never closed', () => {
    for (const unit of ['<url><loc>https://h.example/a</loc>', '<url ', '<url a="b">']) {
      const started = performance.now();
      const { entries } = parseSitemap(urlset(unit.repeat(Math.ceil(131_072 / unit.length))));
      expect(entries).toEqual([]);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it('keeps the entries before an unclosed opener', () => {
    const body = '<url><loc>https://h.example/a</loc></url><url><loc>https://h.example/b</loc>';
    expect(parseSitemap(urlset(body)).entries).toEqual([{ loc: 'https://h.example/a' }]);
  });
});
