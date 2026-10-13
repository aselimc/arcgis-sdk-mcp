/**
 * Counters taken from the finished Markdown. The same numbers are the assertions of the
 * fixture tests: fences closed and tagged, no HTML left outside code.
 */

/** A fence delimiter at any indentation, also inside block quotes and list items. */
const FENCE_LINE = /^[ \t>]*(`{3,}|~{3,})(.*)$/;

/** Tag-shaped text: `<div>`, `</span>`, `<calcite-icon scale="s">`. */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>\n]*)?\/?>/g;

/**
 * Names that are markup when they appear in tag position. Generic type text such as
 * `Promise<this>` or `List<T>` is not HTML and must not be counted.
 */
const HTML_NAMES = new Set(
  (
    'a abbr article aside b blockquote button caption code col colgroup dd del details div dl dt em ' +
    'figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i iframe img input ins kbd label li link ' +
    'main mark meta nav ol p pre s script section small span strong style sub summary sup svg table ' +
    'tbody td tfoot th thead tr u ul var wbr'
  ).split(' '),
);

/** One line of Markdown with its fence state. */
export interface ScannedLine {
  text: string;
  /** Inside a fence, or one of its delimiter lines. */
  fenced: boolean;
  /** Set on an opening delimiter: the info string (language), possibly empty. */
  opens?: string;
  /** Set on a closing delimiter. */
  closes?: true;
}

/**
 * Walks Markdown line by line, tracking code fences at any indentation (Turndown indents the
 * fences of list items by four spaces, which a CommonMark-strict tracker would miss).
 */
export function scanLines(markdown: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let open: string | undefined;
  for (const text of markdown.split('\n')) {
    const match = FENCE_LINE.exec(text);
    const marker = match?.[1];
    const rest = (match?.[2] ?? '').trim();
    if (open === undefined) {
      if (marker === undefined) lines.push({ text, fenced: false });
      else {
        open = marker;
        lines.push({ text, fenced: true, opens: rest });
      }
      continue;
    }
    const closes =
      marker !== undefined &&
      marker.startsWith(open.charAt(0)) &&
      marker.length >= open.length &&
      rest === '';
    if (closes) open = undefined;
    lines.push(closes ? { text, fenced: true, closes: true } : { text, fenced: true });
  }
  return lines;
}

/** What {@link measureMarkdown} reports. */
export interface MarkdownMetrics {
  fences: number;
  fencesWithLanguage: number;
  /** HTML or custom-element tags outside code, not counting `<br>` (used inside table cells). */
  leftoverHtmlTags: number;
  /** True when the last fence was never closed. */
  unclosedFence: boolean;
}

/** Counts fences and leftover HTML tags in converted Markdown. */
export function measureMarkdown(markdown: string): MarkdownMetrics {
  let fences = 0;
  let fencesWithLanguage = 0;
  let unclosedFence = false;
  const prose: string[] = [];
  for (const line of scanLines(markdown)) {
    if (!line.fenced) {
      prose.push(line.text);
      continue;
    }
    if (line.opens !== undefined) {
      fences += 1;
      unclosedFence = true;
      if (line.opens !== '') fencesWithLanguage += 1;
    } else if (line.closes === true) unclosedFence = false;
  }
  const text = prose.join('\n').replace(/`[^`\n]*`/g, '');
  let leftoverHtmlTags = 0;
  for (const match of text.matchAll(TAG)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === 'br') continue;
    if (HTML_NAMES.has(name) || /^[a-z]+-[a-z0-9-]+$/.test(name)) leftoverHtmlTags += 1;
  }
  return { fences, fencesWithLanguage, leftoverHtmlTags, unclosedFence };
}
