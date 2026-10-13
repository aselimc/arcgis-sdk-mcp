/**
 * `arcgis-sdk-mcp warm <product...>`: builds the catalogue indexes of the named products
 * ahead of time, so that the first search of a session does not pay for them. Index files
 * only: no page body is fetched.
 */
import type { Container } from '../app/container.js';
import { newBudget } from '../core/async.js';
import type { IndexState } from '../core/ports.js';

/** How often a build that outlived its deadline is polled. */
const POLL_INTERVAL_MS = 2000;

/** How long one product may keep building before `warm` reports what it has. */
const MAX_WAIT_MS = 180_000;

/** Index states `warm` counts as usable. */
const USABLE: ReadonlySet<IndexState['state']> = new Set(['ready', 'stale', 'partial']);

/** Outcome of warming one product. */
export interface WarmResult {
  /** The argument as typed. */
  input: string;
  /** Resolved product id. */
  product: string;
  line: string;
  states: IndexState[];
  /** True when at least one index of the product can answer searches. */
  usable: boolean;
}

/**
 * Builds the indexes of each product on its current version line (or of one source, for
 * the scope form `product/source`).
 *
 * An index build that passes its deadline continues in the background, so the states are
 * polled until none is `building` or the wait limit is reached.
 *
 * @param sleep waits the given milliseconds (injected so tests do not).
 * @throws McpDocError `UNKNOWN_PRODUCT` for a name the registry does not resolve.
 */
export async function runWarm(
  container: Container,
  products: readonly string[],
  sleep: (ms: number) => Promise<void>,
): Promise<WarmResult[]> {
  const { registry, services, config, clock } = container;
  // Resolve everything first: a typo in the third name should not cost two index builds.
  const resolved = products.map((input) => ({ input, resolution: registry.resolve(input) }));

  const results: WarmResult[] = [];
  for (const { input, resolution } of resolved) {
    const { product, source } = resolution;
    const line = registry.line(product);
    const sourceIds = source === undefined ? undefined : [source.id];
    const ensure = (): Promise<IndexState[]> =>
      services.index.ensure(product, sourceIds, line, {
        budget: newBudget(config.limits.requestsPerCall, config.limits.callDeadlineMs, clock),
      });

    let states = await ensure();
    for (
      let waited = 0;
      waited < MAX_WAIT_MS && states.some((state) => state.state === 'building');
      waited += POLL_INTERVAL_MS
    ) {
      await sleep(POLL_INTERVAL_MS);
      states = await ensure();
    }
    results.push({
      input,
      product: product.id,
      line: line.id,
      states,
      usable: states.some((state) => USABLE.has(state.state)),
    });
  }
  return results;
}

/** The text of `warm`: one block per product, one line per index. */
export function formatWarm(results: readonly WarmResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${result.product} (${result.line})`);
    if (result.states.length === 0) lines.push('  no indexable sources');
    for (const state of result.states) {
      const built = state.builtAt === undefined ? '' : `, built ${state.builtAt}`;
      lines.push(`  ${state.source}: ${state.state}, ${state.records} records${built}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
