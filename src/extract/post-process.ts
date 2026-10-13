/**
 * Clean-up of Turndown's output. Code inside fences is left alone apart from trailing
 * whitespace and characters no reader can see; everything else is normalised so that
 * goldens are stable byte for byte.
 */
import { BR_PLACEHOLDER } from './dom.js';
import { scanLines } from './diagnostics.js';

const BR_PLACEHOLDERS = new RegExp(BR_PLACEHOLDER, 'g');
const NBSP = /\u00a0/g;
/**
 * Characters that take no space in prose: soft hyphen, the zero-width space, joiners and
 * direction marks (U+200B to U+200F), word joiner and invisible operators (U+2060 to
 * U+2064), and the byte order mark.
 */
const ZERO_WIDTH = /[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g;
/**
 * Characters that hide or reorder text and have no place in documentation or in code: the
 * bidirectional embedding, override and isolate controls (U+202A to U+202E, U+2066 to
 * U+2069), which make a line read differently from what it holds, and the Unicode tag block
 * (U+E0000 to U+E007F), which spells ASCII that no font shows. Both are known carriers for
 * instructions aimed at a model, so they are removed everywhere, code fences included.
 */
export const INVISIBLE = /[\u202a-\u202e\u2066-\u2069\u{e0000}-\u{e007f}]/gu;

/**
 * Normalises converted Markdown: cell line breaks become `<br>`, NBSP becomes a space,
 * zero-width and invisible characters go, trailing spaces and a lone leading space go, and
 * runs of blank lines outside code fences collapse to one. The result has no leading or
 * trailing blank lines and no final newline.
 */
export function postProcess(markdown: string): string {
  const out: string[] = [];
  for (const line of scanLines(markdown.replace(/\r\n?/g, '\n').replace(INVISIBLE, ''))) {
    if (line.fenced) {
      out.push(line.text.replace(/[ \t]+$/, ''));
      continue;
    }
    const text = line.text
      .replace(BR_PLACEHOLDERS, '<br>')
      .replace(NBSP, ' ')
      .replace(ZERO_WIDTH, '')
      .replace(/[ \t]+$/, '')
      // One leading space is what an NBSP before a block leaves behind; it indents nothing.
      .replace(/^ (?=\S)/, '');
    if (text === '' && (out.length === 0 || out.at(-1) === '')) continue;
    out.push(text);
  }
  while (out.at(-1) === '') out.pop();
  return out.join('\n');
}
