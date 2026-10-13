/**
 * `.d.ts` files to pages. A file with an `export default class` is a class page (the
 * `@arcgis/core` layout); any other file is a module page listing its exports.
 *
 * Only own members are shown: base classes are named and the reader is told to look them up,
 * because resolving inheritance needs one more file per mixin (design decision 7).
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../../core/ports.js';
import type { DocPage } from '../../core/types.js';
import { renderApiPage, type ApiMember, type ApiType } from '../api-page.js';
import {
  blocks,
  bullets,
  fence,
  fencedExample,
  firstSentence,
  inlineCode,
  oneLine,
} from '../md.js';
import { parseJsDoc, type JsDoc } from './jsdoc.js';
import { classView, defaultClass, publicExports, rawMemberText, type ClassView } from './model.js';
import { scanDts, type DtsDeclaration, type DtsFile, type DtsMember } from './scanner.js';

const RAW_NOTICE =
  'Part of this declaration file could not be parsed; the affected declarations are shown as written.';

const GROUP_BY_KIND: Record<DtsDeclaration['kind'], string> = {
  class: 'Classes',
  interface: 'Interfaces',
  enum: 'Enumerations',
  namespace: 'Namespaces',
  function: 'Functions',
  const: 'Variables',
  type: 'Type aliases',
  import: 'Other',
  export: 'Other',
  other: 'Other',
};

/** The documentation fields of a member or type, taken from its JSDoc. */
function documentation(doc: JsDoc): Partial<ApiMember> {
  return {
    ...(doc.description === '' ? {} : { description: doc.description }),
    ...(doc.since === undefined ? {} : { since: doc.since }),
    ...(doc.deprecated === undefined ? {} : { deprecated: doc.deprecated }),
    ...(doc.params.length === 0 ? {} : { params: doc.params }),
    ...(doc.returns === undefined ? {} : { returns: doc.returns }),
    // JSDoc examples of JavaScript packages are JavaScript unless they bring their own fence.
    examples: doc.examples.map((example) => fencedExample(example, 'js')),
    see: doc.see,
    throws: doc.throws,
  };
}

function isHidden(member: DtsMember): boolean {
  return (
    member.modifiers.includes('private') ||
    member.name.startsWith('#') ||
    // The typing helper `"@eventTypes"` is not a member anyone can use.
    member.name.startsWith('@')
  );
}

function group(kind: DtsMember['kind']): { group: string; kind: string } {
  switch (kind) {
    case 'constructor':
      return { group: 'Constructors', kind: 'constructor' };
    case 'method':
      return { group: 'Methods', kind: 'method' };
    case 'call':
    case 'index':
      return { group: 'Signatures', kind: 'signature' };
    default:
      return { group: 'Properties', kind: 'property' };
  }
}

/** Members with the same name declared as a `get`/`set` pair become one property. */
function mergeAccessors(members: readonly DtsMember[]): DtsMember[][] {
  const merged: DtsMember[][] = [];
  const accessors = new Map<string, DtsMember[]>();
  for (const member of members) {
    if (member.kind !== 'getter' && member.kind !== 'setter') {
      merged.push([member]);
      continue;
    }
    const pair = accessors.get(member.name);
    if (pair === undefined) {
      const fresh = [member];
      accessors.set(member.name, fresh);
      merged.push(fresh);
    } else pair.push(member);
  }
  return merged;
}

