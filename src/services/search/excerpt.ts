/**
 * Excerpts of search hits (design section 6.4): a site-search highlight with its markup
 * removed, else the record's description, else the opening of a section already read.
 * Never longer than 240 characters.
 */

/** Hard cap of an excerpt. */
export const MAX_EXCERPT_CHARS = 240;

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Removes the `<b>` markers and any other tags of a site-search highlight. */
export function stripHighlight(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapses whitespace and cuts at the last word boundary within `max` characters, marking
 * the cut with an ellipsis that counts towards the limit.
 */
export function clip(text: string, max: number = MAX_EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  // A single very long token has no boundary worth keeping.
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** The excerpt of a hit within the cap, or `undefined` when it has none. */
export function excerptOf(excerpt: string | undefined): string | undefined {
  if (excerpt === undefined) return undefined;
  const clipped = clip(excerpt);
  return clipped === '' ? undefined : clipped;
}
