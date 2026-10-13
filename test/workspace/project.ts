import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import type { Product } from '../../src/core/types.js';
import { makeProduct } from '../support/builders.js';

/** Creates fixture projects; `write` adds or replaces files of one later on. */
export interface ProjectFactory {
  (files: Record<string, string>): string;
  write(root: string, files: Record<string, string>): void;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
}

/**
 * Fixture projects are written to a fresh temporary directory per test and removed
 * afterwards. Call {@link useProjects} once in a test file to get the factory.
 */
export function useProjects(): ProjectFactory {
  const created: string[] = [];
  afterEach(() => {
    for (const directory of created.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const create = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'arcgis-sdk-mcp-ws-'));
    created.push(root);
    write(root, files);
    return root;
  };
  return Object.assign(create, { write });
}

const product = (
  id: string,
  packages: Product['packages'],
  extra: Partial<Product> = {},
): Product => makeProduct({ id, name: id, aliases: [], packages, ...extra });

/** A small registry with one product per ecosystem the detector knows. */
export const WORKSPACE_PRODUCTS: Product[] = [
  product('js-maps-sdk', [
    { registry: 'npm', name: '@arcgis/core', license: 'esri-ma', primary: true },
    { registry: 'npm', name: '@arcgis/map-components', license: 'esri-ma' },
  ]),
  product('calcite', [{ registry: 'npm', name: '@esri/calcite-components', license: 'esri-ma' }]),
  product('python-api', [
    { registry: 'pypi', name: 'arcgis', license: 'apache-2.0', primary: true },
    { registry: 'pypi', name: 'arcgis-mapping', license: 'apache-2.0' },
  ]),
  // ArcPy ships with ArcGIS Pro: it has no package and is found through its product id.
  product('arcpy', []),
  product('dotnet-maps-sdk', [
    { registry: 'nuget', name: 'Esri.ArcGISRuntime', license: 'esri-ma', primary: true },
  ]),
  product('flutter-maps-sdk', [{ registry: 'pub', name: 'arcgis_maps', license: 'esri-ma' }]),
  product('kotlin-maps-sdk', [
    { registry: 'maven', name: 'com.esri:arcgis-maps-kotlin', license: 'esri-ma' },
  ]),
  product('swift-maps-sdk', [
    { registry: 'swiftpm', name: 'arcgis-maps-sdk-swift', license: 'esri-ma' },
  ]),
  product('unity-maps-sdk', [], {
    workspaceSignals: [
      {
        files: ['Packages/manifest.json'],
        pattern: '"com\\.esri\\.arcgis-maps-sdk"\\s*:\\s*"([^"]+)"',
        versionGroup: 1,
      },
    ],
  }),
  product('unreal-maps-sdk', [], {
    workspaceSignals: [{ files: ['*.uproject', '**/*.uproject'], pattern: 'ArcGISMapsSDK' }],
  }),
];
