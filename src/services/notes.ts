/**
 * The `notes` lines that make degradation visible (design sections 3.1 and 6.6): which
 * sources were not searched, and which answered from a lower rung of the ladder and why.
 */
import type { IndexState } from '../core/ports.js';
import type { ScopeOrigin } from './scope.js';

/** Most lines of one category; the rest is summarised so a product with 17 sources stays readable. */
const MAX_LINES_PER_KIND = 4;

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LINES_PER_KIND) return lines;
  const rest = lines.length - MAX_LINES_PER_KIND;
  return [...lines.slice(0, MAX_LINES_PER_KIND), `... and ${rest} more sources in the same state`];
}

/**
 * One note per index that is not answering from a fresh build.
 *
 * @param reason why a source is degraded, from the index service.
 */
export function indexNotes(
  states: readonly IndexState[],
  reason: (product: string, source: string) => string | undefined,
): string[] {
  const building: string[] = [];
  const degraded: string[] = [];
  const skipped: string[] = [];
  for (const state of states) {
    const name = `${state.product}/${state.source}`;
    const why = reason(state.product, state.source);
    const because = why === undefined ? '' : `: ${why}`;
    switch (state.state) {
      case 'ready':
        break;
      case 'building':
        building.push(`not searched yet: ${name} (index is building, retry)`);
        break;
      case 'stale':
        degraded.push(`degraded: ${name} answered from an older index snapshot${because}`);
        break;
      case 'partial':
        degraded.push(`degraded: ${name} has no index, only its entry links were used${because}`);
        break;
      case 'unavailable':
        skipped.push(
          `not searched: ${name}${because === '' ? ' (not available in this configuration)' : because}`,
        );
        break;
    }
  }
  return [...capped(building), ...capped(degraded), ...capped(skipped)];
}

/** True when at least one index of a scope holds enumerated records (fresh or stale). */
export function anySearchable(states: readonly IndexState[]): boolean {
  return states.some((state) => state.state === 'ready' || state.state === 'stale');
}

/** How the product scope was chosen, when the caller did not choose it. */
export function scopeNote(origin: ScopeOrigin, products: readonly string[]): string | undefined {
  const list = products.join(', ');
  switch (origin) {
    case 'workspace':
      return `Scope: ${list} (detected in the project). Pass "product" to use another.`;
    case 'query':
      return `Scope: ${list} (named by the query). Pass "product" to use another.`;
    case 'router':
      return `Scope: ${list} (most likely products for this query). Pass "product" to narrow or change it.`;
    case 'argument':
    case 'none':
      return undefined;
  }
}
