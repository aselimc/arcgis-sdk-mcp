import { describe, expect, it } from 'vitest';
import { createVersionService } from '../../src/versions/index.js';
import { REGISTRIES } from './cassettes-registries.js';
import { SITES } from './cassettes-sites.js';
import { jsProduct, restJsProduct } from './products.js';
import { useProjects } from '../workspace/project.js';
import { MINUTE } from '../support/fake-clock.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';

const project = useProjects();

const LOADER_WARNING =
  'package.json depends on esri-loader@3.7.0, which is the archived loader for the AMD build of the JavaScript SDK. Install @arcgis/core and import ES modules, or load the components from @arcgis/map-components.';

function setup(projectDir: string, mode: 'stdio' | 'http' = 'stdio') {
  return makeCtx({
    cassette: { interactions: [...REGISTRIES.interactions, ...SITES.interactions] },
    products: [jsProduct, restJsProduct],
    config: { projectDir, mode },
  });
}

describe('version report: retired packages in the project', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { 'esri-loader': '^3.7.0' } }),
  };

  it('warns on the product the package belonged to', async () => {
    const ctx = setup(project(files));
    const report = await createVersionService(ctx).report(
      { product: 'js-maps-sdk' },
      makeCall(ctx),
    );
    expect(report.products[0]?.notices.at(-1)).toBe(LOADER_WARNING);
    expect(report.notes).toEqual([]);
    // The loader is not the SDK: its version is no statement about the project's SDK version.
    expect(report.products[0]?.project).toBeUndefined();
  });

  it('warns in the report notes when that product is not part of the report', async () => {
    const ctx = setup(project(files));
    const service = createVersionService(ctx);
    const other = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(other.products[0]?.notices).not.toContain(LOADER_WARNING);
    expect(other.notes).toEqual([LOADER_WARNING]);

    const none = await service.report({}, makeCall(ctx));
    expect(none.notes).toEqual([
      'No Esri SDK was detected in the current project. Pass "product" to report on one.',
      LOADER_WARNING,
    ]);
  });

  it('notices a changed manifest after a minute, although the facts stay cached', async () => {
    const root = project({ 'package.json': '{}' });
    const ctx = setup(root);
    const service = createVersionService(ctx);
    const before = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(before.notes).toEqual([]);
    const requests = ctx.http.count();

    project.write(root, files);
    ctx.clock.advance(2 * MINUTE);
    const after = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(after.notes).toEqual([LOADER_WARNING]);
    expect(ctx.http.count()).toBe(requests);
  });

  it('never reads the project in HTTP mode', async () => {
    const ctx = setup(project(files), 'http');
    const report = await createVersionService(ctx).report({ product: 'rest-js' }, makeCall(ctx));
    expect(report.notes).toEqual([]);
  });
});
