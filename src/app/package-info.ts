/**
 * This package's own version and project URL, read from its `package.json`. Both feed the
 * `User-Agent` header, the MCP server info and `--version`.
 */
import { readFileSync } from 'node:fs';

/** The two facts of `package.json` the server needs; the `pkg` argument of `loadConfig`. */
export interface PackageInfo {
  version: string;
  repoUrl: string;
}

/** Used when `package.json` is unreadable or lacks a repository (a bundled or vendored copy). */
export const FALLBACK_PACKAGE_INFO: Readonly<PackageInfo> = {
  version: '0.0.0',
  repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp',
};

/** `git+https://github.com/o/r.git` and the object form of `repository` to a plain https URL. */
function repositoryUrl(repository: unknown): string | undefined {
  const raw =
    typeof repository === 'string'
      ? repository
      : typeof repository === 'object' && repository !== null
        ? (repository as { url?: unknown }).url
        : undefined;
  if (typeof raw !== 'string') return undefined;
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '');
  return /^https:\/\/\S+$/.test(url) ? url : undefined;
}

/**
 * Extracts {@link PackageInfo} from the text of a `package.json`, falling back field by
 * field. Never throws: a broken manifest must not keep the server from starting.
 */
export function parsePackageInfo(json: string): PackageInfo {
  let manifest: { version?: unknown; repository?: unknown };
  try {
    const parsed: unknown = JSON.parse(json);
    manifest = typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    manifest = {};
  }
  const { version } = manifest;
  return {
    version:
      typeof version === 'string' && version !== '' ? version : FALLBACK_PACKAGE_INFO.version,
    repoUrl: repositoryUrl(manifest.repository) ?? FALLBACK_PACKAGE_INFO.repoUrl,
  };
}

/**
 * Reads the manifest two directories above this module, which is the package root both for
 * `src/app` (run with tsx) and for `dist/app` (the published build).
 *
 * @param location overrides the manifest URL (tests).
 */
export function readPackageInfo(
  location: URL = new URL('../../package.json', import.meta.url),
): PackageInfo {
  try {
    return parsePackageInfo(readFileSync(location, 'utf8'));
  } catch {
    return { ...FALLBACK_PACKAGE_INFO };
  }
}
