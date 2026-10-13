import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { VersionFact } from '../../../src/core/types.js';
import {
  defineOracle,
  homeUrl,
  lineUrl,
  option,
  packageOption,
  resolveUrl,
  urlOption,
} from '../../../src/versions/oracles/kit.js';
import { ORACLES } from '../../../src/versions/oracles/index.js';
import { REGISTRIES } from '../cassettes-registries.js';
import { LINE_200, LINE_300, dotnetProduct, jsProduct, spec } from '../products.js';
import { makeProduct } from '../../support/builders.js';
import { makeCall, makeCtx } from '../../support/make-ctx.js';

const D = 'https://developers.arcgis.com';

const installable: VersionFact = {
  role: 'installable',
  value: '1.2.3',
  oracle: 'github-release',
  url: 'https://github.com/Esri/x/releases/tag/1.2.3',
};
const documented: VersionFact = { ...installable, role: 'documented', oracle: 'page-regex' };
const fixed = (facts: VersionFact[]) =>
  defineOracle('github-release', 'github', () => Promise.resolve(facts));

describe('defineOracle', () => {
  it('skips an oracle whose capability is off, without calling it', async () => {
    const ctx = makeCtx({
      cassette: REGISTRIES,
      config: { capabilities: new Set(['website'] as const) },
    });
    const outcome = await ORACLES['npm-dist-tags'].attempt(ctx, jsProduct, spec('npm-dist-tags'));
    expect(outcome).toEqual({ facts: [], skipped: 'registries' });
    expect(ctx.http.count()).toBe(0);
  });

  it.each([404, 403, 503, 'timeout', 'html', 'truncated'] as const)(
    'turns upstream fault %s into "no answer" and keeps the reason',
    async (fault) => {
      const ctx = makeCtx({ cassette: REGISTRIES });
      ctx.http.fail(/registry\.npmjs\.org/, fault);
      const outcome = await ORACLES['npm-dist-tags'].attempt(ctx, jsProduct, spec('npm-dist-tags'));
      expect(outcome.facts).toEqual([]);
      expect(outcome.error).toBeInstanceOf(McpDocError);
      // The port's `read` gives the same answer without the reason.
      expect(await ORACLES['npm-dist-tags'].read(ctx, jsProduct, spec('npm-dist-tags'))).toEqual(
        [],
      );
    },
  );

  it('lets programming errors through instead of hiding them as "no answer"', async () => {
    const ctx = makeCtx();
    // Nothing is recorded: the fake rejects with an error that is not an upstream condition.
    await expect(
      ORACLES['npm-dist-tags'].read(ctx, jsProduct, spec('npm-dist-tags')),
    ).rejects.toThrow(/No recorded response/);
  });

  it('has no answer once the request budget is spent', async () => {
    const ctx = makeCtx({ cassette: REGISTRIES });
    const call = makeCall(ctx);
    call.budget.used = call.budget.maxRequests;
    const outcome = await ORACLES['npm-dist-tags'].attempt(ctx, jsProduct, spec('npm-dist-tags'), {
      call,
    });
    expect(outcome.error?.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('keeps only the roles a spec declares', async () => {
    const ctx = makeCtx();
    const oracle = fixed([
      installable,
      { ...installable, role: 'prerelease', value: '2.0.0-rc.1' },
    ]);
    const all = await oracle.read(ctx, jsProduct, spec('github-release'));
    expect(all.map((fact) => fact.role)).toEqual(['installable', 'prerelease']);
    const stable = await oracle.read(ctx, jsProduct, spec('github-release', {}, ['installable']));
    expect(stable.map((fact) => fact.role)).toEqual(['installable']);
    expect(await oracle.read(ctx, jsProduct, spec('github-release', {}, ['lifecycle']))).toEqual(
      [],
    );
  });

  it('relabels a fact when the spec declares the oracle as evidence for the other role', async () => {
    const ctx = makeCtx();
    const asDocumented = await fixed([installable]).read(
      ctx,
      jsProduct,
      spec('github-release', {}, ['documented']),
    );
    expect(asDocumented[0]?.role).toBe('documented');
    const asReleaseDate = await fixed([installable]).read(
      ctx,
      jsProduct,
      spec('github-release', {}, ['released']),
    );
    expect(asReleaseDate[0]?.role).toBe('documented');
    const asInstallable = await fixed([documented]).read(
      ctx,
      jsProduct,
      spec('github-release', {}, ['installable']),
    );
    expect(asInstallable[0]?.role).toBe('installable');
  });
});

describe('option helpers', () => {
  it('reads an option under its one key, trimmed, and takes a blank value as absent', () => {
    const options = spec('page-regex', { url: ' /x/ ', pattern: '  ' });
    expect(option(options, 'url')).toBe('/x/');
    expect(option(options, 'pattern')).toBeUndefined();
    expect(option(options, 'format')).toBeUndefined();
  });

  // Regression: readers accepted lists of alternative spellings (`pkg`, `name`, `page`,
  // `regex` ...) that no registry entry used and no lint knew about.
  it('knows no alternative spellings of a key', () => {
    expect(urlOption(spec('page-regex', { page: `${D}/net/` }), dotnetProduct, LINE_300)).toBe(
      undefined,
    );
    expect(packageOption(jsProduct, spec('npm-dist-tags', { pkg: 'x', name: 'y' }), 'npm')).toBe(
      '@arcgis/core',
    );
  });

  it('picks the package from the option, then the primary package of that registry', () => {
    expect(packageOption(jsProduct, spec('npm-dist-tags', { package: 'x' }), 'npm')).toBe('x');
    // NuGet calls the package name an id, and so does the registry.
    expect(packageOption(dotnetProduct, spec('nuget-flat', { id: 'x' }), 'nuget', 'id')).toBe('x');
    expect(packageOption(dotnetProduct, spec('nuget-flat'), 'nuget', 'id')).toBe(
      'Esri.ArcGISRuntime',
    );
    expect(packageOption(jsProduct, spec('npm-dist-tags'), 'npm')).toBe('@arcgis/core');
    expect(packageOption(jsProduct, spec('pypi'), 'pypi')).toBeUndefined();
  });

  it('resolves registry paths against developers.arcgis.com and substitutes line variables', () => {
    expect(resolveUrl('/net/{prefix}release-notes/', LINE_200)).toBe(
      `${D}/net/v200/release-notes/`,
    );
    expect(resolveUrl('https://doc.esri.com/x/', undefined)).toBe('https://doc.esri.com/x/');
  });

  it('places a non-current line under its prefix', () => {
    expect(homeUrl(dotnetProduct, LINE_300)).toBe(`${D}/net/`);
    expect(homeUrl(dotnetProduct, LINE_200)).toBe(`${D}/net/v200/`);
    expect(homeUrl(makeProduct({ homepage: `${D}/java/v200` }), LINE_200)).toBe(`${D}/java/v200/`);
    expect(urlOption(spec('page-regex', { url: `${D}/net/` }), dotnetProduct, LINE_200)).toBe(
      `${D}/net/v200/`,
    );
    expect(urlOption(spec('page-regex', { url: `${D}/other/` }), dotnetProduct, LINE_200)).toBe(
      `${D}/other/`,
    );
    expect(urlOption(spec('page-regex'), dotnetProduct, LINE_200)).toBeUndefined();
    // A page under the home page moves with it; one that already names the line stays.
    expect(lineUrl(`${D}/net/release-notes/`, dotnetProduct, LINE_200)).toBe(
      `${D}/net/v200/release-notes/`,
    );
    expect(lineUrl('/net/{prefix}release-notes/', dotnetProduct, LINE_200)).toBe(
      `${D}/net/v200/release-notes/`,
    );
    expect(lineUrl(`${D}/net/release-notes/`, dotnetProduct, LINE_300)).toBe(
      `${D}/net/release-notes/`,
    );
  });
});
