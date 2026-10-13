/**
 * The `static` adapter: a fixed list of pages written in the registry, for products whose
 * documentation is a handful of known URLs (tombstones, single help pages).
 */
import type { BoundSource, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord, DocKind } from '../../core/types.js';
import { absoluteUrl, probeSource, readHtmlPage, recordOf } from '../kit/index.js';

/** The entry of a `static` source that a URL names, compared without fragment. */
function entryFor(src: BoundSource<'static'>, url: URL): { kind: DocKind } | undefined {
  const wanted = url.href.replace(/#.*$/, '');
  return src.source.config.entries.find((entry) => absoluteUrl(entry.url, src) === wanted);
}

/** `static`: pages listed one by one in the registry. Enumeration needs no request. */
export const staticAdapter: SourceAdapter<'static'> = {
  type: 'static',
  // Enumeration reads registry data only; the contract asks for a positive budget.
  maxEnumerateRequests: 1,

  enumerate(_ctx, src) {
    const records = new Map<string, CatalogRecord>();
    for (const entry of src.source.config.entries) {
      const ref = absoluteUrl(entry.url, src);
      if (!records.has(ref)) records.set(ref, recordOf(src, ref, entry.kind, entry.title));
    }
    return Promise.resolve([...records.values()]);
  },

  read(ctx, src, target) {
    const kind =
      target.record?.kind ?? entryFor(src, target.url)?.kind ?? src.source.kinds[0] ?? 'guide';
    return readHtmlPage(ctx, src, target, { kind });
  },

  probe: (ctx, src) => probeSource(ctx, src),
};
