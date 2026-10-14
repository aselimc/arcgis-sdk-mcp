/**
 * API reference pages that are named by their title and by nothing else. Some sources index
 * such pages without a symbol: the class pages of Esri Leaflet and Survey123 (`L.esri.featureLayer`,
 * `Survey123WebForm`), a REST operation whose page is titled `search: Search` or
 * `GET /places/near-point`. The symbol table does not know them, but a caller who writes the
 * name the page is titled with means that page.
 */
import type { CatalogRecord } from '../../core/types.js';
import type { IndexInternals } from '../index/types.js';
import type { Target } from './target.js';

/** Catalogue hits inspected for a title that is the name. */
const TITLE_CANDIDATES = 20;

const HTTP_VERB = /^(?:GET|POST|PUT|PATCH|DELETE)\s+/i;

/**
 * A word or bracket that qualifies a name in a title without being part of it: CityEngine's
 * `alignScopeToAxes operation`, I3S's `nodePageDefinition [common profile]`.
 */
const QUALIFIER = /\s+(?:operation|function|\[[^\]]*\])$/i;

/** The profile suffix of an I3S specification file name (`nodePageDefinition.cmn`). */
const PROFILE_SUFFIX = /\.(?:cmn|psl|pcsl|bld|msh)$/i;

/** Kinds of the pages a title can name a symbol on: API references and specifications. */
const TITLED_KINDS = ['api', 'spec'] as const;

function lastSegment(name: string): string {
  return name.split(/::|[.#/]/).at(-1) ?? name;
}

/** The names a page title can be asked for by, lower-case. */
function titleNames(title: string): Set<string> {
  const whole = title.trim();
  const bare = whole.replace(HTTP_VERB, '');
  // `search: Search` and `/generateToken: Generate Token` open with the operation's name.
  const beforeColon = /^([^\s:]+):\s/.exec(bare)?.[1];
  const unqualified = bare.replace(QUALIFIER, '');
  const stem = unqualified.replace(PROFILE_SUFFIX, '');
  const forms = [
    whole,
    bare,
    ...(beforeColon === undefined ? [] : [beforeColon]),
    ...(unqualified === bare ? [] : [unqualified]),
    ...(stem === unqualified ? [] : [stem]),
  ];
  const names = new Set<string>();
  for (const form of forms) {
    const plain = form.replace(/^\//, '').replace(/\(\)$/, '');
    // A title in sentence form names nothing by its last word.
    for (const name of /\s/.test(plain) ? [form] : [form, plain, lastSegment(plain)]) {
      if (name !== '') names.add(name.toLowerCase());
    }
  }
  return names;
}

/** How a symbol was matched to a page title. */
export interface TitledMatch {
  record: CatalogRecord;
  /** True when the title is the input as written, apart from case. */
  exact: boolean;
}

/**
 * The API and specification pages of the targets whose title names `symbol`, best first: titles equal to the
 * input before titles that only end with it. Records that carry a symbol of their own are
 * included, since a page may be titled differently from its symbol (`places.nearPointGet`).
 */
export function titledRecords(
  index: IndexInternals,
  symbol: string,
  targets: readonly Target[],
): TitledMatch[] {
  const input = symbol.trim();
  if (input === '' || targets.length === 0) return [];
  const wanted = new Set([input, input.replace(/^\//, '')].map((form) => form.toLowerCase()));
  const lines = new Map(targets.map((target) => [target.product.id, target.line.id]));
  const hits = TITLED_KINDS.flatMap(
    (kind) =>
      index.query({
        text: input,
        products: [...lines.keys()],
        kind,
        limit: TITLE_CANDIDATES,
        offset: 0,
      }).hits,
  );
  const matches: TitledMatch[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const record = index.record(hit.ref);
    if (record === undefined || record.parent !== undefined || seen.has(record.ref)) continue;
    if (record.line !== lines.get(record.product)) continue;
    const names = titleNames(record.title);
    if (![...wanted].some((form) => names.has(form))) continue;
    seen.add(record.ref);
    matches.push({ record, exact: record.title.trim().toLowerCase() === input.toLowerCase() });
  }
  return matches.sort((a, b) => Number(b.exact) - Number(a.exact));
}

/**
 * A record that can be shown and looked up by name: one without a symbol is named by its
 * title, which is how {@link titledRecords} finds it again.
 */
export function namedByTitle(record: CatalogRecord): CatalogRecord {
  if (record.symbol !== undefined || record.qualified !== undefined) return record;
  return { ...record, symbol: record.title, qualified: record.title };
}
