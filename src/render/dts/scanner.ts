/**
 * Hand-written scanner for `.d.ts` files (design section 6.5). It finds top-level
 * declarations and the members at depth 1 of class, interface and enum bodies, keeps each
 * declaration's text verbatim and attaches the JSDoc block that precedes it. There is no
 * type analysis and no TypeScript dependency.
 */
import { parseMember, type DtsMember } from './member.js';
import { depthChange, isCode, matchingClose, tokenize, type Token } from './tokens.js';

export type { DtsMember } from './member.js';

/** Kind of a top-level statement. */
export type DtsKind =
  | 'class'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'function'
  | 'const'
  | 'type'
  | 'import'
  | 'export'
  | 'other';

/** One top-level statement of a declaration file. */
export interface DtsDeclaration {
  kind: DtsKind;
  /** Declared name; empty for imports, re-exports and anonymous defaults. */
  name: string;
  exported: boolean;
  isDefault: boolean;
  /** The statement as written, without its JSDoc. */
  text: string;
  /** The text before the body of a class, interface, enum or namespace; otherwise `text`. */
  head: string;
  /** The preceding JSDoc block, delimiters included. */
  jsdoc?: string;
  /** Base types named after `extends`. */
  extends: string[];
  /** Interfaces named after `implements`. */
  implements: string[];
  /** Members of a class, interface or enum body. */
  members: DtsMember[];
  /** False when the body's braces do not balance, so `members` is incomplete. */
  bodyParsed: boolean;
}

/** The scanned file. */
export interface DtsFile {
  declarations: DtsDeclaration[];
}

const STATEMENT_START = new Set([
  'import',
  'export',
  'declare',
  'abstract',
  'class',
  'interface',
  'type',
  'enum',
  'function',
  'const',
  'let',
  'var',
  'namespace',
  'module',
]);

const KIND_BY_KEYWORD: Record<string, DtsKind> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  namespace: 'namespace',
  module: 'namespace',
  function: 'function',
  const: 'const',
  let: 'const',
  var: 'const',
  type: 'type',
};

interface Range {
  /** Index of the first code token. */
  from: number;
  /** Index after the last token. */
  to: number;
  jsdoc?: Token;
}

/**
 * Cuts the token stream into top-level statements. A statement starts at a declaration
 * keyword that begins a line outside every bracket, which also holds for statements without
 * a terminating semicolon (`declare const XSuperclass: typeof A & typeof B`).
 */
function statements(tokens: readonly Token[]): Range[] {
  const ranges: Range[] = [];
  let depth = 0;
  let pending: Token | undefined;
  let current: Range | undefined;
  tokens.forEach((token, index) => {
    if (!isCode(token)) {
      if (token.kind === 'jsdoc' && depth === 0) pending = token;
      return;
    }
    const starts =
      depth === 0 && token.lineStart && token.kind === 'word' && STATEMENT_START.has(token.text);
    if (starts) {
      current = {
        from: index,
        to: index + 1,
        ...(pending === undefined ? {} : { jsdoc: pending }),
      };
      ranges.push(current);
    } else if (current !== undefined) {
      current.to = index + 1;
    }
    pending = undefined;
    depth = Math.max(0, depth + depthChange(token));
  });
  return ranges;
}

/** Splits the tokens of a heritage clause at top-level commas and returns each item's text. */
function heritageItems(source: string, tokens: readonly Token[]): string[] {
  const items: string[] = [];
  let depth = 0;
  let start: Token | undefined;
  let last: Token | undefined;
  const flush = (): void => {
    if (start !== undefined && last !== undefined) {
      items.push(source.slice(start.start, last.end).replace(/\s+/g, ' '));
    }
    start = undefined;
  };
  for (const token of tokens) {
    if (token.text === '<' || depthChange(token) > 0) depth += 1;
    else if (token.text === '>' || depthChange(token) < 0) depth -= 1;
    if (depth === 0 && token.text === ',') flush();
    else {
      start ??= token;
      last = token;
    }
  }
  flush();
  return items;
}

/** Reads the `extends` and `implements` lists from the tokens between the name and the body. */
function heritage(
  source: string,
  tokens: readonly Token[],
): Pick<DtsDeclaration, 'extends' | 'implements'> {
  let angle = 0;
  let clause: 'extends' | 'implements' | undefined;
  const parts: Record<'extends' | 'implements', Token[]> = { extends: [], implements: [] };
  for (const token of tokens) {
    // `extends` inside the type parameter list is a constraint, not heritage.
    if (clause === undefined && token.text === '<') angle += 1;
    else if (clause === undefined && token.text === '>') angle -= 1;
    else if (angle === 0 && (token.text === 'extends' || token.text === 'implements')) {
      clause = token.text;
    } else if (clause !== undefined) parts[clause].push(token);
  }
  return {
    extends: heritageItems(source, parts.extends),
    implements: heritageItems(source, parts.implements),
  };
}

