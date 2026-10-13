/**
 * Where the cache lives on disk and how entries are named. File names are hashes only, so
 * no URL, product name or other user-visible string ever becomes a path: that rules out
 * reserved Windows names, over-long paths and path traversal in one stroke.
 */
import { join, resolve } from 'node:path';
import envPaths from 'env-paths';
import type { Config } from '../core/config.js';
import { sha256Hex } from '../core/hash.js';
import { PACKAGE_NAME } from '../core/names.js';
import type { DerivedNamespace } from '../core/ports.js';

/** Schema version of the on-disk layout; it names the directory and fills the `VERSION` file. */
export const CACHE_SCHEMA_VERSION = '1';

/**
 * The cache directory: `ARCGIS_DOCS_CACHE_DIR` when set, otherwise the per-user cache
 * directory of the platform (`%LOCALAPPDATA%\arcgis-sdk-mcp\Cache`,
 * `~/Library/Caches/arcgis-sdk-mcp`, `$XDG_CACHE_HOME/arcgis-sdk-mcp`). Touches no file.
 */
export function resolveCacheDir(config: Pick<Config, 'cacheDir'>): string {
  if (config.cacheDir !== undefined) return resolve(config.cacheDir);
  return envPaths(PACKAGE_NAME, { suffix: '' }).cache;
}

/** Paths of the two files of one HTTP entry. */
export interface HttpEntryPaths {
  meta: string;
  body: string;
}

/** Absolute paths inside one cache directory. */
export interface CacheLayout {
  /** The directory the user configured or the platform default. */
  dir: string;
  /** `<dir>/v1`: everything this schema version owns. */
  root: string;
  versionFile: string;
  httpDir: string;
  derivedDir: string;
  http(key: string): HttpEntryPaths;
  derived(ns: DerivedNamespace, key: string): string;
}

/** Suffix of an HTTP entry's metadata file. */
export const META_SUFFIX = '.meta.json';
/** Suffix of an HTTP entry's gzip-compressed body file. */
export const BODY_SUFFIX = '.body.gz';
/** Suffix of a derived value's file. */
export const DERIVED_SUFFIX = '.json.gz';

/** Builds the layout `<dir>/v1/{VERSION, http/<aa>/<sha256>.*, derived/<ns>/<aa>/<sha256>.json.gz}`. */
export function cacheLayout(dir: string): CacheLayout {
  const root = join(dir, `v${CACHE_SCHEMA_VERSION}`);
  const httpDir = join(root, 'http');
  const derivedDir = join(root, 'derived');
  // Two hex characters give 256 shard directories, which keeps each one small enough for
  // fast listing on NTFS even with tens of thousands of entries.
  const sharded = (base: string, hash: string) => join(base, hash.slice(0, 2), hash);
  return {
    dir,
    root,
    versionFile: join(root, 'VERSION'),
    httpDir,
    derivedDir,
    http(key) {
      const stem = sharded(httpDir, sha256Hex(key));
      return { meta: `${stem}${META_SUFFIX}`, body: `${stem}${BODY_SUFFIX}` };
    },
    derived: (ns, key) => `${sharded(join(derivedDir, ns), sha256Hex(key))}${DERIVED_SUFFIX}`,
  };
}
