/**
 * Esri packages installed in the user's project (capability `local-packages`).
 *
 * The installed copy is the best source there is: it is exactly the version the project
 * compiles against, and reading it needs no network. This is the only adapter file that
 * touches the file system; it reads inside `node_modules/@arcgis/*` and `node_modules/@esri/*`
 * and nowhere else.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Ctx } from '../../../core/ports.js';
import { parseVersion } from '../../../core/version-key.js';
import { isRecord, str } from './shared.js';

/** An installed package: its name, the version its manifest states and its directory. */
export interface LocalPackage {
  name: string;
  version: string;
  /** Absolute path of the package directory. */
  dir: string;
}

/** Scoped Esri package names; the only ones looked up locally (design section 6.3). */
const ESRI_PACKAGE = /^@(?:arcgis|esri)\/[a-z0-9][a-z0-9._-]*$/;

/** How many parent directories of the project are searched for a hoisting `node_modules`. */
const MAX_PARENT_LEVELS = 5;

/** The version of the package manifest in `dir`, when it is the manifest of `name`. */
async function installedVersion(dir: string, name: string): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    if (!isRecord(manifest) || manifest.name !== name) return undefined;
    const version = str(manifest.version);
    return version !== undefined && parseVersion(version).length > 0 ? version : undefined;
  } catch {
    // Not installed here, unreadable or not JSON: the next directory or the network answers.
    return undefined;
  }
}

/**
 * Finds a package in the project's `node_modules`, walking up at most five parent directories
 * (a workspace hoists dependencies to its root).
 *
 * @returns `undefined` when capability `local-packages` is off, the name is not an Esri
 *   scoped package, or nothing is installed.
 */
export async function findLocalPackage(
  ctx: Pick<Ctx, 'config' | 'policy'>,
  name: string,
): Promise<LocalPackage | undefined> {
  if (!ctx.policy.enabled('local-packages') || !ESRI_PACKAGE.test(name)) return undefined;
  let dir = resolve(ctx.config.projectDir);
  for (let level = 0; level <= MAX_PARENT_LEVELS; level++) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    const version = await installedVersion(candidate, name);
    if (version !== undefined) return { name, version, dir: candidate };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Reads one file of an installed package as UTF-8 text without a byte-order mark.
 *
 * @param path relative to the package root; a path that leaves the package is refused.
 * @returns `undefined` when the file is missing, unreadable, outside the package or larger
 *   than `maxBytes`, so the caller can fall back to the published copy.
 */
export async function readLocalFile(
  pkg: LocalPackage,
  path: string,
  maxBytes: number,
): Promise<string | undefined> {
  const file = resolve(pkg.dir, path);
  if (!file.startsWith(pkg.dir + sep)) return undefined;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const text = await readFile(file, 'utf8');
    // A byte-order mark is not part of the content.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return undefined;
  }
}

/**
 * Lists the files of an installed package whose name ends with `suffix`, as sorted paths
 * relative to the package root with forward slashes. Nested `node_modules` are skipped.
 *
 * @returns `[]` when the directory cannot be read.
 */
export async function listLocalFiles(pkg: LocalPackage, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(pkg.dir, { recursive: true });
    return entries
      .map((entry) => entry.split(sep).join('/'))
      .filter((entry) => entry.endsWith(suffix) && !/(?:^|\/)node_modules\//.test(entry))
      .sort();
  } catch {
    return [];
  }
}
