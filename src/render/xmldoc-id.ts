/**
 * C# documentation ids (`M:Ns.Type.Method(System.String,Ns.Other{System.Int32})`) to
 * readable signatures. The id is the only place a doc XML file states parameter types.
 */

/** A parsed documentation id. */
export interface MemberId {
  /** `T` type, `M` method, `P` property, `E` event, `F` field, `N` namespace. */
  prefix: 'T' | 'M' | 'P' | 'E' | 'F' | 'N';
  /** Fully qualified name without parameters, generic arity markers kept (`Ns.List`1`). */
  qualified: string;
  /** Qualified name of the declaring type (or namespace, for a type). */
  owner: string;
  /** Simple display name: `Search`, `Dictionary<T0, T1>`, the type name for a constructor. */
  name: string;
  /** `Type.Member`, the readable name used at the start of a signature. */
  display: string;
  /** Parameter types in C# spelling, in order. */
  parameters: string[];
  /** Readable declaration: `Type.Method(string, int)`, `Type.Property`, `Ns.Type<T0>`. */
  signature: string;
}

const ALIASES: Record<string, string> = {
  'System.String': 'string',
  'System.Boolean': 'bool',
  'System.Int32': 'int',
  'System.Int64': 'long',
  'System.Int16': 'short',
  'System.UInt32': 'uint',
  'System.UInt64': 'ulong',
  'System.UInt16': 'ushort',
  'System.Byte': 'byte',
  'System.SByte': 'sbyte',
  'System.Char': 'char',
  'System.Double': 'double',
  'System.Single': 'float',
  'System.Decimal': 'decimal',
  'System.Object': 'object',
  'System.Void': 'void',
};

/** Splits at commas that are outside `{}`, `()` and `[]`. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/** `` `2 `` to `<T0, T1>`; a doubled backtick (method arity) uses `M`. */
function arity(marker: string): string {
  const letter = marker.startsWith('``') ? 'M' : 'T';
  const count = Number(marker.replace(/`/g, ''));
  return `<${Array.from({ length: count }, (_, index) => `${letter}${index}`).join(', ')}>`;
}

/** A type as written in an id to its C# spelling, without namespaces. */
function typeName(encoded: string): string {
  let text = encoded.trim();
  let prefix = '';
  if (text.endsWith('@')) {
    prefix = 'ref ';
    text = text.slice(0, -1);
  }
  const suffix = /(?:\[[\d:,]*\]|\*)+$/.exec(text)?.[0] ?? '';
  text = text.slice(0, text.length - suffix.length);
  const array = suffix.replace(/\[[^\]]*\]/g, (dims) => `[${','.repeat((dims.match(/,/g) ?? []).length)}]`);

  // A reference to a generic parameter: `0 of the type, ``0 of the method.
  const parameter = /^(`{1,2})(\d+)$/.exec(text);
  if (parameter !== null) return `${prefix}${parameter[1] === '``' ? 'M' : 'T'}${parameter[2] ?? ''}${array}`;

  const open = text.indexOf('{');
  const base = open === -1 ? text : text.slice(0, open);
  const args = open === -1 ? [] : splitTopLevel(text.slice(open + 1, text.lastIndexOf('}'))).map(typeName);
  const alias = ALIASES[base];
  const short = alias ?? (base.split('.').at(-1) ?? base).replace(/`+\d+$/, '');
  if (base === 'System.Nullable' && args.length === 1) return `${prefix}${args[0] ?? ''}?${array}`;
  return `${prefix}${short}${args.length > 0 ? `<${args.join(', ')}>` : ''}${array}`;
}

/** Replaces generic arity markers: `` List`1 `` becomes `List<T0>`. */
function readable(segment: string): string {
  return segment.replace(/`+\d+/g, arity);
}

/**
 * Parses a documentation id. Returns `undefined` for text that is not one (no known prefix).
 *
 * Constructors (`#ctor`) take the name of their type; indexers print as `Type.this[...]`;
 * explicit interface implementations keep the interface name (`IDisposable.Dispose`).
 */
export function parseMemberId(id: string): MemberId | undefined {
  const match = /^([TMPEFN]):([^(~]+)(?:\((.*)\))?(?:~(.+))?$/s.exec(id.trim());
  if (match === null) return undefined;
  const prefix = match[1] as MemberId['prefix'];
  const qualified = match[2] ?? '';
  const parameters = match[3] === undefined ? [] : splitTopLevel(match[3]).map(typeName);
  const segments = qualified.split('.');
  const last = segments.at(-1) ?? qualified;
  const owner = segments.slice(0, -1).join('.');
  const ownerShort = readable(owner.split('.').at(-1) ?? '');

  if (prefix === 'T' || prefix === 'N') {
    const name = readable(last);
    return { prefix, qualified, owner, name, display: name, parameters, signature: readable(qualified) };
  }
  const constructor = last === '#ctor' || last === '#cctor';
  const name = constructor ? ownerShort : readable(last.replace(/#/g, '.'));
  const display = constructor ? ownerShort : `${ownerShort}.${name}`;
  let signature = display;
  if (prefix === 'M') signature = `${display}(${parameters.join(', ')})`;
  else if (prefix === 'P' && parameters.length > 0) signature = `${ownerShort}.this[${parameters.join(', ')}]`;
  if (match[4] !== undefined) signature += `: ${typeName(match[4])}`;
  return { prefix, qualified, owner, name, display, parameters, signature };
}
