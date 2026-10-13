/**
 * Versions that are directories of one source rather than version lines of a product. The
 * I3S specification keeps every release side by side (`docs/1.9/3DSceneLayer.cmn.md`,
 * `docs/1.10/...`) in one repository, which the registry knows as one line. A search for
 * `version: "1.9"` then has to mean that directory, and a search without a version should
 * not list the same file five times.
 */
import type { SearchHit } from '../../core/types.js';

/** A path segment that is a version number: `1.9`, `1.10`, `2.0.1`. */
const VERSION_SEGMENT = /\/(\d+\.\d+(?:\.\d+)?)(?=\/)/;

/** The version directory in the path of a ref, if it has one. */
export function versionDirectory(ref: string): string | undefined {
  try {
    return VERSION_SEGMENT.exec(new URL(ref).pathname)?.[1];
  } catch {
    return undefined;
  }
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let position = 0; position < Math.max(left.length, right.length); position++) {
    const difference = (left[position] ?? 0) - (right[position] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** What makes two hits copies of one document in different version directories. */
function familyOf(hit: SearchHit, directory: string): string {
  return `${hit.product}\n${hit.source}\n${hit.ref.replace(`/${directory}/`, '/{version}/')}`;
}

/** The outcome of {@link applyVersionFacet}. */
export interface Faceted {
  hits: SearchHit[];
  /** The directory the hits were narrowed to, when the requested version named one. */
  narrowedTo?: string;
}

/**
 * Applies version directories to a hit list, keeping its order.
 *
 * - With a `version` that is a directory of some hit: hits of other directories are left
 *   out; hits outside any version directory stay.
 * - Without a version: of the copies of one document, only the newest directory's stays.
 */
export function applyVersionFacet(hits: readonly SearchHit[], version: string | undefined): Faceted {
  const directories = hits.map((hit) => versionDirectory(hit.ref));
  const wanted = version?.trim().replace(/^v(?=\d)/i, '');
  if (wanted !== undefined) {
    if (!directories.includes(wanted)) return { hits: [...hits] };
    return {
      hits: hits.filter((_, position) => {
        const directory = directories[position];
        return directory === undefined || directory === wanted;
      }),
      narrowedTo: wanted,
    };
  }
  const newest = new Map<string, string>();
  hits.forEach((hit, position) => {
    const directory = directories[position];
    if (directory === undefined) return;
    const family = familyOf(hit, directory);
    const known = newest.get(family);
    if (known === undefined || compareVersions(directory, known) > 0) newest.set(family, directory);
  });
  return {
    hits: hits.filter((hit, position) => {
      const directory = directories[position];
      return directory === undefined || newest.get(familyOf(hit, directory)) === directory;
    }),
  };
}
