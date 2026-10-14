import { describe, expect, it } from 'vitest';
import type { PackageRef } from '../../src/core/types.js';
import {
  currentLine,
  productRow,
  profileOf,
  renderProductList,
  renderProfile,
  renderToc,
  tocRow,
} from '../../src/mcp/presenters/product.js';
import { renderVersionsProduct, versionsProduct } from '../../src/mcp/presenters/versions.js';
import { makeLine, makeProduct, makeRecord, makeSource } from '../support/builders.js';
import { fakePolicy } from '../support/fake-policy.js';

const pkg = (registry: PackageRef['registry'], name: string, primary = false): PackageRef => ({
  registry,
  name,
  license: 'esri-ma',
  ...(primary ? { primary } : {}),
});

describe('product presenters', () => {
  it('tolerates a product without a current line or without any line', () => {
    const noCurrent = makeProduct({
      lines: [makeLine({ id: 'v1', label: '1.x', current: false })],
    });
    expect(currentLine(noCurrent)?.id).toBe('v1');
    expect(productRow(noCurrent).currentLine).toBe('1.x');

    const noLines = makeProduct({ lines: [] });
    expect(currentLine(noLines)).toBeUndefined();
    expect(productRow(noLines)).not.toHaveProperty('currentLine');
    expect(renderProductList([productRow(noLines)])).toBe(
      '## web\n- widgets-sdk: Widgets SDK. An invented SDK used by tests.',
    );
    const profile = profileOf(noLines, {}, fakePolicy());
    expect(profile.sources[0]?.ref).toBe(noLines.homepage);
  });

  it('points a brief source at its first concrete brief, else at the homepage', () => {
    const product = makeProduct({
      sources: [
        makeSource('brief', { slugs: ['ai/*', 'auth/choosing-authentication'] }, { id: 'briefs' }),
        makeSource('brief', { slugs: ['ai/*'] }, { id: 'globbed' }),
      ],
    });
    const { sources } = profileOf(product, {}, fakePolicy());
    expect(sources.map((source) => source.ref)).toEqual([
      'brief:auth/choosing-authentication',
      product.homepage,
    ]);
  });

  it('derives the lookups a product supports from its sources and the policy', () => {
    const product = makeProduct({
      esearch: { index: 'widgets' },
      sources: [makeSource('gatsby', { base: '/widgets/' }, { kinds: ['guide', 'release-notes'] })],
    });
    expect(profileOf(product, {}, fakePolicy()).capabilities).toEqual({
      symbols: 'none',
      samples: false,
      releaseNotes: true,
      search: 'local',
    });
    const withSiteSearch = fakePolicy({ enabled: ['website', 'site-search'] });
    expect(profileOf(product, {}, withSiteSearch).capabilities.search).toBe('local+site');
  });

  it('renders a minimal profile without empty lines of facts or empty sections', () => {
    const product = makeProduct({ aliases: [], languages: [], sources: [] });
    expect(renderProfile(profileOf(product, {}, fakePolicy()))).toBe(
      [
        '# Widgets SDK',
        '',
        'An invented SDK used by tests.',
        '',
        '- Id: widgets-sdk',
        '- Status: active',
        '- Homepage: https://developers.arcgis.com/widgets/',
        '- Version lines: latest "Current" (current)',
        '- Lookups: symbols no, samples no, release notes no, search local',
        '- Licence tier: esri-website-terms; registry entry verified on 2026-10-13',
      ].join('\n'),
    );
  });

  it('counts ancestors for the depth of a table-of-contents entry', () => {
    expect(tocRow(makeRecord()).depth).toBe(0);
    expect(tocRow(makeRecord({ breadcrumb: '' })).depth).toBe(0);
    expect(tocRow(makeRecord({ breadcrumb: 'Guide > Layers > Feature layers' })).depth).toBe(3);
  });

  // Regression: entries were indented by their depth alone. A page three levels down then
  // appeared to be nested under whatever unrelated top-level page happened to precede it.
  it('heads each run of table-of-contents entries with the path of its ancestors', () => {
    const page = (title: string, breadcrumb?: string) =>
      makeRecord({
        title,
        ref: `https://developers.arcgis.com/widgets/${title.toLowerCase()}/`,
        ...(breadcrumb === undefined ? {} : { breadcrumb }),
      });
    expect(
      renderToc([
        page('Home'),
        page('Install', ''),
        page('Tiles', 'Guide > Layers'),
        page('Rasters', 'Guide > Layers'),
        page('Tokens', 'Guide > Security'),
      ]),
    ).toBe(
      [
        '- Home: https://developers.arcgis.com/widgets/home/',
        '- Install: https://developers.arcgis.com/widgets/install/',
        '',
        '**Guide > Layers**',
        '- Tiles: https://developers.arcgis.com/widgets/tiles/',
        '- Rasters: https://developers.arcgis.com/widgets/rasters/',
        '',
        '**Guide > Security**',
        '- Tokens: https://developers.arcgis.com/widgets/tokens/',
      ].join('\n'),
    );
    expect(renderToc([])).toBe('');
  });
});

