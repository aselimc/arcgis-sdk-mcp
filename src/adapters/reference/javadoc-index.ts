/**
 * Readers for the index files of a javadoc site. Since JDK 9 the search box is fed by
 * script files that assign one JSON array each (`typeSearchIndex = [...]`); the frame-based
 * output of JDK 8 has only `allclasses-noframe.html`, a list of links. URLs are composed the
 * way javadoc's own `search.js` composes them.
 */
import type { BoundSource } from '../../core/ports.js';
import type { CatalogRecord } from '../../core/types.js';
import { symbolRecord } from '../kit/index.js';

/** How javadoc names the package of a class declared without one. */
const UNNAMED_PACKAGE = '<Unnamed>';

const BARE_KEY = /[A-Za-z_$][\w$]*(?=\s*:)/y;
const TRAILING_COMMA = /,(?=\s*[}\]])/y;

/**
 * Rewrites a JavaScript literal of plain data as JSON: property names get quotes, single
 * quotes become double quotes and trailing commas go. Sites that run their generated files
 * through a code formatter publish search indexes in this form. Strings are copied as they
 * are, so a label such as `"put(K key, V value)"` is never mistaken for a property.
 */
function literalToJson(literal: string): string {
  const out: string[] = [];
  let at = 0;
  while (at < literal.length) {
    const char = literal.charAt(at);
    if (char === '"' || char === "'") {
      let end = at + 1;
      let body = '';
      while (end < literal.length && literal.charAt(end) !== char) {
        const piece = literal.charAt(end);
        if (piece === '\\') {
          const escaped = literal.charAt(end + 1);
          // An escaped apostrophe is JavaScript only; every other escape is kept for JSON.
          body += escaped === "'" ? "'" : `\\${escaped}`;
          end += 2;
        } else {
          body += piece === '"' ? '\\"' : piece;
          end += 1;
        }
      }
      out.push(`"${body}"`);
      at = end + 1;
      continue;
    }
    BARE_KEY.lastIndex = at;
    const key = BARE_KEY.exec(literal)?.[0];
    if (key !== undefined) {
      out.push(`"${key}"`);
      at += key.length;
      continue;
    }
    TRAILING_COMMA.lastIndex = at;
    if (!TRAILING_COMMA.test(literal)) out.push(char);
    at += 1;
  }
  return out.join('');
}

/**
 * The array a search-index script assigns: `memberSearchIndex = [...];updateSearchResults();`.
 * The text between the first `[` and the last `]` is JSON as javadoc writes it, or a
 * JavaScript literal after a formatter has been over it; either way nothing is evaluated.
 *
 * @returns `undefined` when the script holds no parseable array.
 */
export function parseSearchIndex(script: string): unknown[] | undefined {
  const start = script.indexOf('[');
  const end = script.lastIndexOf(']');
  if (start < 0 || end <= start) return undefined;
  const literal = script.slice(start, end + 1);
  for (const text of [() => literal, () => literalToJson(literal)]) {
    try {
      const data: unknown = JSON.parse(text());
      return Array.isArray(data) ? (data as unknown[]) : undefined;
    } catch {
      // Not JSON in this form; the next one is tried.
    }
  }
  return undefined;
}

/** A search-index entry: `p` package, `c` class, `l` label, `m` module, `u` explicit URL or anchor. */
type IndexEntry = Partial<Record<'p' | 'c' | 'l' | 'm' | 'u', unknown>> | null;

/** Module of each package, from `package-search-index.js`; empty for a site without modules. */
export function packageModules(entries: readonly unknown[]): Map<string, string> {
  const modules = new Map<string, string>();
  for (const entry of entries as readonly IndexEntry[]) {
    if (typeof entry?.l === 'string' && typeof entry.m === 'string') modules.set(entry.l, entry.m);
  }
  return modules;
}

/** Page of a type relative to the site root: `[module/]com/example/Outer.Inner.html`. */
function typePath(pkg: string, type: string, modules: ReadonlyMap<string, string>): string {
  const module = modules.get(pkg);
  const directory = pkg === UNNAMED_PACKAGE ? '' : `${pkg.replace(/\./g, '/')}/`;
  return `${module === undefined ? '' : `${module}/`}${directory}${type}.html`;
}

function qualify(pkg: string, name: string): string {
  return pkg === UNNAMED_PACKAGE ? name : `${pkg}.${name}`;
}

