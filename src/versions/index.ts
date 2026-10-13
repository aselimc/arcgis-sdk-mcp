/**
 * The version service (design sections 3.3 and 4.8): `report` backs
 * `arcgis_docs_get_versions`, `label` supplies the version printed on every other result.
 *
 * Reports are cached for six hours per product, line, requested version and capability set.
 * The user's project is joined in afterwards, so a changed manifest shows at once.
 */
import { budgetExhausted, newBudget, singleFlight } from '../core/async.js';
import type { CreateVersionService } from '../core/factories.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { OracleSpec, Product, VersionFact, VersionLine } from '../core/types.js';
import { deadPackageWarning, type DeadPackageHit } from '../workspace/dead-packages.js';
import { scanWorkspace } from '../workspace/index.js';
import { mergeFacts } from './merge.js';
import { ORACLES } from './oracles/index.js';
import { gatherProduct, toProductReport, type GatheredProduct } from './report.js';
import { belongsToLine, lineNumbers, truncateVersion } from './version-text.js';

/** How long a gathered report and a version label are reused (design section 4.8). */
export const VERSION_REPORT_TTL_MS = 6 * 60 * 60 * 1000;
/** How long "no label could be read" is remembered before the oracles are asked again. */
const MISSING_LABEL_TTL_MS = 60 * 60 * 1000;
/** How long the project's retired-package scan is reused. */
const PROJECT_SCAN_TTL_MS = 60 * 1000;
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

/** Oracles in the order `label` tries them: live documented sources, then registries, then static values. */
function labelOrder(product: Product): OracleSpec[] {
  const rank = (spec: OracleSpec): number => {
    if (spec.type === 'static') return 2;
    return spec.provides.includes('documented') ? 0 : 1;
  };
  return product.oracles.filter((spec) => spec.type !== 'plc').sort((a, b) => rank(a) - rank(b));
}

/** Creates the version service. See `VersionService` in `src/core/ports.ts`. */
export const createVersionService: CreateVersionService = (ctx) => {
  const labels = new Map<string, CachedLabel>();
  const labelFlights = singleFlight<string, string | undefined>();
  let projectScan: { at: number; dead: DeadPackageHit[] } | undefined;

  /** Retired packages in the project; the scan itself is empty in HTTP mode or with `workspace` off. */
  const deadPackages = async (): Promise<DeadPackageHit[]> => {
    if (projectScan !== undefined && ctx.clock.now() - projectScan.at < PROJECT_SCAN_TTL_MS) {
      return projectScan.dead;
    }
    const scan = await scanWorkspace({
      config: ctx.config,
      registry: ctx.registry,
      logger: ctx.logger,
    });
    projectScan = { at: ctx.clock.now(), dead: scan.dead };
    return scan.dead;
  };

  const gather = async (
    product: Product,
    version: string | undefined,
    call: CallOptions,
  ): Promise<CachedReport> => {
    const key = `report/${product.id}/${version ?? ''}/${capabilityKey(ctx)}`;
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

  const readLabel = async (product: Product, line: VersionLine): Promise<string | undefined> => {
    const call = { budget: newBudget(LABEL_REQUESTS, LABEL_DEADLINE_MS, ctx.clock) };
    const ofLine = (fact: VersionFact): boolean =>
      line.current || lineNumbers(line).length === 0 || belongsToLine(fact.value, line);
    const facts: VersionFact[] = [];
    for (const spec of labelOrder(product)) {
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
      const sdks = await ctx.workspace();
      const notes: string[] = [];
      let products: Product[];
      let version = req.version;
      if (req.product !== undefined) {
        products = [ctx.registry.resolve(req.product).product];
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

      const dead = await deadPackages();
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

    label(product, line): Promise<string | undefined> {
      const key = `${product.id}/${line.id}/${capabilityKey(ctx)}`;
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
        const label = await readLabel(product, line);
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
};
