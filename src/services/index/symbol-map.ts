/**
 * The symbol sidecar of a catalogue index (design section 6.4): exact maps from qualified and
 * simple names to records, and from a type to its members. It is rebuilt from the snapshot's
 * records on load, so nothing but the records is persisted.
 */
import { levenshtein } from '../../core/text-distance.js';
import type { CatalogRecord } from '../../core/types.js';

/** Largest edit distance of a fuzzy symbol match. */
export const MAX_SYMBOL_DISTANCE = 2;

/** Shortest input that may match as a prefix; shorter prefixes match half the index. */
const MIN_PREFIX_LENGTH = 3;

/** Exact and fuzzy symbol lookup over the records of one or more catalogue indexes. */
export interface SymbolMap {
  /**
   * Records named `name`, from the most to the least exact reading that has any: the
   * qualified name, a dotted suffix of it, the simple name, then the same three without case.
   */
  exact(name: string): CatalogRecord[];
  /** Member records of a type, by its qualified name (case-insensitive as a fallback). */
  members(qualifiedType: string): CatalogRecord[];
  /**
   * The `n` records whose simple name is nearest to `name`: names it is a prefix of first,
   * then by edit distance (at most {@link MAX_SYMBOL_DISTANCE}); types before members.
   */
  fuzzy(name: string, n: number): CatalogRecord[];
  /** Number of symbol records. */
  size(): number;
}

/** The last segment of a qualified name: `a.b.C` gives `C`, `A#b` gives `b`. */
export function simpleName(record: CatalogRecord): string {
  return record.symbol ?? record.qualified?.split(/::|[.#/]/).at(-1) ?? '';
}

function push<K>(map: Map<K, CatalogRecord[]>, key: K, record: CatalogRecord): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [record]);
  else list.push(record);
}

/** True when `qualified` ends with `suffix` on a segment boundary. */
function endsWithSegment(qualified: string, suffix: string): boolean {
  if (!qualified.endsWith(suffix)) return false;
  const before = qualified.charAt(qualified.length - suffix.length - 1);
  return before === '.' || before === '#' || before === '/' || before === ':';
}

/** Builds the sidecar over the records that name a symbol (`symbol` or `qualified` set). */
export function buildSymbolMap(records: readonly CatalogRecord[]): SymbolMap {
  const byQualified = new Map<string, CatalogRecord[]>();
  const byLowerQualified = new Map<string, CatalogRecord[]>();
  const byLowerSimple = new Map<string, CatalogRecord[]>();
  const byParent = new Map<string, CatalogRecord[]>();
  const byLowerParent = new Map<string, CatalogRecord[]>();
  let count = 0;

  for (const record of records) {
    const simple = simpleName(record);
    if (simple === '') continue;
    count += 1;
    push(byLowerSimple, simple.toLowerCase(), record);
    if (record.qualified !== undefined) {
      push(byQualified, record.qualified, record);
      push(byLowerQualified, record.qualified.toLowerCase(), record);
    }
    if (record.parent !== undefined) {
      push(byParent, record.parent, record);
      push(byLowerParent, record.parent.toLowerCase(), record);
    }
  }

  const exact = (name: string): CatalogRecord[] => {
    const lower = name.toLowerCase();
    const last = lower.split(/::|[.#/]/).at(-1) ?? lower;
    const sameSimple = byLowerSimple.get(last) ?? [];
    const dotted = last !== lower;
    const readings: Array<() => CatalogRecord[]> = [
      () => byQualified.get(name) ?? [],
      () => sameSimple.filter((r) => dotted && endsWithSegment(r.qualified ?? '', name)),
      () => (dotted ? [] : sameSimple.filter((r) => simpleName(r) === name)),
      () => byLowerQualified.get(lower) ?? [],
      () =>
        sameSimple.filter((r) => dotted && endsWithSegment((r.qualified ?? '').toLowerCase(), lower)),
      () => (dotted ? [] : sameSimple),
    ];
    for (const reading of readings) {
      const found = reading();
      if (found.length > 0) return found;
    }
    return [];
  };

  const fuzzy = (name: string, n: number): CatalogRecord[] => {
    const needle = (name.split(/::|[.#/]/).at(-1) ?? name).toLowerCase();
    if (needle === '' || n <= 0) return [];
    const scored: Array<{ record: CatalogRecord; score: number }> = [];
    for (const [simple, list] of byLowerSimple) {
      let score: number;
      if (simple === needle) score = 0;
      else if (needle.length >= MIN_PREFIX_LENGTH && simple.startsWith(needle)) score = 1;
      else {
        const distance = levenshtein(needle, simple, MAX_SYMBOL_DISTANCE);
        if (distance > MAX_SYMBOL_DISTANCE) continue;
        // Offset so that a prefix match outranks any pure edit-distance match.
        score = 1 + distance;
      }
      for (const record of list) scored.push({ record, score });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        Number(a.record.parent !== undefined) - Number(b.record.parent !== undefined) ||
        simpleName(a.record).length - simpleName(b.record).length,
    );
    return scored.slice(0, n).map((entry) => entry.record);
  };

  return {
    exact,
    members: (qualifiedType) =>
      byParent.get(qualifiedType) ?? byLowerParent.get(qualifiedType.toLowerCase()) ?? [],
    fuzzy,
    size: () => count,
  };
}

/**
 * One view over several sidecars (every loaded source of a product line). Results keep the
 * order of `maps`, which callers pass most important source first.
 */
export function mergeSymbolMaps(maps: readonly SymbolMap[]): SymbolMap {
  return {
    exact: (name) => maps.flatMap((map) => map.exact(name)),
    members: (qualifiedType) => maps.flatMap((map) => map.members(qualifiedType)),
    fuzzy(name, n) {
      const needle = (name.split(/::|[.#/]/).at(-1) ?? name).toLowerCase();
      // Each map returns its own best n; re-rank the union by the same distance measure.
      return maps
        .flatMap((map) => map.fuzzy(name, n))
        .map((record, order) => {
          const simple = simpleName(record).toLowerCase();
          const score =
            simple === needle
              ? 0
              : simple.startsWith(needle)
                ? 1
                : 1 + levenshtein(needle, simple, MAX_SYMBOL_DISTANCE);
          return { record, score, order };
        })
        .sort((a, b) => a.score - b.score || a.order - b.order)
        .slice(0, n)
        .map((entry) => entry.record);
    },
    size: () => maps.reduce((sum, map) => sum + map.size(), 0),
  };
}
