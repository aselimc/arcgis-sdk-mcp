/**
 * HTML and XML character references.
 *
 * One decoder for every place that reads entity-encoded text outside a DOM parser: sitemap
 * XML, meta-refresh attributes, topic titles in legacy navigation scripts, Markdown embedded in
 * JSON, and copy-button attributes.
 */

/** The named entities decoded. A non-breaking space becomes a plain space. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  reg: '®',
  trade: '™',
  copy: '©',
};

/**
 * Decodes numeric character references (decimal and hexadecimal) and the named entities above
 * in one pass, so `&amp;lt;` becomes `&lt;` and not `<`. A reference that is unknown or out of
 * the Unicode range stays as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}