describe('version presenters', () => {
  const entry = (overrides: Parameters<typeof makeProduct>[0] = {}) => ({
    product: makeProduct(overrides),
    facts: [],
    compatibility: [],
    releaseNotes: [],
    notices: [],
    mismatches: [],
  });

  it('gives install coordinates per registry', () => {
    const { install } = versionsProduct(
      entry({
        packages: [
          pkg('npm', '@x/core', true),
          pkg('pypi', 'x', true),
          pkg('nuget', 'X.Runtime', true),
          pkg('pub', 'x_maps', true),
          pkg('maven', 'com.x:maps', true),
          pkg('swiftpm', 'x-swift', true),
          pkg('cran', 'xr', true),
          pkg('npm', '@x/not-primary'),
        ],
      }),
    );
    expect(install).toEqual([
      'npm install @x/core',
      'pip install x',
      'dotnet add package X.Runtime',
      'flutter pub add x_maps',
      'Gradle or Maven dependency com.x:maps:<version>',
      'Swift Package Manager: x-swift',
      'install.packages("xr")',
    ]);
  });

  it('shows the first packages when none is marked primary', () => {
    const packages = ['a', 'b', 'c', 'd'].map((name) => pkg('npm', name));
    expect(versionsProduct(entry({ packages })).install).toEqual([
      'npm install a',
      'npm install b',
      'npm install c',
    ]);
  });

  it('restricts a line to the sources that exist for it', () => {
    const product = entry({
      lines: [makeLine(), makeLine({ id: 'v200', label: '200.x', current: false, vars: {} })],
      sources: [
        makeSource('brief', { slugs: ['native/200-vs-300'] }, { id: 'briefs' }),
        makeSource(
          'gatsby',
          { base: '/widgets/api/' },
          { id: 'api', kinds: ['api'], lines: ['latest'] },
        ),
      ],
    });
    expect(versionsProduct(product).lines).toEqual([
      {
        id: 'latest',
        label: 'Current',
        docsUrl: 'https://developers.arcgis.com/widgets/api/',
        access: 'live',
        symbols: 'live',
      },
      {
        id: 'v200',
        label: '200.x',
        docsUrl: 'https://developers.arcgis.com/widgets/',
        access: 'live',
        symbols: 'none',
      },
    ]);
  });

  it('does not call a project behind when it is current or nothing is known', () => {
    const project = {
      product: 'widgets-sdk',
      package: 'widgets',
      version: '2.0.0',
      file: 'package.json',
    };
    const current = versionsProduct({
      ...entry(),
      project,
      facts: [
        {
          role: 'documented',
          value: '2.0',
          oracle: 'static',
          url: 'https://developers.arcgis.com/widgets/',
        },
      ],
    });
    expect(current.project).toEqual({ version: '2.0.0', file: 'package.json' });
    expect(versionsProduct({ ...entry(), project }).project).not.toHaveProperty('behind');
    expect(renderVersionsProduct(current)).toContain('In this project: 2.0.0 (package.json)\n');
  });

  it('renders the mature phase of a lifecycle', () => {
    const item = versionsProduct({
      ...entry(),
      facts: [
        {
          role: 'lifecycle',
          tag: 'mature',
          value: '2027-01-01',
          oracle: 'plc',
          url: 'https://support.esri.com/',
        },
      ],
    });
    expect(item.lifecycle).toEqual({ mature: '2027-01-01', source: 'https://support.esri.com/' });
    expect(renderVersionsProduct(item)).toContain(
      'Lifecycle: mature 2027-01-01 (https://support.esri.com/)',
    );
  });
});
