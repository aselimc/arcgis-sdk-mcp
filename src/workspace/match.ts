/**
 * From a dependency to a product. The registry lists each product's packages; a dependency
 * that is none of them is still recognised when its name is Esri-shaped and is a product id
 * or alias (`arcpy` ships with ArcGIS Pro and is on no registry).
 */
import { isMcpDocError } from '../core/errors.js';
import type { Registry } from '../core/ports.js';
import type { PackageRef, Product } from '../core/types.js';
import type { Dependency } from './dependency.js';

/** A dependency resolved to a product. */
export interface PackageMatch {
  product: Product;
  /** The package name as the registry writes it, or as the manifest does for an alias match. */
  package: string;
  /** True when the package is the one whose version is the product version. */
  primary: boolean;
}

/** Looks a dependency up among the registry's packages and aliases. */
export interface PackageIndex {
  find(found: Dependency): PackageMatch | undefined;
}

/** Names that can only belong to Esri software; the gate in front of alias matching. */
const ESRI_SHAPED = /arcgis|esri|arcpy|calcite|jimu/i;

/** Registry names compare case-insensitively; Python names treat `-`, `_` and `.` alike (PEP 503). */
function normalise(ecosystem: PackageRef['registry'], name: string): string {
  const lower = name.trim().toLowerCase();
  return ecosystem === 'pypi' ? lower.replace(/[-_.]+/g, '-') : lower;
}

const key = (ecosystem: PackageRef['registry'], name: string): string =>
  `${ecosystem}:${normalise(ecosystem, name)}`;

/** The artifact id of a Maven coordinate. */
const artifactOf = (name: string): string => name.split(':').at(-1) ?? name;

/** Builds the lookup once per scan. The first product listing a package owns it. */
export function buildPackageIndex(registry: Registry): PackageIndex {
  const packages = new Map<string, PackageMatch>();
  const register = (id: string, match: PackageMatch): void => {
    if (!packages.has(id)) packages.set(id, match);
  };
  for (const product of registry.all()) {
    const primary = product.packages.find((ref) => ref.primary === true) ?? product.packages[0];
    for (const ref of product.packages) {
      const match = { product, package: ref.name, primary: ref === primary };
      register(key(ref.registry, ref.name), match);
      // A build script may name only the artifact where the registry writes group:artifact.
      if (ref.registry === 'maven') register(key('maven', artifactOf(ref.name)), match);
    }
  }

  const byAlias = (name: string): Product | undefined => {
    if (!ESRI_SHAPED.test(name)) return undefined;
    try {
      const resolved = registry.resolve(name);
      // A fuzzy or scoped match is a guess; only an exact id or alias identifies a package.
      return resolved.how === 'id' || resolved.how === 'alias' ? resolved.product : undefined;
    } catch (error) {
      if (isMcpDocError(error)) return undefined;
      throw error;
    }
  };

  return {
    find(found) {
      const names =
        found.ecosystem === 'maven' ? [found.name, artifactOf(found.name)] : [found.name];
      for (const name of names) {
        const listed = packages.get(key(found.ecosystem, name));
        if (listed !== undefined) return listed;
      }
      for (const name of names) {
        const product = byAlias(name);
        if (product !== undefined) {
          return { product, package: found.name, primary: product.packages.length === 0 };
        }
      }
      return undefined;
    },
  };
}
