import { McpDocError } from '../../../src/core/errors.js';
import type {
  AdapterRegistry,
  BoundSource,
  Ctx,
  ProbeResult,
  ReadTarget,
  SourceAdapter,
} from '../../../src/core/ports.js';
import { sectionSubtree } from '../../../src/core/sections.js';
import type {
  AdapterType,
  CatalogRecord,
  DocPage,
  SymbolDetail,
} from '../../../src/core/types.js';

/** A method of {@link TestAdapter} that can be scripted. */
export type Method = 'enumerate' | 'read' | 'symbol' | 'sample';

/** One call seen by a {@link TestAdapter}. */
export interface SeenCall {
  method: Method;
  product: string;
  source: string;
  line: string;
  version?: string;
  ref?: string;
  target?: ReadTarget;
  detail?: SymbolDetail;
}

/** Options of {@link TestAdapter}. */
export interface TestAdapterOptions {
  /** Leave `enumerate` undefined, as on read-only adapters. */
  noEnumerate?: boolean;
  /** Leave `sample` undefined, as on adapters without sample bundles. */
  noSample?: boolean;
  /** Give the adapter its own `symbol` method instead of the default read. */
  ownSymbol?: boolean;
  /** Apply `target.select` like a real renderer: one section and its children, or one member. */
  slices?: boolean;
  maxEnumerateRequests?: number;
  owns?: (url: URL) => boolean;
}

function pageUrl(url: string): string {
  return url.split('#')[0] ?? url;
}

/**
 * A scriptable adapter for service tests. Unlike `FakeAdapter` it serves several sources:
 * `enumerate` returns only the records of the bound product, source and line, which is what
 * the index service's per-source units need.
 */
export class TestAdapter implements SourceAdapter {
  readonly calls: SeenCall[] = [];
  readonly maxEnumerateRequests: number;
  enumerate?: (ctx: Ctx, src: BoundSource) => Promise<CatalogRecord[]>;
  sample?: (ctx: Ctx, src: BoundSource, record: CatalogRecord) => Promise<DocPage>;
  symbol?: (
    ctx: Ctx,
    src: BoundSource,
    record: CatalogRecord,
    detail: SymbolDetail,
  ) => Promise<DocPage>;
  owns?: (url: URL, src: BoundSource) => boolean;

  private records: CatalogRecord[] = [];
  private readonly pages = new Map<string, DocPage>();
  private readonly failures = new Map<Method, { error: unknown; remaining: number }>();
  private readonly gates = new Map<Method, Promise<void>>();

  constructor(
    readonly type: AdapterType,
    private readonly options: TestAdapterOptions = {},
  ) {
    this.maxEnumerateRequests = options.maxEnumerateRequests ?? 5;
    if (options.noEnumerate !== true) {
      this.enumerate = async (_ctx, src) => {
        await this.enter('enumerate', src);
        return this.records.filter(
          (record) =>
            record.product === src.product.id &&
            record.source === src.source.id &&
            record.line === src.line.id,
        );
      };
    }
    if (options.noSample !== true) {
      this.sample = async (_ctx, src, record) => {
        await this.enter('sample', src, { ref: record.ref });
        return this.page(record.ref);
      };
    }
    if (options.ownSymbol === true) {
      this.symbol = async (_ctx, src, record, detail) => {
        await this.enter('symbol', src, { ref: record.ref, detail });
        return this.page(record.ref);
      };
    }
    const { owns } = options;
    if (owns !== undefined) this.owns = (url) => owns(url);
  }

  /** Replaces every record this adapter enumerates. */
  setRecords(records: CatalogRecord[]): this {
    this.records = records;
    return this;
  }

  /** Adds records. */
  addRecords(records: CatalogRecord[]): this {
    this.records.push(...records);
    return this;
  }

  /** Adds or replaces a page, keyed by its URL without fragment. */
  addPage(page: DocPage, url: string = page.url): this {
    this.pages.set(pageUrl(url), page);
    return this;
  }

  /** Makes a method reject `times` times (default: always). */
  failOn(method: Method, error: unknown, times = Number.POSITIVE_INFINITY): this {
    this.failures.set(method, { error, remaining: times });
    return this;
  }

  /** Removes every scripted failure. */
  heal(): this {
    this.failures.clear();
    return this;
  }

  /** Makes a method wait until the returned function is called. */
  block(method: Method): () => void {
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
  count(method?: Method): number {
    return this.calls.filter((call) => method === undefined || call.method === method).length;
  }

  async read(_ctx: Ctx, src: BoundSource, target: ReadTarget): Promise<DocPage> {
    await this.enter('read', src, { ref: target.url.href, target });
    const page = this.page(target.url.href);
    if (this.options.slices !== true || target.select === undefined) return page;
    const { section, member } = target.select;
    const bySection = section === undefined ? [] : sectionSubtree(page.sections, section);
    if (bySection.length > 0) return { ...page, sections: bySection };
    const found = page.members?.find((entry) => entry.name === member || entry.id === member);
    const byMember = found === undefined ? [] : sectionSubtree(page.sections, found.id);
    return byMember.length > 0 ? { ...page, sections: byMember } : page;
  }

  async probe(): Promise<ProbeResult> {
    return { ok: true, ms: 1 };
  }

  private page(url: string): DocPage {
    const page = this.pages.get(pageUrl(url));
    if (page === undefined) {
      throw new McpDocError('DOC_NOT_FOUND', `${url} does not exist`, {
        url,
        host: new URL(url).host,
      });
    }
    return page;
  }

  private async enter(
    method: Method,
    src: BoundSource,
    extra: Partial<SeenCall> = {},
  ): Promise<void> {
    this.calls.push({
      method,
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      ...(src.version === undefined ? {} : { version: src.version }),
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

/** An adapter registry over test adapters; `get` throws for an unregistered type. */
export function adapterRegistry(adapters: readonly SourceAdapter[]): AdapterRegistry {
  const byType = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  return {
    get<A extends AdapterType>(type: A): SourceAdapter<A> {
      const adapter = byType.get(type);
      if (adapter === undefined) throw new Error(`no adapter registered for "${type}"`);
      // The map is keyed by `adapter.type`, so the entry has that type parameter.
      return adapter as unknown as SourceAdapter<A>;
    },
    types: () => [...byType.keys()],
  };
}
