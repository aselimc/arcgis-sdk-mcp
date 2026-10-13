import { describe, expect, it } from 'vitest';
import { apiNames, type ApiEntry } from '../../../../src/adapters/site/astro-api.js';

/** An entry as the site stores it: breadcrumb, page type and URL. */
function entry(
  name: string,
  breadcrumb: string | undefined,
  pageType: string | undefined,
  url: string,
): ApiEntry {
  const [path = '', fragment] = url.split('#');
  return {
    name,
    ...(breadcrumb === undefined ? {} : { breadcrumb }),
    ...(pageType === undefined ? {} : { pageType }),
    path,
    anchored: fragment !== undefined,
  };
}

const names = (entries: ApiEntry[]) =>
  apiNames(entries).map((name) =>
    name.parent === undefined ? name.qualified : `${name.qualified} < ${name.parent}`,
  );

describe('apiNames', () => {
  // A package whose reference lives under `references/kit/`, in the three stored forms.
  const kit = [
    entry('units', '@pier/kit/support/units', 'module', 'references/kit/support/units/'),
    entry(
      'toKnots',
      '@pier/kit/support/units',
      'function',
      'references/kit/support/units/#toKnots',
    ),
    entry('TideLayer', '@pier/kit', 'class', 'references/kit/layers/TideLayer/#TideLayer'),
    entry('refresh', '@pier/kit/TideLayer', 'method', 'references/kit/layers/TideLayer/#refresh'),
    entry(
      'TideLayerEvents',
      '@pier/kit/layers/TideLayer',
      'type',
      'references/kit/layers/TideLayer/#TideLayerEvents',
    ),
  ];

  it('names a default-export class by the module path of its page', () => {
    expect(names(kit)).toEqual([
      '@pier/kit/support/units',
      '@pier/kit/support/units/toKnots',
      '@pier/kit/layers/TideLayer',
      '@pier/kit/layers/TideLayer.refresh < @pier/kit/layers/TideLayer',
      '@pier/kit/layers/TideLayer/TideLayerEvents',
    ]);
  });

  it('gives a member the class of its own page when two modules export the same name', () => {
    const twins = [
      ...kit,
      entry('TideLayer', '@pier/kit', 'class', 'references/kit/legacy/TideLayer/#TideLayer'),
      entry('reload', '@pier/kit/TideLayer', 'method', 'references/kit/legacy/TideLayer/#reload'),
    ];
    expect(names(twins).slice(-2)).toEqual([
      '@pier/kit/legacy/TideLayer',
      '@pier/kit/legacy/TideLayer.reload < @pier/kit/legacy/TideLayer',
    ]);
  });

  it('keeps the stored form when no entry shows which directory the package has', () => {
    const lone = [
      entry('TideLayer', '@pier/kit', 'class', 'references/kit/layers/TideLayer/#TideLayer'),
      entry('refresh', '@pier/kit/TideLayer', 'method', 'references/kit/layers/TideLayer/#refresh'),
    ];
    expect(names(lone)).toEqual([
      '@pier/kit/TideLayer',
      '@pier/kit/TideLayer.refresh < @pier/kit/TideLayer',
    ]);
  });

  it('keeps the stored form of a page outside the learned directory, and of plain names', () => {
    const mixed = [
      ...kit,
      entry('Elsewhere', '@pier/kit', 'class', 'other/place/Elsewhere/'),
      entry('Renderer', undefined, 'class', 'api/Renderer/'),
      entry('paint', 'Renderer', 'method', 'api/Renderer/#paint'),
      entry('note', 'Renderer', 'method', 'api/Renderer/'),
    ];
    expect(names(mixed).slice(-4)).toEqual([
      '@pier/kit/Elsewhere',
      'Renderer',
      'Renderer.paint < Renderer',
      // Without an anchor an entry is a page of its own, not a member.
      'Renderer/note',
    ]);
  });
});
