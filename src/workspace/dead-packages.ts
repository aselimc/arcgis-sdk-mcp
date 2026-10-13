/**
 * npm packages that still install but must not be used for new ArcGIS code. A project that
 * depends on one gets a warning with the replacement in `arcgis_docs_get_versions`.
 */
import type { Dependency } from './dependency.js';

/** One retired package and what replaces it. */
export interface DeadPackage {
  name: string;
  /** Id of the product the package belonged to. */
  product: string;
  /** Why it is dead, as a clause that follows the package name. */
  reason: string;
  /** What to use instead, as an imperative sentence without a trailing period. */
  replacement: string;
  /** True when the package's version numbers are the SDK's own (`arcgis-js-api` 4.x). */
  versionIsSdkVersion: boolean;
}

/** The dead packages of design section 3.8 (brief `legacy/do-not-use`). */
export const DEAD_PACKAGES: readonly DeadPackage[] = [
  {
    name: '@arcgis/ai-orchestrator',
    product: 'js-maps-sdk',
    reason: 'was an internal dependency of @arcgis/ai-components 5.0 and was removed at 5.1',
    replacement: 'Use the components of @arcgis/ai-components',
    versionIsSdkVersion: false,
  },
  {
    name: '@arcgis/ai-agents',
    product: 'js-maps-sdk',
    reason: 'was an internal dependency of @arcgis/ai-components 5.0 and was removed at 5.1',
    replacement: 'Use the components of @arcgis/ai-components',
    versionIsSdkVersion: false,
  },
  {
    name: 'arcgis-js-api',
    product: 'js-maps-sdk',
    reason: 'is the legacy AMD build of the JavaScript SDK; its repository is archived',
    replacement: 'Install @arcgis/core and import ES modules',
    versionIsSdkVersion: true,
  },
  {
    name: 'esri-loader',
    product: 'js-maps-sdk',
    reason: 'is the archived loader for the AMD build of the JavaScript SDK',
    replacement:
      'Install @arcgis/core and import ES modules, or load the components from @arcgis/map-components',
    versionIsSdkVersion: false,
  },
  {
    name: '@arcgis/cli',
    product: 'js-maps-sdk',
    reason: 'has not been published since 4.25',
    replacement:
      'Start from the templates in https://github.com/Esri/jsapi-resources with a standard bundler',
    versionIsSdkVersion: false,
  },
];

/** A dead package found in a manifest. */
export interface DeadPackageHit {
  package: DeadPackage;
  /** The version the manifest states; empty when it states none. */
  version: string;
  /** Manifest path relative to the project directory. */
  file: string;
}

const byName = new Map(DEAD_PACKAGES.map((entry) => [entry.name, entry]));

/** The dead-package entry for an npm dependency, if it is one. */
export function deadPackageOf(found: Dependency): DeadPackage | undefined {
  return found.ecosystem === 'npm' ? byName.get(found.name.toLowerCase()) : undefined;
}

/** The warning line for one hit: what was found where, why it is dead and what replaces it. */
export function deadPackageWarning(hit: DeadPackageHit): string {
  const at = hit.version === '' ? '' : `@${hit.version}`;
  return `${hit.file} depends on ${hit.package.name}${at}, which ${hit.package.reason}. ${hit.package.replacement}.`;
}
