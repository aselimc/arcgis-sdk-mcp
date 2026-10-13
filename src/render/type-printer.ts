/**
 * Type-to-text printing shared by the TypeDoc and Custom Elements Manifest renderers.
 *
 * TypeDoc serialises types as a tree (`{ type: 'union', types: [...] }`); a manifest carries
 * them as text already. Both end up as the TypeScript an author would have written.
 */
import { asRecord, isRecord, list, records, scalar, str, type Json } from './json.js';

/** Binding strength of a printed type, used to decide where parentheses are needed. */
const enum Tight {
  Conditional = 0,
  Union = 1,
  Intersection = 2,
  Operator = 3,
  Postfix = 4,
}

interface Printed {
  text: string;
  tight: Tight;
}

function wrap(printed: Printed, needed: Tight): string {
  return printed.tight < needed ? `(${printed.text})` : printed.text;
}

function literal(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  // TypeDoc writes a bigint literal as { value, negative }.
  if (isRecord(value)) return `${value.negative === true ? '-' : ''}${scalar(value.value) ?? ''}n`;
  return scalar(value) ?? 'unknown';
}

function typeArguments(node: Json): string {
  const args = list(node.typeArguments);
  return args.length === 0 ? '' : `<${args.map((arg) => printType(arg)).join(', ')}>`;
}

function propertyLine(child: Json): string {
  const flags = asRecord(child.flags);
  const name = str(child.name) ?? '';
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
  const signatures = records(child.signatures);
  if (signatures.length > 0) {
    return signatures.map((signature) => printSignature(key, signature)).join('; ');
  }
  const readonly = flags.isReadonly === true ? 'readonly ' : '';
  return `${readonly}${key}${flags.isOptional === true ? '?' : ''}: ${printType(child.type)}`;
}

/** An inline object, function or constructor type (`reflection` in TypeDoc). */
function reflection(declaration: Json): Printed {
  const signatures = records(declaration.signatures);
  const children = records(declaration.children);
  const index = records(declaration.indexSignatures ?? declaration.indexSignature);
  if (signatures.length === 1 && children.length === 0 && index.length === 0) {
    const [signature] = signatures;
    return { text: printSignature('', asRecord(signature), ' => '), tight: Tight.Conditional };
  }
  const lines = [
    ...signatures.map((signature) => printSignature('', signature)),
    ...index.map((signature) => {
      const [key] = records(signature.parameters);
      return `[${str(key?.name) ?? 'key'}: ${printType(key?.type)}]: ${printType(signature.type)}`;
    }),
    ...children.map(propertyLine),
  ];
  return { text: lines.length === 0 ? '{}' : `{ ${lines.join('; ')} }`, tight: Tight.Postfix };
}

function templateLiteral(node: Json): string {
  const tail = list(node.tail)
    .map((part) => {
      const [type, text] = list(part);
      return `\${${printType(type)}}${scalar(text) ?? ''}`;
    })
    .join('');
  return `\`${scalar(node.head) ?? ''}${tail}\``;
}

function mapped(node: Json): string {
  const modifier = (value: unknown, mark: string): string =>
    value === '+' ? mark : value === '-' ? `-${mark}` : '';
  const readonly = modifier(node.readonlyModifier, 'readonly ');
  const optional = modifier(node.optionalModifier, '?');
  const as = node.nameType === undefined ? '' : ` as ${printType(node.nameType)}`;
  return `{ ${readonly}[${str(node.parameter) ?? 'K'} in ${printType(node.parameterType)}${as}]${optional}: ${printType(node.templateType)} }`;
}

