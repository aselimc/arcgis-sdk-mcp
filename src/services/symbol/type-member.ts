/**
 * Members of a type whose source lists types only. A package typings source indexes one
 * record per module, and a class page of some references has its members as headings: the
 * member is then found at read time, by asking the adapter for the type's page with the
 * member selected and checking the member list the renderer reports.
 */
import type { CatalogRecord, DocPage, MemberEntry } from '../../core/types.js';
import { simpleName } from '../index/symbol-map.js';
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
  return { record: memberRecord(type, member), step: 'member', rank: [1, 0, 0, 0], twins: [] };
}

/** The entry of `member` in the member list of a rendered type page; case decides only ties. */
export function memberEntry(page: DocPage, member: string): MemberEntry | undefined {
  const members = page.members ?? [];
  const lower = member.toLowerCase();
  return (
    members.find((entry) => entry.name === member || entry.id === member) ??
    members.find((entry) => entry.name.toLowerCase() === lower)
  );
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