/** Splits a class, interface or enum body into members (design section 6.5: depth 1 only). */
function members(source: string, body: readonly Token[], inEnum: boolean): DtsMember[] {
  const result: DtsMember[] = [];
  let depth = 0;
  let angle = 0;
  let pending: Token | undefined;
  let current: { tokens: Token[]; jsdoc?: Token } | undefined;
  const flush = (): void => {
    if (current !== undefined && current.tokens.length > 0) {
      result.push(parseMember(source, current.tokens, current.jsdoc?.text));
    }
    current = undefined;
  };
  for (const token of body) {
    if (!isCode(token)) {
      if (token.kind !== 'jsdoc' || depth > 0) continue;
      // A doc comment while a member is still open means its terminator is missing.
      flush();
      angle = 0;
      pending = token;
      continue;
    }
    current ??= { tokens: [], ...(pending === undefined ? {} : { jsdoc: pending }) };
    pending = undefined;
    current.tokens.push(token);
    depth = Math.max(0, depth + depthChange(token));
    // Enum initialisers may contain shift operators; everywhere else `<` opens type arguments.
    if (!inEnum && token.text === '<') angle += 1;
    else if (!inEnum && token.text === '>') angle = Math.max(0, angle - 1);
    if (depth === 0 && angle === 0 && (token.text === ';' || token.text === ',')) flush();
  }
  flush();
  return result;
}

function declaration(source: string, tokens: readonly Token[], range: Range): DtsDeclaration {
  const own = tokens.slice(range.from, range.to).filter(isCode);
  const first = own[0];
  const last = own.at(-1);
  const text = first === undefined || last === undefined ? '' : source.slice(first.start, last.end);
  const result: DtsDeclaration = {
    kind: 'other',
    name: '',
    exported: false,
    isDefault: false,
    text,
    head: text,
    ...(range.jsdoc === undefined ? {} : { jsdoc: range.jsdoc.text }),
    extends: [],
    implements: [],
    members: [],
    bodyParsed: true,
  };

  let cursor = 0;
  for (; cursor < own.length; cursor += 1) {
    const word = own[cursor]?.text;
    if (word === 'export') result.exported = true;
    else if (word === 'default') result.isDefault = true;
    else if (word !== 'declare' && word !== 'abstract') break;
  }
  const keyword = own[cursor]?.text ?? '';
  if (keyword === 'import') return { ...result, kind: 'import' };
  const kind = KIND_BY_KEYWORD[keyword];
  if (kind === undefined) {
    // `export { a, b }`, `export * from`, `export default Name;`, `export = Name;`
    const named = own[cursor]?.kind === 'word' && result.isDefault ? keyword : '';
    return { ...result, kind: result.exported ? 'export' : 'other', name: named };
  }
  result.kind = kind;
  const nameToken = own[cursor + 1];
  if (nameToken?.kind === 'word' || nameToken?.kind === 'string') {
    result.name = nameToken.text.replace(/^["']|["']$/g, '');
  }
  if (kind !== 'class' && kind !== 'interface' && kind !== 'enum' && kind !== 'namespace') {
    return result;
  }

  const open = own.findIndex((token, index) => index > cursor && token.text === '{');
  if (open === -1) return result;
  const openToken = own[open];
  result.head = openToken === undefined ? text : source.slice(first?.start, openToken.start).trim();
  Object.assign(result, heritage(source, own.slice(cursor + 2, open)));
  if (kind === 'namespace') return result;

  // The body is searched in the full token stream so that member JSDoc is seen.
  const openIndex = tokens.indexOf(openToken as Token);
  const closeIndex = matchingClose(tokens, openIndex, range.to);
  result.bodyParsed = closeIndex !== -1;
  const body = tokens.slice(openIndex + 1, closeIndex === -1 ? range.to : closeIndex);
  result.members = members(source, body, kind === 'enum');
  return result;
}

/**
 * Scans a declaration file.
 *
 * - Every top-level statement becomes a {@link DtsDeclaration} with its verbatim text and
 *   preceding JSDoc; `export default Name;` marks the named declaration as the default.
 * - Class, interface and enum bodies are split into members at depth 1; nested object types
 *   stay inside the member's text.
 * - Nothing throws: a body whose braces do not balance is reported through `bodyParsed`, a
 *   member the scanner cannot classify through `DtsMember.raw`.
 */
export function scanDts(source: string): DtsFile {
  const text = source.replace(/\r\n?/g, '\n');
  const tokens = tokenize(text);
  const declarations = statements(tokens).map((range) => declaration(text, tokens, range));
  for (const statement of declarations) {
    if (statement.kind !== 'export' || !statement.isDefault || statement.name === '') continue;
    const target = declarations.find(
      (candidate) => candidate.kind !== 'export' && candidate.name === statement.name,
    );
    if (target !== undefined) target.isDefault = true;
  }
  return { declarations };
}
