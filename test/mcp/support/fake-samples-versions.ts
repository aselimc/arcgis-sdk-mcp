/**
 * Scripted sample and version services for the MCP surface tests.
 */
import type { Ctx, SampleService, VersionService } from '../../../src/core/ports.js';
import { makeRecord } from '../../support/builders.js';
import { JS } from './catalogue.js';

/** One GitHub sample for every query except `nothing`; code when asked for. */
export function fakeSamples(): SampleService {
  return {
    async find(req) {
      const blob = 'https://github.com/Esri/jsapi-resources/blob/v5.1.0/samples/cluster';
      const hit = {
        record: makeRecord({
          ref: `${JS}/sample-code/cluster/`,
          product: 'js-maps-sdk',
          source: 'samples',
          kind: 'sample' as const,
          title: 'Cluster points',
          language: 'typescript',
          platform: 'web',
          breadcrumb: 'Visualization',
          license: 'apache-2.0' as const,
        }),
        summary: 'Clusters point\n features.',
        relevantApis: ['FeatureLayer', 'FeatureReductionCluster'],
        files: [
          { name: 'main.ts', ref: `${blob}/main.ts`, bytes: 512 },
          { name: 'README.md', ref: `${blob}/README.md` },
        ],
        origin: 'github' as const,
        apiConfirmed: false,
        legacyPattern: true,
      };
      const hits = req.query === 'nothing' ? [] : [hit];
      return {
        scope: {
          product: 'js-maps-sdk',
          line: 'latest',
          pinnedTo: 'v5.1.0',
          ...(req.platform ? { platform: req.platform } : {}),
        },
        total: hits.length,
        hits,
        ...(req.withCode && hits.length > 0
          ? {
              code: {
                ref: `${blob}/main.ts`,
                file: 'main.ts',
                language: 'ts',
                text: 'const fence = "```";\nexport const layer = 1;\n',
                truncated: req.maxTokens < 1000,
              },
            }
          : {}),
        notes: req.usesApi ? [`API use of ${req.usesApi} was not confirmed for every hit.`] : [],
      };
    },
  };
}

/**
 * A full report for `js-maps-sdk`, an empty one for other products and none without a
 * product. The label of `widgets-sdk` fails, as an oracle may.
 */
export function fakeVersions(ctx: Ctx): VersionService {
  const { registry } = ctx;
  return {
    async report(req) {
      if (req.product === undefined) return { asOf: ctx.clock.iso(), products: [], notes: [] };
      const { product } = registry.resolve(req.product);
      if (product.id !== 'js-maps-sdk') {
        return {
          asOf: ctx.clock.iso(),
          products: [
            {
              product,
              facts: [],
              compatibility: [],
              releaseNotes: [],
              notices: [],
              mismatches: [],
            },
          ],
          notes: ['No version oracle answered.'],
        };
      }
      const npm = 'https://registry.npmjs.org/@arcgis/core';
      return {
        asOf: ctx.clock.iso(),
        products: [
          {
            product,
            facts: [
              {
                role: 'documented',
                value: '5.1',
                date: '2026-06-24',
                oracle: 'page-regex',
                url: `${JS}/`,
              },
              {
                role: 'installable',
                value: '5.1.2',
                tag: 'latest',
                date: '2026-07-01',
                registry: 'npm',
                package: '@arcgis/core',
                oracle: 'npm-dist-tags',
                url: npm,
              },
              { role: 'installable', value: '4.34.8', oracle: 'npm-dist-tags', url: npm },
              {
                role: 'prerelease',
                value: '5.2.0-next.3',
                tag: 'next',
                oracle: 'npm-dist-tags',
                url: npm,
              },
              { role: 'prerelease', value: '5.2.0-rc.1', oracle: 'npm-dist-tags', url: npm },
              {
                role: 'lifecycle',
                value: '2026-06-24',
                tag: 'ga',
                oracle: 'plc',
                url: 'https://support.esri.com/lifecycle',
              },
              {
                role: 'lifecycle',
                value: '2028-06-24',
                tag: 'retirement',
                oracle: 'plc',
                url: 'https://support.esri.com/lifecycle',
              },
            ],
            project: {
              product: product.id,
              package: '@arcgis/core',
              version: '4.31.0',
              file: 'package.json',
            },
            compatibility: [
              {
                with: 'ArcGIS Enterprise',
                value: '12.0',
                unreleased: true,
                source: `${JS}/system-requirements/`,
              },
            ],
            releaseNotes: [{ version: '5.1', ref: `${JS}/release-notes/` }],
            notices: ['4.x widgets are deprecated.'],
            mismatches: ['Documentation describes 5.1; npm latest is 5.1.2.'],
          },
        ],
        notes: [],
      };
    },
    async label(product) {
      if (product.id === 'widgets-sdk') throw new Error('oracle offline');
      return '5.1';
    },
  };
}
