import { describe, expect, it } from 'vitest';
import { ownedPrefix } from '../../src/core/adapter-helpers.js';
import { docUrlPattern } from '../../src/core/source-urls.js';
import type { AnySourceDef } from '../../src/core/types.js';
import { makeLine, makeSource } from '../support/builders.js';

const D = 'https://developers.arcgis.com';
const latest = makeLine({ vars: { prefix: '' } });

/** One source per adapter type whose ownership rule is not a plain base prefix. */
const SOURCES = {
  astro: makeSource('astro', { base: '/widgets/' }),
  'npm-dts': makeSource('npm-dts', {
    package: '@arcgis/core',
    docUrl: '/javascript/latest/references/core/{path}/',
  }),
  'npm-cem': makeSource('npm-cem', {
    packages: ['@arcgis/map-components'],
    file: 'dist/docs/api.json',
    docUrl: '/javascript/latest/references/{pkg}/components/{tag}/',
  }),
  'npm-json': makeSource('npm-json', {
    package: '@arcgis/coding-components',
    file: 'arcade-api.json',
    mapper: 'arcade-api',
    docUrl: '/arcade/function-reference/',
  }),
  'github-repo': makeSource('github-repo', {
    repo: 'Esri/example-samples',
    preset: 'samples-metadata',
  }),
  xmldoc: makeSource('xmldoc', { repo: 'Esri/example-sdk', dir: 'References/API' }),
  brief: makeSource('brief', { slugs: ['ai/*'] }),
} satisfies Record<string, AnySourceDef>;

function sourceFor(adapter: keyof typeof SOURCES): AnySourceDef {
  return SOURCES[adapter];
}

describe('ownedPrefix', () => {
  const JS = `${D}/javascript/latest/`;
  // The JavaScript SDK in miniature: three site sources on one base, told apart by filters.
  const guide = makeSource('astro', {
    base: '/javascript/latest/',
    exclude: ['^references/', '^sample-code/'],
  });
  const samples = makeSource('astro', { base: '/javascript/latest/', include: ['^sample-code/'] });
  const core = makeSource('astro', { base: '/javascript/latest/', include: ['^references/core/'] });

  it('applies the include and exclude filter to the path below the base', () => {
    const owners = (url: string) =>
      [guide, samples, core].map((source) => ownedPrefix(source, latest, url) !== undefined);
    expect(owners(`${JS}layers/#intro`)).toEqual([true, false, false]);
    expect(owners(`${JS}sample-code/intro-mapview/`)).toEqual([false, true, false]);
    expect(owners(`${JS}references/core/layers/FeatureLayer/#queryFeatures`)).toEqual([
      false,
      false,
      true,
    ]);
    expect(owners(`${D}/kotlin/`)).toEqual([false, false, false]);
    expect(ownedPrefix(guide, latest, new URL(JS))).toBe(JS);
  });

  it('gives typings no URL and components only the pages their template describes', () => {
    const url = `${JS}references/core/layers/FeatureLayer/`;
    expect(ownedPrefix(sourceFor('npm-dts'), latest, url)).toBeUndefined();
    // The bare prefix of the components template would also cover the core reference.
    expect(ownedPrefix(sourceFor('npm-cem'), latest, url)).toBeUndefined();
    expect(ownedPrefix(sourceFor('npm-cem'), latest, `${JS}references/`)).toBeUndefined();
    expect(docUrlPattern(sourceFor('npm-dts'), latest)).toBeUndefined();
    expect(docUrlPattern(sourceFor('astro'), latest)).toBeUndefined();

    const arcade = sourceFor('npm-json');
    expect(ownedPrefix(arcade, latest, `${D}/arcade/function-reference/math_functions/#abs`)).toBe(
      `${D}/arcade/function-reference/`,
    );
    expect(ownedPrefix(arcade, latest, `${D}/arcade/guide/`)).toBeUndefined();
    const profiles = makeSource('npm-json', {
      package: '@arcgis/coding-components',
      file: 'profiles.json',
      mapper: 'arcade-profiles',
    });
    expect(docUrlPattern(profiles, latest)).toBeUndefined();
    expect(
      ownedPrefix(
        profiles,
        latest,
        'https://cdn.jsdelivr.net/npm/@arcgis/coding-components/profiles.json',
      ),
    ).toBe('https://cdn.jsdelivr.net/npm/@arcgis/coding-components/');
    expect(
      ownedPrefix(sourceFor('npm-cem'), latest, `${JS}references/map-components/components/x/`),
    ).toBe(`${JS}references/`);
  });

  it('returns the longest matching base of a source', () => {
    const help = makeSource('docfx-esri', { slug: 'arcgis-pro', sections: ['help', 'help/data'] });
    const root = 'https://doc.esri.com/en/arcgis-pro/latest/';
    expect(ownedPrefix(help, latest, `${root}help/data/tables.html`)).toBe(`${root}help/data/`);
    expect(ownedPrefix(help, latest, `${root}help/intro.html`)).toBe(`${root}help/`);
    expect(ownedPrefix(help, latest, `${root}sdk/intro.html`)).toBeUndefined();
    expect(ownedPrefix(sourceFor('brief'), latest, 'brief:ai/overview')).toBeUndefined();
  });

  it('owns every content URL of a repository, whatever the host or letter case', () => {
    const repo = sourceFor('github-repo');
    const root = 'https://github.com/Esri/example-samples/';
    expect(ownedPrefix(repo, latest, `${root}blob/main/README.md`)).toBe(root);
    expect(ownedPrefix(repo, latest, 'https://github.com/esri/Example-Samples')).toBe(root);
    expect(ownedPrefix(repo, latest, `${root}wiki/Home`)).toBe(root);
    expect(
      ownedPrefix(
        repo,
        latest,
        'https://raw.githubusercontent.com/Esri/example-samples/v1/a/README.md',
      ),
    ).toBe(root);
    expect(ownedPrefix(repo, latest, `${root}issues/1`)).toBeUndefined();
    expect(
      ownedPrefix(repo, latest, 'https://github.com/Esri/other/blob/main/a.md'),
    ).toBeUndefined();
    expect(ownedPrefix(sourceFor('xmldoc'), latest, 'https://github.com/Esri/example-sdk')).toBe(
      'https://github.com/Esri/example-sdk/',
    );
  });
});
