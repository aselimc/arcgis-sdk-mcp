/**
 * Workspace detection (design decision 16): which Esri SDKs does the user's project use, and
 * at which version? Answers come from package manifests only (names and versions), read
 * with a bounded walk of the project directory; there is no network access and nothing is
 * read in HTTP mode or with capability `workspace` switched off.
 *
 * Two mechanisms feed the result. The manifest readers of `signals.ts` extract every
 * dependency and look it up among the registry's packages. The `workspaceSignals` a product
 * declares (a file glob list and a regular expression) cover everything else: project files
 * without a package registry, such as a Unity `Packages/manifest.json` or an `.uproject`.
 */
import type { DetectWorkspace } from '../core/factories.js';
import { matchesAnyGlob } from '../core/glob.js';
import type { Product, WorkspaceSdk, WorkspaceSignal } from '../core/types.js';
import { deadPackageOf, type DeadPackageHit } from './dead-packages.js';
import { cleanVersion } from './dependency.js';
import { buildPackageIndex } from './match.js';
import { DEFAULT_SCAN_LIMITS, scanFiles, type ScanLimits, type ScannedFile } from './scan.js';
import { MANIFEST_KINDS, manifestKindOf } from './signals.js';

/** Everything one scan found. */
export interface WorkspaceScan {
  /**
   * One entry per product and package, a product's primary package first. `version` is an
   * empty string when no manifest states one (`"*"`, a path dependency, a project file
   * that only names the SDK).
   */
  sdks: WorkspaceSdk[];
  /** Retired npm packages the project depends on. */
  dead: DeadPackageHit[];
  /** True when a scan limit was reached, so the result may be incomplete. */
  truncated: boolean;
}

/** One sighting of a product in a manifest, before the best one per package is chosen. */
interface Sighting {
  product: Product;
  package: string;
  version: string;
  file: string;
  primary: boolean;
  /** A lock file or exact pin. */
  exact: boolean;
  /** Read by a manifest parser rather than a registry regex. */
  structured: boolean;
}

const depthOf = (path: string): number => path.split('/').length;

/** Preference among sightings of the same package: a stated version, an exact one, a parsed one, the shallowest file. */
function better(a: Sighting, b: Sighting): boolean {
  const rank = (s: Sighting): number[] => [
    Number(s.version !== ''),
    Number(s.exact),
    Number(s.structured),
    -depthOf(s.file),
  ];
  const left = rank(a);
  const right = rank(b);
  for (let i = 0; i < left.length; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * The package a registry signal is about: the product package whose name appears in the
 * pattern (longest first), else the primary package, else the product id.
 */
function signalPackage(
  product: Product,
  signal: WorkspaceSignal,
): { name: string; primary: boolean } {
  const literal = signal.pattern.replace(/\\(.)/g, '$1').toLowerCase();
  const primary = product.packages.find((ref) => ref.primary === true) ?? product.packages[0];
  const named = [...product.packages]
    .sort((a, b) => b.name.length - a.name.length)
    .find((ref) => literal.includes(ref.name.toLowerCase()));
  const chosen = named ?? primary;
  return { name: chosen?.name ?? product.id, primary: chosen === primary };
}

/** Sightings from the `workspaceSignals` of every product, for one file. */
function signalSightings(file: ScannedFile, products: readonly Product[]): Sighting[] {
  const found: Sighting[] = [];
  for (const product of products) {
    for (const signal of product.workspaceSignals ?? []) {
      if (!matchesAnyGlob(file.path, signal.files)) continue;
      let match: RegExpExecArray | null;
      try {
        match = new RegExp(signal.pattern).exec(file.text);
      } catch {
        // The registry lint rejects patterns that do not compile; never fail a scan on one.
        continue;
      }
      if (match === null) continue;
      const chosen = signalPackage(product, signal);
      const raw = signal.versionGroup === undefined ? undefined : match[signal.versionGroup];
      found.push({
        product,
        package: chosen.name,
        version: cleanVersion(raw ?? ''),
        file: file.path,
        primary: chosen.primary,
        exact: false,
        structured: false,
      });
    }
  }
  return found;
}

/**
 * Scans the project directory. Returns an empty result in HTTP mode, with capability
 * `workspace` off, and for a directory that does not exist or cannot be read.
 */
export async function scanWorkspace(
  deps: Parameters<DetectWorkspace>[0],
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): Promise<WorkspaceScan> {
  const { config, registry, logger } = deps;
  if (config.mode !== 'stdio' || !config.capabilities.has('workspace')) {
    return { sdks: [], dead: [], truncated: false };
  }
  const products = registry.all();
  const signalGlobs = products.flatMap((product) =>
    (product.workspaceSignals ?? []).flatMap((signal) => signal.files),
  );
  const manifestGlobs = MANIFEST_KINDS.flatMap((kind) => kind.files);
  const { files, truncated } = await scanFiles(
    config.projectDir,
    (path) => matchesAnyGlob(path, manifestGlobs) || matchesAnyGlob(path, signalGlobs),
    limits,
  );

  const index = buildPackageIndex(registry);
  const sightings: Sighting[] = [];
  const dead: DeadPackageHit[] = [];
  for (const file of files) {
    for (const found of manifestKindOf(file.path)?.parse(file.text) ?? []) {
      const retired = deadPackageOf(found);
      if (retired !== undefined) {
        dead.push({ package: retired, version: found.version, file: file.path });
        const product = retired.versionIsSdkVersion ? registry.get(retired.product) : undefined;
        if (product !== undefined) {
          sightings.push({
            product,
            package: retired.name,
            version: found.version,
            file: file.path,
            primary: false,
            exact: found.exact,
            structured: true,
          });
        }
        continue;
      }
      const match = index.find(found);
      if (match === undefined) continue;
      sightings.push({
        product: match.product,
        package: match.package,
        version: found.version,
        file: file.path,
        primary: match.primary,
        exact: found.exact,
        structured: true,
      });
    }
    sightings.push(...signalSightings(file, products));
  }

  const best = new Map<string, Sighting>();
  for (const sighting of sightings) {
    const id = `${sighting.product.id}\n${sighting.package.toLowerCase()}`;
    const known = best.get(id);
    if (known === undefined || better(sighting, known)) best.set(id, sighting);
  }
  const sdks = [...best.values()]
    .sort(
      (a, b) =>
        a.product.id.localeCompare(b.product.id) ||
        Number(b.primary) - Number(a.primary) ||
        a.package.localeCompare(b.package),
    )
    .map(({ product, package: name, version, file }) => ({
      product: product.id,
      package: name,
      version,
      file,
    }));

  if (truncated) logger.warn('workspace scan stopped at a limit', { files: files.length });
  for (const hit of dead) {
    logger.warn('project depends on a retired package', {
      package: hit.package.name,
      file: hit.file,
    });
  }
  logger.debug('workspace scanned', { files: files.length, sdks: sdks.length });
  return { sdks, dead, truncated };
}

/** The `DetectWorkspace` factory of `src/core/factories.ts`: the SDKs of {@link scanWorkspace}. */
export const detectWorkspace: DetectWorkspace = async (deps) => (await scanWorkspace(deps)).sdks;
