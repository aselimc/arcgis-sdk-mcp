/**
 * Esri packages installed in the user's project (capability `local-packages`).
 *
 * The installed copy is the best source there is: it is exactly the version the project
 * compiles against, and reading it needs no network. This is the only adapter file that
 * touches the file system; it reads inside `node_modules/@arcgis/*` and `node_modules/@esri/*`
 * and nowhere else.
 *
 * "Inside" is decided on real paths. A package directory may itself be a link (pnpm and npm
 * workspaces install packages that way), so it is resolved first; a link found inside the
 * package is followed only when it stays inside, and is never descended into while listing.
 * Otherwise a crafted `node_modules` could make a file from elsewhere on the machine part of
 * a tool result.
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

/** True when `path` lies below `base`; both are real, absolute paths. */
function isInside(base: string, path: string): boolean {
  const rest = relative(base, path);
  // A path on another drive has no relative form: Windows gives it back absolute.
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
}

/**
 * Reads one file of an installed package as UTF-8 text without a byte-order mark.
 *
 * @param path relative to the package root; a path that leaves the package is refused, as
 *   written and after links are resolved.
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
    // Containment is checked where the bytes really are, not where the path says they are.
    const [base, real] = await Promise.all([realpath(pkg.dir), realpath(file)]);
    if (!isInside(base, real)) return undefined;
    const info = await lstat(real);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const text = await readFile(real, 'utf8');
    // A byte-order mark is not part of the content.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return undefined;
  }
}

/** Directories deeper than this are not part of any package layout; guards against cycles. */
const MAX_DEPTH = 24;

/**
 * Lists the files of an installed package whose name ends with `suffix`, as sorted paths
 * relative to the package root with forward slashes. Nested `node_modules` are skipped, and
 * so is every link (a symbolic link or a junction): what it points to is not this package.
 *
 * @returns `[]` when the directory cannot be read.
 */
export async function listLocalFiles(pkg: LocalPackage, suffix: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && depth < MAX_DEPTH) {
          await walk(join(dir, entry.name), `${path}/`, depth + 1);
        }
      } else if (entry.isFile() && path.endsWith(suffix)) {
        found.push(path);
      }
    }
  };
  try {
    // The package directory itself may be a link; its real location is what is walked.
    await walk(await realpath(pkg.dir), '', 0);
    return found.sort();
  } catch {
    return [];
  }
}
