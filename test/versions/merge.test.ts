import { describe, expect, it } from 'vitest';
import type { VersionFact } from '../../src/core/types.js';
import { mergeFacts } from '../../src/versions/merge.js';
import { dotnetProduct, javaProduct, jsProduct, pythonProduct, restJsProduct } from './products.js';

const fact = (partial: Partial<VersionFact> & Pick<VersionFact, 'role' | 'value'>): VersionFact => ({
  oracle: 'page-regex',
  url: 'https://developers.arcgis.com/x/',
  ...partial,
});

const npm = (name: string, tag: string, value: string, role: VersionFact['role'] = 'installable') =>
  fact({ role, value, tag, registry: 'npm', package: name, oracle: 'npm-dist-tags' });

describe('mergeFacts: documented versus installable', () => {
  // Research 1.2: the developer site describes 2.4.4 while PyPI still serves 2.4.3.
  const pythonFacts: VersionFact[] = [
    fact({
      role: 'installable',
      value: '2.4.3',
      date: '2026-04-21',
      registry: 'pypi',
      package: 'arcgis',
      oracle: 'pypi',
    }),
    fact({ role: 'documented', value: '2.4.4', date: '2026-09-22' }),
    fact({
      role: 'installable',
      value: '2.4.4',
      date: '2026-09-22',
      tag: 'v2.4.4',
      registry: 'github',
      package: 'Esri/arcgis-python-api',
      oracle: 'github-release',
    }),
  ];

  it('reports the Python 2.4.4 / 2.4.3 case as two answers and a mismatch', () => {
    const merged = mergeFacts(pythonProduct, pythonFacts);
    expect(merged.documented?.value).toBe('2.4.4');
    expect(merged.installable).toMatchObject({ value: '2.4.3', registry: 'pypi' });
    expect(merged.current).toBe('2.4.4');
    expect(merged.mismatches).toEqual([
      'Documented and installable versions differ: the documentation describes 2.4.4 (2026-09-22), but pypi arcgis serves 2.4.3 (2026-04-21). APIs new in 2.4.4 may not be installable from pypi yet.',
      'github Esri/arcgis-python-api has 2.4.4 (2026-09-22), which is newer than pypi arcgis 2.4.3 (2026-04-21).',
    ]);
  });

  it('puts the answer of each role first: the primary package leads the installable facts', () => {
    const merged = mergeFacts(pythonProduct, [...pythonFacts].reverse());
    expect(merged.facts.map((entry) => [entry.role, entry.registry ?? '', entry.value])).toEqual([
      ['documented', '', '2.4.4'],
      ['installable', 'pypi', '2.4.3'],
      ['installable', 'github', '2.4.4'],
    ]);
  });

  it('sees no mismatch between a minor version in the docs and a patch build in the registry', () => {
    const merged = mergeFacts(jsProduct, [
      npm('@arcgis/core', 'latest', '5.1.27'),
      fact({ role: 'documented', value: '5.1', date: '2026-06' }),
    ]);
    expect(merged.mismatches).toEqual([]);
    expect(merged.current).toBe('5.1');
  });

  it('says so when the registry is ahead of the documentation', () => {
    const merged = mergeFacts(jsProduct, [
      npm('@arcgis/core', 'latest', '5.2.0'),
      fact({ role: 'documented', value: '5.1' }),
    ]);
    expect(merged.mismatches).toEqual([
      'Documented and installable versions differ: npm @arcgis/core serves 5.2.0, but the documentation describes 5.1. The documentation may lag the package.',
    ]);
  });
});

