/**
 * TypeDoc reflection JSON (schema 0.23 and later) to a page. One renderer serves the ArcGIS
 * REST JS and Experience Builder references, which both embed the reflection of a symbol as
 * `typedocPage.raw` in their Gatsby page data.
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage } from '../core/types.js';
import { renderApiPage, type ApiMember, type ApiParam, type ApiType } from './api-page.js';
import { asRecord, isRecord, list, num, records, str, type Json } from './json.js';
import { inlineCode } from './md.js';
import { invalidInput } from './page.js';
import { printSignature, printType, printTypeParameters } from './type-printer.js';
import { readComment, type CommentContext, type CommentDoc } from './typedoc-comment.js';

/** TypeDoc `ReflectionKind` values. */
const KIND = {
  enum: 8,
  enumMember: 16,
  variable: 32,
  function: 64,
  class: 128,
  interface: 256,
  constructor: 512,
  property: 1024,
  method: 2048,
  accessor: 262144,
  typeAlias: 2097152,
} as const;

const KIND_NAMES: Record<number, string> = {
  1: 'project',
  2: 'module',
  4: 'namespace',
  [KIND.enum]: 'enum',
  [KIND.enumMember]: 'enum member',
  [KIND.variable]: 'variable',
  [KIND.function]: 'function',
  [KIND.class]: 'class',
  [KIND.interface]: 'interface',
  [KIND.constructor]: 'constructor',
  [KIND.property]: 'property',
  [KIND.method]: 'method',
  [KIND.accessor]: 'accessor',
  [KIND.typeAlias]: 'type alias',
  4194304: 'reference',
};

const GROUP_BY_KIND: Record<number, string> = {
  [KIND.constructor]: 'Constructors',
  [KIND.property]: 'Properties',
  [KIND.accessor]: 'Accessors',
  [KIND.method]: 'Methods',
  [KIND.enumMember]: 'Enumeration members',
};

