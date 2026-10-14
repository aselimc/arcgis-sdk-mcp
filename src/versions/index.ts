/**
 * The version service (design sections 3.3 and 4.8): `report` backs
 * `arcgis_docs_get_versions`, `label` supplies the version printed on every other result.
 *
 * What the oracles say is cached for six hours per product, requested version and
 * capability set. The user's project is joined in afterwards from one scan that is reused
 * for a minute (`createWorkspaceScanner`): the detected SDK and the retired-package warnings
 * of a report come from the same walk, and a changed manifest shows within that minute.
 */
import { budgetExhausted, newBudget, singleFlight } from '../core/async.js';
import type { CreateVersionService } from '../core/factories.js';
import type { CallOptions, Ctx, VersionReport, VersionService } from '../core/ports.js';
import type { OracleSpec, Product, SourceDef, VersionFact, VersionLine } from '../core/types.js';
import { oracleSources } from '../registry/oracle-options.js';
import { deadPackageWarning } from '../workspace/dead-packages.js';
import { createWorkspaceScanner } from '../workspace/index.js';
import { mergeFacts } from './merge.js';
import { ORACLES } from './oracles/index.js';
import { gatherProduct, toProductReport, type GatheredProduct } from './report.js';
import { belongsToLine, lineNumbers, truncateVersion } from './version-text.js';

/** How long a gathered report and a version label are reused (design section 4.8). */
export const VERSION_REPORT_TTL_MS = 6 * 60 * 60 * 1000;
/** How long "no label could be read" is remembered before the oracles are asked again. */
const MISSING_LABEL_TTL_MS = 60 * 60 * 1000;
/** `label` runs outside any tool call's budget, so it gets a small one of its own. */
const LABEL_REQUESTS = 2;
const LABEL_DEADLINE_MS = 4000;

interface CachedReport {
  at: number;
  gathered: GatheredProduct;
}

interface CachedLabel {
  at: number;
  /** Absent when no oracle had an answer. */
  label?: string;
}

/** The enabled capabilities that change what a report contains, as a cache-key part. */
function capabilityKey(ctx: Ctx): string {
  return (['website', 'registries', 'github', 'lifecycle-api'] as const)
    .filter((capability) => ctx.policy.enabled(capability))
    .join('+');
}

/**
 * The cache key of a gathered report. "No version" and a version are different words
 * (`current`, `v=5.1`), so no request can be answered with the report of another. The
 * prefix names the layout of the key: entries written under an older layout, where an empty
 * version and no version shared a key, are never read again.
 */
function reportKey(ctx: Ctx, product: Product, version: string | undefined): string {
  const asked = version === undefined ? 'current' : `v=${version}`;
  return `report2/${product.id}/${asked}/${capabilityKey(ctx)}`;
}

/**
 * An optional argument as the caller meant it. Hosts and models send `""` for an optional
 * argument they do not use, so a blank value means "not given": it is neither a version
 * that names nothing nor a product that is unknown.
 */
