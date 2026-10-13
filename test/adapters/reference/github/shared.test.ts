import { describe, expect, it } from 'vitest';
import { titleFromName } from '../../../../src/adapters/reference/github/shared.js';

describe('titleFromName', () => {
  it.each([
    ['Add 3D tiles layer', 'Add 3D tiles layer'],
    ['add-3d-tiles-layer', 'Add 3d tiles layer'],
    ['add_3d_tiles_layer.md', 'Add 3d tiles layer'],
    ['DisplayKMLNetworkLinks', 'Display KML network links'],
    ['samples/01-getting-started', 'Getting started'],
    ['README.md', 'README'],
  ])('reads %s as %s', (name, title) => {
    expect(titleFromName(name)).toBe(title);
  });

  // Regression: the object files of a specification were listed as "3 D scene layer.cmn"
  // and "3 D node index document.cmn": a digit was split from the capital after it, and a
  // dotted object name was spelled out as if it were a sentence.
  it.each([
    ['Add3DTilesLayer', 'Add 3D tiles layer'],
    ['Show2DAnd3DViews', 'Show 2D and 3D views'],
    ['docs/2.1/3DSceneLayer.cmn.md', '3DSceneLayer.cmn'],
    ['attributeStorageInfo.cmn.md', 'attributeStorageInfo.cmn'],
  ])('keeps digits with their capitals and dotted names whole: %s', (name, title) => {
    expect(titleFromName(name)).toBe(title);
  });
});
