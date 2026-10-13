/**
 * The upstream half of `doctor`: which sources to probe and how. Every probe goes through
 * the adapter and therefore through the normal HTTP gateway (policy, robots, rate limit,
 * cache), so `doctor` can reach nothing the server could not.
 */
import { bindSource } from '../core/adapter-helpers.js';
import { newBudget } from '../core/async.js';
import { isMcpDocError } from '../core/errors.js';
import type { Registry } from '../core/ports.js';
import type {
  AdapterType,
  AnySourceDef,
  Product,
  ProductTier,
  SourceDef,
  VersionLine,
} from '../core/types.js';
import type { Container } from '../app/container.js';
import type { DoctorTier } from './args.js';

/** Requests one probe may issue (`SourceAdapter.probe` promises at most two). */
const PROBE_MAX_REQUESTS = 2;

/** Deadline of one probe. */
const PROBE_DEADLINE_MS = 20_000;

/** Pause per upstream request, which keeps a run at one request per second or slower. */
export const PROBE_INTERVAL_MS = 1000;

/** One source selected for probing. */
export interface ProbeTarget {
  product: Product;
  source: AnySourceDef;
  line: VersionLine;
}

/** Result of probing, or deciding not to probe, one source. */
export interface ProbeOutcome {
  product: string;
  source: string;
  adapter: string;
  tier: ProductTier;
  floor: boolean;
  url: string;
  status: 'ok' | 'fail' | 'skip';
  /** Why the probe failed or was skipped. */
  reason?: string;
  ms?: number;
  records?: number;
  chars?: number;
  family?: string;
}

/** The line a source is probed on: the current one, or the first line the source exists for. */
function probeLine(
  registry: Registry,
  product: Product,
  source: SourceDef,
): VersionLine | undefined {
  const current = registry.line(product);
  if (source.lines === undefined || source.lines.includes(current.id)) return current;
  return product.lines.find((line) => source.lines?.includes(line.id) === true);
}

/**
 * Selects the sources to probe.
 *
 * With `product` (an id, alias or `product/source` scope): every source of that product, or
 * the one source of the scope. Otherwise the floor source of each product in the tier:
 * the floor is the source that must keep working for a product to be reachable at all, and
 * one request per product keeps a full run to about a minute.
 *
 * @throws McpDocError `UNKNOWN_PRODUCT` when `product` does not resolve.
 */
export function selectProbeTargets(
  registry: Registry,
  options: { product?: string; tier: DoctorTier },
): ProbeTarget[] {
  const pairs: Array<{ product: Product; source: AnySourceDef }> = [];
  if (options.product !== undefined) {
    const resolution = registry.resolve(options.product);
    const sources =
      resolution.source === undefined ? resolution.product.sources : [resolution.source];
    for (const source of sources) pairs.push({ product: resolution.product, source });
  } else {
    for (const product of registry.all()) {
      if (options.tier === 'developer' && product.tier !== 'developer') continue;
      for (const source of product.sources) {
        if (source.floor === true) pairs.push({ product, source });
      }
    }
  }
  return pairs.flatMap(({ product, source }) => {
    const line = probeLine(registry, product, source);
    return line === undefined ? [] : [{ product, source, line }];
  });
}

/** The reason a target cannot be probed under the current configuration, if any. */
function skipReason(container: Container, target: ProbeTarget): string | undefined {
  const { capability } = target.source;
  if (container.config.offline) return 'offline mode (ARCGIS_DOCS_OFFLINE)';
  if (capability !== undefined && !container.policy.enabled(capability)) {
    return `capability "${capability}" is off (ARCGIS_DOCS_SOURCES=+${capability})`;
  }
  if (
    target.line.access === 'link-only' &&
    (capability === 'website' || capability === 'site-index')
  ) {
    return `line ${target.line.id} is link-only`;
  }
  return undefined;
}

/**
 * Probes the targets one after another.
 *
 * A source the policy keeps closed is reported as skipped, not failed: `doctor` under preset
 * `strict` must not look broken. Pacing waits one interval per request the previous probe
 * spent, so cached answers do not slow the run down more than needed.
 *
 * @param sleep waits the given milliseconds (injected so tests do not).
 * @param onOutcome called after each probe, for progress output.
 */
export async function runProbes(
  container: Container,
  targets: readonly ProbeTarget[],
  sleep: (ms: number) => Promise<void>,
  onOutcome?: (outcome: ProbeOutcome) => void,
): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  let owed = 0;
  for (const target of targets) {
    const { product, source } = target;
    const base: ProbeOutcome = {
      product: product.id,
      source: source.id,
      adapter: source.adapter,
      tier: product.tier,
      floor: source.floor === true,
      url: source.probe.url,
      status: 'skip',
    };
    const skipped = skipReason(container, target);
    let outcome: ProbeOutcome;
    if (skipped !== undefined) {
      outcome = { ...base, reason: skipped };
    } else {
      if (owed > 0) await sleep(owed * PROBE_INTERVAL_MS);
      const budget = newBudget(PROBE_MAX_REQUESTS, PROBE_DEADLINE_MS, container.clock);
      outcome = await probeOne(container, target, base, budget);
      owed = Math.max(1, budget.used);
    }
    outcomes.push(outcome);
    onOutcome?.(outcome);
  }
  return outcomes;
}

async function probeOne(
  container: Container,
  { product, source, line }: ProbeTarget,
  base: ProbeOutcome,
  budget: ReturnType<typeof newBudget>,
): Promise<ProbeOutcome> {
  try {
    const adapter = container.adapters.get(source.adapter);
    // The union type cannot express that `source` and `adapter` share one adapter type, so
    // the source is bound at the base type the registry returned the adapter at.
    const bound = bindSource<AdapterType>(product, source, line, undefined, budget);
    const result = await adapter.probe(container.ctx, bound);
    return {
      ...base,
      status: result.ok ? 'ok' : 'fail',
      ms: result.ms,
      ...(result.error === undefined ? {} : { reason: result.error }),
      ...(result.records === undefined ? {} : { records: result.records }),
      ...(result.chars === undefined ? {} : { chars: result.chars }),
      ...(result.family === undefined ? {} : { family: result.family }),
    };
  } catch (error) {
    if (isMcpDocError(error)) {
      const closed = error.code === 'SOURCE_DISABLED' || error.code === 'LINK_ONLY';
      return {
        ...base,
        status: closed ? 'skip' : 'fail',
        reason: `${error.code}: ${error.message}`,
      };
    }
    return {
      ...base,
      status: 'fail',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
