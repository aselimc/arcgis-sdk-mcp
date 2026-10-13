/**
 * Removes from a Markdown document what a reader of the rendered page does not see: HTML
 * comments, embedded HTML elements that are hidden, and characters without a glyph. Such
 * text is an editor's note at best and text aimed at a model at worst; either way it is not
 * documentation, and it must not reach an agent under the publisher's name (design R12).
 *
 * Everything here is a single pass over the text with `indexOf` and patterns that cannot
 * backtrack beyond one tag: a README is fetched with a cap of megabytes, and a lazy
 * `<!--[\s\S]*?-->` rescans the rest of the document from every unterminated `<!--`.
 */
import { stepFence, type OpenFence } from '../core/fences.js';

/**
 * Bidirectional embedding, override and isolate controls (U+202A to U+202E, U+2066 to
 * U+2069) and the Unicode tag block (U+E0000 to U+E007F): the first make a line read
 * differently from what it holds, the second spells ASCII that no font shows. Neither has a
 * place in documentation or in code, so they go everywhere, code fences included.
 */
const INVISIBLE = /[\u202a-\u202e\u2066-\u2069\u{e0000}-\u{e007f}]/gu;

/** An opening tag: name and attributes. No `<` or `>` inside, so a match never spans tags. */
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*)>/g;
/** The `hidden` attribute, bare or with a value. */
const HIDDEN_ATTRIBUTE = /(?:^|\s)hidden(?=\s|=|\/|$)/i;
/** An inline style that takes the element out of sight (`opacity: 0.8` and the like stay). */
const HIDING_STYLE =
  /\sstyle\s*=\s*["'][^"']*?(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|(?:font-size|opacity)\s*:\s*0(?![.\d]))/i;
/** Elements without content: removing one removes its tag and nothing else. */
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'wbr']);

const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * Where the element opened at `from` ends: just after its closing tag, with elements of the
 * same name inside it counted. An element that is never closed hides the rest of the
 * document in a browser, and so it does here.
 */
function elementEnd(text: string, name: string, from: number): number {
  if (VOID.has(name.toLowerCase())) return from;
  const tags = new RegExp(`<(/?)${name}\\b[^<>]*>`, 'gi');
  tags.lastIndex = from;
  let depth = 1;
  for (let tag = tags.exec(text); tag !== null; tag = tags.exec(text)) {
    if (tag[1] === '/') depth -= 1;
    else if (!tag[0].endsWith('/>')) depth += 1;
    if (depth === 0) return tags.lastIndex;
  }
  return text.length;
}

/** The first hidden element that opens in `line` at or after `column`. */
function hiddenOpening(line: string, column: number): RegExpExecArray | undefined {
  OPEN_TAG.lastIndex = column;
  for (let tag = OPEN_TAG.exec(line); tag !== null; tag = OPEN_TAG.exec(line)) {
    const attributes = tag[2] ?? '';
    if (HIDDEN_ATTRIBUTE.test(attributes) || HIDING_STYLE.test(attributes)) return tag;
  }
  return undefined;
}

/**
 * Removes HTML comments, hidden HTML elements and invisible characters from Markdown.
 *
 * - Code fences are left alone (apart from the invisible characters): a comment or a hidden
 *   element inside a fence is part of a sample.
 * - A comment or a hidden element may span lines, and then swallows everything up to its
 *   end, fences included, as it does in the rendered page. An unterminated comment is left
 *   as it is; an unclosed hidden element runs to the end of the document.
 * - A line that held nothing else becomes a blank line (it separated two paragraphs), and
 *   no run of blank lines is left behind.
 */
