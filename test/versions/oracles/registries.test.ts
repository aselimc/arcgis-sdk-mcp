import { describe, expect, it } from 'vitest';
import { ORACLES, versionOracles } from '../../../src/versions/oracles/index.js';
import { ORACLE_TYPES_UNDER_TEST } from './types.js';
import { REGISTRIES } from '../cassettes-registries.js';
import { dotnetProduct, jsProduct, pythonProduct, restJsProduct, spec } from '../products.js';
import { makeProduct } from '../../support/builders.js';
import { FakeGithub } from '../../support/fake-github.js';
import { makeCall, makeCtx } from '../../support/make-ctx.js';

const ctxWithRegistries = () => makeCtx({ cassette: REGISTRIES });

describe('oracle table', () => {
  it('has one implementation per oracle type of the design', () => {
    expect(Object.keys(ORACLES).sort()).toEqual([...ORACLE_TYPES_UNDER_TEST].sort());
    for (const [type, oracle] of Object.entries(ORACLES)) expect(oracle.type).toBe(type);
    expect(versionOracles()).toHaveLength(ORACLE_TYPES_UNDER_TEST.length);
  });
});

describe('npm-dist-tags', () => {
  it('reports latest as installable and builds ahead of it as pre-releases', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES['npm-dist-tags'].read(ctx, jsProduct, spec('npm-dist-tags'));
    expect(facts).toEqual([
      expect.objectContaining({
        role: 'installable',
        value: '5.1.27',
        tag: 'latest',
        registry: 'npm',
        package: '@arcgis/core',
        oracle: 'npm-dist-tags',
        url: 'https://registry.npmjs.org/-/package/@arcgis/core/dist-tags',
      }),
      expect.objectContaining({ role: 'prerelease', value: '5.2.0-next.145', tag: 'rc' }),
      expect.objectContaining({ role: 'prerelease', value: '6.0.0-next.6', tag: 'next' }),
    ]);
    // The package came from the product's primary npm package: no option was given.
    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count()).toBe(1);
  });

  it('counts long-term support tags as generally available and drops unrelated tags', async () => {
    const ctx = ctxWithRegistries();
    const [oracle] = restJsProduct.oracles;
    const facts = await ORACLES['npm-dist-tags'].read(ctx, restJsProduct, oracle!);
    expect(facts.map((fact) => [fact.role, fact.tag, fact.value])).toEqual([
      ['installable', 'latest', '4.11.0'],
      ['installable', 'lts-v4.x', '4.11.1'],
    ]);
  });

  it('honours a custom list of general-availability tags', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES['npm-dist-tags'].read(
      ctx,
      restJsProduct,
      spec('npm-dist-tags', { tags: 'latest, v3-*' }),
    );
    expect(facts.map((fact) => fact.tag)).toEqual(['latest', 'v3-archive']);
  });

  it('has no answer for a package that needs authentication or has no npm package', async () => {
    const ctx = ctxWithRegistries();
    const locked = spec('npm-dist-tags', { package: '@esri/private-thing' });
    expect(await ORACLES['npm-dist-tags'].read(ctx, jsProduct, locked)).toEqual([]);
    const bare = makeProduct({ packages: [] });
    expect(await ORACLES['npm-dist-tags'].read(ctx, bare, spec('npm-dist-tags'))).toEqual([]);
  });
});

describe('pypi', () => {
  it('reports info.version with the upload date of that release', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES.pypi.read(ctx, pythonProduct, spec('pypi', { package: 'arcgis' }));
    expect(facts).toEqual([
      {
        role: 'installable',
        value: '2.4.3',
        date: '2026-04-21',
        registry: 'pypi',
        package: 'arcgis',
        oracle: 'pypi',
        url: 'https://pypi.org/pypi/arcgis/json',
      },
    ]);
  });

  it('has no answer when the document has no version', async () => {
    const ctx = makeCtx();
    ctx.http.on('https://pypi.org/pypi/arcgis/json', { json: { info: {} } });
    expect(await ORACLES.pypi.read(ctx, pythonProduct, spec('pypi'))).toEqual([]);
  });
});

describe('nuget-flat', () => {
  it('reports the newest stable version overall and per version line', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES['nuget-flat'].read(
      ctx,
      dotnetProduct,
      spec('nuget-flat', { id: 'esri.arcgisruntime' }),
    );
    // 300.2.0-beta.1 is listed but is not generally available.
    expect(facts.map((fact) => fact.value)).toEqual(['300.1.0', '200.8.3']);
    expect(facts[0]).toMatchObject({
      role: 'installable',
      registry: 'nuget',
      oracle: 'nuget-flat',
    });
  });

  it('lower-cases the package id of the product in the URL', async () => {
    const ctx = ctxWithRegistries();
    await ORACLES['nuget-flat'].read(ctx, dotnetProduct, spec('nuget-flat'));
    expect(ctx.http.requests[0]?.url).toBe(
      'https://api.nuget.org/v3-flatcontainer/esri.arcgisruntime/index.json',
    );
  });
});

