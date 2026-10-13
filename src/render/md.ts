/**
 * Small Markdown writers shared by the structured renderers. They produce the same dialect
 * as the HTML pipeline: ATX headings, backtick fences with a language, `-` bullets and GFM
 * tables.
 */
import { stepFence, type OpenFence } from '../core/fences.js';

const ATX = /^( {0,3})(#{1,6})([ \t]+.*)$/;

/** Joins the non-empty parts with one blank line. */
export function blocks(...parts: Array<string | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.replace(/^\n+|\s+$/g, ''))
    .join('\n\n');
}

/** A fenced code block whose fence is longer than any backtick run inside the code. */
export function fence(code: string, language = ''): string {
  const body = code.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((run) => run[0].length));
  const marker = '`'.repeat(Math.max(3, longest + 1));
  return `${marker}${language}\n${body}\n${marker}`;
}

/** True when the text already contains a fenced code block. */
export function hasFence(text: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})/m.test(text);
}

/**
 * Closes a code fence that the text opens and never closes. Authored text (JSDoc examples,
 * descriptions) sometimes ends inside a fence; embedded as it is, it would turn every fence
 * after it inside out: headings and signatures become code, and code becomes prose.
 */
export function closeFences(text: string): string {
  let open: OpenFence;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) open = stepFence(line, open).open;
  return open === undefined ? text : `${text.replace(/\s+$/, '')}\n${open}`;
}

/**
 * Example text as Markdown: kept when it brings its own fences (with an unclosed one
 * closed), fenced otherwise.
 */
export function fencedExample(example: string, language: string): string {
  return hasFence(example) ? closeFences(example.trim()) : fence(example, language);
}

/** An inline code span that survives backticks in the text. */
export function inlineCode(text: string): string {
  const value = oneLine(text);
  if (!value.includes('`')) return `\`${value}\``;
  const longest = Math.max(...[...value.matchAll(/`+/g)].map((run) => run[0].length));
  const marker = '`'.repeat(longest + 1);
  return `${marker} ${value} ${marker}`;
}

/** Collapses every run of whitespace to one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The first sentence of the first prose paragraph, on one line. Code fences, headings,
 * block quotes markers and tables are skipped, so the result is usable as a member summary.
 */
export function firstSentence(markdown: string | undefined): string {
  if (markdown === undefined) return '';
  let open: OpenFence;
  const paragraph: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const step = stepFence(line, open);
    open = step.open;
    const trimmed = line.trim();
    if (step.fenced || ATX.test(line) || trimmed.startsWith('|')) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (trimmed === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed.replace(/^>\s?/, ''));
  }
  const text = oneLine(paragraph.join(' '));
  // A sentence ends at ". " followed by a capital or an opening bracket; "e.g. x" must not cut.
  const end = /[.!?](?=\s+[A-Z[`(*_])/.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
}

/** An inline link; its target may hold one level of paired parentheses (`.../tojson()/`). */
const LINK = /\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g;

/**
 * A one-line summary for member indexes: the first sentence with link targets removed, since
 * a list of fifty members should not carry fifty URLs.
 */
export function summaryLine(markdown: string | undefined): string {
  return firstSentence(markdown).replace(LINK, '$1');
}

/** Cell text for a GFM table: one line, paragraph breaks as `<br>`, pipes escaped. */
export function tableCell(text: string | undefined): string {
  if (text === undefined) return '';
  return (
    text
      .replace(/\r\n?/g, '\n')
      .trim()
      .replace(/\n[ \t]*\n+/g, '<br>')
      // List items inside a cell keep their line breaks.
      .replace(/\n[ \t]*(?=(?:[-*+]|\d+\.) )/g, '<br>')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\|/g, '\\|')
  );
}

/** A GFM table. Cells are passed through {@link tableCell}. Empty when there are no rows. */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  if (rows.length === 0) return '';
  const line = (cells: readonly string[]): string =>
    `| ${headers.map((_, index) => tableCell(cells[index])).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join(
    '\n',
  );
}

/** Indents every non-empty line after the first, so the text continues a list item. */
export function hang(text: string, indent: string): string {
  return text.replace(/\n(?=[^\n])/g, `\n${indent}`);
}

/** A `-` bullet list; continuation lines of an item are indented under it. */
export function bullets(items: readonly string[]): string {
  return items
    .filter((item) => item.trim() !== '')
    .map((item) => `- ${hang(item.trim(), '  ')}`)
    .join('\n');
}

/**
 * Splits a text at its first ATX heading (outside code fences): the introduction before it,
 * and the titled parts from it on. A text without headings is all introduction.
 */
export function splitAtFirstHeading(markdown: string): { intro: string; titled: string } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let open: OpenFence;
  for (let index = 0; index < lines.length; index += 1) {
    const step = stepFence(lines[index] ?? '', open);
    open = step.open;
    if (!step.fenced && ATX.test(lines[index] ?? '')) {
      return {
        intro: lines.slice(0, index).join('\n').trim(),
        titled: lines.slice(index).join('\n').trim(),
      };
    }
  }
  return { intro: markdown.trim(), titled: '' };
}

/**
 * Moves the ATX headings of a text down so that the shallowest one is at `minLevel`. Text
 * authored as a stand-alone document (JSDoc, docstrings, descriptions) often starts at `##`,
 * which would otherwise break out of the section it is embedded in. Headings inside code
 * fences are left alone; levels are capped at 6.
 */
export function shiftHeadings(markdown: string, minLevel: number): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let open: OpenFence;
  const headings: Array<{ index: number; level: number }> = [];
  lines.forEach((line, index) => {
    const step = stepFence(line, open);
    open = step.open;
    const match = step.fenced ? null : ATX.exec(line);
    if (match !== null) headings.push({ index, level: (match[2] ?? '#').length });
  });
  const shallowest = Math.min(...headings.map((heading) => heading.level));
  const delta = minLevel - shallowest;
  if (headings.length === 0 || delta <= 0) return markdown;
  for (const { index, level } of headings) {
    const match = ATX.exec(lines[index] ?? '');
    if (match === null) continue;
    lines[index] = `${match[1] ?? ''}${'#'.repeat(Math.min(6, level + delta))}${match[3] ?? ''}`;
  }
  return lines.join('\n');
}

/** Heading text for a symbol name: wrapped in a code span when Markdown would restyle it. */
export function headingText(title: string): string {
  return /[*_<>[\]`#\\]/.test(title) ? inlineCode(title) : oneLine(title);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the handful of HTML entities that appear in JSON-embedded Markdown. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}
