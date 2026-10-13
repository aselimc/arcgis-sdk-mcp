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
  escapeRegExp,
  fragmentOf,
  indexRequest,
  isIndexCanary,
  probeSource,
  renderMeta,
  renderOptionsOf,
  siteIndexEnabled,
  symbolRecord,
  symbolTarget,
  tolerate,
  unusableIndex,
} from '../kit/index.js';
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
const KINDS: ReadonlyMap<string, string> = new Map([
  ['classmethod', 'method'],
  ['staticmethod', 'method'],
]);
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
 * same index. An alias (a second name for the same anchor) yields no record of its own.
 */
export function sphinxRecords(src: BoundSource, entries: readonly SphinxEntry[]): CatalogRecord[] {
  const base = src.url();
  const classes = new Set(
    entries.filter((entry) => OWNER_ROLES.has(entry.role)).map((entry) => entry.name),
  );
  const records = new Map<string, CatalogRecord>();
  // Where two names share an anchor, the one Sphinx shows in its own search is the record.
  const visibleFirst = [
    ...entries.filter((entry) => entry.priority >= 0),
    ...entries.filter((entry) => entry.priority < 0),
  ];
  for (const entry of visibleFirst) {
    const ref = pageRef(base, entry.uri);
    if (ref === undefined || records.has(ref)) continue;
    if (entry.domain === 'std') {
      if (entry.role !== 'doc' || GENERATED_DOCS.has(entry.name)) continue;
      records.set(ref, symbolRecord(src, ref, entry.display));
      continue;
    }
    // An object without an anchor cannot be told from the page it is on.
    if (!ref.includes('#')) continue;
    const parts = entry.name.split('.');
    const symbol = parts.at(-1) ?? entry.name;
    const prefix = parts.slice(0, -1).join('.');
    const owned = prefix !== '' && (MEMBER_ROLES.has(entry.role) || classes.has(prefix));
    records.set(
      ref,
      symbolRecord(src, ref, owned ? parts.slice(-2).join('.') : symbol, {
        symbol,
        qualified: entry.name,
        symbolKind: KINDS.get(entry.role) ?? entry.role,
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

/**
 * What a read of a page names on it: the object whose anchor is the fragment of the URL.
 * See {@link memberOf} for the two additions.
 */
interface Wanted {
  target: ReadTarget;
  /** The page is rendered whole; only the members of this type are its members. */
  owner?: string;
  /** The page is one member, read by the name its type knows it by. */
  member?: { id: string; name: string; kind: string };
}

/** True when the page has an element with this id: Sphinx anchors an object by its full name. */
function hasAnchor(html: string, id: string): boolean {
  return new RegExp(`\\bid=["']${escapeRegExp(id)}["']`).test(html);
}

/**
 * The read of a member that the catalogue does not list. The index of some releases has
 * classes without their members; a member is then asked for on the page of its type, by
 * its bare name (`...#to_featurelayer`). That name is not an anchor of the page, and a page
 * documents a whole module: `query` is a method of several classes on it. The member is
 * therefore addressed by its full name, which is its anchor:
 *
 * - the page has `<type>.<member>`: that object is read and cited, and listed as the one
 *   member of the page under its bare name, which is what the caller asked for;
 * - it has only the type (the member is inherited, or does not exist): the type is read, and
 *   its member list says what the type declares;
 * - it has neither: the page is read whole, with only the members that belong to the type,
 *   so that a same-named member of another class cannot be taken for the one asked for.
 */
function memberOf(html: string, target: ReadTarget, type: string, member: string): Wanted {
  const name = member.slice(type.length + 1);
  const { select: _bareName, ...rest } = target;
  const at = (anchor: string): URL => {
    const url = new URL(target.url.href);
    url.hash = anchor;
    return url;
  };
  if (hasAnchor(html, member)) {
    const kind = target.record?.symbolKind ?? 'member';
    return {
      target: { ...rest, url: at(member), select: { member } },
      member: { id: member, name, kind },
    };
  }
  if (hasAnchor(html, type)) return { target: { ...rest, url: at(type) } };
  return { target: { ...rest, url: at('') }, owner: type };
}

/**
 * Fetches a page and renders the object the target names. `address` may replace the target
 * once the page is known (a member that is asked for by a name the page does not anchor).
 */
async function read(
  ctx: Ctx,
  src: BoundSource,
  target: ReadTarget,
  address: (html: string) => Wanted = () => ({ target }),
): Promise<DocPage> {
  assertLive(src, target.url.href);
  const requested = target.url.href.replace(/#.*$/, '');
  const res = await ctx.http.get({ url: requested, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const landed = res.finalUrl === res.url ? requested : res.finalUrl.replace(/#.*$/, '');
  const wanted = address(res.text);
  const anchor = fragmentOf(wanted.target.url);
  const page = ctx.render.render(
    'sphinx',
    { html: res.text, ...(anchor === undefined ? {} : { anchor }) },
    renderMeta(src, wanted.target, `${landed}${wanted.target.url.hash}`, res),
    renderOptionsOf(wanted.target),
  );
  const { owner, member } = wanted;
  const members = page.members ?? [];
  if (member !== undefined && page.sections[0]?.id === member.id) {
    // The section of the member is the page; saying so keeps a reader from looking the
    // bare name up again in a member list that a method does not have.
    return members.some((entry) => entry.id === member.id)
      ? page
      : { ...page, members: [member, ...members] };
  }
  if (owner === undefined || page.members === undefined) return page;
  return { ...page, members: members.filter((entry) => entry.id.startsWith(`${owner}.`)) };
}

/**
 * Reads the page of a symbol record. A member the index lists carries its anchor in its ref;
 * any other member is looked for under its full name ({@link memberOf}).
 */
function symbol(
  ctx: Ctx,
  src: BoundSource,
  record: CatalogRecord,
  detail: ReadTarget['detail'],
): Promise<DocPage> {
  const target = symbolTarget(record, detail);
  const { parent, qualified } = record;
  if (parent === undefined || qualified === undefined || fragmentOf(target.url) === qualified) {
    return read(ctx, src, target);
  }
  return read(ctx, src, target, (html) => memberOf(html, target, parent, qualified));
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
      tolerate(ctx, src, error, 'The Sphinx inventory');
    }
    if (failure === undefined) return records;
    const searchUrl = src.url('searchindex.js');
    try {
      records = sphinxRecords(src, (await searchIndex(ctx, src, searchUrl)).entries);
    } catch (error) {
      tolerate(ctx, src, error, 'The Sphinx search index');
    }
    if (records.length === 0) throw toMcpDocError(failure);
    return records;
  },

  read: (ctx, src, target) => read(ctx, src, target),
  symbol,
  probe: (ctx, src) =>
    /\.inv(?:[?#]|$)/.test(src.source.probe.url)
      ? probeSource(ctx, src, {
          siteIndex: isIndexCanary(src),
          encoding: 'base64',
          count: (text) => parseObjectsInv(Buffer.from(text, 'latin1'))?.entries.length,
        })
      : probeSource(ctx, src, {
          siteIndex: isIndexCanary(src),
          count: (text) => parseSphinxSearchIndex(text)?.entries.length,
        }),
};