describe('pub-dev', () => {
  it('strips the build suffix and reports the publication date', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES['pub-dev'].read(
      ctx,
      makeProduct(),
      spec('pub-dev', { package: 'arcgis_maps' }),
    );
    expect(facts).toEqual([
      expect.objectContaining({
        role: 'installable',
        value: '300.1.0',
        date: '2026-08-05',
        registry: 'pub',
        package: 'arcgis_maps',
      }),
    ]);
  });
});

describe('agol-rest-info', () => {
  it('reports the version ArcGIS Online runs as documented', async () => {
    const ctx = ctxWithRegistries();
    const facts = await ORACLES['agol-rest-info'].read(ctx, makeProduct(), spec('agol-rest-info'));
    expect(facts).toEqual([
      {
        role: 'documented',
        value: '2026.2',
        oracle: 'agol-rest-info',
        url: 'https://www.arcgis.com/sharing/rest?f=json',
      },
    ]);
  });

  it('accepts a numeric currentVersion', async () => {
    const ctx = makeCtx();
    ctx.http.on('https://www.arcgis.com/sharing/rest?f=json', { json: { currentVersion: 12.1 } });
    const facts = await ORACLES['agol-rest-info'].read(ctx, makeProduct(), spec('agol-rest-info'));
    expect(facts[0]?.value).toBe('12.1');
  });
});

describe('github-release', () => {
  const github = () =>
    new FakeGithub({
      'Esri/arcgis-python-api': { release: { tag: 'v2.4.4', publishedAt: '2026-09-22T18:04:00Z' } },
      'Esri/arcgis-rest-js': {
        release: { tag: '@esri/arcgis-rest-request@4.11.1', publishedAt: '2026-08-12T10:00:00Z' },
      },
      'Esri/no-releases': {},
      'Esri/nightlies': { release: { tag: 'nightly', publishedAt: '2026-10-01T00:00:00Z' } },
    });

  it('reads the version out of the tag and keeps the tag', async () => {
    const ctx = makeCtx({ github: github() });
    const call = makeCall(ctx);
    const facts = await ORACLES['github-release'].read(
      ctx,
      pythonProduct,
      spec('github-release', { repo: 'Esri/arcgis-python-api' }),
      { call },
    );
    expect(facts).toEqual([
      {
        role: 'installable',
        value: '2.4.4',
        date: '2026-09-22',
        tag: 'v2.4.4',
        registry: 'github',
        package: 'Esri/arcgis-python-api',
        oracle: 'github-release',
        url: 'https://github.com/Esri/arcgis-python-api/releases/tag/v2.4.4',
      },
    ]);
    // The GitHub call counts against the tool call's budget.
    expect(call.budget.used).toBe(1);
  });

  it('handles monorepo tags', async () => {
    const ctx = makeCtx({ github: github() });
    const facts = await ORACLES['github-release'].read(
      ctx,
      restJsProduct,
      spec('github-release', { repo: 'Esri/arcgis-rest-js' }),
    );
    expect(facts[0]).toMatchObject({ value: '4.11.1', tag: '@esri/arcgis-rest-request@4.11.1' });
    expect(facts[0]?.url).toBe(
      'https://github.com/Esri/arcgis-rest-js/releases/tag/%40esri%2Farcgis-rest-request%404.11.1',
    );
  });

  it('declared as release-date evidence, it is relabelled as documented', async () => {
    const ctx = makeCtx({ github: github() });
    const [, , declared] = pythonProduct.oracles;
    const facts = await ORACLES['github-release'].read(ctx, pythonProduct, declared!);
    expect(facts[0]).toMatchObject({ role: 'documented', value: '2.4.4', date: '2026-09-22' });
  });

  it('has no answer without a release, a version-shaped tag or a repository', async () => {
    const ctx = makeCtx({ github: github() });
    const read = (repo?: string) =>
      ORACLES['github-release'].read(
        ctx,
        makeProduct(),
        spec('github-release', repo === undefined ? {} : { repo }),
      );
    expect(await read('Esri/no-releases')).toEqual([]);
    expect(await read('Esri/nightlies')).toEqual([]);
    expect(await read('Esri/unknown')).toEqual([]);
    expect(await read()).toEqual([]);
  });

  it('defaults to the source repository, never to a samples repository', async () => {
    const ctx = makeCtx({ github: github() });
    const product = makeProduct({
      repos: [
        { repo: 'Esri/nightlies', role: 'samples', license: 'apache-2.0', defaultBranch: 'main' },
        {
          repo: 'Esri/arcgis-python-api',
          role: 'source',
          license: 'apache-2.0',
          defaultBranch: 'master',
        },
      ],
    });
    const facts = await ORACLES['github-release'].read(ctx, product, spec('github-release'));
    expect(facts[0]?.package).toBe('Esri/arcgis-python-api');
  });

  it('reports a spent API quota as the reason for having no answer', async () => {
    const ctx = makeCtx({ github: github().exhaustQuota('2026-10-13T13:00:00Z') });
    const outcome = await ORACLES['github-release'].attempt(
      ctx,
      pythonProduct,
      spec('github-release', { repo: 'Esri/arcgis-python-api' }),
    );
    expect(outcome.facts).toEqual([]);
    expect(outcome.error?.code).toBe('RATE_LIMITED_GITHUB');
  });
});
