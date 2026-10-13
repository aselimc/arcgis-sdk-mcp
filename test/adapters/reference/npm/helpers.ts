import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PRESETS } from '../../../../src/core/capabilities.js';
import type { Capability, Product, SourceDef } from '../../../../src/core/types.js';
import { makeProduct, makeSource } from '../../../support/builders.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';

/** Request URLs of the synthetic packages, as the adapters build them. */
export const distTags = (name: string): string =>
  `https://registry.npmjs.org/-/package/${name}/dist-tags`;
export const cdnFile = (name: string, version: string, path: string): string =>
  `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`;
export const flatListing = (name: string, version: string): string =>
  `https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`;
export const resolved = (name: string, specifier: string): string =>
  `https://data.jsdelivr.com/v1/packages/npm/${name}/resolved?specifier=${encodeURIComponent(specifier)}`;

/** A context whose renderer is the recording fake, typed as such. */
export type NpmTestCtx = TestCtx & { render: FakeRenderer };

/** Options of {@link npmCtx}. */
export interface NpmCtxOptions {
  /** Cassette file under `test/fixtures/cassettes/reference/npm`; none for an empty recording. */
  cassette?: string;
  /** Project directory; giving one switches capability `local-packages` on. */
  projectDir?: string;
  /** Capabilities switched off for the test. */
  without?: Capability[];
}

/**
 * A test context for the npm adapters. Capability `local-packages` is off unless a project
 * directory is given, so no test depends on what happens to be installed on the machine.
 */
export function npmCtx(options: NpmCtxOptions = {}): NpmTestCtx {
  const off = new Set<Capability>(options.without ?? []);
  if (options.projectDir === undefined) off.add('local-packages');
  const render = new FakeRenderer();
  const ctx = makeCtx({
    ...(options.cassette === undefined
      ? {}
      : { cassette: loadCassette('cassettes', 'reference', 'npm', options.cassette) }),
    config: {
      capabilities: new Set(PRESETS.standard.filter((capability) => !off.has(capability))),
      ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir }),
    },
    render,
  });
  return { ...ctx, render };
}

function npmSource<A extends 'npm-dts' | 'npm-cem' | 'npm-json'>(
  adapter: A,
  id: string,
  config: SourceDef<A>['config'],
  probePackage: string,
): SourceDef<A> {
  return makeSource(adapter, config, {
    id,
    title: id,
    kinds: ['api'],
    capability: 'package-cdn',
    license: 'esri-ma',
    floor: false,
    probe: { url: distTags(probePackage), expect: 'json', mustContain: 'latest' },
  });
}

/** `npm-dts` over the synthetic `@arcgis/widget-core`. */
export const typingsSource = npmSource(
  'npm-dts',
  'typings',
  { package: '@arcgis/widget-core', docUrl: '/widgets/latest/references/core/{path}/' },
  '@arcgis/widget-core',
);

/** `npm-cem` over two synthetic packages whose URLs carry the package and the full tag. */
export const componentsSource = npmSource(
  'npm-cem',
  'components',
  {
    packages: ['@arcgis/widget-components', '@arcgis/chart-widgets'],
    file: 'dist/docs/api.json',
    docUrl: '/widgets/latest/references/{pkg}/components/{tag}/',
  },
  '@arcgis/widget-components',
);

/** `npm-cem` over one package whose URLs carry the tag without its prefix. */
export const shortTagSource = npmSource(
  'npm-cem',
  'components',
  {
    packages: ['@esri/gadget-components'],
    file: 'dist/docs/api.json',
    docUrl: '/gadget-design-system/components/{tagShort}/',
  },
  '@esri/gadget-components',
);

const SCRIPT_ASSETS = 'dist/assets/script-language';

/** `npm-json` with mapper `arcade-api` and a documentation root. */
export const functionsSource = npmSource(
  'npm-json',
  'functions',
  {
    package: '@arcgis/script-components',
    file: `${SCRIPT_ASSETS}/api/script-api.t9n.en.json`,
    mapper: 'arcade-api',
    docUrl: '/widgets-script/function-reference/',
  },
  '@arcgis/script-components',
);

/** `npm-json` with mapper `arcade-profiles` and no documentation root. */
export const profilesSource = npmSource(
  'npm-json',
  'profiles',
  {
    package: '@arcgis/script-components',
    file: `${SCRIPT_ASSETS}/profiles/script-profiles.t9n.en.json`,
    mapper: 'arcade-profiles',
  },
  '@arcgis/script-components',
);

/** A product holding the given sources. */
export function productOf(...sources: Product['sources']): Product {
  return makeProduct({ sources });
}

const created: string[] = [];

/**
 * Creates a project directory with packages installed in its `node_modules`. The project
 * sits several levels below the temporary root, so the upward search for a hoisting
 * `node_modules` never leaves the directory this function created.
 *
 * @param packages package name to its version and files (path relative to the package root).
 * @returns the project directory and the temporary root above it.
 */
export function makeProject(
  packages: Record<string, { version: string; files?: Record<string, string> }>,
  options: { hoistLevels?: number } = {},
): { projectDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'arcgis-sdk-mcp-npm-'));
  created.push(root);
  const workspace = join(root, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'workspace');
  let projectDir = workspace;
  for (let level = 0; level < (options.hoistLevels ?? 0); level++) {
    projectDir = join(projectDir, `nested${level}`);
  }
  mkdirSync(projectDir, { recursive: true });
  for (const [name, { version, files }] of Object.entries(packages)) {
    const dir = join(workspace, 'node_modules', ...name.split('/'));
    const all = { 'package.json': JSON.stringify({ name, version }), ...files };
    for (const [path, content] of Object.entries(all)) {
      const file = join(dir, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  return { projectDir, root };
}

/** Removes every directory {@link makeProject} created; call from `afterEach`. */
export function removeProjects(): void {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
}
