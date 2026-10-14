/**
 * Text helpers for catalogue records: one-line descriptions that are plain text, and the
 * decoding of URL parts that may be malformed.
 */
import { safeDecode } from '../../core/url.js';

/** Percent-decoding that returns the input unchanged when it holds a malformed escape. */
export { safeDecode };

/** The decoded fragment of a URL without its `#`; `undefined` when there is none. */
export function fragmentOf(url: URL): string | undefined {
  return url.hash.length > 1 ? safeDecode(url.hash.slice(1)) : undefined;
}

/** Escapes a literal for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Inline Markdown reduced to the text a reader sees: images and links become their label
 * (`[label](url)`, `[label][ref]`, `{@link target label}`) and code ticks are dropped.
 *
 * A description is shortened after this, never before: cutting first can end the text in
 * the middle of a link target, which no later step can turn back into its label.
 */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\{@link(?:code|plain)?\s+([^}]+)\}/g, (_whole, body: string) => {
      // `{@link target label}` and `{@link target|label}` show the label, else the target.
      const [target = '', ...label] = body.trim().split(/[\s|]+/);
      return label.length > 0 ? label.join(' ') : target;
    })
    .replace(/`+/g, '');
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * One line of plain text from an index entry: inline Markdown reduced to its text, whitespace
 * collapsed, capped at `max` characters. `undefined` for anything but a non-blank string.
 */
export function oneLine(text: unknown, max = 240): string | undefined {
  if (typeof text !== 'string') return undefined;
  const flat = plainInline(text).replace(/\s+/g, ' ').trim();
  return flat === '' ? undefined : shorten(flat, max);
}

/**
 * A one-line description for a catalogue record: the first sentence of the first paragraph
 * of a Markdown text as plain text, with whitespace collapsed, at most `max` characters.
 */
export function summaryOf(text: unknown, max = 200): string | undefined {
  if (typeof text !== 'string') return undefined;
  const paragraph = text.trim().split(/\n\s*\n/)[0] ?? '';
  const line = plainInline(paragraph).replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  return sentence === '' ? undefined : shorten(sentence, max);
}
