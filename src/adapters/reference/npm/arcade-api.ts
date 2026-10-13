/**
 * Mapper `arcade-api`: the Arcade function reference shipped in `@arcgis/coding-components`
 * (`arcade-api.t9n.en.json`, `js-web.md` section 4). The file is an array of categories
 * `{ id, title, items }`; an entry of `items` is one function or constant, or an array of
 * the overloads of one function. A category is one page of the published reference and each
 * item links to its anchor on that page.
 */
import { formatCall } from '../../../core/budget.js';
import { TOOLS } from '../../../core/names.js';
import type { Ctx, ReadTarget, RenderOptions } from '../../../core/ports.js';
import type { CatalogRecord, DocPage, SymbolDetail } from '../../../core/types.js';
import { pageKey } from '../../../core/url.js';
import {
  docRoot,
  fileRef,
  fromPackage,
  type JsonMapper,
  type JsonSrc,
  type LoadedFile,
} from './json-mapper.js';
import { packageMeta } from './package-file.js';
import { fragmentOf, summaryOf } from '../../kit/index.js';
import {
  baseRecord,
  isRecord,
  notFound,
  records,
  selectorOf,
  shapeError,
  str,
  type Json,
} from './shared.js';

/** One function or constant. */
interface ArcadeItem {
  raw: Json;
  /** Display name with its real capitalisation (`Concatenate`); `name` in the file is lower-case. */
  label: string;
  /** Anchor on the category page; overloads are numbered (`array1`, `array2`). */
  anchor: string;
  ref: string;
  /** The item with its overloads, in file order; just the item when there are none. */
  overloads: Json[];
}

/** One category: a page of the function reference. */
interface ArcadeCategory {
  raw: Json;
  id: string;
  title: string;
  ref: string;
  items: ArcadeItem[];
}

function linkOf(item: Json): { page: string; anchor?: string } | undefined {
  const link = str(item.link);
  if (link === undefined || !URL.canParse(link)) return undefined;
  const url = new URL(link);
  const anchor = fragmentOf(url);
  url.hash = '';
  return { page: url.href, ...(anchor === undefined ? {} : { anchor }) };
}

function labelOf(item: Json): string | undefined {
  return str(isRecord(item.completion) ? item.completion.label : undefined) ?? str(item.name);
}

/**
 * Parses the file into categories.
 *
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the file is not a list of
 *   categories with `items`; an empty list is valid. Categories without a usable item are
 *   dropped: they have nothing to show.
 */
function parse(src: JsonSrc, loaded: LoadedFile): ArcadeCategory[] {
  const { data, url } = loaded.file;
  const entries = Array.isArray(data) ? records(data) : undefined;
  const valid = entries?.filter((entry) => Array.isArray(entry.items)) ?? [];
  if (entries === undefined || (entries.length > 0 && valid.length === 0)) {
    throw shapeError(url, 'an Arcade function reference');
  }
  const root = docRoot(src);
  const file = fileRef(src);
  const categories = valid.map((raw, index): ArcadeCategory => {
    const groups = (raw.items as unknown[]).map((entry) =>
      records(Array.isArray(entry) ? entry : [entry]),
    );
    const id = str(raw.id) ?? `category-${index + 1}`;
    const page =
      groups
        .flat()
        .map(linkOf)
        .find((link) => link !== undefined)?.page ??
      (root === undefined ? undefined : `${root}${id}/`);
    const items = groups.flatMap((overloads) =>
      overloads.flatMap((item): ArcadeItem[] => {
        const label = labelOf(item);
        if (label === undefined) return [];
        const link = linkOf(item);
        const anchor = link?.anchor ?? label.toLowerCase();
        const ref =
          link?.anchor === undefined ? `${page ?? file}#${anchor}` : `${link.page}#${anchor}`;
        return [{ raw: item, label, anchor, ref, overloads }];
      }),
    );
    return { raw, id, title: str(raw.title) ?? id, ref: page ?? `${file}#${id}`, items };
  });
  return categories.filter((category) => category.items.length > 0);
}

