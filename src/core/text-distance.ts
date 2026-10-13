/**
 * Edit distance and nearest-name suggestions, used for "did you mean" lists in errors and
 * for fuzzy product, section and symbol resolution.
 */

/**
 * Levenshtein distance between `a` and `b`, bounded by `max`.
 *
 * @returns the distance when it is `<= max`, otherwise `max + 1`. The bound lets callers
 *   scan large candidate lists cheaply: rows that cannot stay within `max` stop early.
 */
export function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  const distance = previous[b.length] ?? 0;
  return distance > max ? max + 1 : distance;
}

/**
 * The `n` candidates most similar to `input`, best first, compared case-insensitively.
 *
 * Ranking: exact match, then candidates that start with the input, then candidates that
 * contain it, then by edit distance (at most a third of the longer string, minimum 2).
 * Candidates beyond that distance are not returned, so the result may be shorter than `n`.
 * Ties keep the order of `candidates`.
 */
export function nearest(input: string, candidates: readonly string[], n: number): string[] {
  const needle = input.trim().toLowerCase();
  if (needle === '' || n <= 0) return [];

  const scored: Array<{ candidate: string; score: number; order: number }> = [];
  const seen = new Set<string>();
  candidates.forEach((candidate, order) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    const hay = candidate.toLowerCase();
    let score: number;
    if (hay === needle) score = 0;
    else if (hay.startsWith(needle)) score = 1;
    else if (hay.includes(needle)) score = 2;
    else {
      const max = Math.max(2, Math.floor(Math.max(needle.length, hay.length) / 3));
      const distance = levenshtein(needle, hay, max);
      if (distance > max) return;
      // Offset so that any substring match outranks any pure edit-distance match.
      score = 2 + distance;
    }
    scored.push({ candidate, score, order });
  });

  scored.sort((x, y) => x.score - y.score || x.order - y.order);
  return scored.slice(0, n).map((entry) => entry.candidate);
}
