import type { Config } from '../../../src/core/config.js';
import type { Services, VersionService } from '../../../src/core/ports.js';
import { ADAPTER_TYPES } from '../../../src/core/types.js';
import type {
  AdapterType,
  Capability,
  CatalogRecord,
  HostPolicy,
  Product,
  WorkspaceSdk,
} from '../../../src/core/types.js';
import { createServices } from '../../../src/services/index.js';
import type { IndexInternals } from '../../../src/services/index/types.js';
import { fakePolicy } from '../../support/fake-policy.js';
import { fakeRegistry, type Brief } from '../../support/fake-registry.js';
import { makeCall, makeCtx, type TestCtx } from '../../support/make-ctx.js';
import { BRIEFS, PRODUCTS, RECORDS } from './catalogue.js';
import { adapterRegistry, TestAdapter, type TestAdapterOptions } from './test-adapter.js';

/** Options of {@link makeHarness}. */
export interface HarnessOptions {
  /** Default: the fixture products of `catalogue.ts`. */
  products?: Product[];
  /** Default: the fixture records. Each record goes to the adapter of its source's type. */
  records?: CatalogRecord[];
  briefs?: Brief[];
  config?: Partial<Config>;
  workspace?: WorkspaceSdk[];
  /** Enabled capabilities. Default: preset `standard`. */
  enabled?: Capability[];
  hosts?: HostPolicy[];
  /** Version labels by `product/line`. */
  labels?: Record<string, string>;
  /** Options per adapter type. */
  adapters?: Partial<Record<AdapterType, TestAdapterOptions>>;
  /** Share a context (cache, clock) with an earlier harness, as after a restart. */
  ctx?: TestCtx;
}

/** Everything a service test needs. */
export interface Harness {
  ctx: TestCtx;
  services: Omit<Services, 'versions'>;
  /** The index service with its package-internal surface. */
  index: IndexInternals;
  /** The test adapter of a type. */
  adapter(type: AdapterType): TestAdapter;
  /** The test adapter that serves a product's source. */
  adapterOf(product: string, source: string): TestAdapter;
  call(): ReturnType<typeof makeCall>;
}

/** A version service that only labels lines. */
export function fakeVersions(labels: Record<string, string> = {}): VersionService {
  return {
    report: async () => ({ asOf: '2026-10-13', products: [], notes: [] }),
    label: async (product, line) => labels[`${product.id}/${line.id}`],
  };
}

/**
 * Builds the services over the fixture catalogue with one {@link TestAdapter} per adapter
 * type. Records are handed to the adapter of their source's type.
 */
export function makeHarness(options: HarnessOptions = {}): Harness {
  const products = options.products ?? PRODUCTS;
  const records = options.records ?? RECORDS;
  const adapters = new Map<AdapterType, TestAdapter>(
    ADAPTER_TYPES.map((type) => [type, new TestAdapter(type, options.adapters?.[type])]),
  );
  const typeOf = (product: string, source: string): AdapterType | undefined =>
    products.find((candidate) => candidate.id === product)?.sources.find((s) => s.id === source)
      ?.adapter;
  for (const record of records) {
    const type = typeOf(record.product, record.source);
    if (type !== undefined) adapters.get(type)?.addRecords([record]);
  }

  const ctx =
    options.ctx ??
    makeCtx({
      ...(options.config === undefined ? {} : { config: options.config }),
      ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
      registry: fakeRegistry({
        products,
        briefs: options.briefs ?? BRIEFS,
        ...(options.hosts === undefined ? {} : { hosts: options.hosts }),
      }),
      ...(options.enabled === undefined && options.hosts === undefined
        ? {}
        : {
            policy: fakePolicy({
              ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
              ...(options.hosts === undefined ? {} : { hosts: options.hosts }),
            }),
          }),
    });

  const services = createServices(
    ctx,
    adapterRegistry([...adapters.values()]),
    fakeVersions(options.labels),
  );
  const adapter = (type: AdapterType): TestAdapter => {
    const found = adapters.get(type);
    if (found === undefined) throw new Error(`no test adapter for ${type}`);
    return found;
  };
  return {
    ctx,
    services,
    // `createServices` returns the concrete index service typed as the public port.
    index: services.index as IndexInternals,
    adapter,
    adapterOf(product, source) {
      const type = typeOf(product, source);
      if (type === undefined) throw new Error(`unknown source ${product}/${source}`);
      return adapter(type);
    },
    call: () => makeCall(ctx),
  };
}
