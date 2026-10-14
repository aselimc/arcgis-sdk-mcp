/**
 * Typings that live in one global namespace instead of one file per module.
 *
 * `@arcgis/core` 4.x publishes a single `interfaces.d.ts` holding `declare namespace __esri`
 * with every class of the SDK; the per-module files only alias into it:
 *
 * ```ts
 * import "../interfaces";
 * import FeatureLayer = __esri.FeatureLayer;
 * export default FeatureLayer;
 * ```
 *
 * A class is spread over three sibling declarations of the namespace: an interface that
 * names its bases, the class with its members, and the options of its constructor. They are
 * cut out and written as the module the 5.x typings would have had, which is the shape the
 * declaration renderer reads. Older 4.x releases have no `class` at all: an interface holds
 * the members and a `<Name>Constructor` interface the construct signature; that is read as
 * the same class.
 */

/** What a per-module stub points at. */
export interface NamespaceAlias {
  /** The file that declares the namespace, relative to the package root. */
  file: string;
  namespace: string;
  /** The aliased declaration: `FeatureLayer` in `__esri.FeatureLayer`. */
  name: string;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SIDE_EFFECT_IMPORT = /^\s*import\s+["']([^"']+)["']\s*;?\s*$/m;
const ALIAS = /^\s*import\s+([\w$]+)\s*=\s*([\w$]+)\.([\w$]+)\s*;?\s*$/m;
/**
 * A module that exports an instance instead of a class (`identity/IdentityManager`):
 * `declare const IdentityManager: __esri.IdentityManager;` followed by `export default
 * IdentityManager;`. The class of the instance is what documents the module.
 */
const INSTANCE = /^\s*declare\s+const\s+([\w$]+)\s*:\s*([\w$]+)\.([\w$]+)\s*;?\s*$/m;
const OWN_DECLARATION =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|function|namespace)\s/m;

/** Resolves a relative import specifier against the directory of the importing file. */
function resolveImport(fromFile: string, specifier: string): string | undefined {
  const segments = fromFile.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part !== '..') segments.push(part);
    else if (segments.pop() === undefined) return undefined;
  }
  const path = segments.join('/');
  return path === '' ? undefined : path.replace(/(?:\.d\.ts|\.js|\.ts)?$/, '.d.ts');
}

/**
 * The namespace declaration a module file is an alias of, or `undefined` for a file that
 * declares its API itself.
 *
 * @param file the module file, relative to the package root (`layers/FeatureLayer.d.ts`).
 */
export function namespaceAlias(source: string, file: string): NamespaceAlias | undefined {
  const instance = INSTANCE.exec(source);
  const exportsInstance =
    instance?.[1] !== undefined &&
    new RegExp(`^\\s*export\\s+default\\s+${escapeRegExp(instance[1])}\\s*;?\\s*$`, 'm').test(
      source,
    );
  const alias = ALIAS.exec(source) ?? (exportsInstance ? instance : null);
  const imported = SIDE_EFFECT_IMPORT.exec(source)?.[1];
  if (alias?.[2] === undefined || alias[3] === undefined || imported === undefined) {
    return undefined;
  }
  // A stub holds nothing else: a file with declarations of its own is read as it is.
  if (OWN_DECLARATION.test(source)) return undefined;
  const target = imported.startsWith('.') ? resolveImport(file, imported) : undefined;
  return target === undefined ? undefined : { file: target, namespace: alias[2], name: alias[3] };
}

interface Block {
  /** Text between the declared name and the opening brace: type parameters and heritage. */
  heritage: string;
  /** The lines between the braces, with the namespace indentation removed. */
  body: string;
}

/**
 * A `class` or `interface` declared directly inside the namespace. Declarations there are
 * indented by one level, so the block ends at the first closing brace at that indentation.
 */
function block(text: string, keyword: 'class' | 'interface', name: string): Block | undefined {
  const head = new RegExp(
    `^([ \\t]+)(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?${keyword}\\s+${escapeRegExp(name)}(?![\\w$])([^{\\n]*)\\{[ \\t]*$`,
    'm',
  ).exec(text);
  if (head?.[1] === undefined) return undefined;
  const indent = head[1];
  const bodyStart = head.index + head[0].length + 1;
  const close = new RegExp(`^${indent}\\}`, 'm').exec(text.slice(bodyStart));
  if (close === null) return undefined;
  const body = text
    .slice(bodyStart, bodyStart + close.index)
    .split('\n')
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n')
    .trimEnd();
  return { heritage: (head[2] ?? '').trim(), body };
}

