/**
 * Classification of one member of a class, interface or enum body: its name, kind,
 * modifiers and, where the declaration has them, parameter and type text.
 */
import { depthChange, matchingClose, type Token } from './tokens.js';

/** Kind of a member as far as the scanner can tell without type analysis. */
export type DtsMemberKind =
  | 'constructor'
  | 'method'
  | 'property'
  | 'getter'
  | 'setter'
  | 'index'
  | 'call'
  | 'unknown';

/** One member at depth 1 of a class, interface or enum body. */
export interface DtsMember {
  /** Member name without quotes; empty for call and index signatures. */
  name: string;
  kind: DtsMemberKind;
  /** The declaration as written, de-indented, terminator included. */
  text: string;
  /** The preceding JSDoc block, delimiters included. */
  jsdoc?: string;
  /** `static`, `readonly`, `abstract`, `protected`, `private`, `accessor`, ... as written. */
  modifiers: string[];
  optional: boolean;
  /** Text between the parentheses of a method, constructor or accessor. */
  params?: string;
  /** Property type, method return type, getter type or setter parameter type. */
  type?: string;
  /** True when the declaration could not be classified; `text` is then all there is. */
  raw?: boolean;
}

const MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'abstract',
  'declare',
  'override',
  'async',
  'accessor',
  'get',
  'set',
]);

/** Tokens that can follow a member name; a modifier word followed by one of these is the name. */
const AFTER_NAME = new Set(['(', ':', '?', '!', ';', ',', '<', '=']);

/** Removes the indentation of the member's first line from its continuation lines. */
function dedent(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart, start))?.[0] ?? '';
  const text = source.slice(start, end);
  return indent === '' ? text : text.split(`\n${indent}`).join('\n');
}

function slice(source: string, from: Token | undefined, to: Token | undefined): string {
  if (from === undefined || to === undefined || to.end < from.start) return '';
  return source.slice(from.start, to.end).trim();
}

/** Text after the first top-level `:` of a token run, without the terminator. */
function typeAfterColon(source: string, tokens: readonly Token[]): string | undefined {
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (depth === 0 && token.text === ':') {
      const text = slice(source, tokens[index + 1], tokens.at(-1)).replace(/[;,]$/, '').trim();
      return text === '' ? undefined : text;
    }
    depth += depthChange(token);
  }
  return undefined;
}

/** Index of the parameter list's `(` at or after `from`, past any type parameter list. */
function openParen(tokens: readonly Token[], from: number): number {
  let angle = 0;
  for (let index = from; index < tokens.length; index += 1) {
    const text = tokens[index]?.text;
    if (text === '<') angle += 1;
    else if (text === '>') angle -= 1;
    else if (text === '(' && angle <= 0) return index;
  }
  return -1;
}

/**
 * Classifies the tokens of one member. A declaration that fits none of the known shapes is
 * returned with `raw: true` and kind `unknown`, never rejected: the renderer then shows its
 * text as written.
 */
export function parseMember(
  source: string,
  tokens: readonly Token[],
  jsdoc: string | undefined,
): DtsMember {
  const first = tokens[0];
  const last = tokens.at(-1);
  const terminated = last?.text === ',';
  const end = terminated ? (tokens.at(-2)?.end ?? last.end) : (last?.end ?? 0);
  const member: DtsMember = {
    name: '',
    kind: 'unknown',
    text: first === undefined ? '' : dedent(source, first.start, end),
    ...(jsdoc === undefined ? {} : { jsdoc }),
    modifiers: [],
    optional: false,
  };

  let cursor = 0;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    const next = tokens[cursor + 1];
    if (token?.kind !== 'word' || !MODIFIERS.has(token.text)) break;
    if (next === undefined || AFTER_NAME.has(next.text)) break;
    member.modifiers.push(token.text);
    cursor += 1;
  }

  const nameToken = tokens[cursor];
  if (nameToken === undefined) return { ...member, raw: true };
  if (nameToken.text === '(' || nameToken.text === '<') {
    member.kind = 'call';
  } else if (nameToken.text === '[') {
    const close = matchingClose(tokens, cursor, tokens.length);
    if (close === -1) return { ...member, raw: true };
    const inner = tokens.slice(cursor + 1, close);
    member.name = slice(source, nameToken, tokens[close]);
    // `[key: string]: T` is an index signature; `[Symbol.iterator]()` is a computed name.
    if (inner.some((token) => token.text === ':')) member.kind = 'index';
    cursor = close + 1;
  } else if (nameToken.kind === 'word' || nameToken.kind === 'string') {
    member.name = nameToken.text.replace(/^["'`]|["'`]$/g, '');
    cursor += 1;
  } else {
    return { ...member, raw: true };
  }

  if (tokens[cursor]?.text === '?' || tokens[cursor]?.text === '!') {
    member.optional = tokens[cursor]?.text === '?';
    cursor += 1;
  }
  const rest = tokens.slice(cursor);
  const head = rest[0]?.text;

  if (member.kind === 'index') {
    const type = typeAfterColon(source, rest);
    return type === undefined ? member : { ...member, type };
  }
  if (member.kind === 'call' || head === '(' || head === '<') {
    const open = openParen(tokens, cursor);
    const close = open === -1 ? -1 : matchingClose(tokens, open, tokens.length);
    if (close === -1) return { ...member, kind: 'unknown', raw: true };
    const params = slice(source, tokens[open + 1], tokens[close - 1]);
    const returns = typeAfterColon(source, tokens.slice(close + 1));
    if (member.kind !== 'call') {
      if (member.name === 'constructor') member.kind = 'constructor';
      else if (member.modifiers.includes('get')) member.kind = 'getter';
      else if (member.modifiers.includes('set')) member.kind = 'setter';
      else member.kind = 'method';
    }
    const type = member.kind === 'setter' ? params.replace(/^[^:]*:\s*/, '') : returns;
    return {
      ...member,
      ...(close > open + 1 ? { params } : {}),
      ...(type === undefined || type === '' ? {} : { type }),
    };
  }
  if (head === undefined || head === ':' || head === ';' || head === ',' || head === '=') {
    const type = typeAfterColon(source, rest);
    return { ...member, kind: 'property', ...(type === undefined ? {} : { type }) };
  }
  return { ...member, raw: true };
}