function classMember(
  parts: readonly DtsMember[],
  options: Map<string, DtsMember>,
): ApiMember | undefined {
  const [first] = parts;
  if (first === undefined) return undefined;
  const option = options.get(first.name);
  const documented = parts.find((part) => part.jsdoc !== undefined);
  // Property prose often lives on the `XProperties` interface instead of the accessor.
  const doc = parseJsDoc(documented?.jsdoc ?? option?.jsdoc);
  if (doc.internal) return undefined;
  const getter = parts.find((part) => part.kind === 'getter');
  const setter = parts.find((part) => part.kind === 'setter');
  const accessor = getter !== undefined || setter !== undefined;
  const readonly = (accessor && setter === undefined) || first.modifiers.includes('readonly');
  const ownType = getter?.type ?? first.type;
  const { group: groupName, kind } = group(first.kind);
  const raw = parts.some((part) => part.raw === true);
  const flags = [
    first.modifiers.includes('static') ? 'static' : undefined,
    first.modifiers.includes('abstract') ? 'abstract' : undefined,
    first.modifiers.includes('protected') ? 'protected' : undefined,
    readonly ? 'readonly' : undefined,
    first.optional ? 'optional' : undefined,
    option === undefined ? undefined : 'constructor option',
    doc.default === undefined ? undefined : `default ${inlineCode(doc.default)}`,
    raw ? 'unparsed declaration' : undefined,
  ].filter((flag) => flag !== undefined);
  const accepts =
    option?.type !== undefined && ownType !== undefined && oneLine(option.type) !== oneLine(ownType)
      ? [`Constructor accepts: ${inlineCode(option.type)}`]
      : [];
  return {
    id: first.name === '' ? kind : first.name,
    name: first.name === '' ? oneLine(first.text) : first.name,
    kind,
    group: groupName,
    signature: parts.map((part) => part.text).join('\n'),
    ...(flags.length > 0 ? { flags } : {}),
    ...(accepts.length > 0 ? { facts: accepts } : {}),
    ...(readonly ? { readonly: true } : {}),
    ...documentation(doc),
  };
}

function extraMembers(
  owner: DtsDeclaration | undefined,
  groupName: string,
  kind: string,
  skip: ReadonlySet<string>,
): ApiMember[] {
  return (owner?.members ?? []).flatMap((member) => {
    if (member.name === '' || skip.has(member.name) || isHidden(member)) return [];
    const doc = parseJsDoc(member.jsdoc);
    if (doc.internal) return [];
    return [
      {
        id: kind === 'event' ? `event-${member.name}` : member.name,
        name: member.name,
        kind,
        group: groupName,
        signature: member.text,
        ...(kind === 'event' ? {} : { flags: ['constructor option'] }),
        ...documentation(doc),
      },
    ];
  });
}

function classMembers(view: ClassView): ApiMember[] {
  const options = new Map((view.properties?.members ?? []).map((member) => [member.name, member]));
  const own = mergeAccessors(view.members.filter((member) => !isHidden(member))).flatMap(
    (parts) => classMember(parts, options) ?? [],
  );
  const order = ['Constructors', 'Properties', 'Methods', 'Signatures'];
  own.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const seen = new Set(own.map((member) => member.name));
  return [
    ...own,
    ...extraMembers(view.properties, 'Constructor-only options', 'property', seen),
    ...extraMembers(view.events, 'Events', 'event', new Set()),
  ];
}

