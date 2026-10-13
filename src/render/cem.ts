/**
 * Custom Elements Manifest (`dist/docs/api.json`, schema 2.x with Esri's extensions) to a
 * component page: properties, methods, events, slots and CSS custom properties.
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage } from '../core/types.js';
import { renderApiPage, type ApiMember, type ApiParam, type ApiType } from './api-page.js';
import { asRecord, isRecord, records, str, type Json } from './json.js';
import { blocks, bullets, fence, inlineCode } from './md.js';
import { invalidInput, type Block } from './page.js';
import { manifestSignature, manifestType } from './type-printer.js';

interface Found {
  declaration: Json;
  module: Json;
}

/** The declaration with the given tag name, or failing that the given class or function name. */
function findDeclaration(manifest: Json, tag: string): Found | undefined {
  let byName: Found | undefined;
  for (const module of records(manifest.modules)) {
    for (const declaration of records(module.declarations)) {
      if (declaration.tagName === tag) return { declaration, module };
      if (byName === undefined && declaration.name === tag) byName = { declaration, module };
    }
  }
  return byName;
}

interface Tags {
  since?: string;
  deprecated?: string | boolean;
  examples: string[];
  see: string[];
}

/** Reads the JSDoc-style `docsTags` (and the standard `deprecated` field) of a manifest entry. */
function readTags(entry: Json): Tags {
  const tags: Tags = { examples: [], see: [] };
  for (const tag of records(entry.docsTags)) {
    const text = str(tag.text)?.trim();
    switch (tag.name) {
      case 'since':
        if (text !== undefined) tags.since = text;
        break;
      case 'deprecated':
        tags.deprecated = text ?? true;
        break;
      case 'example':
        if (text !== undefined) tags.examples.push(text);
        break;
      case 'see':
        if (text !== undefined) tags.see.push(text);
        break;
      default:
    }
  }
  if (entry.deprecated === true) tags.deprecated ??= true;
  else if (typeof entry.deprecated === 'string') tags.deprecated = entry.deprecated;
  return tags;
}

function documented(entry: Json): Pick<ApiMember, 'description' | 'since' | 'deprecated'> & {
  examples: string[];
  see: string[];
} {
  const tags = readTags(entry);
  const description = str(entry.description);
  return {
    ...(description === undefined ? {} : { description }),
    ...(tags.since === undefined ? {} : { since: tags.since }),
    ...(tags.deprecated === undefined ? {} : { deprecated: tags.deprecated }),
    examples: tags.examples,
    see: tags.see,
  };
}

function inheritedFrom(entry: Json): string | undefined {
  const name = str(asRecord(entry.inheritedFrom).name);
  // Esri marks members that every component gets from the runtime as inherited from `this`.
  return name === 'this' ? undefined : name;
}

function fieldMember(field: Json, name: string): ApiMember {
  const type = manifestType(field.type);
  const fallback = str(field.default);
  const attribute = str(field.attribute);
  const readonly = field.readonly === true || field.docsOnlyReadonly === true;
  const base = inheritedFrom(field);
  const facts = [
    readonly ? 'readonly' : undefined,
    field.static === true ? 'static' : undefined,
    attribute === undefined ? undefined : `attribute ${inlineCode(attribute)}`,
    field.reflects === true ? 'reflects' : undefined,
  ].filter((fact) => fact !== undefined);
  return {
    id: name,
    name,
    kind: 'property',
    group: 'Properties',
    signature: `${name}${type === undefined ? '' : `: ${type}`}${fallback === undefined ? '' : ` = ${fallback}`}`,
    ...(facts.length > 0 ? { flags: facts } : {}),
    ...(readonly ? { readonly: true } : {}),
    ...(base === undefined ? {} : { inheritedFrom: base }),
    ...documented(field),
  };
}

function methodMember(method: Json, name: string): ApiMember {
  const params: ApiParam[] = records(method.parameters).map((parameter) => {
    const type = manifestType(parameter.type);
    const description = str(parameter.description);
    const fallback = str(parameter.default);
    return {
      name: str(parameter.name) ?? 'arg',
      ...(type === undefined ? {} : { type }),
      ...(parameter.optional === true ? { optional: true } : {}),
      ...(fallback === undefined ? {} : { default: fallback }),
      ...(description === undefined ? {} : { description }),
    };
  });
  const returns = str(asRecord(method.return).description);
  const base = inheritedFrom(method);
  return {
    id: name,
    name,
    kind: 'method',
    group: 'Methods',
    signature: manifestSignature(name, method),
    ...(method.static === true ? { flags: ['static'] } : {}),
    ...(params.length > 0 ? { params } : {}),
    ...(returns === undefined ? {} : { returns }),
    ...(base === undefined ? {} : { inheritedFrom: base }),
    ...documented(method),
  };
}