function kindName(node: Json): string {
  return KIND_NAMES[num(node.kind) ?? 0] ?? 'symbol';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Maps the id of every member, and of each of its signatures, to the member's anchor. */
function anchorsOf(raw: Json): Map<number, string> {
  const anchors = new Map<number, string>();
  const rawId = num(raw.id);
  if (rawId !== undefined) anchors.set(rawId, '');
  for (const child of records(raw.children)) {
    const name = str(child.name);
    if (name === undefined) continue;
    const nested = [child, ...records(child.signatures), child.getSignature, child.setSignature];
    for (const node of nested) {
      const id = num(asRecord(node).id);
      if (id !== undefined) anchors.set(id, name);
    }
  }
  return anchors;
}

function sourceLink(node: Json): string | undefined {
  const url = str(asRecord(list(node.sources)[0]).url);
  return url === undefined ? undefined : `[source](${url})`;
}

function typeNames(types: unknown): string[] {
  return list(types).map((type) => inlineCode(printType(type)));
}

function parametersOf(signature: Json, comment: CommentDoc, context: CommentContext): ApiParam[] {
  return records(signature.parameters).map((parameter) => {
    const name = str(parameter.name) ?? 'arg';
    const flags = asRecord(parameter.flags);
    const own = readComment(parameter.comment, context).description;
    const description = own ?? comment.params.get(name);
    const fallback = str(parameter.defaultValue);
    return {
      name,
      type: printType(parameter.type),
      ...(flags.isOptional === true ? { optional: true } : {}),
      ...(fallback === undefined ? {} : { default: fallback }),
      ...(description === undefined ? {} : { description }),
    };
  });
}

interface Declared {
  signature: string;
  comment: CommentDoc;
  params?: ApiParam[];
  readonly?: boolean;
}

/** Declaration text, comment and parameters of a member or of a top-level function or variable. */
function declare(node: Json, name: string, context: CommentContext): Declared {
  const flags = asRecord(node.flags);
  const prefix = [
    flags.isStatic === true ? 'static ' : '',
    flags.isAbstract === true ? 'abstract ' : '',
    flags.isProtected === true ? 'protected ' : '',
  ].join('');
  const signatures = records(node.signatures);
  if (signatures.length > 0) {
    // The comment of an overloaded function sits on its signatures; the first documented one speaks for all.
    const documented = signatures.find((signature) => isRecord(signature.comment)) ?? signatures[0];
    const comment = readComment(documented?.comment ?? node.comment, context);
    return {
      signature: signatures
        .map(
          (signature) =>
            `${prefix}${printSignature(name, signature, num(node.kind) === KIND.constructor ? null : ': ')}`,
        )
        .join('\n'),
      comment,
      params: parametersOf(asRecord(documented), comment, context),
    };
  }
  const getter = isRecord(node.getSignature) ? node.getSignature : undefined;
  const setter = isRecord(node.setSignature) ? node.setSignature : undefined;
  if (getter !== undefined || setter !== undefined) {
    const lines = [
      getter === undefined ? undefined : `${prefix}get ${name}(): ${printType(getter.type)}`,
      setter === undefined
        ? undefined
        : `${prefix}set ${printSignature(name, setter).replace(/: void$/, '')}`,
    ].filter((line) => line !== undefined);
    return {
      signature: lines.join('\n'),
      comment: readComment(getter?.comment ?? setter?.comment ?? node.comment, context),
      ...(setter === undefined ? { readonly: true } : {}),
    };
  }
  const readonly = flags.isReadonly === true;
  const optional = flags.isOptional === true ? '?' : '';
  const fallback = str(node.defaultValue);
  const type = node.type === undefined ? '' : `: ${printType(node.type)}`;
  return {
    signature: `${prefix}${readonly ? 'readonly ' : ''}${name}${optional}${type}${fallback === undefined ? '' : ` = ${fallback}`}`,
    comment: readComment(node.comment, context),
    ...(readonly ? { readonly: true } : {}),
  };
}

function memberOf(child: Json, group: string, context: CommentContext): ApiMember | undefined {
  const name = str(child.name);
  if (name === undefined || asRecord(child.flags).isPrivate === true) return undefined;
  const kind = num(child.kind) ?? 0;
  const declared = declare(child, name, context);
  const { comment } = declared;
  const inherited = str(asRecord(child.inheritedFrom).name)?.replace(/\.[^.]+$/, '');
  // `static`, `readonly` and `?` are in the declaration; only a documented default that the
  // declaration does not show is worth a line of its own.
  const facts =
    comment.defaultValue === undefined || child.defaultValue !== undefined
      ? []
      : [`default ${inlineCode(comment.defaultValue)}`];
  return {
    id: name,
    name,
    kind: kind === KIND.constructor ? 'constructor' : kindName(child),
    group,
    signature: declared.signature,
    ...(facts.length > 0 ? { flags: facts } : {}),
    ...(comment.description === undefined ? {} : { description: comment.description }),
    ...(declared.params === undefined ? {} : { params: declared.params }),
    ...(comment.returns === undefined ? {} : { returns: comment.returns }),
    ...(comment.since === undefined ? {} : { since: comment.since }),
    ...(comment.deprecated === undefined ? {} : { deprecated: comment.deprecated }),
    ...(inherited === undefined ? {} : { inheritedFrom: inherited }),
    ...(declared.readonly === true ? { readonly: true } : {}),
    examples: comment.examples,
    see: comment.see,
    throws: comment.throws,
  };
}

/** Members in the order of `groups[]`, the order the published page uses; ungrouped ones follow. */
function membersOf(owner: Json, context: CommentContext): ApiMember[] {
  const children = records(owner.children);
  const byId = new Map(children.map((child) => [num(child.id), child]));
  const placed = new Set<Json>();
  const members: ApiMember[] = [];
  const add = (child: Json | undefined, group: string): void => {
    if (child === undefined || placed.has(child)) return;
    placed.add(child);
    const member = memberOf(child, group, context);
    if (member !== undefined) members.push(member);
  };
  for (const group of records(owner.groups)) {
    const title = str(group.title) ?? 'Members';
    for (const id of list(group.children)) add(byId.get(num(id)), title);
  }
  for (const child of children) add(child, GROUP_BY_KIND[num(child.kind) ?? 0] ?? 'Members');
  return members;
}

function heritage(raw: Json): string[] {
  const line = (label: string, types: unknown): string | undefined => {
    const names = typeNames(types);
    return names.length === 0 ? undefined : `**${label}:** ${names.join(', ')}`;
  };
  // Base types are part of the declaration line; only the reverse direction needs saying.
  return [line('Extended by', raw.extendedBy), line('Implemented by', raw.implementedBy)].filter(
    (fact) => fact !== undefined,
  );
}

function typeDeclaration(raw: Json, name: string): string | undefined {
  const parameters = printTypeParameters(raw);
  const plain = (types: unknown): string => list(types).map(printType).join(', ');
  switch (num(raw.kind)) {
    case KIND.class: {
      const base = list(raw.extendedTypes).length > 0 ? ` extends ${plain(raw.extendedTypes)}` : '';
      const contracts =
        list(raw.implementedTypes).length > 0 ? ` implements ${plain(raw.implementedTypes)}` : '';
      return `class ${name}${parameters}${base}${contracts}`;
    }
    case KIND.interface:
      return `interface ${name}${parameters}${list(raw.extendedTypes).length > 0 ? ` extends ${plain(raw.extendedTypes)}` : ''}`;
    case KIND.enum:
      return `enum ${name}`;
    case KIND.typeAlias:
      return `type ${name}${parameters} = ${printType(raw.type)}`;
    default:
      return undefined;
  }
}

/** The module a symbol belongs to: TypeDoc's own field, else the path segment of the reference URL. */
function moduleOf(raw: Json, url: string): string | undefined {
  return str(raw.module) ?? /\/api-reference\/([^/#?]+)\/[^/#?]+/.exec(url)?.[1];
}

/**
 * Renders the TypeDoc reflection of one symbol.
 *
 * Classes, interfaces and enums list their members in `groups[]` order; functions and
 * variables are a single declaration. Member anchors are the bare member names, as on the
 * published pages. `input.member` selects one member.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when `input.raw` is not a reflection object.
 */
export function renderTypedoc(
  input: RendererInputs['typedoc'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const raw = input.raw;
  const name = isRecord(raw) ? str(raw.name) : undefined;
  if (!isRecord(raw) || name === undefined) {
    throw invalidInput('typedoc', meta, 'the page data holds no TypeDoc reflection');
  }
  const pageUrl = meta.url.replace(/#.*$/, '');
  const context: CommentContext = { pageUrl, anchors: anchorsOf(raw) };
  const kind = num(raw.kind);
  const callable = kind === KIND.function || kind === KIND.variable;
  const declared = callable ? declare(raw, name, context) : undefined;
  const comment = declared?.comment ?? readComment(raw.comment, context);
  // An alias of an object type documents its properties on the inline declaration.
  const owner =
    kind === KIND.typeAlias && records(raw.children).length === 0
      ? asRecord(asRecord(raw.type).declaration)
      : raw;
  const module = moduleOf(raw, pageUrl);
  const signature =
    declared === undefined
      ? typeDeclaration(raw, name)
      : kind === KIND.function
        ? `function ${declared.signature}`
        : // `const` already says what the readonly flag of a variable says.
          `const ${declared.signature.replace(/^readonly /, '')}`;

  const type: ApiType = {
    title: name,
    header: [
      `_${capitalise(kindName(raw))}_${module === undefined ? '' : ` in ${inlineCode(module)}`}`,
      sourceLink(raw),
    ]
      .filter((part) => part !== undefined)
      .join(' · '),
    language: 'ts',
    ...(signature === undefined ? {} : { signature }),
    facts: heritage(raw),
    ...(comment.description === undefined ? {} : { description: comment.description }),
    ...(declared?.params === undefined ? {} : { params: declared.params }),
    ...(comment.returns === undefined ? {} : { returns: comment.returns }),
    ...(comment.since === undefined ? {} : { since: comment.since }),
    ...(comment.deprecated === undefined ? {} : { deprecated: comment.deprecated }),
    examples: comment.examples,
    see: comment.see,
    throws: comment.throws,
    members: callable ? [] : membersOf(owner, context),
  };
  return renderApiPage('typedoc', meta, type, opts, input.member);
}
