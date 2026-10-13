import type { Registry } from '../../src/core/ports.js';
import type { Product } from '../../src/core/types.js';

/**
 * Loads the registry data modules that exist. The data files are written by more than one
 * author, so the data-driven tests (schema, invariants) run over whatever is present instead
 * of failing to load when one file is missing; `complete` tells whether all are there.
 */

/** Data modules of the registry and the export each one carries. */
const MODULES = [
  ['web', 'webProducts'],
  ['native', 'nativeProducts'],
  ['python', 'pythonProducts'],
  ['desktop-enterprise', 'desktopEnterpriseProducts'],
  ['rest-services', 'restServicesProducts'],
  ['ai', 'aiProducts'],
  ['support', 'supportProducts'],
  ['specs', 'specsProducts'],
  ['devops-oss', 'devopsOssProducts'],
  ['legacy', 'legacyProducts'],
  ['help.generated', 'helpProducts'],
] as const;

type Brief = ReturnType<Registry['briefs']>[number];

/** The registry data found on disk. */
export interface LoadedData {
  products: Product[];
  briefs: Brief[];
  /** Module names that could not be loaded. */
  missing: string[];
  /** True when every data module was loaded. */
  complete: boolean;
}

async function load(name: string): Promise<Record<string, unknown> | undefined> {
  try {
    // A computed specifier: a missing sibling file must not stop this module from loading.
    return (await import(`../../src/registry/data/${name}.ts`)) as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const text = error instanceof Error ? error.message : String(error);
    // Only "the file is not there" is tolerated; a file that exists and throws is a failure.
    // The first message is how the test runner reports a computed import without a file.
    if (
      code === 'ERR_MODULE_NOT_FOUND' ||
      /Unknown variable dynamic import|Cannot find module|Failed to load url/i.test(text)
    ) {
      return undefined;
    }
    throw error;
  }
}

/** Loads every data module that exists, in registry order. */
export async function loadData(): Promise<LoadedData> {
  const products: Product[] = [];
  const missing: string[] = [];
  for (const [name, exported] of MODULES) {
    const loaded = await load(name);
    const list = loaded?.[exported];
    if (Array.isArray(list)) products.push(...(list as Product[]));
    else missing.push(name);
  }
  const briefModule = await load('briefs.generated');
  const briefs = Array.isArray(briefModule?.BRIEFS) ? (briefModule.BRIEFS as Brief[]) : [];
  if (briefModule === undefined) missing.push('briefs.generated');
  return { products, briefs, missing, complete: missing.length === 0 };
}
