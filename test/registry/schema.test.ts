import { describe, expect, it } from 'vitest';
import { ADAPTER_TYPES, type AdapterConfigMap, type AdapterType } from '../../src/core/types.js';
import {
  briefSchema,
  hostPolicySchema,
  probeSchema,
  productSchema,
  sourceDefSchema,
  validateProducts,
  versionLineSchema,
} from '../../src/registry/schema.js';
import { makeHost, makeLine, makeProduct, makeSource } from '../support/builders.js';
import { loadData } from './load-data.js';

const data = await loadData();

/** A minimal valid config for every adapter type. */
const CONFIGS: { [A in AdapterType]: AdapterConfigMap[A] } = {
  astro: { base: '/widgets/{prefix}', sitemap: 'sitemap-0.xml' },
  gatsby: { base: '{base}', symbols: 'typedoc', bodyFrom: 'auto' },
  'docfx-esri': { slug: 'widgets', scope: 'api/', toc: 'api/toc.json', symbols: 'toc' },
  'legacy-help': {
    host: 'doc.arcgis.com',
    base: '/en/widgets/{line}/',
    books: [{ path: 'use', tocScript: '/en/widgets/use/1.js' }],
    enumerate: 'on-demand',
  },
  sitemap: {
    url: 'https://support.esri.com/sitemap.xml',
    titleFrom: 'slug',
    kind: 'troubleshooting',
  },
  static: { entries: [{ url: 'https://esri.github.io/widgets/', title: 'Widgets', kind: 'api' }] },
  brief: { slugs: ['ai/*'] },
  openapi: {
    specs: [
      'https://hub.arcgis.com/api/x/v1/docs-json',
      { url: 'https://hub.arcgis.com/a.js', embedded: true },
    ],
  },
  docc: { base: '/widgets/api/', maxDepth: 3 },
  dokka: { base: '/widgets/api/' },
  dartdoc: { base: '/widgets/api/', index: 'index.json' },
  'docfx-net': { base: '/widgets/api/', xrefmaps: ['xrefmap.yml'] },
  javadoc: { base: '/widgets/api/', legacy: true },
  sphinx: { base: '/widgets/api/' },
  'npm-dts': { package: '@acme/widgets', docUrl: '/widgets/api/{path}/' },
  'npm-cem': { packages: ['@acme/widgets'], file: 'api.json', docUrl: '/widgets/{tag}/' },
  'npm-json': { package: '@acme/widgets', file: 'api.json', mapper: 'arcade-api' },
  'github-repo': { repo: 'Esri/widgets', preset: 'markdown-docs', include: ['**/*.md'] },
  xmldoc: { repo: 'Esri/widgets', dir: 'References/API', docUrlHost: 'doc.esri.com' },
  pkgdown: { host: 'r.esri.com', packages: ['widgets'] },
};

function issuesOf(product: unknown): string[] {
  return validateProducts([product]).map((issue) => `${issue.path}: ${issue.message}`);
}

describe('registry data against the schemas', () => {
  it('validates every product', () => {
    expect(validateProducts(data.products)).toEqual([]);
  });

  it('validates every brief', () => {
    for (const brief of data.briefs) {
      expect(briefSchema.safeParse(brief).error?.issues ?? [], brief.slug).toEqual([]);
    }
  });

  it('keeps summaries, pitfalls and titles within their limits', () => {
    for (const product of data.products) {
      expect(product.summary.length, product.id).toBeLessThanOrEqual(160);
      expect(product.pitfalls.length, product.id).toBeLessThanOrEqual(4);
      expect(product.summary, product.id).not.toMatch(/\s{2,}|^\s|\s$/);
    }
  });
});

describe('sourceDefSchema', () => {
  it.each(ADAPTER_TYPES)('accepts a %s source and nothing misspelt in its config', (adapter) => {
    const source = makeSource(adapter, CONFIGS[adapter]);
    expect(sourceDefSchema.safeParse(source).error?.issues ?? []).toEqual([]);

    const misspelt = { ...source, config: { ...CONFIGS[adapter], bsae: '/typo/' } };
    expect(sourceDefSchema.safeParse(misspelt).success).toBe(false);
  });

  it('rejects a config that belongs to another adapter', () => {
    const source = { ...makeSource('docc', CONFIGS.docc), config: CONFIGS['github-repo'] };
    expect(sourceDefSchema.safeParse(source).success).toBe(false);
    expect(
      sourceDefSchema.safeParse({ ...makeSource('docc', CONFIGS.docc), adapter: 'wiki' }).success,
    ).toBe(false);
  });

  it('requires a probe, a kind and a kebab-case id', () => {
    const source = makeSource('gatsby', { base: '/widgets/' });
    const { probe: _probe, ...withoutProbe } = source;
    expect(sourceDefSchema.safeParse(withoutProbe).success).toBe(false);
    expect(sourceDefSchema.safeParse({ ...source, kinds: [] }).success).toBe(false);
    expect(sourceDefSchema.safeParse({ ...source, id: 'Guide Pages' }).success).toBe(false);
    expect(sourceDefSchema.safeParse({ ...source, capability: 'internet' }).success).toBe(false);
  });

  it('checks patterns, repository names and URL shapes', () => {
    const bad: Array<[AdapterType, unknown]> = [
      ['astro', { base: '/widgets/', exclude: ['('] }],
      ['astro', { base: 'widgets/' }],
      ['gatsby', { base: '/widgets/', symbolsFromSlug: '[' }],
      ['gatsby', { base: '/widgets/', classify: [['^a/', 'manual']] }],
      ['github-repo', { repo: 'widgets', preset: 'markdown-docs' }],
      ['github-repo', { repo: 'Esri/widgets', preset: 'everything' }],
      ['legacy-help', { host: 'doc.arcgis.com', base: 'en/widgets', books: [] }],
      ['docfx-esri', { slug: 'widgets', scope: 'api' }],
      ['openapi', { specs: [] }],
      ['openapi', { specs: ['http://hub.arcgis.com/api'] }],
      ['static', { entries: [] }],
      ['pkgdown', { host: 'https://r.esri.com', packages: ['widgets'] }],
    ];
    for (const [adapter, config] of bad) {
      const source = { ...makeSource(adapter, CONFIGS[adapter]), config };
      expect(sourceDefSchema.safeParse(source).success, JSON.stringify(config)).toBe(false);
    }
  });
});

