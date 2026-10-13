/**
 * Symbol resolution (design section 3.6). The input is normalised and tried, in order, as an
 * exact qualified name, an exact simple name, the longest known type plus a member, the same
 * without case, then fuzzily (prefix, edit distance at most 2). The first step that finds
 * anything decides; ranking inside it is types before members, the product order, then the
 * source order (core package first).
 */
import { levenshtein } from '../../core/text-distance.js';
import { normalizeSymbol } from '../../core/tokenize.js';
import type { CatalogRecord } from '../../core/types.js';
import { MAX_SYMBOL_DISTANCE, simpleName, type SymbolMap } from '../index/symbol-map.js';

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

/** A record that may be what the caller meant. */
export interface Candidate {
  record: CatalogRecord;
  step: Step;
  /** Sort key: member after type, then product, then source, then fuzzy distance. */
  rank: [member: number, product: number, source: number, distance: number];
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

function endsWithSegment(qualified: string, suffix: string): boolean {
  return (
    qualified === suffix || qualified.endsWith(`.${suffix}`) || qualified.endsWith(`#${suffix}`)
  );
}

function isType(record: CatalogRecord): boolean {
  return record.parent === undefined;
}

/** How exactly a record returned for `joined` matches it. */
function directStep(record: CatalogRecord, joined: string, qualified: boolean): Step {
  if (record.qualified === joined) return 'qualified';
  if (qualified) {
    return endsWithSegment(record.qualified ?? '', joined) ? 'simple' : 'case-insensitive';
  }
  return simpleName(record) === joined ? 'simple' : 'case-insensitive';
}

/** Members named by `Type.member`, trying the longest type prefix first. */
function typeMembers(
  parts: readonly string[],
  scope: SymbolScope,
): { found: Array<{ record: CatalogRecord; step: Step }>; type?: CatalogRecord } {
  let knownType: CatalogRecord | undefined;
  for (let split = parts.length - 1; split >= 1; split--) {
    const typeName = parts.slice(0, split).join('.');
    const memberName = parts.slice(split).join('.');
    const types = scope.symbols.exact(typeName).filter(isType);
    if (types.length === 0) continue;
    knownType ??= types[0];
    const found: Array<{ record: CatalogRecord; step: Step }> = [];
    for (const type of types) {
      const members = scope.symbols.members(displayName(type));
      const exact = members.filter((member) => simpleName(member) === memberName);
      const loose = members.filter(
        (member) => simpleName(member).toLowerCase() === memberName.toLowerCase(),
      );
      const typeExact = endsWithSegment(displayName(type), typeName);
      for (const record of exact.length > 0 ? exact : loose) {
        found.push({ record, step: exact.length > 0 && typeExact ? 'member' : 'case-insensitive' });
      }
    }
    if (found.length > 0) return { found, ...(knownType === undefined ? {} : { type: knownType }) };
  }
  return { found: [], ...(knownType === undefined ? {} : { type: knownType }) };
}

function fuzzyDistance(needle: string, record: CatalogRecord): number {
  const name = simpleName(record).toLowerCase();
  if (name.startsWith(needle)) return 0;
  return levenshtein(needle, name, MAX_SYMBOL_DISTANCE);
}

/** Members considered when a written type has to pick one of many same-named members. */
const OWNER_SCAN = 64;

/** The type a caller wrote before the member name, when no such type is known. */
function ownerHint(parts: readonly string[]): string | undefined {
  return parts.length > 1 ? parts.at(-2)?.toLowerCase() : undefined;
}

/**
 * How far the written type is from the type that owns a member: 0 for the same name, up to
 * `MAX_SYMBOL_DISTANCE + 1` for an unrelated one. Records without an owner are not affected.
 */
function ownerDistance(hint: string | undefined, record: CatalogRecord): number {
  if (hint === undefined || record.parent === undefined) return 0;
  const owner = (record.parent.split(/::|[.#/]/).at(-1) ?? record.parent).toLowerCase();
  return levenshtein(hint, owner, MAX_SYMBOL_DISTANCE);
}

function compare(a: Candidate, b: Candidate): number {
  for (let position = 0; position < a.rank.length; position++) {
    const difference = (a.rank[position] ?? 0) - (b.rank[position] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Merges records that are the same symbol of the same product seen through several sources. */
function mergeTwins(candidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const candidate of [...candidates].sort(compare)) {
    const { record } = candidate;
    const identity = `${record.product}\n${displayName(record)}\n${record.parent ?? ''}`;
    const first = merged.get(identity);
    if (first === undefined) merged.set(identity, candidate);
    else if (first.record.ref !== record.ref || first.record.source !== record.source) {
      first.twins.push(record);
    }
  }
  return [...merged.values()];
}

/**
 * Resolves `input` against the symbols of the given product lines.
 *
 * - `found`: one candidate ranks strictly before every other.
 * - `ambiguous`: several rank equally; at most {@link MAX_AMBIGUOUS} are returned.
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
  const add = (scope: SymbolScope, record: CatalogRecord, step: Step, distance = 0): void => {
    all.push({
      record,
      step,
      rank: [isType(record) ? 0 : 1, scope.productRank, scope.sourceRank(record), distance],
      twins: [],
    });
  };

  for (const scope of scopes) {
    for (const record of scope.symbols.exact(joined)) {
      add(scope, record, directStep(record, joined, qualified));
    }
    if (qualified) {
      const viaType = typeMembers(parts, scope);
      knownType ??= viaType.type;
      for (const { record, step } of viaType.found) add(scope, record, step);
    }
  }

  // What stands before the name when it is not a known type: a module path, or a type that
  // is misspelt or qualified differently (`layers/FeatureLayer.queryFeatures`). It cannot
  // select a member, but it still says which of several same-named members was meant.
  const hint = knownType === undefined ? ownerHint(parts) : undefined;

  if (all.length === 0 && qualified && knownType === undefined) {
    // No part of the prefix is a known type, so it is a module or namespace path
    // (`layers/FeatureLayer`): the last part is the name.
    for (const scope of scopes) {
      for (const record of scope.symbols.exact(simple)) {
        add(scope, record, directStep(record, simple, false), ownerDistance(hint, record));
      }
    }
  }

  let step = STEPS.find((candidate) => all.some((entry) => entry.step === candidate));
  if (step === undefined) {
    const needle = simple.toLowerCase();
    for (const scope of scopes) {
      const depth = hint === undefined ? MAX_AMBIGUOUS : OWNER_SCAN;
      for (const record of scope.symbols.fuzzy(simple, depth)) {
        // `Type.membr` should not match a similarly named member of another type.
        if (knownType !== undefined && record.parent !== displayName(knownType)) continue;
        add(scope, record, 'fuzzy', fuzzyDistance(needle, record) + ownerDistance(hint, record));
      }
    }
    step = all.length > 0 ? 'fuzzy' : undefined;
  }
  const candidates = mergeTwins(all.filter((entry) => entry.step === step));
  const [winner, runnerUp, ...rest] = candidates;
  if (winner === undefined) {
    return { kind: 'none', ...(knownType === undefined ? {} : { knownType }) };
  }
  if (runnerUp === undefined || compare(winner, runnerUp) < 0) {
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
    const alternates = [...(runnerUp === undefined ? [] : [runnerUp, ...rest]), ...looser];
    return { kind: 'found', winner, alternates: alternates.slice(0, MAX_ALTERNATES) };
  }
  return { kind: 'ambiguous', candidates: candidates.slice(0, MAX_AMBIGUOUS) };
}
