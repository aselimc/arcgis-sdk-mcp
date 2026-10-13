/**
 * Symbol resolution (design section 3.6). The input is normalised and tried, in order, as an
 * exact qualified name, an exact simple name, the longest known type plus a member, the same
 * without case, then fuzzily (prefix, edit distance at most 2). The first step that finds
 * anything decides; ranking inside it is types before members, the product order, then the
 * source order (core package first), then how well the written qualifier fits, and last a
 * declared class before a type alias or an internal namespace of the same name.
 */
import { levenshtein } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { CatalogRecord } from '../../core/types.js';
import { pageKey } from '../../core/url.js';
import {
  MAX_SYMBOL_DISTANCE,
  endsWithSegment,
  simpleName,
  type SymbolMap,
} from '../index/symbol-map.js';

/** The step of the resolution table that produced a candidate, most exact first. */
export const STEPS = ['qualified', 'simple', 'member', 'case-insensitive', 'fuzzy'] as const;

/** One of {@link STEPS}. */
export type Step = (typeof STEPS)[number];

/** The symbols of one product line, with the product's place in the scope. */
export interface SymbolScope {
  product: string;
  /** Position of the product in the scope; lower is preferred. */
  productRank: number;
  symbols: Pick<SymbolMap, 'exact' | 'members' | 'fuzzy'>;
  /** Rank of a record's source inside the product; lower is preferred. */
  sourceRank(record: CatalogRecord): number;
}

/**
 * Sort key of a candidate: member after type, then product, then source, then the distance
 * of a fuzzy match or of the written qualifier, then {@link preference}.
 */
export type Rank = [member: number, product: number, source: number, distance: number, preference: number];

/** A record that may be what the caller meant. */
export interface Candidate {
  record: CatalogRecord;
  step: Step;
  rank: Rank;
  /** The same symbol in other sources of the product, best first: fallbacks for reading it. */
  twins: CatalogRecord[];
}

/** Outcome of {@link resolveSymbol}. */
export type Resolution =
  | { kind: 'found'; winner: Candidate; alternates: Candidate[] }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'none'; knownType?: CatalogRecord };

/** Most candidates listed by an ambiguous result. */
export const MAX_AMBIGUOUS = 8;
/** Most alternates listed next to a winner. */
export const MAX_ALTERNATES = 3;

/** The name a candidate is shown and looked up by. */
export function displayName(record: CatalogRecord): string {
  return record.qualified ?? simpleName(record);
}

/** A candidate for a record that was not found by {@link resolveSymbol} itself. */
export function candidateOf(record: CatalogRecord, step: Step): Candidate {
  return { record, step, rank: [isType(record) ? 0 : 1, 0, 0, 0, 0], twins: [] };
}

function isType(record: CatalogRecord): boolean {
  return record.parent === undefined;
}