describe('productSchema', () => {
  it('accepts the builder product', () => {
    expect(issuesOf(makeProduct())).toEqual([]);
    expect(productSchema.parse(makeProduct()).id).toBe('widgets-sdk');
  });

  it.each([
    ['id', { id: 'Widgets_SDK' }, 'id: must be kebab-case'],
    ['alias case', { aliases: ['Widgets'] }, 'aliases.0: must be lower-case'],
    ['summary length', { summary: 'x'.repeat(161) }, 'summary:'],
    ['pitfall count', { pitfalls: ['a', 'b', 'c', 'd', 'e'] }, 'pitfalls:'],
    ['homepage', { homepage: 'http://developers.arcgis.com/' }, 'homepage: must be an https URL'],
    ['verifiedOn', { verifiedOn: '13 October 2026' }, 'verifiedOn: must be an ISO date'],
    ['startHere ref', { startHere: [{ title: 'x', ref: 'docs/page' }] }, 'startHere.0.ref:'],
    ['category', { category: 'mobile' }, 'category:'],
    ['related', { related: ['Not An Id'] }, 'related.0: must be kebab-case'],
    ['lines', { lines: [] }, 'lines:'],
    [
      'workspace pattern',
      { workspaceSignals: [{ files: ['package.json'], pattern: '(' }] },
      'workspaceSignals.0.pattern: must be a valid regular expression',
    ],
    [
      'oracle type',
      { oracles: [{ type: 'crystal-ball', options: {}, provides: ['documented'] }] },
      'oracles.0.type:',
    ],
    [
      'release-notes filter',
      { releaseNotes: { sitemapFilter: '[' } },
      'releaseNotes.sitemapFilter: must be a valid regular expression',
    ],
  ])('rejects an invalid %s', (_name, override, expected) => {
    const issues = issuesOf({ ...makeProduct(), ...override });
    expect(issues.some((issue) => issue.startsWith(expected))).toBe(true);
  });

  it('rejects unknown keys and names the product', () => {
    const issues = validateProducts([{ ...makeProduct(), colour: 'blue' }, null]);
    expect(issues.map((issue) => issue.product)).toEqual(['widgets-sdk', '#1']);
  });

  it('accepts brief refs in startHere', () => {
    const product = makeProduct({ startHere: [{ title: 'Overview', ref: 'brief:ai/overview' }] });
    expect(issuesOf(product)).toEqual([]);
  });
});

describe('small schemas', () => {
  it('validates version lines', () => {
    expect(versionLineSchema.safeParse(makeLine()).success).toBe(true);
    expect(versionLineSchema.safeParse(makeLine({ id: '2.3' })).success).toBe(true);
    expect(versionLineSchema.safeParse(makeLine({ id: 'V 200' })).success).toBe(false);
    expect(versionLineSchema.safeParse(makeLine({ vars: { versions: '(' } })).success).toBe(false);
    expect(versionLineSchema.safeParse({ ...makeLine(), access: 'archived' }).success).toBe(false);
  });

  it('validates host rows', () => {
    expect(hostPolicySchema.safeParse(makeHost()).success).toBe(true);
    expect(hostPolicySchema.safeParse(makeHost({ capability: null })).success).toBe(true);
    expect(hostPolicySchema.safeParse(makeHost({ host: 'https://x.com' })).success).toBe(false);
    expect(hostPolicySchema.safeParse(makeHost({ allowPaths: ['('] })).success).toBe(false);
    expect(hostPolicySchema.safeParse(makeHost({ robotsDisallow: ['search'] })).success).toBe(
      false,
    );
    expect(hostPolicySchema.safeParse(makeHost({ ratePerSec: 0 })).success).toBe(false);
  });

  it('validates probes and briefs', () => {
    expect(probeSchema.safeParse({ url: 'https://a.example/x', expect: 'json' }).success).toBe(
      true,
    );
    expect(probeSchema.safeParse({ url: 'https://a.example/x', expect: 'pdf' }).success).toBe(
      false,
    );
    const brief = {
      slug: 'ai/overview',
      title: 'Overview',
      verifiedOn: '2026-10-13',
      sources: ['https://developers.arcgis.com/x/'],
      markdown: '# Overview',
    };
    expect(briefSchema.safeParse(brief).success).toBe(true);
    expect(briefSchema.safeParse({ ...brief, slug: 'AI/Overview' }).success).toBe(false);
  });
});
