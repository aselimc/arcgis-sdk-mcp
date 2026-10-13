/**
 * Mapper `arcade-profiles`: the Arcade profiles shipped in `@arcgis/coding-components`
 * (`arcade-profiles.t9n.en.json`, `js-web.md` section 4). The file is an array of profiles
 * `{ id, name, bundles, variables }`; a profile says which function bundles and which
 * profile variables (`$feature`, `$layer`) an expression may use in one context.
 */
import type { Ctx, RenderOptions } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
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
import { baseRecord, fragmentOf, notFound, records, shapeError, str, type Json } from './shared.js';

/** One profile. */
interface Profile {
  raw: Json;
  id: string;
  name: string;
  ref: string;
}

/** How many profile ids a not-found answer lists. */
const MAX_CANDIDATES = 10;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((entry) => str(entry) ?? []) : [];
}

/**
 * Parses the file into profiles. A profile's ref is its page under the source's `docUrl`
 * when the registry declares one, else the file URL with the profile id as fragment.
 *
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the file is not a list of
 *   profiles with an `id`; an empty list is valid.
 */
function parse(src: JsonSrc, loaded: LoadedFile): Profile[] {
  const { data, url } = loaded.file;
  const entries = Array.isArray(data) ? records(data) : undefined;
  const root = docRoot(src);
  const file = fileRef(src);
  const profiles = (entries ?? []).flatMap((raw): Profile[] => {
    const id = str(raw.id);
    if (id === undefined) return [];
    return [
      {
        raw,
        id,
        name: str(raw.name) ?? id,
        ref: root === undefined ? `${file}#${id}` : `${root}${id}/`,
      },
    ];
  });
  if (entries === undefined || (entries.length > 0 && profiles.length === 0)) {
    throw shapeError(url, 'an Arcade profile list');
  }
  return profiles;
}

function profileRecord(src: JsonSrc, profile: Profile): CatalogRecord {
  const variables = records(profile.raw.variables).flatMap((variable) => str(variable.name) ?? []);
  const bundles = strings(profile.raw.bundles);
  const description = [
    variables.length === 0 ? undefined : `Profile variables: ${variables.join(', ')}`,
    bundles.length === 0 ? undefined : `Function bundles: ${bundles.join(', ')}`,
  ]
    .filter((part) => part !== undefined)
    .join('. ');
  return {
    ...baseRecord(src, profile.ref, `${profile.name} profile`),
    symbol: profile.id,
    qualified: profile.id,
    symbolKind: 'profile',
    ...(description === '' ? {} : { description }),
    // Profile variables are what an expression author searches for (`$feature`, `$datastore`).
    keywords: [profile.name, ...variables, ...bundles],
    locator: { profile: profile.id },
  };
}

/** The `arcade-profiles` mapper. */
export const arcadeProfilesMapper: JsonMapper = {
  records(src, loaded) {
    const byRef = new Map<string, CatalogRecord>();
    for (const profile of parse(src, loaded)) {
      if (!byRef.has(profile.ref)) byRef.set(profile.ref, profileRecord(src, profile));
    }
    return [...byRef.values()];
  },

  page(ctx: Ctx, src, loaded, target): DocPage {
    const profiles = parse(src, loaded);
    const wanted = pageKey(target.url.href);
    // On the file URL every profile shares one path, so only the fragment tells them apart.
    const onFile = wanted === pageKey(fileRef(src));
    const id = target.record?.locator?.profile ?? (onFile ? fragmentOf(target.url) : undefined);
    const profile =
      profiles.find((candidate) => candidate.id === id) ??
      (onFile ? undefined : profiles.find((candidate) => pageKey(candidate.ref) === wanted));
    if (profile === undefined) {
      throw notFound(
        target.url.href,
        `${target.url.href} names no Arcade profile`,
        'A profile is addressed by its id',
        { candidates: profiles.slice(0, MAX_CANDIDATES).map((candidate) => candidate.ref) },
      );
    }
    // The fragment names the profile, not a part of it, so only an explicit selector applies.
    const opts: RenderOptions = {
      ...(target.select === undefined ? {} : { select: target.select }),
      ...(target.detail === undefined ? {} : { detail: target.detail }),
    };
    const page = ctx.render.render(
      'arcade',
      { item: profile.raw, profile: true },
      packageMeta(src, loaded.pkg, loaded.file, profile.ref),
      Object.keys(opts).length === 0 ? undefined : opts,
    );
    return fromPackage(page, loaded.pkg);
  },
};
