import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findLocalPackage,
  listLocalFiles,
  readLocalFile,
} from '../../../../src/adapters/reference/npm/local-packages.js';
import { makeProject, npmCtx, removeProjects } from './helpers.js';

const NAME = '@arcgis/widget-core';

afterEach(removeProjects);

describe('findLocalPackage', () => {
  it('finds a package in the project and reads its version', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const found = await findLocalPackage(npmCtx({ projectDir }), NAME);
    expect(found).toMatchObject({ name: NAME, version: '7.1.9' });
    expect(found?.dir).toBe(join(projectDir, 'node_modules', '@arcgis', 'widget-core'));
  });

  it('walks up to five parent directories for a hoisting node_modules', async () => {
    const near = makeProject({ [NAME]: { version: '7.1.9' } }, { hoistLevels: 5 });
    expect(await findLocalPackage(npmCtx({ projectDir: near.projectDir }), NAME)).toMatchObject({
      version: '7.1.9',
    });
    const far = makeProject({ [NAME]: { version: '7.1.9' } }, { hoistLevels: 6 });
    expect(await findLocalPackage(npmCtx({ projectDir: far.projectDir }), NAME)).toBeUndefined();
  });

  it('finds nothing when the capability is off', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const ctx = npmCtx({ projectDir, without: ['local-packages'] });
    expect(await findLocalPackage(ctx, NAME)).toBeUndefined();
  });

  it('looks only for scoped Esri packages', async () => {
    const { projectDir } = makeProject({
      'left-pad': { version: '1.0.0' },
      '@other/widget-core': { version: '1.0.0' },
    });
    const ctx = npmCtx({ projectDir });
    expect(await findLocalPackage(ctx, 'left-pad')).toBeUndefined();
    expect(await findLocalPackage(ctx, '@other/widget-core')).toBeUndefined();
    expect(await findLocalPackage(ctx, '@arcgis/../../left-pad')).toBeUndefined();
  });

  it('ignores a manifest that is damaged, of another package or without a version', async () => {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9' } });
    const manifest = join(projectDir, 'node_modules', '@arcgis', 'widget-core', 'package.json');
    const ctx = npmCtx({ projectDir });
    for (const content of [
      '{ not json',
      '[]',
      JSON.stringify({ name: '@arcgis/other', version: '7.1.9' }),
      JSON.stringify({ name: NAME }),
      JSON.stringify({ name: NAME, version: 'workspace:*' }),
    ]) {
      writeFileSync(manifest, content);
      expect(await findLocalPackage(ctx, NAME), content).toBeUndefined();
    }
  });
});

describe('reading installed files', () => {
  const files = {
    'Gadget.d.ts': 'export default class Gadget {}\n',
    'layers/PanelLayer.d.ts': `${String.fromCharCode(0xfeff)}export default class PanelLayer {}\n`,
    'layers/PanelLayer.js': 'export default class PanelLayer {}\n',
    'node_modules/tiny-dep/index.d.ts': 'export {};\n',
  };

  async function installed() {
    const { projectDir } = makeProject({ [NAME]: { version: '7.1.9', files } });
    const pkg = await findLocalPackage(npmCtx({ projectDir }), NAME);
    if (pkg === undefined) throw new Error('the fixture package was not found');
    return pkg;
  }

  it('reads a file as text without its byte-order mark', async () => {
    const pkg = await installed();
    expect(await readLocalFile(pkg, 'layers/PanelLayer.d.ts', 1000)).toBe(
      'export default class PanelLayer {}\n',
    );
  });

  it('answers undefined for a missing file, a directory and a file over the size cap', async () => {
    const pkg = await installed();
    expect(await readLocalFile(pkg, 'Missing.d.ts', 1000)).toBeUndefined();
    expect(await readLocalFile(pkg, 'layers', 1000)).toBeUndefined();
    expect(await readLocalFile(pkg, 'Gadget.d.ts', 5)).toBeUndefined();
  });

  it('refuses paths that leave the package', async () => {
    const pkg = await installed();
    expect(await readLocalFile(pkg, '../../../package.json', 1000)).toBeUndefined();
    expect(await readLocalFile(pkg, '', 1000)).toBeUndefined();
  });

  it('lists files by suffix with forward slashes, skipping nested node_modules', async () => {
    const pkg = await installed();
    expect(await listLocalFiles(pkg, '.d.ts')).toEqual(['Gadget.d.ts', 'layers/PanelLayer.d.ts']);
  });

  it('lists nothing for a directory that cannot be read', async () => {
    const pkg = await installed();
    expect(await listLocalFiles({ ...pkg, dir: join(pkg.dir, 'missing') }, '.d.ts')).toEqual([]);
  });

  // SECURITY.md: a path that reads outside the project or cache directories is in scope.
  describe('links', () => {
    /** A directory next to the project, which no package may read from. */
    function outsideOf(pkgDir: string): string {
      const outside = join(dirname(dirname(dirname(dirname(pkgDir)))), 'outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'Leak.d.ts'), 'export declare const SECRET: "not yours";');
      writeFileSync(join(outside, 'id_key'), 'not a real key');
      return outside;
    }

    it('neither lists nor reads through a linked directory that leaves the package', async () => {
      const pkg = await installed();
      // A junction needs no privilege on Windows and is a symbolic link everywhere else.
      symlinkSync(outsideOf(pkg.dir), join(pkg.dir, 'linked'), 'junction');

      expect(await listLocalFiles(pkg, '.d.ts')).toEqual(['Gadget.d.ts', 'layers/PanelLayer.d.ts']);
      expect(await readLocalFile(pkg, 'linked/Leak.d.ts', 1000)).toBeUndefined();
      expect(await readLocalFile(pkg, 'linked/id_key', 1000)).toBeUndefined();
    });

    it('does not read a linked file that leaves the package', async ({ skip }) => {
      const pkg = await installed();
      try {
        symlinkSync(join(outsideOf(pkg.dir), 'id_key'), join(pkg.dir, 'Stolen.d.ts'), 'file');
      } catch {
        // Windows lets only privileged accounts create file links; the junction test covers it.
        skip();
      }
      expect(await listLocalFiles(pkg, '.d.ts')).toEqual(['Gadget.d.ts', 'layers/PanelLayer.d.ts']);
      expect(await readLocalFile(pkg, 'Stolen.d.ts', 1000)).toBeUndefined();
    });

    it('reads a package whose own directory is a link, as pnpm and workspaces install it', async () => {
      const pkg = await installed();
      const store = join(dirname(dirname(dirname(dirname(pkg.dir)))), 'store', 'widget-core');
      mkdirSync(dirname(store), { recursive: true });
      renameSync(pkg.dir, store);
      symlinkSync(store, pkg.dir, 'junction');

      expect(await listLocalFiles(pkg, '.d.ts')).toEqual(['Gadget.d.ts', 'layers/PanelLayer.d.ts']);
      expect(await readLocalFile(pkg, 'Gadget.d.ts', 1000)).toBe(files['Gadget.d.ts']);
    });

    it('follows a link that stays inside the package when reading, without listing it twice', async () => {
      const pkg = await installed();
      symlinkSync(join(pkg.dir, 'layers'), join(pkg.dir, 'alias'), 'junction');

      expect(await listLocalFiles(pkg, '.d.ts')).toEqual(['Gadget.d.ts', 'layers/PanelLayer.d.ts']);
      expect(await readLocalFile(pkg, 'alias/PanelLayer.js', 1000)).toBe(
        files['layers/PanelLayer.js'],
      );
    });
  });
});
