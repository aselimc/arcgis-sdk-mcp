/**
 * The bounded file walk of workspace detection: the project root and two
 * directory levels below it, at most 200 manifest files of at most 1 MB each, never inside
 * dependency, VCS or build directories. Nothing here touches the network.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Limits of one scan. */
export interface ScanLimits {
  /** Manifest files read. */
  maxFiles: number;
  /** Size of one manifest file. */
  maxBytes: number;
  /** Directory levels below the root. */
  maxDepth: number;
  /** Directory entries looked at, so a huge flat directory cannot stall start-up. */
  maxEntries: number;
}

/** The limits of the design: 200 files, 1 MB each, root + 2 levels. */
export const DEFAULT_SCAN_LIMITS: Readonly<ScanLimits> = {
  maxFiles: 200,
  maxBytes: 1_048_576,
  maxDepth: 2,
  maxEntries: 20_000,
};

/** Directories that hold dependencies, build output or tool state, never the project's own manifests. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'target',
  'coverage',
  'venv',
  'env',
  '__pycache__',
  'site-packages',
  'Pods',
  'Carthage',
  'DerivedData',
  'Library',
  'Temp',
  'Intermediate',
  'Binaries',
  'Saved',
]);

/**
 * Fixed locations inside an Xcode bundle. `Package.resolved` sits four levels deep there, so
 * it is probed directly instead of widening the walk for every project.
 */
const XCODE_BUNDLE_FILES = [
  'project.pbxproj',
  'project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
  'xcshareddata/swiftpm/Package.resolved',
];

/** One file the scan read. */
export interface ScannedFile {
  /** Path relative to the project directory, with `/` separators. */
  path: string;
  text: string;
}

/** Result of {@link scanFiles}. */
export interface ScanResult {
  files: ScannedFile[];
  /** True when a limit stopped the walk before every directory was seen. */
  truncated: boolean;
}

const isSkipped = (name: string): boolean => name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
const isXcodeBundle = (name: string): boolean => /\.(?:xcodeproj|xcworkspace)$/.test(name);

/**
 * Walks `root` breadth-first (so the root's own manifests are read first) and returns the
 * text of every file `wanted` selects. Unreadable directories and files are skipped: a
 * project that cannot be scanned is a project without detected SDKs, not an error. Symbolic
 * links are not followed.
 *
 * @param wanted receives the path relative to `root` with `/` separators.
 */
export async function scanFiles(
  root: string,
  wanted: (relativePath: string) => boolean,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  let entriesSeen = 0;
  let truncated = false;

  const take = async (relativePath: string): Promise<void> => {
    if (files.length >= limits.maxFiles) {
      truncated = true;
      return;
    }
    const absolute = join(root, relativePath);
    try {
      if ((await stat(absolute)).size > limits.maxBytes) return;
      files.push({ path: relativePath, text: await readFile(absolute, 'utf8') });
    } catch {
      // Gone or unreadable since it was listed: not a manifest we can use.
    }
  };

  let level = [''];
  for (let depth = 0; depth <= limits.maxDepth && level.length > 0; depth++) {
    const next: string[] = [];
    for (const directory of level) {
      let entries;
      try {
        entries = await readdir(join(root, directory), { withFileTypes: true });
      } catch {
        continue;
      }
      // Sorted so that the same project always yields the same result on every platform.
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        entriesSeen += 1;
        if (entriesSeen > limits.maxEntries) return { files, truncated: true };
        const relativePath = directory === '' ? entry.name : `${directory}/${entry.name}`;
        if (entry.isFile()) {
          if (wanted(relativePath)) await take(relativePath);
        } else if (entry.isDirectory() && isXcodeBundle(entry.name)) {
          for (const inner of XCODE_BUNDLE_FILES) {
            const innerPath = `${relativePath}/${inner}`;
            if (wanted(innerPath)) await take(innerPath);
          }
        } else if (entry.isDirectory() && !isSkipped(entry.name)) {
          next.push(relativePath);
        }
      }
    }
    level = next;
  }
  return { files, truncated };
}