function print(type: unknown): Printed {
  const node = asRecord(type);
  const atom = (text: string): Printed => ({ text, tight: Tight.Postfix });
  const each = (key: string, needed: Tight): string[] =>
    list(node[key]).map((item) => wrap(print(item), needed));

  switch (node.type) {
    case 'intrinsic':
    case 'unknown':
    case 'reference':
      return atom(`${str(node.name) ?? 'unknown'}${typeArguments(node)}`);
    case 'literal':
      return atom(literal(node.value));
    case 'array':
      return atom(`${wrap(print(node.elementType), Tight.Postfix)}[]`);
    case 'union':
      return { text: each('types', Tight.Intersection).join(' | '), tight: Tight.Union };
    case 'intersection':
      return { text: each('types', Tight.Operator).join(' & '), tight: Tight.Intersection };
    case 'tuple':
      return atom(`[${list(node.elements).map(printType).join(', ')}]`);
    case 'namedTupleMember':
    case 'named-tuple-member':
      return atom(
        `${str(node.name) ?? ''}${node.isOptional === true ? '?' : ''}: ${printType(node.element)}`,
      );
    case 'reflection':
      return reflection(asRecord(node.declaration));
    case 'typeOperator':
      return {
        text: `${str(node.operator) ?? 'keyof'} ${wrap(print(node.target), Tight.Operator)}`,
        tight: Tight.Operator,
      };
    case 'indexedAccess':
      return atom(`${wrap(print(node.objectType), Tight.Postfix)}[${printType(node.indexType)}]`);
    case 'predicate': {
      const asserts = node.asserts === true ? 'asserts ' : '';
      const target = node.targetType === undefined ? '' : ` is ${printType(node.targetType)}`;
      return { text: `${asserts}${str(node.name) ?? 'value'}${target}`, tight: Tight.Conditional };
    }
    case 'conditional':
      return {
        text: `${wrap(print(node.checkType), Tight.Union)} extends ${wrap(print(node.extendsType), Tight.Union)} ? ${printType(node.trueType)} : ${printType(node.falseType)}`,
        tight: Tight.Conditional,
      };
    case 'mapped':
      return atom(mapped(node));
    case 'templateLiteral':
    case 'template-literal':
      return atom(templateLiteral(node));
    case 'query':
      return { text: `typeof ${printType(node.queryType)}`, tight: Tight.Operator };
    case 'inferred':
      return { text: `infer ${str(node.name) ?? 'T'}`, tight: Tight.Operator };
    case 'rest':
      return atom(`...${wrap(print(node.elementType), Tight.Postfix)}`);
    case 'optional':
      return atom(`${wrap(print(node.elementType), Tight.Postfix)}?`);
    default:
      // A node kind this printer does not know is shown by name rather than dropped.
      return atom(str(node.name) ?? 'unknown');
  }
}

/** Prints a TypeDoc type node as TypeScript. Unknown or missing nodes print as `unknown`. */
export function printType(type: unknown): string {
  return print(type).text;
}

/** `<T extends Base = Default>` for a TypeDoc signature or declaration; empty without parameters. */
export function printTypeParameters(owner: Json): string {
  const parameters = records(owner.typeParameters ?? owner.typeParameter);
  if (parameters.length === 0) return '';
  const printed = parameters.map((parameter) => {
    const constraint = parameter.type === undefined ? '' : ` extends ${printType(parameter.type)}`;
    const fallback = parameter.default === undefined ? '' : ` = ${printType(parameter.default)}`;
    return `${str(parameter.name) ?? 'T'}${constraint}${fallback}`;
  });
  return `<${printed.join(', ')}>`;
}

/**
 * Prints a TypeDoc call signature as `name<T>(a: A, b?: B): R`.
 *
 * @param separator what stands between the parameter list and the return type: `': '` for a
 *   declaration, `' => '` for a function type, `null` to leave the return type out
 *   (constructors).
 */
export function printSignature(
  name: string,
  signature: Json,
  separator: string | null = ': ',
): string {
  const parameters = records(signature.parameters).map((parameter) => {
    const flags = asRecord(parameter.flags);
    const rest = flags.isRest === true ? '...' : '';
    const optional = flags.isOptional === true || parameter.defaultValue !== undefined ? '?' : '';
    return `${rest}${str(parameter.name) ?? 'arg'}${optional}: ${printType(parameter.type)}`;
  });
  const head = `${name}${printTypeParameters(signature)}(${parameters.join(', ')})`;
  if (separator === null) return head;
  return `${head}${separator}${signature.type === undefined ? 'void' : printType(signature.type)}`;
}

/** The text of a Custom Elements Manifest type (`{ text }`), or `undefined` when absent. */
export function manifestType(type: unknown): string | undefined {
  return str(asRecord(type).text);
}

/**
 * The call signature of a manifest method or function: Esri's precomputed `signature` when
 * the manifest has one, otherwise built from `parameters` and `return` as the schema defines.
 */
export function manifestSignature(name: string, member: Json): string {
  const ready = str(member.signature);
  if (ready !== undefined) return `${name}${ready}`;
  const parameters = records(member.parameters).map((parameter) => {
    const rest = parameter.rest === true ? '...' : '';
    const optional = parameter.optional === true ? '?' : '';
    const type = manifestType(parameter.type);
    return `${rest}${str(parameter.name) ?? 'arg'}${optional}${type === undefined ? '' : `: ${type}`}`;
  });
  const returns = manifestType(asRecord(member.return).type);
  return `${name}(${parameters.join(', ')})${returns === undefined ? '' : `: ${returns}`}`;
}
