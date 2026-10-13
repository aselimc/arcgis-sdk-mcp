/**
 * The `dartdoc` adapter (Flutter API references): the flat `index.json` a dartdoc site
 * publishes for its search box, and server-rendered HTML pages.
 */
import type { BoundSource, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord } from '../../core/types.js';
import {
  assertLive,
  indexRequest,
  isIndexCanary,
  oneLine,
  probeSource,
  readHtmlPage,
  siteIndexEnabled,
  symbolRecord,
  symbolTarget,
  unusableIndex,
} from '../kit/index.js';

/** One entry of a dartdoc `index.json`. */
interface DartdocEntry {
  name?: unknown;
  qualifiedName?: unknown;
  href?: unknown;
  kind?: unknown;
  desc?: unknown;
  enclosedBy?: { name?: unknown; kind?: unknown };
}

/** dartdoc's numeric `Kind` values, as far as they occur in an index. */
const DART_KINDS: Readonly<Record<number, string>> = {
  0: 'accessor',
  1: 'constant',
  2: 'constructor',
  3: 'class',
  5: 'enum',
  6: 'extension',
  7: 'extension-type',
  8: 'function',
  9: 'library',
  10: 'method',
  11: 'mixin',
  16: 'property',
  19: 'constant',
  20: 'property',
  21: 'typedef',
};

/** Kinds whose entries own members: class, enum, extension, extension type, mixin. */
const DART_CONTAINERS: ReadonlySet<unknown> = new Set([3, 5, 6, 7, 11]);

/**
 * Catalogue records of a dartdoc index. A member's qualified name is `library.Type.member`:
 * the index repeats the type name for constructors (`lib.Point.Point.fromJson`), which is
 * folded so that the name reads as it is written in Dart code.
 */
export function dartdocRecords(src: BoundSource, entries: readonly unknown[]): CatalogRecord[] {
  const base = src.url();
  const records = new Map<string, CatalogRecord>();
  for (const entry of entries as ReadonlyArray<DartdocEntry | null>) {
    const { name, qualifiedName, href } = entry ?? {};
    if (typeof name !== 'string' || typeof href !== 'string' || name === '') continue;
    const ref = new URL(href, base).href;
    if (!ref.startsWith(base) || records.has(ref)) continue;
    const full = typeof qualifiedName === 'string' ? qualifiedName : name;
    const kind = typeof entry?.kind === 'number' ? entry.kind : -1;
    const owner = entry?.enclosedBy;
    const common = { symbolKind: DART_KINDS[kind] ?? 'symbol', description: oneLine(entry?.desc) };
    if (typeof owner?.name !== 'string' || !DART_CONTAINERS.has(owner.kind)) {
      const library = typeof owner?.name === 'string' ? [owner.name] : [];
      records.set(
        ref,
        symbolRecord(src, ref, name, {
          ...common,
          symbol: name,
          qualified: full,
          breadcrumb: library,
        }),
      );
      continue;
    }
    const simple = name.split('.').at(-1) ?? name;
    const parent = full.endsWith(`.${name}`)
      ? full.slice(0, -(name.length + 1))
      : full.split('.').slice(0, -1).join('.');
    records.set(
      ref,
      symbolRecord(src, ref, `${owner.name}.${simple}`, {
        ...common,
        symbol: simple,
        qualified: `${parent}.${simple}`,
        parent,
        breadcrumb: parent.split('.'),
      }),
    );
  }
  return [...records.values()];
}

/**
 * `dartdoc`: the flat `index.json` a dartdoc site publishes for its search box (one entry per
 * library, type and member, each with its own page), and server-rendered HTML pages.
 */
export const dartdocAdapter: SourceAdapter<'dartdoc'> = {
  type: 'dartdoc',
  maxEnumerateRequests: 1,

  async enumerate(ctx, src) {
    const url = src.url(src.source.config.index);
    assertLive(src, url);
    if (!siteIndexEnabled(ctx, src)) return [];
    const { data } = await ctx.http.getJson(indexRequest(src, url, 'json'));
    if (!Array.isArray(data)) throw unusableIndex(url, 'The index is not a list of entries');
    const records = dartdocRecords(src, data);
    if (records.length === 0) {
      throw unusableIndex(url, 'No entry of the index has a name and an href');
    }
    return records;
  },

  read: (ctx, src, target) => readHtmlPage(ctx, src, target, { family: 'dartdoc' }),
  symbol: (ctx, src, record, detail) =>
    readHtmlPage(ctx, src, symbolTarget(record, detail), { family: 'dartdoc' }),
  probe: (ctx, src) => probeSource(ctx, src, { siteIndex: isIndexCanary(src) }),
};