function given(argument: string | undefined): string | undefined {
  const trimmed = argument?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Oracles in the order `label` tries them: live documented sources, then registries, then
 * static values. With a source, only the oracles that speak for it: an oracle limited to
 * other sources (`options.sources`) says nothing about this one.
 */
function labelOrder(product: Product, source?: SourceDef): OracleSpec[] {
  const rank = (spec: OracleSpec): number => {
    if (spec.type === 'static') return 2;
    return spec.provides.includes('documented') ? 0 : 1;
  };
  const speaksFor = (spec: OracleSpec): boolean =>
    source === undefined || (oracleSources(spec.options)?.includes(source.id) ?? true);
  return product.oracles
    .filter((spec) => spec.type !== 'plc' && speaksFor(spec))
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * The part of a label's cache key that tells sources apart. Empty for a product whose
 * oracles speak for all of it, so that every source shares one label and one request.
 */
function labelScope(product: Product, source: SourceDef | undefined): string {
  const scoped = product.oracles.some((spec) => oracleSources(spec.options) !== undefined);
  return source === undefined || !scoped ? '' : `/${source.id}`;
}

/** Creates the version service. See `VersionService` in `src/core/ports.ts`. */
export const createVersionService = ((ctx: Ctx): VersionService => {
  const labels = new Map<string, CachedLabel>();
  const labelFlights = singleFlight<string, string | undefined>();
  /** The project as of at most a minute ago; empty in HTTP mode or with `workspace` off. */
  const scanProject = createWorkspaceScanner({
    config: ctx.config,
    registry: ctx.registry,
    logger: ctx.logger,
    clock: ctx.clock,
  });

  const gather = async (
    product: Product,
    version: string | undefined,
    call: CallOptions,
  ): Promise<CachedReport> => {
    const key = reportKey(ctx, product, version);
    const cached = await ctx.cache.getDerived<CachedReport>('versions', key);
    if (cached !== undefined && ctx.clock.now() - cached.at < VERSION_REPORT_TTL_MS) return cached;
    const fresh = {
      at: ctx.clock.now(),
      gathered: await gatherProduct(ctx, product, version, call),
    };
    // A partial answer is returned but not remembered, so the next call can complete it.
    if (fresh.gathered.complete) await ctx.cache.putDerived('versions', key, fresh);
    return fresh;
  };

  const readLabel = async (
    product: Product,
    line: VersionLine,
    source?: SourceDef,
  ): Promise<string | undefined> => {
    const call = { budget: newBudget(LABEL_REQUESTS, LABEL_DEADLINE_MS, ctx.clock) };
    const ofLine = (fact: VersionFact): boolean =>
      line.current || lineNumbers(line).length === 0 || belongsToLine(fact.value, line);
    const facts: VersionFact[] = [];
    for (const spec of labelOrder(product, source)) {
      if (budgetExhausted(call.budget, ctx.clock)) break;
      const found = await ORACLES[spec.type].read(ctx, product, spec, { call, line });
      facts.push(...found.filter(ofLine));
      // One live statement of the documented version is the label; nothing more is needed.
      if (facts.some((fact) => fact.role === 'documented' && fact.oracle !== 'static')) break;
    }
    const merged = mergeFacts(product, facts);
    if (merged.documented !== undefined) return merged.documented.value;
    // A registry states patch builds (5.1.27); the documentation line is the minor version.
    return merged.installable === undefined
      ? undefined
      : truncateVersion(merged.installable.value, 2);
  };

  return {
    async report(req, call): Promise<VersionReport> {
      const { sdks, dead } = await scanProject();
      const notes: string[] = [];
      let products: Product[];
      let version = given(req.version);
      const named = given(req.product);
      if (named !== undefined) {
        products = [ctx.registry.resolve(named).product];
      } else {
        const ids = [...new Set(sdks.map((sdk) => sdk.product))];
        products = ids
          .map((id) => ctx.registry.get(id))
          .filter((product): product is Product => product !== undefined);
        if (products.length === 0) {
          notes.push(
            'No Esri SDK was detected in the current project. Pass "product" to report on one.',
          );
        }
        if (version !== undefined && products.length !== 1) {
          notes.push(`"version" (${version}) was ignored: pass "product" together with it.`);
          version = undefined;
        }
      }

      const entries: VersionReport['products'] = [];
      let oldest = ctx.clock.now();
      for (const product of products) {
        const { at, gathered } = await gather(product, version, call);
        oldest = Math.min(oldest, at);
        const warnings = dead
          .filter((hit) => hit.package.product === product.id)
          .map(deadPackageWarning);
        entries.push(toProductReport(product, gathered, sdks, warnings));
        notes.push(...gathered.notes);
      }
      // Warnings about packages of products that are not in this report still reach the agent.
      const reported = new Set(products.map((product) => product.id));
      notes.push(
        ...dead.filter((hit) => !reported.has(hit.package.product)).map(deadPackageWarning),
      );
      if (budgetExhausted(call.budget, ctx.clock)) {
        notes.push(
          'The request budget of this call was spent before every fact was read. Call again to continue: the responses read so far are cached.',
        );
      }
      return {
        asOf: new Date(oldest).toISOString().slice(0, 10),
        products: entries,
        notes: [...new Set(notes)],
      };
    },

    /**
     * The port takes a product and a line. The optional `source` narrows the answer to the
     * oracles that speak for that source: the Enterprise release number is not printed on a
     * hosted location service, which has no version.
     */
    label(product, line, source): Promise<string | undefined> {
      // No oracle speaks for this source: it has no version, and nothing needs to be read.
      if (source !== undefined && labelOrder(product, source).length === 0) {
        return Promise.resolve(undefined);
      }
      const key = `${product.id}/${line.id}${labelScope(product, source)}/${capabilityKey(ctx)}`;
      const fresh = (entry: CachedLabel | undefined): entry is CachedLabel =>
        entry !== undefined &&
        ctx.clock.now() - entry.at <
          (entry.label === undefined ? MISSING_LABEL_TTL_MS : VERSION_REPORT_TTL_MS);
      const remembered = labels.get(key);
      if (fresh(remembered)) return Promise.resolve(remembered.label);

      return labelFlights.run(key, async () => {
        const stored = await ctx.cache.getDerived<CachedLabel>('versions', `label/${key}`);
        if (fresh(stored)) {
          labels.set(key, stored);
          return stored.label;
        }
        const label = await readLabel(product, line, source);
        const entry: CachedLabel = {
          at: ctx.clock.now(),
          ...(label === undefined ? {} : { label }),
        };
        labels.set(key, entry);
        await ctx.cache.putDerived('versions', `label/${key}`, entry);
        return label;
      });
    },
  };
}) satisfies CreateVersionService;