function eventMember(event: Json, name: string): ApiMember {
  const type = manifestType(event.type);
  return {
    // Event anchors on the published component pages carry this prefix.
    id: `event-${name}`,
    name,
    kind: 'event',
    group: 'Events',
    signature: `${name}: CustomEvent${type === undefined ? '' : `<${type}>`}`,
    ...documented(event),
  };
}

function membersOf(declaration: Json): ApiMember[] {
  const members: ApiMember[] = [];
  const methods: ApiMember[] = [];
  for (const member of records(declaration.members)) {
    const name = str(member.name);
    if (name === undefined || member.privacy === 'private' || member.privacy === 'protected') {
      continue;
    }
    if (member.kind === 'method') methods.push(methodMember(member, name));
    else if (member.kind === 'field') members.push(fieldMember(member, name));
  }
  const events = records(declaration.events).flatMap((event) => {
    const name = str(event.name);
    return name === undefined ? [] : [eventMember(event, name)];
  });
  return [...members, ...methods, ...events];
}

/** A list section for entries that are one line each and have no anchor of their own. */
function listSection(title: string, entries: unknown, label: (name: string) => string): Block[] {
  const lines = records(entries).map((entry) => {
    const description = str(entry.description)?.trim();
    const name = label(typeof entry.name === 'string' ? entry.name : '');
    return description === undefined ? name : `${name}: ${description}`;
  });
  return lines.length === 0 ? [] : [{ level: 2, title, body: bullets(lines) }];
}

function headerOf(declaration: Json, module: Json, input: RendererInputs['cem']): string {
  const element = declaration.customElement === true;
  const className = str(declaration.name);
  const importPath = str(declaration.importPath) ?? str(module.path);
  const superclass = str(asRecord(declaration.superclass).name);
  const facts = [
    element ? '_Web component_' : `_${str(declaration.kind) ?? 'declaration'}_`,
    element && className !== undefined ? `class ${inlineCode(className)}` : undefined,
    `package ${inlineCode(input.packageName)}`,
    superclass === undefined || superclass === 'HTMLElement'
      ? undefined
      : `extends ${inlineCode(superclass)}`,
  ].filter((fact) => fact !== undefined);
  const importLine =
    importPath === undefined
      ? undefined
      : fence(
          element
            ? `import "${input.packageName}/${importPath}";`
            : `import { ${className ?? input.tag} } from "${input.packageName}/${importPath}";`,
          'js',
        );
  return blocks(facts.join(' · '), importLine);
}

/**
 * Renders one declaration of a Custom Elements Manifest.
 *
 * `input.tag` is a tag name (`arcgis-map`) or, for the non-component modules a manifest also
 * describes, a class or function name. Properties, methods and events are members with their
 * own sections (events under `event-<name>`); slots and CSS custom properties are lists.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the manifest has no such declaration.
 */
export function renderCem(
  input: RendererInputs['cem'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const found = isRecord(input.manifest) ? findDeclaration(input.manifest, input.tag) : undefined;
  if (found === undefined) {
    throw invalidInput(
      'cem',
      meta,
      `the manifest of ${input.packageName} does not declare ${input.tag}`,
    );
  }
  const { declaration, module } = found;
  const element = declaration.customElement === true;
  const callable = declaration.kind === 'function';
  const demos = records(declaration.demos).flatMap((demo) => {
    const url = str(demo.url);
    return url === undefined ? [] : [`[${str(demo.description) ?? url}](${url})`];
  });
  const docs = documented(declaration);

  const type: ApiType = {
    title: element ? input.tag : (str(declaration.name) ?? input.tag),
    header: headerOf(declaration, module, input),
    language: 'ts',
    ...(callable ? { signature: `function ${manifestSignature(input.tag, declaration)}` } : {}),
    ...docs,
    see: [...docs.see, ...demos],
    members: membersOf(declaration),
    trailing: [
      ...listSection('Slots', declaration.slots, (name) =>
        name === '' ? '_default slot_' : inlineCode(name),
      ),
      ...listSection('CSS custom properties', declaration.cssProperties, inlineCode),
      ...listSection('CSS parts', declaration.cssParts, inlineCode),
      ...listSection('CSS states', declaration.cssStates, inlineCode),
    ],
  };
  return renderApiPage('cem', meta, type, opts, input.member);
}
