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
 * Markdown as running text: links keep their label, emphasis and fence markers go, and
 * list, quote and heading markers at the start of a line are dropped. Inline code keeps its
 * backticks, because that is how an identifier reads best in one line. An excerpt is at most
 * 240 characters, and a single link with its URL can use all of them.
 */
export function plainText(markdown: string): string {
  return (
    markdown
      // Images and links: `[label](url "title")` -> `label`.
      .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, '$1')
      // Fence delimiters with their language, also when the text was flattened to one line.
      .replace(/(?:`{3,}|~{3,})[\w+-]*/g, ' ')
      // Bold is written with asterisks here; a double underscore is a Python name (__init__).
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
      // Single markers only when they wrap words: `snake_case` and `a * b` stay as they are.
      .replace(/(?<![\p{L}\p{N}*_])([*_])(?=\S)([^*_\n]+?)(?<=\S)\1(?![\p{L}\p{N}*_])/gu, '$2')
      .replace(/^ {0,3}(?:#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, '')
  );
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
  const clipped = clip(plainText(excerpt));
  return clipped === '' ? undefined : clipped;
}
