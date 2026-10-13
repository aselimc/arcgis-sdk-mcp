/**
 * The `javadoc` adapter: Java API references. A current javadoc site is catalogued from the
 * three script files behind its search box (packages, types, members); a JDK 8 site
 * (`legacy: true`) from its class list. Pages are server-rendered HTML; members are sections
 * of their class page, addressed by the anchor the index gives.
 */
import type { BoundSource, Ctx, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord, HtmlFamily } from '../../core/types.js';
import {
  assertLive,
  continueWithout,
  indexRequest,
  probeSource,
  readHtmlPage,
  siteIndexEnabled,
  symbolTarget,
  unusableIndex,
} from './dartdoc.js';
import {
  javadocLegacyRecords,
  javadocMemberRecords,
  javadocTypeRecords,
  packageModules,
  parseSearchIndex,
} from './javadoc-index.js';

const LEGACY_CLASS_LIST = 'allclasses-noframe.html';

function familyOf(src: BoundSource<'javadoc'>): HtmlFamily {
  return src.source.config.legacy === true ? 'javadoc-legacy' : 'javadoc';
}

/** Fetches one search-index script and returns the array it assigns. */
async function searchIndex(ctx: Ctx, src: BoundSource, file: string): Promise<unknown[]> {
  const url = src.url(file);
  const res = await ctx.http.get(indexRequest(src, url, 'text'));
  const entries = parseSearchIndex(res.text);
  if (entries === undefined) throw unusableIndex(url, 'The script does not assign a JSON array');
  return entries;
}

async function legacyRecords(ctx: Ctx, src: BoundSource): Promise<CatalogRecord[]> {
  const url = src.url(LEGACY_CLASS_LIST);
  const res = await ctx.http.get(indexRequest(src, url, 'html'));
  const records = javadocLegacyRecords(src, res.text);
  if (records.length === 0) throw unusableIndex(url, 'The class list links to no type page');
  return records;
}

/**
 * Types and members of a current javadoc site. The package index is needed first: it names
 * the module directory every page URL starts with. The member index is the largest file and
 * the only optional one; without it the catalogue holds the types.
 */
async function modernRecords(ctx: Ctx, src: BoundSource): Promise<CatalogRecord[]> {
  const modules = packageModules(await searchIndex(ctx, src, 'package-search-index.js'));
  const typesUrl = src.url('type-search-index.js');
  const types = javadocTypeRecords(
    src,
    await searchIndex(ctx, src, 'type-search-index.js'),
    modules,
  );
  if (types.length === 0) throw unusableIndex(typesUrl, 'No entry has a package and a label');
  try {
    const members = await searchIndex(ctx, src, 'member-search-index.js');
    return [...types, ...javadocMemberRecords(src, members, modules)];
  } catch (error) {
    continueWithout(ctx, src, error, 'The member index');
    return types;
  }
}

/** Entries of whichever index file a canary names. */
function countEntries(text: string): number | undefined {
  const linked = text.match(/<a\s[^>]*title="(?:class|interface|enum|annotation)\s+in\s/gi);
  return linked?.length ?? parseSearchIndex(text)?.length;
}

/**
 * `javadoc`: three requests list every type and member of a current site, one request the
 * types of a JDK 8 site.
 */
export const javadocAdapter: SourceAdapter<'javadoc'> = {
  type: 'javadoc',
  maxEnumerateRequests: 3,

  async enumerate(ctx, src) {
    assertLive(src, src.url());
    if (!siteIndexEnabled(ctx, src)) return [];
    return src.source.config.legacy === true ? legacyRecords(ctx, src) : modernRecords(ctx, src);
  },

  read: (ctx, src, target) => readHtmlPage(ctx, src, target, familyOf(src)),
  symbol: (ctx, src, record, detail) =>
    readHtmlPage(ctx, src, symbolTarget(record, detail), familyOf(src)),
  probe: (ctx, src) =>
    probeSource(ctx, src, {
      count: countEntries,
      // The class list is an HTML file, but it is the index of the site, not a page of it.
      ...(src.source.probe.url.endsWith(LEGACY_CLASS_LIST) ? { siteIndex: true } : {}),
    }),
};