export function stripUnseen(markdown: string): string {
  const text = markdown.replace(INVISIBLE, '');
  if (!text.includes('<')) return text;

  const out: string[] = [];
  /** Offset before which everything belongs to a removed comment or element. */
  let skipTo = 0;
  let commentsEnd = true;
  let open: OpenFence;
  let dropped = false;
  let start = 0;

  for (const line of text.split('\n')) {
    const end = start + line.length;
    const lineStart = start;
    start = end + 1;

    if (skipTo >= end && skipTo > lineStart) {
      dropped = true;
      continue;
    }
    let column = Math.max(0, skipTo - lineStart);
    if (column === 0) {
      const step = stepFence(line, open);
      open = step.open;
      if (step.fenced) {
        out.push(line);
        dropped = false;
        continue;
      }
    }

    let kept = '';
    let touched = column > 0;
    // The next hidden element of the line is searched once and kept until it is passed:
    // searching again after every comment would rescan the line each time.
    let hidden: RegExpExecArray | undefined;
    let searched = false;
    for (;;) {
      const comment = commentsEnd ? line.indexOf(COMMENT_OPEN, column) : -1;
      if (!searched || (hidden !== undefined && hidden.index < column)) {
        hidden = hiddenOpening(line, column);
        searched = true;
      }
      const hiddenAt = hidden === undefined ? -1 : hidden.index;
      if (comment === -1 && hiddenAt === -1) {
        kept += line.slice(column);
        break;
      }
      let removeFrom: number;
      let removeTo: number;
      if (comment !== -1 && (hiddenAt === -1 || comment < hiddenAt)) {
        const close = text.indexOf(COMMENT_CLOSE, lineStart + comment + COMMENT_OPEN.length);
        if (close === -1) {
          // No comment in the rest of the document ends: stop looking for them.
          commentsEnd = false;
          continue;
        }
        removeFrom = comment;
        removeTo = close + COMMENT_CLOSE.length;
      } else {
        removeFrom = hiddenAt;
        const tagEnd = lineStart + hiddenAt + (hidden?.[0].length ?? 0);
        removeTo = elementEnd(text, hidden?.[1] ?? '', tagEnd);
      }
      kept += line.slice(column, removeFrom);
      touched = true;
      skipTo = removeTo;
      if (removeTo >= end) break;
      column = removeTo - lineStart;
    }

    const blank = kept.trim() === '';
    if (touched && blank) {
      // An HTML block ends a paragraph: the line it stood on stays as a blank line.
      if ((out.at(-1) ?? '').trim() !== '') out.push('');
      dropped = true;
      continue;
    }
    // A removed line between two blank lines leaves one blank line, not two.
    if (dropped && blank && (out.at(-1) ?? '').trim() === '') continue;
    out.push(kept);
    if (!blank) dropped = false;
  }
  return out.join('\n');
}

/** `<a href="url" ...>text</a>` with plain text inside; quantifiers bounded against long tags. */
const HTML_LINK =
  /<a\s[^<>]{0,400}?\bhref\s*=\s*(["'])([^"'<>\s]{1,2000})\1[^<>]{0,400}>([^<>]{1,400})<\/a>/gi;

/**
 * Writes the plain HTML links of a Markdown document (`<a href="..." target="_blank">View it
 * live</a>`, common in sample READMEs) as Markdown links. Code fences and code spans are not
 * touched; a link with markup inside it stays as it is.
 */
export function htmlLinksToMarkdown(markdown: string): string {
  if (!/<a\s/i.test(markdown)) return markdown;
  let open: OpenFence;
  return markdown
    .split('\n')
    .map((line) => {
      const step = stepFence(line, open);
      open = step.open;
      if (step.fenced || !/<a\s/i.test(line)) return line;
      // Odd-numbered pieces are inside backticks.
      return line
        .split(/(`+[^`]*`+)/)
        .map((piece, index) =>
          index % 2 === 1
            ? piece
            : piece.replace(HTML_LINK, (whole, _quote: string, href: string, label: string) =>
                label.trim() === '' ? whole : `[${label.trim()}](${href})`,
              ),
        )
        .join('');
    })
    .join('\n');
}
