/**
 * Puts the pieces of a class back together. `@arcgis/core` splits one documented class over
 * several declarations of the same file:
 *
 * ```ts
 * export interface XProperties { ... }                      // constructor options
 * export default class X extends __XSansType { ... }
 * export abstract class __XSansType extends XSuperclass { ... }   // most members
 * declare const XSuperclass: typeof A & typeof B            // the real bases
 * ```
 */
import type { DtsDeclaration, DtsFile, DtsMember } from './scanner.js';

/** A class as documented, assembled from the declarations that make it up. */
export interface ClassView {
  name: string;
  /** The declaration that carries the class JSDoc. */
  declaration: DtsDeclaration;
  /** Own members: those of the class and of its `__XSansType` half. Inherited ones are not here. */
  members: DtsMember[];
  /** Names of the base classes and mixins. */
  bases: string[];
  /** `XProperties`: what the constructor accepts. */
  properties?: DtsDeclaration;
  /** `XEvents`: the event map of the class. */
  events?: DtsDeclaration;
  /** False when a body of the class could not be scanned to its end. */
  complete: boolean;
}

function named(
  file: DtsFile,
  name: string,
  kinds: ReadonlyArray<DtsDeclaration['kind']>,
): DtsDeclaration | undefined {
  return file.declarations.find(
    (declaration) => declaration.name === name && kinds.includes(declaration.kind),
  );
}

/** The identifier at the start of a heritage item (`Base<T>` gives `Base`). */
function baseName(item: string): string {
  return /^[\w$.]+/.exec(item)?.[0] ?? item;
}

/**
 * The bases of a class. A base that is a `declare const XSuperclass: typeof A & typeof B` in
 * the same file stands for the listed types; any other base is named as written.
 */
function resolveBases(file: DtsFile, items: readonly string[]): string[] {
  return items.flatMap((item) => {
    const mixed = named(file, baseName(item), ['const']);
    if (mixed === undefined) return [item];
    const types = [...mixed.text.matchAll(/typeof\s+([\w$.]+)/g)].map((match) => match[1] ?? '');
    return types.length > 0 ? types : [item];
  });
}

/** Builds the view of one class or interface declaration. */
export function classView(file: DtsFile, declaration: DtsDeclaration): ClassView {
  const name = declaration.name;
  // The public class is a thin shell over `__XSansType`, which holds the members.
  const half = declaration.extends
    .map((item) => named(file, baseName(item), ['class']))
    .find((candidate) => candidate?.name === `__${name}SansType`);
  const properties = named(file, `${name}Properties`, ['interface']);
  const events = named(file, `${name}Events`, ['interface']);
  return {
    name,
    declaration,
    members: [...declaration.members, ...(half?.members ?? [])],
    bases: resolveBases(file, half?.extends ?? declaration.extends),
    ...(properties === undefined || properties === declaration ? {} : { properties }),
    ...(events === undefined || events === declaration ? {} : { events }),
    complete: declaration.bodyParsed && (half?.bodyParsed ?? true),
  };
}

/** The class a file is about: its `export default class`, if it has one. */
export function defaultClass(file: DtsFile): DtsDeclaration | undefined {
  return file.declarations.find(
    (declaration) => declaration.kind === 'class' && declaration.isDefault,
  );
}

/** Declarations that are part of the module's public surface, in source order. */
export function publicExports(file: DtsFile): DtsDeclaration[] {
  return file.declarations.filter(
    (declaration) =>
      declaration.exported &&
      declaration.name !== '' &&
      declaration.kind !== 'export' &&
      declaration.kind !== 'import' &&
      // Implementation halves and helper constants of the class split are not API.
      !declaration.name.startsWith('__'),
  );
}

/**
 * Finds the raw text of a member when the class body could not be scanned: from the JSDoc
 * that precedes the first declaration of `name` to the start of the next doc comment.
 * `undefined` when no line declares the name.
 */
export function rawMemberText(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^[ \\t]*(?:(?:public|protected|static|readonly|abstract|accessor|get|set)\\s+)*(?:["']${escaped}["']|${escaped})\\s*[?!]?\\s*[(:<;]`,
    'm',
  );
  const text = source.replace(/\r\n?/g, '\n');
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const before = text.slice(0, match.index);
  const docStart = before.lastIndexOf('/**');
  // The comment belongs to the member only when nothing but whitespace separates them.
  const comment = docStart === -1 ? '' : before.slice(docStart).trimEnd();
  const attached = comment.endsWith('*/') && comment.indexOf('*/') === comment.length - 2;
  const start = attached ? docStart : match.index;
  const next = text.indexOf('/**', match.index + match[0].length);
  return text.slice(start, next === -1 ? text.length : next).trim();
}
