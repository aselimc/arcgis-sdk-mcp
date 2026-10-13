/**
 * Members of a type that the catalogue does not hold under that type. A package typings
 * source indexes one record per module; a reference indexes an inherited member once, under
 * the type that declares it, although the page of the inheriting type documents it too; a
 * page-per-type reference has its members as headings or as rows of a property table. The
 * member is then found at read time, on the page of the type.
 */
import type { CatalogRecord, DocPage, DocSection, MemberEntry } from '../../core/types.js';
import { memberHeading } from '../doc/section-resolve.js';
import { endsWithSegment, simpleName } from '../index/symbol-map.js';
import { displayName, type Candidate } from './resolve.js';

/**
 * The record of `member` on `type`, as the catalogue would hold it had the source listed
 * members: same page, the member as fragment, the type as `parent`.
 */
export function memberRecord(type: CatalogRecord, member: string): CatalogRecord {
  const owner = displayName(type);
  return {
    ...type,
    ref: `${type.ref.split('#')[0] ?? type.ref}#${member}`,
    title: member,
    symbol: member,
    qualified: `${owner}.${member}`,
    parent: owner,
    symbolKind: 'member',
  };
}

/** The candidate that reads {@link memberRecord} through the type's own source. */
export function memberCandidate(type: CatalogRecord, member: string): Candidate {
  return { record: memberRecord(type, member), step: 'member', rank: [1, 0, 0, 0, 0], twins: [] };
}

/** The owner a member entry states through its id (`pkg.Class.add` gives `pkg.Class`). */
function statedOwner(entry: MemberEntry): string | undefined {
  const suffix = `.${entry.name}`;
  return entry.id.endsWith(suffix) ? entry.id.slice(0, -suffix.length) : undefined;
}

/**
 * The entry of `member` in the member list of a rendered type page; case decides only ties.
 *
 * A page can list the members of several types (a Sphinx module page lists every class of
 * the module, and many of them have an `add`). With `owner`, an entry that states another
 * owner is then not the answer: returning the first `add` of the page under the name that
 * was asked for would document one class as another.
 */
export function memberEntry(
  page: DocPage,
  member: string,
  owner?: CatalogRecord,
): MemberEntry | undefined {
  const members = page.members ?? [];
  const lower = member.toLowerCase();
  const exact = members.filter((entry) => entry.name === member || entry.id === member);
  const pool =
    exact.length > 0 ? exact : members.filter((entry) => entry.name.toLowerCase() === lower);
  // Entries that state different owners mean the page documents several types.
  const owners = new Set(members.map(statedOwner).filter((stated) => stated !== undefined));
  if (owner === undefined || owners.size <= 1) return pool[0];
  const wanted = displayName(owner);
  return pool.find((entry) => {
    const stated = statedOwner(entry);
    return (
      stated === undefined || endsWithSegment(stated, wanted) || endsWithSegment(wanted, stated)
    );
  });
}

/** The names under which a page lists `member` when several types of the page have one. */
export function memberOwners(page: DocPage, member: string): string[] {
  const lower = member.toLowerCase();
  const owners = (page.members ?? [])
    .filter((entry) => entry.name.toLowerCase() === lower)
    .map((entry) => {
      const stated = statedOwner(entry);
      return stated === undefined ? undefined : `${stated}.${entry.name}`;
    })
    .filter((name) => name !== undefined);
  return [...new Set(owners)];
}

const TABLE_ROW = /^\|(.+)\|\s*$/;

/** A table cell as plain text: no code ticks, no link target, no array or optional marker. */
function cellName(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\[\]|\?$/g, '')
    .trim();
}

/** The row of a property table whose first cell names `member`, as a member entry. */
function tableMember(sections: readonly DocSection[], member: string): MemberEntry | undefined {
  const lower = member.toLowerCase();
  for (const section of sections) {
    for (const line of section.markdown.split('\n')) {
      const cells = TABLE_ROW.exec(line)?.[1]?.split(/(?<!\\)\|/) ?? [];
      const [first = '', ...rest] = cells;
      const name = cellName(first);
      if (name.toLowerCase() !== lower || rest.length === 0) continue;
      const summary = rest
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .join(' ');
      return { id: name, name, kind: 'property', ...(summary === '' ? {} : { summary }) };
    }
  }
  return undefined;
}

/**
 * The member of a type page that reports no such member in its member list: the section
 * headed `<Type>.<member> Method` (page-per-type references such as the Enterprise SDK), or
 * the row of a property table (specification objects). `undefined` when the page has neither.
 */
export function memberOnPage(page: DocPage, member: string): MemberEntry | undefined {
  const heading = memberHeading(page.sections, member);
  if (heading !== undefined) {
    return { id: heading.id, name: member, kind: 'member' };
  }
  return tableMember(page.sections, member);
}

/** The simple name of the type that owns a member record. */
export function ownerName(record: CatalogRecord): string {
  const owner = record.parent ?? '';
  return owner.split(/::|[.#/]/).at(-1) ?? owner;
}

/** True when `record` is a type with the given simple name. */
export function isTypeNamed(record: CatalogRecord, name: string): boolean {
  return record.parent === undefined && simpleName(record) === name;
}