/** `layers/FeatureLayer.d.ts` and the package name to `@arcgis/core/layers/FeatureLayer`. */
function moduleId(input: RendererInputs['dts']): string {
  const path = input.modulePath.replace(/^\.?\//, '').replace(/\.d\.[cm]?ts$|\.[cm]?[jt]s$/, '');
  return `${input.packageName}/${path}`;
}

function declarationText(declaration: DtsDeclaration): string {
  return declaration.text.replace(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?/, '');
}

function classPage(view: ClassView, input: RendererInputs['dts'], isDefault: boolean): ApiType {
  const doc = parseJsDoc(view.declaration.jsdoc);
  const module = moduleId(input);
  const importLine = isDefault
    ? `import ${view.name} from "${module}.js";`
    : `import { ${view.name} } from "${input.packageName}";`;
  const inheritedOptions = view.properties?.extends ?? [];
  const inheritedEvents = view.events?.extends ?? [];
  const facts = [
    view.bases.length === 0
      ? undefined
      : `**Extends:** ${view.bases.map(inlineCode).join(', ')}. Inherited members are not listed here: look up the base class.`,
    view.declaration.implements.length === 0
      ? undefined
      : `**Implements:** ${view.declaration.implements.map(inlineCode).join(', ')}`,
    inheritedOptions.length === 0
      ? undefined
      : `**Constructor options also come from:** ${inheritedOptions.map(inlineCode).join(', ')}`,
    inheritedEvents.length === 0
      ? undefined
      : `**Events also come from:** ${inheritedEvents.map(inlineCode).join(', ')}`,
  ].filter((fact) => fact !== undefined);
  const members = classMembers(view);
  const raw =
    !view.complete || members.some((member) => member.flags?.includes('unparsed declaration'));
  return {
    title: view.name,
    header: blocks(
      `_${view.declaration.kind === 'interface' ? 'Interface' : 'Class'}_ · ${inlineCode(module)}`,
      fence(importLine, 'js'),
    ),
    language: 'ts',
    facts,
    ...documentation(doc),
    members,
    ...(raw ? { notices: [RAW_NOTICE], unknown: ['dts:raw'] } : {}),
  };
}

function exportMember(declaration: DtsDeclaration, file: DtsFile): ApiMember | undefined {
  const doc = parseJsDoc(declaration.jsdoc);
  if (doc.internal) return undefined;
  const container =
    declaration.kind === 'class' || declaration.kind === 'interface' || declaration.kind === 'enum';
  const index = container
    ? classMembers(classView(file, declaration)).map((member) => {
        const summary = firstSentence(member.description);
        return `${inlineCode(member.name)}${summary === '' ? '' : `: ${summary}`}`;
      })
    : [];
  return {
    id: declaration.name,
    name: declaration.name,
    kind: declaration.kind === 'const' ? 'variable' : declaration.kind,
    group: GROUP_BY_KIND[declaration.kind],
    // A container's members are indexed below; repeating its whole body would double the text.
    signature: container
      ? `${declarationText({ ...declaration, text: declaration.head })} { ... }`
      : declarationText(declaration),
    ...documentation(doc),
    ...(index.length === 0 ? {} : { extra: blocks('**Members**', bullets(index)) }),
  };
}

function modulePage(file: DtsFile, input: RendererInputs['dts']): ApiType {
  const module = moduleId(input);
  const exports = publicExports(file);
  const names = exports.map((declaration) => declaration.name);
  return {
    title: module.split('/').at(-1) ?? module,
    header: blocks(
      `_Module_ · ${inlineCode(module)}`,
      names.length === 0
        ? undefined
        : fence(`import { ${names.join(', ')} } from "${input.packageName}";`, 'js'),
    ),
    language: 'ts',
    members: exports.flatMap((declaration) => exportMember(declaration, file) ?? []),
  };
}

/**
 * Renders a declaration file.
 *
 * - `input.member` names a member of the default class, an export of the module, or
 *   `Export.member` for a member of an exported class or interface.
 * - Declarations the scanner cannot classify are shown as written and reported in `notices`
 *   and `diagnostics.unknownIslands` (`dts:raw`). When a class body cannot be scanned at all,
 *   a requested member is cut out of the raw text: from its JSDoc to the next doc comment.
 */
export function renderDts(
  input: RendererInputs['dts'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const file = scanDts(input.source);
  const wanted = input.member ?? opts?.select?.member;
  const [owner, ownerMember] = wanted?.includes('.') === true ? wanted.split('.', 2) : [];
  const exported = publicExports(file).find(
    (declaration) => declaration.name === owner && declaration.kind !== 'function',
  );
  const primary = defaultClass(file);
  const target = exported ?? primary;

  if (target === undefined)
    return renderApiPage('dts', meta, modulePage(file, input), opts, wanted);

  const view = classView(file, target);
  const type = classPage(view, input, target === primary);
  const memberName = exported === undefined ? wanted : ownerMember;
  const known = type.members.some(
    (member) => member.name === memberName || member.id === memberName,
  );
  const rawText =
    !view.complete && memberName !== undefined && !known
      ? rawMemberText(input.source, memberName)
      : undefined;
  if (rawText !== undefined && memberName !== undefined) {
    type.members.push({
      id: memberName,
      name: memberName,
      kind: 'member',
      group: 'Unparsed declarations',
      signature: rawText,
      flags: ['unparsed declaration'],
    });
  }
  return renderApiPage('dts', meta, type, opts, memberName);
}