/**
 * Records of `type-search-index.js`. The index does not say whether a type is a class, an
 * interface or an enum, so the kind is `type`; a nested type (`Outer.Inner`) is a member of
 * its outer type. Entries without a package (the "All Classes" link) are skipped.
 */
export function javadocTypeRecords(
  src: BoundSource,
  entries: readonly unknown[],
  modules: ReadonlyMap<string, string>,
): CatalogRecord[] {
  const base = src.url();
  const records = new Map<string, CatalogRecord>();
  for (const entry of entries as readonly IndexEntry[]) {
    const { p: pkg, l: name, u: explicit } = entry ?? {};
    if (typeof pkg !== 'string' || typeof name !== 'string' || name === '') continue;
    const path = typeof explicit === 'string' ? explicit : typePath(pkg, name, modules);
    const ref = new URL(path, base).href;
    if (records.has(ref)) continue;
    const outer = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : undefined;
    records.set(
      ref,
      symbolRecord(src, ref, name, {
        symbol: name.split('.').at(-1),
        qualified: qualify(pkg, name),
        symbolKind: 'type',
        parent: outer === undefined ? undefined : qualify(pkg, outer),
        breadcrumb: [pkg === UNNAMED_PACKAGE ? '' : pkg, ...(outer === undefined ? [] : [outer])],
      }),
    );
  }
  return [...records.values()];
}

/**
 * Records of `member-search-index.js`. The ref carries the member's anchor exactly as the
 * index gives it (`u`, else the label), which is the element id on the class page and the
 * only thing that tells overloads apart. A label with parentheses is a method, or a
 * constructor when it is named like its class; anything else is a field or enum constant.
 */
export function javadocMemberRecords(
  src: BoundSource,
  entries: readonly unknown[],
  modules: ReadonlyMap<string, string>,
): CatalogRecord[] {
  const base = src.url();
  const records = new Map<string, CatalogRecord>();
  for (const entry of entries as readonly IndexEntry[]) {
    const { p: pkg, c: type, l: label, u: anchor } = entry ?? {};
    if (typeof pkg !== 'string' || typeof type !== 'string' || typeof label !== 'string') continue;
    if (type === '' || label === '') continue;
    const fragment = typeof anchor === 'string' && anchor !== '' ? anchor : label;
    const ref = new URL(`${typePath(pkg, type, modules)}#${fragment}`, base).href;
    if (records.has(ref)) continue;
    const name = label.replace(/\(.*$/s, '');
    const callable = label.includes('(');
    const parent = qualify(pkg, type);
    records.set(
      ref,
      symbolRecord(src, ref, `${type}.${label}`, {
        symbol: name,
        qualified: `${parent}.${name}`,
        symbolKind: !callable
          ? 'field'
          : name === type.split('.').at(-1)
            ? 'constructor'
            : 'method',
        parent,
        breadcrumb: [pkg === UNNAMED_PACKAGE ? '' : pkg, type],
      }),
    );
  }
  return [...records.values()];
}

/** One link of the JDK 8 class list: `<a href="com/example/Thing.html" title="class in com.example">`. */
const CLASS_LINK =
  /<a\s[^>]*?href="([^"#?]+\.html)"[^>]*?title="(class|interface|enum|annotation)\s+in\s+([^"]+)"[^>]*>(?:\s*<[^>]+>)*\s*([^<\s][^<]*)/gi;

/**
 * Records of `allclasses-noframe.html`, the only index of a JDK 8 javadoc site. Each link
 * states the kind and package of its type; members are not listed anywhere, so a legacy site
 * is catalogued by type only.
 */
export function javadocLegacyRecords(src: BoundSource, html: string): CatalogRecord[] {
  const base = src.url();
  const records = new Map<string, CatalogRecord>();
  for (const [, href = '', kind = '', pkg = '', text = ''] of html.matchAll(CLASS_LINK)) {
    const name = text.trim();
    const ref = new URL(href, base).href;
    if (name === '' || !ref.startsWith(base) || records.has(ref)) continue;
    records.set(
      ref,
      symbolRecord(src, ref, name, {
        symbol: name.split('.').at(-1),
        qualified: `${pkg}.${name}`,
        symbolKind: kind.toLowerCase(),
        breadcrumb: [pkg],
      }),
    );
  }
  return [...records.values()];
}
