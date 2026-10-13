import { defaultSymbolRead } from '../../src/core/adapter-helpers.js';
import { McpDocError } from '../../src/core/errors.js';
import type {
  AdapterRegistry,
  BoundSource,
  Ctx,
  ProbeResult,
  ReadTarget,
  SourceAdapter,
} from '../../src/core/ports.js';
import type { AdapterType, CatalogRecord, DocPage, SymbolDetail } from '../../src/core/types.js';

/** A method of {@link FakeAdapter} that can be made to fail or be replaced. */
export type AdapterMethod = 'enumerate' | 'read' | 'symbol' | 'sample' | 'probe';

/** One call seen by a {@link FakeAdapter}. */
export interface AdapterCall {
  method: AdapterMethod;
  product: string;
  source: string;
  line: string;
  /** `read`: the target URL. `symbol` and `sample`: the record's ref. */
  ref?: string;
  target?: ReadTarget;
  detail?: SymbolDetail;
}

/** Options of {@link FakeAdapter}. */
export interface FakeAdapterOptions {
  /** What `enumerate` returns. Records whose `line` differs from the bound line are left out. */
  records?: CatalogRecord[];
  /** Pages by URL (fragment ignored). `read`, `symbol` and `sample` answer from here. */
  pages?: Record<string, DocPage>;
  /** Default 5. */
  maxEnumerateRequests?: number;
  /** Default `{ ok: true, ms: 1 }`. */
  probe?: ProbeResult;
  /** Leave `enumerate` undefined, as on read-only adapters. */
  noEnumerate?: boolean;
}

function withoutFragment(url: string): string {
  return url.split('#')[0] ?? url;
}

/**
 * A scriptable {@link SourceAdapter} for service tests. It answers from the records and
 * pages it was given, logs every call, and can be made to fail (`failOn`), to hang until
 * released (`block`), or to run custom logic (`override`).
 */
export class FakeAdapter<A extends AdapterType = AdapterType> implements SourceAdapter<A> {
  readonly calls: AdapterCall[] = [];
  readonly maxEnumerateRequests: number;
  enumerate?: (ctx: Ctx, src: BoundSource<A>) => Promise<CatalogRecord[]>;

  private readonly failures = new Map<AdapterMethod, { error: unknown; remaining: number }>();
  private readonly gates = new Map<AdapterMethod, Promise<void>>();
  private records: CatalogRecord[];
  private readonly pages = new Map<string, DocPage>();
  private readonly probeResult: ProbeResult;

  constructor(
    readonly type: A,
    options: FakeAdapterOptions = {},
  ) {
    this.maxEnumerateRequests = options.maxEnumerateRequests ?? 5;
    this.records = options.records ?? [];
    this.probeResult = options.probe ?? { ok: true, ms: 1 };
    for (const [url, page] of Object.entries(options.pages ?? {})) this.addPage(url, page);
    if (options.noEnumerate !== true) {
      this.enumerate = async (_ctx, src) => {
        await this.enter('enumerate', src);
        return this.records.filter((record) => record.line === src.line.id);
      };
    }
  }

  /** Replaces the records returned by `enumerate`. */
  setRecords(records: CatalogRecord[]): this {
    this.records = records;
    return this;
  }

  /** Adds or replaces a page. */
  addPage(url: string, page: DocPage): this {
    this.pages.set(withoutFragment(url), page);
    return this;
  }

  /**
   * Makes a method reject with `error`.
   *
   * @param times how many calls fail before the method works again (default: all).
   */
  failOn(method: AdapterMethod, error: unknown, times = Number.POSITIVE_INFINITY): this {
    this.failures.set(method, { error, remaining: times });
    return this;
  }

  /** Removes every scripted failure. */
  heal(): this {
    this.failures.clear();
    return this;
  }

  /**
   * Makes a method wait until the returned function is called, for tests of deadlines and
   * background completion.
   */
  block(method: AdapterMethod): () => void {
    let release: () => void = () => undefined;
    this.gates.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.gates.delete(method);
      release();
    };
  }

  /** Number of calls, optionally of one method. */
  count(method?: AdapterMethod): number {
    return this.calls.filter((call) => method === undefined || call.method === method).length;
  }

  async read(_ctx: Ctx, src: BoundSource<A>, target: ReadTarget): Promise<DocPage> {
    await this.enter('read', src, { ref: target.url.href, target });
    return this.page(target.url.href);
  }

  async symbol(
    ctx: Ctx,
    src: BoundSource<A>,
    record: CatalogRecord,
    detail: SymbolDetail,
  ): Promise<DocPage> {
    await this.enter('symbol', src, { ref: record.ref, detail });
    // Delegates like a real adapter without its own symbol(): one logged `read` follows.
    return defaultSymbolRead<A>(this)(ctx, src, record, detail);
  }

  async sample(_ctx: Ctx, src: BoundSource<A>, record: CatalogRecord): Promise<DocPage> {
    await this.enter('sample', src, { ref: record.ref });
    return this.page(record.ref);
  }

  async probe(_ctx: Ctx, src: BoundSource<A>): Promise<ProbeResult> {
    await this.enter('probe', src);
    return this.probeResult;
  }

  private page(url: string): DocPage {
    const page = this.pages.get(withoutFragment(url));
    if (page === undefined) {
      throw new McpDocError('DOC_NOT_FOUND', `${url} does not exist`, { url });
    }
    return page;
  }

  private async enter(
    method: AdapterMethod,
    src: BoundSource<A>,
    extra: Partial<AdapterCall> = {},
  ): Promise<void> {
    this.calls.push({
      method,
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      ...extra,
    });
    await this.gates.get(method);
    const failure = this.failures.get(method);
    if (failure !== undefined && failure.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }
  }
}

/** An {@link AdapterRegistry} over the given adapters; `get` throws for a type that was not provided. */
export function fakeAdapterRegistry(adapters: SourceAdapter[]): AdapterRegistry {
  const byType = new Map<AdapterType, SourceAdapter>(
    adapters.map((adapter) => [adapter.type, adapter]),
  );
  return {
    get<A extends AdapterType>(type: A): SourceAdapter<A> {
      const adapter = byType.get(type);
      if (adapter === undefined) throw new Error(`no fake adapter registered for type "${type}"`);
      // The map is keyed by `adapter.type`, so the entry under `type` has that type parameter.
      return adapter as unknown as SourceAdapter<A>;
    },
    types: () => [...byType.keys()],
  };
}
