/**
 * Tokeniser for TypeScript declaration files. It knows just enough of the language to keep
 * comments, strings and brackets apart, which is all the scanner needs to find declarations
 * and members without a compiler.
 */

/** Kind of a {@link Token}. */
export type TokenKind = 'jsdoc' | 'comment' | 'string' | 'word' | 'punct';

/** One lexical token with its position in the source. */
export interface Token {
  kind: TokenKind;
  /** Source text; for a string token it includes the quotes. */
  text: string;
  start: number;
  end: number;
  /** True when only whitespace precedes the token on its line. */
  lineStart: boolean;
}

const BYTE_ORDER_MARK = 0xfeff;
const WORD_START = /[A-Za-z_$#@\d]/;
const WORD_REST = /[\w$]/;

/** Index just after the closing quote of the string that opens at `from`, or the line end. */
function endOfString(source: string, from: number): number {
  const quote = source.charAt(from);
  for (let i = from + 1; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === '\\') i += 1;
    else if (char === quote) return i + 1;
    else if (char === '\n') return i;
  }
  return source.length;
}

/** Index just after the closing backtick of a template literal, substitutions included. */
function endOfTemplate(source: string, from: number): number {
  let depth = 0;
  for (let i = from + 1; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === '\\') i += 1;
    else if (depth === 0 && char === '`') return i + 1;
    else if (char === '$' && source.charAt(i + 1) === '{') {
      depth += 1;
      i += 1;
    } else if (depth > 0 && char === '{') depth += 1;
    else if (depth > 0 && char === '}') depth -= 1;
  }
  return source.length;
}

/**
 * Splits declaration-file source into tokens. Whitespace is dropped; comments are kept as
 * tokens because a JSDoc block belongs to the declaration that follows it. `=>` and `...`
 * are single tokens so that `>` and `.` never need context to interpret.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let lineStart = true;
  let i = 0;
  const push = (kind: TokenKind, end: number): void => {
    tokens.push({ kind, text: source.slice(i, end), start: i, end, lineStart });
    lineStart = false;
    i = end;
  };

  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '\n') {
      lineStart = true;
      i += 1;
    } else if (char === ' ' || char === '\t' || char === '\r' || char.charCodeAt(0) === BYTE_ORDER_MARK) {
      i += 1;
    } else if (char === '/' && source.charAt(i + 1) === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      const jsdoc = source.charAt(i + 2) === '*' && source.charAt(i + 3) !== '/';
      push(jsdoc ? 'jsdoc' : 'comment', end);
    } else if (char === '/' && source.charAt(i + 1) === '/') {
      const newline = source.indexOf('\n', i);
      push('comment', newline === -1 ? source.length : newline);
    } else if (char === '"' || char === "'") {
      push('string', endOfString(source, i));
    } else if (char === '`') {
      push('string', endOfTemplate(source, i));
    } else if (WORD_START.test(char)) {
      let end = i + 1;
      while (end < source.length && WORD_REST.test(source.charAt(end))) end += 1;
      push('word', end);
    } else if (char === '=' && source.charAt(i + 1) === '>') {
      push('punct', i + 2);
    } else if (source.startsWith('...', i)) {
      push('punct', i + 3);
    } else {
      push('punct', i + 1);
    }
  }
  return tokens;
}

/** True for a token that is code rather than a comment. */
export function isCode(token: Token): boolean {
  return token.kind !== 'comment' && token.kind !== 'jsdoc';
}

const OPENERS = new Set(['{', '(', '[']);
const CLOSERS = new Set(['}', ')', ']']);

/** How a punctuation token changes bracket depth: +1, -1 or 0. */
export function depthChange(token: Token): number {
  if (token.kind !== 'punct') return 0;
  if (OPENERS.has(token.text)) return 1;
  return CLOSERS.has(token.text) ? -1 : 0;
}

/**
 * Index of the token that closes the bracket opened at `open`, or -1 when the brackets do
 * not balance before `limit` (a truncated or malformed file).
 */
export function matchingClose(tokens: readonly Token[], open: number, limit: number): number {
  let depth = 0;
  for (let index = open; index < limit; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    depth += depthChange(token);
    if (depth === 0) return index;
  }
  return -1;
}