/** `extends A, B<T>` as the list `['A', 'B<T>']`; commas inside type arguments do not split. */
function heritageList(heritage: string): string[] {
  const list = /\bextends\s+(.*)$/.exec(heritage)?.[1] ?? '';
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '<') depth += 1;
    if (char === '>') depth -= 1;
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else current += char;
  }
  items.push(current.trim());
  return items.filter((item) => item !== '');
}

const declaration = (head: string, body: string): string => `${head} {\n${body}\n}`;

/** `new(properties?: MapViewProperties): MapView;`, a construct signature. */
const CONSTRUCT_SIGNATURE = /^(\s*)new\s*(\(.*\))\s*:\s*[^;]+;\s*$/;
/** The first line of a member declared at the top level of a block body (two spaces in). */
const MEMBER_START = /^ {2}(?=[\w$])/;

/**
 * A class of the older 4.x layout, which has no `class` at all: the members are on an
 * interface, and what makes it a class is a second interface with a construct signature
 * and a constant of that type,
 *
 * ```ts
 * interface MapView extends View { ... }
 * interface MapViewConstructor { new(properties?: MapViewProperties): MapView; fromJSON(json: any): MapView; }
 * export const MapView: MapViewConstructor;
 * ```
 *
 * Read as the class it stands for: the construct signature becomes the constructor and the
 * other members of the constructor interface are static. Without this, a class of those
 * releases came out as an interface of an unnamed module, imported from the package root
 * that those releases do not have.
 *
 * @returns `undefined` when `name` has no constructor interface with a construct signature.
 */
function constructedClass(
  text: string,
  name: string,
  merged: Block | undefined,
): Block | undefined {
  if (merged === undefined) return undefined;
  const ctor = block(text, 'interface', `${name}Constructor`);
  if (ctor === undefined) return undefined;
  let constructs = false;
  const statics = ctor.body.split('\n').map((line) => {
    const signature = CONSTRUCT_SIGNATURE.exec(line);
    if (signature !== null) {
      constructs = true;
      return `${signature[1] ?? ''}constructor${signature[2] ?? '()'};`;
    }
    return MEMBER_START.test(line) ? line.replace(MEMBER_START, '  static ') : line;
  });
  if (!constructs) return undefined;
  // The heritage is the interface's; the caller reads it from there.
  return { heritage: '', body: `${statics.join('\n')}\n${merged.body}` };
}

/**
 * Writes the module of one class from the namespace file.
 *
 * @param interfaces the text of the file that declares the namespace.
 * @returns the module source, or `undefined` when the namespace declares no class or
 *   interface of that name (the stub is then shown as it is).
 */
export function moduleFromNamespace(interfaces: string, name: string): string | undefined {
  const text = interfaces.replace(/\r\n?/g, '\n');
  const merged = block(text, 'interface', name);
  const cls = block(text, 'class', name) ?? constructedClass(text, name, merged);
  if (cls === undefined) {
    // A module that is an object of functions is declared as an interface only.
    if (merged === undefined) return undefined;
    const heritage = merged.heritage === '' ? '' : ` ${merged.heritage}`;
    return `${declaration(`export interface ${name}${heritage}`, merged.body)}\n`;
  }
  const bases = [...heritageList(cls.heritage), ...heritageList(merged?.heritage ?? '')];
  const parts: string[] = [];
  const options = block(text, 'interface', `${name}Properties`);
  if (options !== undefined) {
    const heritage = options.heritage === '' ? '' : ` ${options.heritage}`;
    parts.push(declaration(`export interface ${name}Properties${heritage}`, options.body));
  }
  if (bases.length > 0) {
    // The renderer reads the bases of a class from a constant of this form.
    const types = bases.map((base) => `typeof ${base.replace(/<.*$/, '')}`).join(' & ');
    parts.push(`declare const ${name}Superclass: ${types};`);
  }
  const heritage = bases.length > 0 ? ` extends ${name}Superclass` : '';
  parts.push(declaration(`export default class ${name}${heritage}`, cls.body));
  return `${parts.join('\n\n')}\n`;
}