describe('mergeFacts: general-availability rule', () => {
  it('reports the REST JS case: latest is older than the long-term support tag', () => {
    const merged = mergeFacts(restJsProduct, [
      npm('@esri/arcgis-rest-request', 'latest', '4.11.0'),
      npm('@esri/arcgis-rest-request', 'lts-v4.x', '4.11.1'),
    ]);
    // The newest generally available version is the answer, whatever tag carries it.
    expect(merged.installable).toMatchObject({ value: '4.11.1', tag: 'lts-v4.x' });
    expect(merged.current).toBe('4.11.1');
    expect(merged.facts.map((entry) => entry.value)).toEqual(['4.11.1', '4.11.0']);
    expect(merged.mismatches).toEqual([
      'npm @esri/arcgis-rest-request: dist-tag "latest" is 4.11.0, but "lts-v4.x" serves the newer 4.11.1. Install 4.11.1 explicitly to get the newest release.',
    ]);
  });

  it('never takes a pre-release for the current version', () => {
    const merged = mergeFacts(jsProduct, [
      npm('@arcgis/core', 'latest', '5.1.27'),
      npm('@arcgis/core', 'next', '6.0.0-next.6', 'prerelease'),
      npm('@arcgis/core', 'rc', '5.2.0-next.145', 'prerelease'),
    ]);
    expect(merged.current).toBe('5.1.27');
    expect(merged.mismatches).toEqual([]);
    expect(merged.facts.at(-1)?.role).toBe('prerelease');
  });

  it('confirms no current version when only pre-releases were found', () => {
    const merged = mergeFacts(jsProduct, [
      npm('@arcgis/core', 'next', '6.0.0-next.6', 'prerelease'),
    ]);
    expect(merged.current).toBeUndefined();
    expect(merged.notices).toEqual([
      'Only pre-release builds were found (next 6.0.0-next.6); no generally available version is confirmed.',
    ]);
  });

  it('keeps one package with several lines in one channel, newest first', () => {
    const nuget = (value: string) =>
      fact({
        role: 'installable',
        value,
        registry: 'nuget',
        package: 'Esri.ArcGISRuntime',
        oracle: 'nuget-flat',
      });
    const merged = mergeFacts(dotnetProduct, [nuget('200.8.3'), nuget('300.1.0')]);
    expect(merged.installable?.value).toBe('300.1.0');
    expect(merged.mismatches).toEqual([]);
  });
});

describe('mergeFacts: evidence', () => {
  it('prefers live evidence to the static registry value and labels a static answer', () => {
    const staticFact = fact({ role: 'documented', value: '200.6', oracle: 'static' });
    const live = fact({ role: 'documented', value: '200.6', date: '2024-11' });
    expect(mergeFacts(javaProduct, [staticFact, live]).documented).toBe(live);
    expect(mergeFacts(javaProduct, [staticFact, live]).notices).toEqual([]);

    const alone = mergeFacts(javaProduct, [staticFact]);
    expect(alone.documented).toBe(staticFact);
    expect(alone.notices).toEqual([
      `Version 200.6 is a registry value as of ${javaProduct.verifiedOn}, not read live.`,
    ]);
  });

  it('does not hold a static value against a live registry', () => {
    const merged = mergeFacts(jsProduct, [
      fact({ role: 'documented', value: '5.0', oracle: 'static' }),
      npm('@arcgis/core', 'latest', '5.1.27'),
    ]);
    expect(merged.mismatches).toEqual([]);
  });

  it('dates an undated banner from another documented fact of the same version', () => {
    const merged = mergeFacts(pythonProduct, [
      fact({ role: 'documented', value: '2.4.4' }),
      fact({ role: 'documented', value: '2.4.4', date: '2026-09-22', oracle: 'github-release' }),
      fact({ role: 'documented', value: '2.4.3', date: '2026-03-31', oracle: 'sitemap-slug' }),
    ]);
    expect(merged.documented).toMatchObject({ oracle: 'page-regex', date: '2026-09-22' });
    expect(merged.facts[0]).toBe(merged.documented);
  });

  it('orders life-cycle facts by phase and returns nothing for no facts', () => {
    const phase = (tag: string, value: string) => fact({ role: 'lifecycle', value, tag });
    const merged = mergeFacts(javaProduct, [
      phase('retirement', '2028-11-25'),
      phase('ga', '2024-11-25'),
      phase('mature', '2026-11-25'),
    ]);
    expect(merged.facts.map((entry) => entry.tag)).toEqual(['ga', 'mature', 'retirement']);
    expect(mergeFacts(jsProduct, [])).toEqual({ facts: [], mismatches: [], notices: [] });
  });
});
