import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import type { Product } from '../../src/core/types.js';
import { desktopEnterpriseProducts } from '../../src/registry/data/desktop-enterprise.js';
import { nativeProducts } from '../../src/registry/data/native.js';
import { pythonProducts } from '../../src/registry/data/python.js';
import { webProducts } from '../../src/registry/data/web.js';
import { lineOf } from '../../src/registry/resolve.js';
import { makeLine, makeProduct } from '../support/builders.js';

const PRODUCTS = new Map(
  [...webProducts, ...nativeProducts, ...pythonProducts, ...desktopEnterpriseProducts].map(
    (product) => [product.id, product],
  ),
);

function product(id: string): Product {
  const found = PRODUCTS.get(id);
  if (found === undefined) throw new Error(`no product ${id}`);
  return found;
}

/** `[product, version, expected line id]`. */
const LINES: Array<[string, string | undefined, string]> = [
  ['kotlin-maps-sdk', undefined, 'latest'],
  ['kotlin-maps-sdk', '', 'latest'],
  ['kotlin-maps-sdk', 'latest', 'latest'],
  ['kotlin-maps-sdk', 'v200', 'v200'],
  ['kotlin-maps-sdk', 'V200', 'v200'],
  ['kotlin-maps-sdk', '200.x LTS', 'v200'],
  ['kotlin-maps-sdk', '200', 'v200'],
  ['kotlin-maps-sdk', '200.8', 'v200'],
  ['kotlin-maps-sdk', '200.8.3', 'v200'],
  ['kotlin-maps-sdk', 'v200.8.0', 'v200'],
  ['kotlin-maps-sdk', '300.1', 'latest'],
  ['kotlin-maps-sdk', '300.1.0', 'latest'],
  ['dotnet-maps-sdk', '200.8.3', 'v200'],
  ['flutter-maps-sdk', '300.1.0+5042', 'latest'],
  ['java-maps-sdk', undefined, 'v200'],
  ['java-maps-sdk', 'latest', 'v200'],
  ['java-maps-sdk', 'current', 'v200'],
  ['java-maps-sdk', '200.6', 'v200'],
  ['unity-maps-sdk', '2.4.0', 'latest'],
  ['js-maps-sdk', undefined, 'latest'],
  ['js-maps-sdk', '5.1', 'latest'],
  ['js-maps-sdk', '5.1.27', 'latest'],
  ['js-maps-sdk', '4.33', 'npm-any-version'],
  ['js-maps-sdk', '4.33.2', 'npm-any-version'],
  ['js-maps-sdk', '6.0.0-next.6', 'npm-any-version'],
  ['js-maps-sdk', 'npm-any-version', 'npm-any-version'],
  ['python-api', '2.4.4', 'latest'],
  ['python-api', '2.3', '2.3'],
  ['python-api', '2.3.1', '2.3'],
  ['arcpy', undefined, 'latest'],
  ['arcpy', '3.7', 'latest'],
  ['arcpy', 'Pro 3.6', '3.6'],
  ['arcpy', '3.6', '3.6'],
  ['arcpy', '3.5.2', '3.5'],
  ['arcpy', '3.4', '3.4'],
  ['arcpy', '2.9', '2.9'],
  // Unversioned documentation: a version-addressed source can still be asked for the version.
  ['calcite', '3.0.1', 'latest'],
  ['rest-js', '4.11.1', 'latest'],
  ['experience-builder', '1.15', 'latest'],
];

/** `[product, version]` for which no line exists. */
const UNAVAILABLE: Array<[string, string]> = [
  ['kotlin-maps-sdk', '100.15'],
  ['kotlin-maps-sdk', '20'],
  ['kotlin-maps-sdk', '2000.1'],
  ['kotlin-maps-sdk', 'nightly'],
  ['swift-maps-sdk', '100.15.6'],
  ['unity-maps-sdk', '1.0'],
  ['python-api', '2.2.0'],
  ['python-api', '1.9'],
  ['arcpy', '2.5'],
  ['java-maps-sdk', '300.1'],
  ['calcite', 'beta'],
];

describe('lineOf', () => {
  it.each(LINES)('%s at %j is line %s', (id, version, expected) => {
    expect(lineOf(product(id), version).id).toBe(expected);
  });

  it.each(UNAVAILABLE)('%s has no line for %j', (id, version) => {
    const target = product(id);
    try {
      lineOf(target, version);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpDocError);
      const failure = error as McpDocError;
      expect(failure.code).toBe('VERSION_UNAVAILABLE');
      expect(failure.details?.candidates).toEqual(target.lines.map((line) => line.id));
      expect(failure.details?.next).toBe(`arcgis_docs_get_versions({"product":"${id}"})`);
      expect(failure.message).toContain(`"${version}"`);
    }
  });

  it('prefers the current line when two lines document a version', () => {
    const overlapping = makeProduct({
      lines: [
        makeLine({ id: 'old', label: '3.x', current: false }),
        makeLine({ id: 'new', label: '3.x (rewrite)' }),
      ],
    });
    expect(lineOf(overlapping, '3.2').id).toBe('new');
  });

  it('reads a declared version pattern before the label', () => {
    const declared = makeProduct({
      lines: [
        makeLine({ label: '9.x' }),
        makeLine({ id: 'odd', label: '1.x', current: false, vars: { versions: '^7\\.' } }),
      ],
    });
    expect(lineOf(declared, '7.4').id).toBe('odd');
    expect(() => lineOf(declared, '1.2')).toThrow(McpDocError);
  });

  it('falls back to the first line of a product without a current one', () => {
    const none = makeProduct({ lines: [makeLine({ id: 'only', current: false })] });
    expect(lineOf(none).id).toBe('only');
    expect(() => lineOf(makeProduct({ lines: [] }))).toThrow(/has no version line/);
  });
});
