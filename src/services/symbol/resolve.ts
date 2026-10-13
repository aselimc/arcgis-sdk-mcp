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
  | { kind: 'none'; nearest: string[]; knownType?: CatalogRecord };

/** Most candidates listed by an ambiguous result. */
export const MAX_AMBIGUOUS = 8;
/** Most alternates listed next to a winner. */
export const MAX_ALTERNATES = 3;
/** Names suggested when nothing matches. */
export const MAX_NEAREST = 5;

/** The name a candidate is shown and looked up by. */
export function displayName(record: CatalogRecord): string {
  return record.qualified ?? simpleName(record);
}

function endsWithSegment(qualified: string, suffix: string): boolean {
  return qualified === suffix || qualified.endsWith(`.${suffix}`) || qualified.endsWith(`#${suffix}`);
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
 * - `none`: nothing matched, with the nearest names and, when `Type.member` named a known
 *   type without such a member, that type.
 */
export function resolveSymbol(input: string, scopes: readonly SymbolScope[]): Resolution {
  const { parts, simple } = normalizeSymbol(input);
  if (simple === '') return { kind: 'none', nearest: [] };
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

  let step = STEPS.find((candidate) => all.some((entry) => entry.step === candidate));
  if (step === undefined) {
    const needle = simple.toLowerCase();
    for (const scope of scopes) {
      for (const record of scope.symbols.fuzzy(simple, MAX_AMBIGUOUS)) {
        // `Type.membr` should not match a similarly named member of another type.
        if (knownType !== undefined && record.parent !== displayName(knownType)) continue;
        add(scope, record, 'fuzzy', fuzzyDistance(needle, record));
      }
    }
    step = all.length > 0 ? 'fuzzy' : undefined;
  }
  if (step === undefined) {
    return { kind: 'none', nearest: [], ...(knownType === undefined ? {} : { knownType }) };
  }

  const candidates = mergeTwins(all.filter((entry) => entry.step === step));
  const [winner, runnerUp, ...rest] = candidates;
  if (winner === undefined) return { kind: 'none', nearest: [] };
  if (runnerUp === undefined || compare(winner, runnerUp) < 0) {
    const alternates = runnerUp === undefined ? [] : [runnerUp, ...rest].slice(0, MAX_ALTERNATES);
    return { kind: 'found', winner, alternates };
  }
  return { kind: 'ambiguous', candidates: candidates.slice(0, MAX_AMBIGUOUS) };
}