function itemRecord(src: JsonSrc, category: ArcadeCategory, item: ArcadeItem): CatalogRecord {
  const signature = str(isRecord(item.raw.completion) ? item.raw.completion.detail : undefined);
  const summary = summaryOf(item.raw.description);
  const description = [signature, summary].filter((part) => part !== undefined).join(' - ');
  const bundle = str(item.raw.bundle);
  return {
    ...baseRecord(src, item.ref, item.label),
    symbol: item.label,
    // Arcade functions are global: the name is the whole qualified name.
    qualified: item.label,
    symbolKind: str(item.raw.type) ?? 'function',
    breadcrumb: category.title,
    ...(description === '' ? {} : { description }),
    ...(bundle === undefined ? {} : { keywords: [bundle] }),
    locator: { category: category.id, anchor: item.anchor },
  };
}

/** What a read names: a category and, when it names one, an item on it. */
interface Located {
  category: ArcadeCategory;
  item?: ArcadeItem;
  /** True when the URL's fragment is the address of the category itself, not of a part of it. */
  fragmentIsCategory: boolean;
}

/**
 * Finds the category by the record that led here, else by URL. A page URL names its category
 * by path. On the file URL (entries without a documentation page) everything shares one
 * path, so the fragment is the address: a category id, or the anchor of an item.
 */
function locate(
  src: JsonSrc,
  categories: ArcadeCategory[],
  target: ReadTarget,
): Located | undefined {
  const locator = target.record?.locator;
  const fragment = fragmentOf(target.url);
  const wanted = pageKey(target.url.href);
  const onFile = wanted === pageKey(fileRef(src));
  const byFragment = onFile ? categories.find((candidate) => candidate.id === fragment) : undefined;
  const category =
    categories.find((candidate) => candidate.id === locator?.category) ??
    (onFile
      ? (byFragment ??
        categories.find((candidate) => candidate.items.some((item) => item.anchor === fragment)))
      : categories.find((candidate) => pageKey(candidate.ref) === wanted));
  if (category === undefined) return undefined;
  const anchor = locator?.anchor ?? fragment;
  const item = category.items.find((candidate) => candidate.anchor === anchor);
  return {
    category,
    ...(item === undefined ? {} : { item }),
    fragmentIsCategory: category === byFragment && item === undefined,
  };
}

/** The `arcade-api` mapper. */
export const arcadeApiMapper: JsonMapper = {
  records(src, loaded) {
    const byRef = new Map<string, CatalogRecord>();
    for (const category of parse(src, loaded)) {
      byRef.set(category.ref, {
        ...baseRecord(src, category.ref, category.title),
        locator: { category: category.id },
      });
      for (const item of category.items) {
        if (!byRef.has(item.ref)) byRef.set(item.ref, itemRecord(src, category, item));
      }
    }
    return [...byRef.values()];
  },

  /**
   * The category page. An item named by the fragment or the record is selected as a member,
   * so the page keeps the category's title and member list while its sections are that item.
   */
  page(ctx: Ctx, src, loaded, target): DocPage {
    const found = locate(src, parse(src, loaded), target);
    if (found === undefined) {
      throw notFound(
        target.url.href,
        `${target.url.href} is not a page of the Arcade function reference`,
        'The reference has one page per function category',
        { next: formatCall(TOOLS.search, { query: 'Arcade functions', product: src.product.id }) },
      );
    }
    const { category, item } = found;
    // The item is selected by its anchor, which is its section id whatever the URL said.
    const select =
      target.select ??
      (item !== undefined
        ? { member: item.anchor }
        : found.fragmentIsCategory
          ? undefined
          : selectorOf(target));
    const opts: RenderOptions = {
      ...(select === undefined ? {} : { select }),
      ...(target.detail === undefined ? {} : { detail: target.detail }),
    };
    const page = ctx.render.render(
      'arcade',
      { item: category.raw },
      packageMeta(src, loaded.pkg, loaded.file, item?.ref ?? category.ref),
      Object.keys(opts).length === 0 ? undefined : opts,
    );
    return fromPackage(page, loaded.pkg);
  },

  /** One function on a page of its own, with its overloads, instead of a slice of its category. */
  symbol(ctx: Ctx, src, loaded, record, detail: SymbolDetail): DocPage | undefined {
    const item = locate(src, parse(src, loaded), { url: new URL(record.ref), record })?.item;
    if (item === undefined) return undefined;
    const page = ctx.render.render(
      'arcade',
      { item: item.overloads.length > 1 ? item.overloads : item.raw },
      packageMeta(src, loaded.pkg, loaded.file, item.ref),
      { detail },
    );
    return fromPackage(page, loaded.pkg);
  },
};