/** A namespace segment that marks implementation detail, not public API. */
const INTERNAL_SEGMENT = /(?:^|[.#/:])_?internal(?:[.#/:]|$)/i;

/**
 * Tie-breaker between records that are otherwise equally good answers. A type alias that
 * shares its name with a class (`portal/jsonTypes/Point` next to `geometry/Point`) is what
 * the caller meant far less often, and so is a namesake in an `Internal` namespace.
 */
function preference(record: CatalogRecord): number {
  const alias = record.symbolKind === 'type' ? 1 : 0;
  return alias + (INTERNAL_SEGMENT.test(record.qualified ?? '') ? 2 : 0);
}

/**
 * REST operations of different services are peers: `generateToken` of ArcGIS Server is no
 * better an answer than the one of the portal because its source is listed first. The source
 * order ranks packages of one API (core before components), not services.
 */
function peerSources(record: CatalogRecord): boolean {
  return record.symbolKind === 'operation';
}

/** How exactly a record returned for `joined` matches it. */
function directStep(record: CatalogRecord, joined: string, qualified: boolean): Step {
  if (record.qualified === joined) return 'qualified';
  if (qualified) {
    return endsWithSegment(record.qualified ?? '', joined) ? 'simple' : 'case-insensitive';
  }
  return simpleName(record) === joined ? 'simple' : 'case-insensitive';
}

/** What `Type.member` found: the members, or the type it names when it has no such member. */
interface TypeMembers {
  found: Array<{ record: CatalogRecord; step: Step }>;
  /** The type written directly before the member, when it is known as written. */
  type?: CatalogRecord;
  /** The same, when it is known only without regard to case. */
  loose?: CatalogRecord;
}

/**
 * Members named by `Type.member`, trying the longest type prefix first. Only the part
 * directly before the member can be its owner: a shorter prefix that names a module
 * (`arcgis.gis` in `arcgis.gis.Folder.add`) says where to look, not which type has the member.
 */
function typeMembers(parts: readonly string[], scope: SymbolScope): TypeMembers {
  const result: TypeMembers = { found: [] };
  for (let split = parts.length - 1; split >= 1; split--) {
    const typeName = parts.slice(0, split).join('.');
    const memberName = parts.slice(split).join('.');
    const types = scope.symbols.exact(typeName).filter(isType);
    if (types.length === 0) continue;
    const found: Array<{ record: CatalogRecord; step: Step }> = [];
    let exactType: CatalogRecord | undefined;
    for (const type of types) {
      const members = scope.symbols.members(displayName(type));
      const exact = members.filter((member) => simpleName(member) === memberName);
      const loose = members.filter(
        (member) => simpleName(member).toLowerCase() === memberName.toLowerCase(),
      );
      const typeExact = endsWithSegment(displayName(type), typeName);
      if (typeExact) exactType ??= type;
      for (const record of exact.length > 0 ? exact : loose) {
        found.push({ record, step: exact.length > 0 && typeExact ? 'member' : 'case-insensitive' });
      }
    }
    if (found.length > 0) return { ...result, found };
    if (split === parts.length - 1) {
      // A directory of a module path can equal a class name but for its case
      // (`widgets/LayerList` and the class `Widgets`): that is kept apart from a real owner.
      if (exactType !== undefined) result.type ??= exactType;
      else if (types[0] !== undefined) result.loose ??= types[0];
    }
  }
  return result;
}

function fuzzyDistance(needle: string, record: CatalogRecord): number {
  const name = simpleName(record).toLowerCase();
  if (name.startsWith(needle)) return 0;
  return levenshtein(needle, name, MAX_SYMBOL_DISTANCE);
}

/** Members considered when a written type has to pick one of many same-named members. */
const OWNER_SCAN = 64;

/** Shortest owner or hint that may match the other as a prefix or suffix. */
const MIN_AFFIX_LENGTH = 4;

/** Distance of a qualifier that names the record's owner but not the path it lives on. */
const SAME_OWNER = 0.5;

/** Distance of a qualifier that fits the record's owner only loosely (`esriConfig` for `config`). */
const LOOSE_QUALIFIER = 1;

/** Distance of a qualifier that names something else. */
const WRONG_QUALIFIER = MAX_SYMBOL_DISTANCE + 1;

const SEPARATORS = /::|[.#/]/;

/**
 * What stands before a record's own name, lower-case, outermost first: the segments of its
 * qualified name, else of its owner. A record that carries neither (a REST operation of the
 * portal) is placed by the last entry of its breadcrumb.
 */
function ownSegments(record: CatalogRecord): string[] {
  const path = record.qualified ?? (record.parent === undefined ? '' : `${record.parent}.x`);
  const segments = path
    .toLowerCase()
    .split(SEPARATORS)
    .filter((segment) => segment !== '')
    .slice(0, -1);
  if (segments.length > 0 || record.breadcrumb === undefined) return segments;
  const last = record.breadcrumb.split(/\s+>\s+/).at(-1) ?? '';
  const squashed = last.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return squashed === '' ? [] : [squashed];
}

function isSubsequence(written: readonly string[], segments: readonly string[]): boolean {
  let position = 0;
  for (const segment of segments) {
    if (segment === written[position]) position += 1;
  }
  return position === written.length;
}

/**
 * How far the qualifier a caller wrote is from where a record lives: 0 when every written
 * part is part of the record's path in order (`arcgis.gis.Folder.add` for
 * `arcgis.gis._impl._content_manager.Folder.add`), {@link SAME_OWNER} when only the owner
 * is the same, the edit distance of a misspelt owner,
 * {@link LOOSE_QUALIFIER} when the written owner contains or abbreviates the real one
 * (`esriConfig.apiKey`, `gis.content.add` for `ContentManager.add`), else
 * {@link WRONG_QUALIFIER}. A record that says nothing about where it lives is not affected.
 *
 * @param written the parts before the name, lower-case; empty when the input was unqualified.
 */
function qualifierDistance(written: readonly string[], record: CatalogRecord): number {
  const hint = written.at(-1);
  if (hint === undefined) return 0;
  const segments = ownSegments(record);
  const owner = segments.at(-1);
  if (owner === undefined) return 0;
  if (isSubsequence(written, segments)) return 0;
  // The owner as written, reached by another path than the record's (`layers/TideLayer`
  // for `pkg/TideLayer`): still that type, behind one whose whole path fits.
  if (hint === owner) return SAME_OWNER;
  const typo = levenshtein(hint, owner, MAX_SYMBOL_DISTANCE);
  if (typo <= MAX_SYMBOL_DISTANCE) return Math.max(LOOSE_QUALIFIER, typo);
  if (hint.length >= MIN_AFFIX_LENGTH && owner.length >= MIN_AFFIX_LENGTH) {
    // A property that holds a manager is named after it in the plural: `users`, `UserManager`.
    const singular = hint.endsWith('s') ? hint.slice(0, -1) : hint;
    if (
      hint.endsWith(owner) ||
      owner.endsWith(hint) ||
      owner.startsWith(hint) ||
      (singular.length >= MIN_AFFIX_LENGTH && owner.startsWith(singular))
    ) {
      return LOOSE_QUALIFIER;
    }
  }
  return WRONG_QUALIFIER;
}

function compare(a: Candidate, b: Candidate): number {
  for (let position = 0; position < a.rank.length; position++) {
    const difference = (a.rank[position] ?? 0) - (b.rank[position] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** What makes two records the same name to a caller: product, name and owning type. */
function identityOf(record: CatalogRecord): string {
  return `${record.product}\n${displayName(record)}\n${record.parent ?? ''}`;
}

/**
 * True when two same-named records of one source are documented on different pages. They
 * are then two declarations (the Arcade `Intersects` of geometries and the one of feature
 * sets, the overloads of a DocC method), not one symbol seen twice.
 */
function isNamesake(a: CatalogRecord, b: CatalogRecord): boolean {
  return a.source === b.source && pageKey(a.ref) !== pageKey(b.ref);
}

/**
 * Merges records that are the same symbol of the same product seen through several sources,
 * or overloads on one page. Namesakes (see {@link isNamesake}) stay candidates of their own,
 * next to each other.
 */
function mergeTwins(candidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate[]>();
  for (const candidate of [...candidates].sort(compare)) {
    const { record } = candidate;
    const group = merged.get(identityOf(record)) ?? [];
    merged.set(identityOf(record), group);
    const first = group.find((known) => !isNamesake(known.record, record));
    if (first === undefined) group.push(candidate);
    else if (first.record.ref !== record.ref || first.record.source !== record.source) {
      first.twins.push(record);
    }
  }
  // Stable: groups in the order of their best candidate, which the sort above fixed.
  return [...merged.values()].flat().sort(compare);
}

/**
 * Resolves `input` against the symbols of the given product lines.
 *
 * - `found`: one candidate ranks strictly before every other, or ties only with other
 *   declarations of its own name, which are then the first alternates.
 * - `ambiguous`: several rank equally; the winner and those that tie with it are returned,
 *   at most {@link MAX_AMBIGUOUS}.
 * - `none`: nothing matched; when `Type.member` named a known type without such a member,
 *   that type is returned.
 */
export function resolveSymbol(input: string, scopes: readonly SymbolScope[]): Resolution {
  const { parts, simple } = normalizeSymbol(input);
  if (simple === '') return { kind: 'none' };
  const joined = parts.join('.');
  const qualified = parts.length > 1;

  const all: Candidate[] = [];
  let knownType: CatalogRecord | undefined;
  let looseType: CatalogRecord | undefined;
  const add = (scope: SymbolScope, record: CatalogRecord, step: Step, distance = 0): void => {
    all.push({
      record,
      step,
      rank: [
        isType(record) ? 0 : 1,
        scope.productRank,
        peerSources(record) ? 0 : scope.sourceRank(record),
        distance,
        preference(record),
      ],
      twins: [],
    });
  };

  for (const scope of scopes) {
    // The whole name first: `widgets/LayerList` is a module before `widgets` is read as the
    // class `Widgets` with a member `LayerList`.
    for (const record of scope.symbols.exact(joined)) {
      add(scope, record, directStep(record, joined, qualified));
    }
    if (qualified) {
      const viaType = typeMembers(parts, scope);
      knownType ??= viaType.type;
      looseType ??= viaType.loose;
      for (const { record, step } of viaType.found) add(scope, record, step);
    }
  }

  // What stands before the name when it is not a known type: a module path, or a type that
  // is misspelt, abbreviated or qualified differently. It cannot select a member by itself,
  // but it says which of several same-named symbols was meant.
  const written =
    knownType === undefined ? parts.slice(0, -1).map((part) => part.toLowerCase()) : [];

  if (all.length === 0 && qualified && knownType === undefined) {
    for (const scope of scopes) {
      for (const record of scope.symbols.exact(simple)) {
        // Behind a prefix that is a type but for its case, only a type can be meant
        // (`geometry/Point`); a member would be one that the type inherits (`mapview.when`).
        if (looseType !== undefined && !isType(record)) continue;
        const distance = qualifierDistance(written, record);
        // A qualifier that fits is an exact reading; one that does not makes the match a guess
        // that the answer has to own up to.
        const fits = distance < LOOSE_QUALIFIER;
        const step = fits ? directStep(record, simple, false) : 'case-insensitive';
        add(scope, record, step, distance);
      }
    }
  }
  if (all.length === 0) knownType ??= looseType;

  let step = STEPS.find((candidate) => all.some((entry) => entry.step === candidate));
  if (step === undefined) {
    const needle = simple.toLowerCase();
    for (const scope of scopes) {
      const depth = written.length === 0 ? MAX_AMBIGUOUS : OWNER_SCAN;
      for (const record of scope.symbols.fuzzy(simple, depth)) {
        // `Type.membr` should not match a similarly named member of another type.
        if (knownType !== undefined && record.parent !== displayName(knownType)) continue;
        const distance = fuzzyDistance(needle, record) + qualifierDistance(written, record);
        add(scope, record, 'fuzzy', distance);
      }
    }
    step = all.length > 0 ? 'fuzzy' : undefined;
  }
  const candidates = mergeTwins(all.filter((entry) => entry.step === step));
  const [winner, ...others] = candidates;
  if (winner === undefined) {
    return { kind: 'none', ...(knownType === undefined ? {} : { knownType }) };
  }
  // Namesakes of the winner tie with it by construction. They are not a choice the caller
  // can make by name, so the first is answered and the others are listed with their refs.
  const rivals = others.filter(
    (other) =>
      compare(winner, other) === 0 && identityOf(other.record) !== identityOf(winner.record),
  );
  if (rivals.length === 0) {
    // Less exact readings of the same name are worth showing next to the answer.
    // The symbol maps stop at their most exact reading, so same-named symbols elsewhere
    // (`smartMapping.Point` next to `Point`) are collected here.
    for (const scope of scopes) {
      for (const record of scope.symbols.fuzzy(simple, MAX_AMBIGUOUS)) {
        const sameName = simpleName(record).toLowerCase() === simple.toLowerCase();
        const known = all.some((entry) => entry.record === record);
        if (sameName && !known && step !== 'fuzzy') add(scope, record, 'case-insensitive');
      }
    }
    const looser = mergeTwins(all.filter((entry) => entry.step !== step)).filter(
      (entry) => displayName(entry.record) !== displayName(winner.record),
    );
    const alternates = [...others, ...looser];
    return { kind: 'found', winner, alternates: alternates.slice(0, MAX_ALTERNATES) };
  }
  // Only what really ties is a choice: a member that shares the name of two tied types
  // (their constructors) ranks after both. One entry per name, since a namesake cannot be
  // told apart by the pair a caller copies.
  const named = new Map<string, Candidate>();
  for (const candidate of [winner, ...rivals]) {
    if (!named.has(identityOf(candidate.record)))
      named.set(identityOf(candidate.record), candidate);
  }
  return { kind: 'ambiguous', candidates: [...named.values()].slice(0, MAX_AMBIGUOUS) };
}
