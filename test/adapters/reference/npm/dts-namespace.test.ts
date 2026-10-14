import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import {
  moduleFromNamespace,
  namespaceAlias,
} from '../../../../src/adapters/reference/npm/dts-namespace.js';
import { npmDtsAdapter } from '../../../../src/adapters/reference/npm/dts.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { makeLine } from '../../../support/builders.js';
import { cdnFile, npmCtx, productOf, resolved, typingsSource } from './helpers.js';

/** A module file of a release that keeps its classes in one namespace file. */
const STUB = [
  'import "../interfaces";',
  '',
  'import PanelLayer = __widgets.PanelLayer;',
  'export default PanelLayer;',
  '',
].join('\n');

/** The namespace file of that release: our own declarations in the published layout. */
const NAMESPACE = [
  'type Maybe<T> = T | undefined;',
  '',
  'declare namespace __widgets {',
  '  export class Accessor {',
  '    destroyed: boolean;',
  '  }',
  '',
  '  export interface PanelLayer extends Layer, Refreshable<PanelLayer, string> {',
  '  }',
  '',
  '  export class PanelLayer {',
  '    /**',
  '     * Rows shown by the panel.',
  '     *',
  '     * @default 10',
  '     */',
  '    rows: number;',
  '    /**',
  '     * Draws the panel again.',
  '     *',
  '     * @param options How to redraw: `{ force: true }` skips the cache.',
  '     */',
  '    refresh(options?: { force: boolean }): Promise<void>;',
  '    static fromJSON(json: any): PanelLayer;',
  '  }',
  '',
  '  interface PanelLayerProperties extends LayerProperties {',
  '    rows?: number;',
  '  }',
  '',
  '  export interface PanelLayerView {',
  '    visible: boolean;',
  '  }',
  '',
  '  interface panelUtils {',
  '    measure(panel: PanelLayer): number;',
  '  }',
  '',
  '  export const panelUtils: panelUtils;',
  '}',
  '',
].join('\r\n');

describe('namespaceAlias', () => {
  it('recognises a module file that only aliases a namespace declaration', () => {
    expect(namespaceAlias(STUB, 'layers/PanelLayer.d.ts')).toEqual({
      file: 'interfaces.d.ts',
      namespace: '__widgets',
      name: 'PanelLayer',
    });
    expect(namespaceAlias(STUB, 'a/b/Deep.d.ts')?.file).toBe('a/interfaces.d.ts');
  });

  it.each([
    ['a file with declarations of its own', `${STUB}export declare class Extra {}\n`],
    ['a file without the alias', 'import "../interfaces";\nexport default 1;\n'],
    ['a file without the import', 'import PanelLayer = __widgets.PanelLayer;\n'],
    ['an import of another package', STUB.replace('../interfaces', 'other-package')],
  ])('leaves %s alone', (_what, source) => {
    expect(namespaceAlias(source, 'layers/PanelLayer.d.ts')).toBeUndefined();
  });

  it('does not resolve an import that leaves the package', () => {
    expect(namespaceAlias(STUB, 'PanelLayer.d.ts')).toBeUndefined();
  });
});

