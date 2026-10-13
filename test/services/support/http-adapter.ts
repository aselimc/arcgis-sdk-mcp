import type {
  BoundSource,
  Ctx,
  ProbeResult,
  ReadTarget,
  SourceAdapter,
} from '../../../src/core/ports.js';
import type { AdapterType, CatalogRecord, DocPage } from '../../../src/core/types.js';

/** The index file the adapter enumerates from: `<source root>index.json`. */
export interface IndexFile {
  pages: Array<{ path: string; title: string; symbol?: string }>;
}

/**
 * A minimal adapter that really goes through `ctx.http` and `ctx.render`, so that faults
 * injected into the HTTP fake reach the services the way they would in production:
 * `enumerate` reads one JSON index file, `read` fetches the page as HTML and renders it.
 */
export class HttpAdapter implements SourceAdapter {
  readonly maxEnumerateRequests = 3;

  constructor(readonly type: AdapterType) {}

  async enumerate(ctx: Ctx, src: BoundSource): Promise<CatalogRecord[]> {
    const { data } = await ctx.http.getJson<IndexFile>({
      url: src.url('index.json'),
      ttl: 'index',
      ...(src.budget === undefined ? {} : { budget: src.budget }),
    });
    return data.pages.map((page) => ({
      ref: src.url(page.path),
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      kind: src.source.kinds[0] ?? 'guide',
      title: page.title,
      ...(page.symbol === undefined ? {} : { symbol: page.symbol, qualified: page.symbol }),
      license: src.product.licenseTier,
    }));
  }

  async read(ctx: Ctx, src: BoundSource, target: ReadTarget): Promise<DocPage> {
    const url = target.url.href.replace(/#.*$/, '');
    const res = await ctx.http.get({
      url,
      expect: 'html',
      ...(src.budget === undefined ? {} : { budget: src.budget }),
    });
    return ctx.render.render(
      'html',
      { html: res.text },
      {
        url: target.url.href,
        product: src.product.id,
        source: src.source.id,
        line: src.line.id,
        kind: target.record?.kind ?? src.source.kinds[0] ?? 'guide',
        license: src.product.licenseTier,
        res,
      },
      target.select === undefined ? undefined : { select: target.select },
    );
  }

  async probe(): Promise<ProbeResult> {
    return { ok: true, ms: 1 };
  }
}
