/**
 * Manifest patterns of workspace detection: which files name a project's dependencies and
 * how each one is read. Only package names and versions are extracted; nothing else of a
 * manifest is kept.
 */
import { matchesAnyGlob } from '../core/glob.js';
import type { Dependency } from './dependency.js';
import {
  parseCsproj,
  parseGradle,
  parsePackageResolved,
  parsePubspec,
  parsePubspecLock,
  parseVersionCatalog,
} from './parsers-native.js';
import {
  parseCondaEnvironment,
  parsePackageJson,
  parsePackageLock,
  parsePyproject,
  parseRequirements,
} from './parsers-web-python.js';

/** One kind of manifest. */
export interface ManifestKind {
  id: string;
  /** Globs over project-relative paths (the dialect of `src/core/glob.ts`). */
  files: readonly string[];
  /** Never throws: malformed input gives `[]`. */
  parse(text: string): Dependency[];
}

/** Every manifest type of design section 7. */
export const MANIFEST_KINDS: readonly ManifestKind[] = [
  // The lock file states what is installed; `package.json` usually states a range.
  { id: 'package-lock.json', files: ['**/package-lock.json'], parse: parsePackageLock },
  { id: 'package.json', files: ['**/package.json'], parse: parsePackageJson },
  { id: 'requirements.txt', files: ['**/requirements*.txt'], parse: parseRequirements },
  { id: 'pyproject.toml', files: ['**/pyproject.toml'], parse: parsePyproject },
  {
    id: 'environment.yml',
    files: ['**/environment.yml', '**/environment.yaml'],
    parse: parseCondaEnvironment,
  },
  {
    id: 'csproj',
    files: ['**/*.csproj', '**/Directory.Packages.props', '**/Directory.Build.props'],
    parse: parseCsproj,
  },
  { id: 'pubspec.lock', files: ['**/pubspec.lock'], parse: parsePubspecLock },
  { id: 'pubspec.yaml', files: ['**/pubspec.yaml'], parse: parsePubspec },
  { id: 'gradle', files: ['**/build.gradle', '**/build.gradle.kts'], parse: parseGradle },
  { id: 'libs.versions.toml', files: ['**/libs.versions.toml'], parse: parseVersionCatalog },
  { id: 'Package.resolved', files: ['**/Package.resolved'], parse: parsePackageResolved },
];

/** The manifest kind that reads a project-relative path, if any. */
export function manifestKindOf(path: string): ManifestKind | undefined {
  return MANIFEST_KINDS.find((kind) => matchesAnyGlob(path, kind.files));
}
