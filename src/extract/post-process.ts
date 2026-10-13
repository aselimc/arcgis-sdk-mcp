/**
 * Clean-up of Turndown's output. Code inside fences is left alone apart from trailing
 * whitespace; everything else is normalised so that goldens are stable byte for byte.
 */
import { BR_PLACEHOLDER } from './dom.js';
import { scanLines } from './diagnostics.js';

const BR_PLACEHOLDERS = new RegExp(BR_PLACEHOLDER, 'g');
const NBSP = /\u00a0/g;
/** Zero-width space, non-joiner, joiner and the byte order mark. */
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

/**
 * Normalises converted Markdown: cell line breaks become `<br>`, NBSP becomes a space,
 * zero-width characters go, trailing spaces go, and runs of blank lines outside code fences
 * collapse to one. The result has no leading or trailing blank lines and no final newline.
 */
export function postProcess(markdown: string): string {
  const out: string[] = [];
  for (const line of scanLines(markdown.replace(/\r\n?/g, '\n'))) {
    if (line.fenced) {
      out.push(line.text.replace(/[ \t]+$/, ''));
      continue;
    }
    const text = line.text
      .replace(BR_PLACEHOLDERS, '<br>')
      .replace(NBSP, ' ')
      .replace(ZERO_WIDTH, '')
      .replace(/[ \t]+$/, '');
    if (text === '' && (out.length === 0 || out.at(-1) === '')) continue;
    out.push(text);
  }
  while (out.at(-1) === '') out.pop();
  return out.join('\n');
}
