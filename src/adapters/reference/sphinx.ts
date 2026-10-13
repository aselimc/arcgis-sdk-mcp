/**
 * The `sphinx` adapter: Python API references built with Sphinx. Symbols come from
 * `objects.inv`, with `searchindex.js` as the rung below; a page is fetched as HTML and
 * handed to the `sphinx` renderer together with the anchor of the wanted object, so that one
 * function is cut out of a page that documents hundreds.
 */
import { toMcpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';
import {
  assertLive,
  budgetOf,
  continueWithout,
  indexRequest,
  probeSource,
  recordOf,
  renderMeta,
  renderOptionsOf,
  siteIndexEnabled,
  symbolTarget,
  unusableIndex,
} from './dartdoc.js';
import {
  parseObjectsInv,
  parseSphinxSearchIndex,
  type SphinxEntry,
  type SphinxIndex,
} from './objects-inv.js';

/** Roles that only exist inside a class. */
const MEMBER_ROLES: ReadonlySet<string> = new Set([
  'method',
  'attribute',
  'property',
  'classmethod',
  'staticmethod',
]);
const OWNER_ROLES: ReadonlySet<string> = new Set(['class', 'exception']);
const KINDS: Readonly<Record<string, string>> = { classmethod: 'method', staticmethod: 'method' };
/** Generated pages that document nothing. */
const GENERATED_DOCS: ReadonlySet<string> = new Set(['genindex', 'search', 'py-modindex']);

/**
 * The page URL of an inventory URI. An inventory written by the JSON builder addresses a
 * page as a directory (`package.module/#anchor`); the published page is `package.module.html`.
 */
function pageRef(base: string, uri: string): string | undefined {
  const [page = '', ...anchor] = uri.split('#');
  const file = page === '' ? 'index.html' : page.endsWith('/') ? `${page.slice(0, -1)}.html` : page;
  const ref = new URL(anchor.length === 0 ? file : `${file}#${anchor.join('#')}`, base).href;
  return ref.startsWith(base) ? ref : undefined;
}

/**
 * Catalogue records of a Sphinx index: every object of a language domain plus one record per
 * document. Labels and other `std` entries are navigation aids, not symbols. An object is a
 * member when its role says so or when the name before its last segment is a class of the
 * same index.
 */
export function sphinxRecords(src: BoundSource, entries: readonly SphinxEntry[]): CatalogRecord[] {
  const base = src.url();
  const classes = new Set(
    entries.filter((entry) => OWNER_ROLES.has(entry.role)).map((entry) => entry.name),
  );
  const records = new Map<string, CatalogRecord>();
  for (const entry of entries) {
    const ref = pageRef(base, entry.uri);
    if (ref === undefined || records.has(ref)) continue;
    if (entry.domain === 'std') {
      if (entry.role !== 'doc' || GENERATED_DOCS.has(entry.name)) continue;
      records.set(ref, recordOf(src, ref, entry.display));
      continue;
    }
    const parts = entry.name.split('.');
    const symbol = parts.at(-1) ?? entry.name;
    const prefix = parts.slice(0, -1).join('.');
    const owned = prefix !== '' && (MEMBER_ROLES.has(entry.role) || classes.has(prefix));
    records.set(
      ref,
      recordOf(src, ref, owned ? parts.slice(-2).join('.') : symbol, {
        symbol,
        qualified: entry.name,
        symbolKind: KINDS[entry.role] ?? entry.role,
        parent: owned ? prefix : undefined,
        breadcrumb: owned ? [parts.slice(0, -2).join('.'), parts.at(-2) ?? ''] : [prefix],
      }),
    );
  }
  return [...records.values()];
}

async function inventory(ctx: Ctx, src: BoundSource, url: string): Promise<SphinxIndex> {
  const res = await ctx.http.get({ ...indexRequest(src, url, 'text'), encoding: 'base64' });
  const index = parseObjectsInv(Buffer.from(res.text, 'base64'));
  if (index === undefined) throw unusableIndex(url, 'The file is not a Sphinx inventory version 2');
  return index;
}

async function searchIndex(ctx: Ctx, src: BoundSource, url: string): Promise<SphinxIndex> {
  const res = await ctx.http.get(indexRequest(src, url, 'text'));
  const index = parseSphinxSearchIndex(res.text);
  if (index === undefined) throw unusableIndex(url, 'The script holds no search index object');
  return index;
}

async function read(ctx: Ctx, src: BoundSource, target: ReadTarget): Promise<DocPage> {
  assertLive(src, target.url.href);
  const requested = target.url.href.replace(/#.*$/, '');
  const res = await ctx.http.get({ url: requested, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const landed = res.finalUrl === res.url ? requested : res.finalUrl.replace(/#.*$/, '');
  let anchor = target.url.hash.slice(1);
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // A malformed escape is matched as written.
  }
  return ctx.render.render(
    'sphinx',
    { html: res.text, ...(anchor === '' ? {} : { anchor }) },
    renderMeta(src, target, `${landed}${target.url.hash}`, res),
    renderOptionsOf(target),
  );
}

/**
 * `sphinx`: one request for `objects.inv`; when it is missing or damaged, one more for
 * `searchindex.js`. A source whose inventory lists nothing usable fails rather than
 * presenting an empty catalogue.
 */
export const sphinxAdapter: SourceAdapter<'sphinx'> = {
  type: 'sphinx',
  maxEnumerateRequests: 2,

  async enumerate(ctx, src) {
    const inventoryUrl = src.url('objects.inv');
    assertLive(src, inventoryUrl);
    if (!siteIndexEnabled(ctx, src)) return [];
    let records: CatalogRecord[] = [];
    let failure: unknown;
    try {
      records = sphinxRecords(src, (await inventory(ctx, src, inventoryUrl)).entries);
      if (records.length === 0) throw unusableIndex(inventoryUrl, 'The inventory has no objects');
    } catch (error) {
      failure = error;
      continueWithout(ctx, src, error, 'The Sphinx inventory');
    }
    if (failure === undefined) return records;
    const searchUrl = src.url('searchindex.js');
    try {
      records = sphinxRecords(src, (await searchIndex(ctx, src, searchUrl)).entries);
    } catch (error) {
      continueWithout(ctx, src, error, 'The Sphinx search index');
    }
    if (records.length === 0) throw toMcpDocError(failure);
    return records;
  },

  read,
  symbol: (ctx, src, record, detail) => read(ctx, src, symbolTarget(record, detail)),
  probe: (ctx, src) =>
    /\.inv(?:[?#]|$)/.test(src.source.probe.url)
      ? probeSource(ctx, src, {
          encoding: 'base64',
          count: (text) => parseObjectsInv(Buffer.from(text, 'latin1'))?.entries.length,
        })
      : probeSource(ctx, src, {
          count: (text) => parseSphinxSearchIndex(text)?.entries.length,
        }),
};