describe('moduleFromNamespace', () => {
  it('writes the class with its bases and constructor options as a module', () => {
    expect(moduleFromNamespace(NAMESPACE, 'PanelLayer')).toBe(
      [
        'export interface PanelLayerProperties extends LayerProperties {',
        '  rows?: number;',
        '}',
        '',
        'declare const PanelLayerSuperclass: typeof Layer & typeof Refreshable;',
        '',
        'export default class PanelLayer extends PanelLayerSuperclass {',
        '  /**',
        '   * Rows shown by the panel.',
        '   *',
        '   * @default 10',
        '   */',
        '  rows: number;',
        '  /**',
        '   * Draws the panel again.',
        '   *',
        '   * @param options How to redraw: `{ force: true }` skips the cache.',
        '   */',
        '  refresh(options?: { force: boolean }): Promise<void>;',
        '  static fromJSON(json: any): PanelLayer;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('writes a class without bases or options, and does not match a longer name', () => {
    expect(moduleFromNamespace(NAMESPACE, 'Accessor')).toBe(
      'export default class Accessor {\n  destroyed: boolean;\n}\n',
    );
    expect(moduleFromNamespace(NAMESPACE, 'Panel')).toBeUndefined();
  });

  // Regression: `MapView` at version 4.24 printed `import { MapView } from "@arcgis/core";`
  // (a root entry 4.24 does not have) and a body of only "Interfaces - MapView": releases of
  // that age declare a class as an interface plus a constructor interface, with no `class`.
  it('writes a class of the older layout, declared through a constructor interface', () => {
    const OLDER = [
      'declare namespace __widgets {',
      '  interface GaugeView extends View, Themed {',
      '    /**',
      '     * The value shown.',
      '     */',
      '    value: number;',
      '    redraw(): void;',
      '  }',
      '',
      '  interface GaugeViewConstructor {',
      '    /**',
      '     * A view that shows one value as a gauge.',
      '     */',
      '    new(properties?: GaugeViewProperties): GaugeView;',
      '',
      '    fromJSON(json: any): GaugeView;',
      '  }',
      '',
      '  export const GaugeView: GaugeViewConstructor;',
      '',
      '  interface GaugeViewProperties extends ViewProperties {',
      '    value?: number;',
      '  }',
      '',
      '  interface gaugeUtils {',
      '    clamp(value: number): number;',
      '  }',
      '',
      '  interface gaugeUtilsConstructor {',
      '    clamp(value: number): number;',
      '  }',
      '}',
    ].join('\n');
    expect(moduleFromNamespace(OLDER, 'GaugeView')).toBe(
      [
        'export interface GaugeViewProperties extends ViewProperties {',
        '  value?: number;',
        '}',
        '',
        'declare const GaugeViewSuperclass: typeof View & typeof Themed;',
        '',
        'export default class GaugeView extends GaugeViewSuperclass {',
        '  /**',
        '   * A view that shows one value as a gauge.',
        '   */',
        '  constructor(properties?: GaugeViewProperties);',
        '',
        '  static fromJSON(json: any): GaugeView;',
        '  /**',
        '   * The value shown.',
        '   */',
        '  value: number;',
        '  redraw(): void;',
        '}',
        '',
      ].join('\n'),
    );
    // A constructor interface without a construct signature does not make a class.
    expect(moduleFromNamespace(OLDER, 'gaugeUtils')).toBe(
      'export interface gaugeUtils {\n  clamp(value: number): number;\n}\n',
    );
  });

  it('writes a module of functions, which is declared as an interface only', () => {
    expect(moduleFromNamespace(NAMESPACE, 'panelUtils')).toBe(
      'export interface panelUtils {\n  measure(panel: PanelLayer): number;\n}\n',
    );
  });
});

// Regression: `FeatureLayer.queryFeatures` at version 4.33 found nothing, because the module
// files of that release are three-line aliases into `interfaces.d.ts`.
describe('npm-dts read of a release with namespace typings', () => {
  const NAME = '@arcgis/widget-core';
  const PANEL_REF =
    'https://developers.arcgis.com/widgets/latest/references/core/layers/PanelLayer/';
  const product = productOf(typingsSource);
  // A release the cassette does not record, so every file comes from this test.
  const bound = bindSource(product, typingsSource, makeLine(), '6.8');
  const stubUrl = cdnFile(NAME, '6.8.3', 'layers/PanelLayer.d.ts');
  const namespaceUrl = cdnFile(NAME, '6.8.3', 'interfaces.d.ts');
  const release = { json: { type: 'npm', name: NAME, version: '6.8.3', links: {} } };

  it('cuts the class out of the namespace file and renders that', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http
      .on(resolved(NAME, '6.8'), release)
      .on(stubUrl, { body: STUB })
      .on(namespaceUrl, { body: NAMESPACE });
    await npmDtsAdapter.read(ctx, bound, { url: new URL(`${PANEL_REF}#refresh`) });

    const input = ctx.render.calls.at(-1)?.input as RendererInputs['dts'];
    expect(input.source).toContain(
      'export default class PanelLayer extends PanelLayerSuperclass {',
    );
    expect(input.source).toContain('refresh(options?: { force: boolean }): Promise<void>;');
    expect(input.member).toBe('refresh');
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      resolved(NAME, '6.8'),
      stubUrl,
      namespaceUrl,
    ]);
  });

  it('shows the module file as published when the namespace file cannot be read', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.on(resolved(NAME, '6.8'), release).on(stubUrl, { body: STUB });
    ctx.http.fail(namespaceUrl, 404);
    await npmDtsAdapter.read(ctx, bound, { url: new URL(PANEL_REF) });
    expect((ctx.render.calls.at(-1)?.input as RendererInputs['dts']).source).toBe(STUB);
    expect(ctx.logger.messages('warn')).toContain(
      'namespace typings unavailable; showing the module file as published',
    );
  });
});
