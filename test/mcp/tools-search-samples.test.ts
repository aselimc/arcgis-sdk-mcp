import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import { TOOLS } from '../../src/core/names.js';
import type { IndexService } from '../../src/core/ports.js';
import { makeHit } from '../support/builders.js';
import { makeFakeServices } from './support/fake-services.js';
import { useToolSuite } from './support/tool-suite.js';

describe('search and sample tools', () => {
  const suite = useToolSuite();
  const { call, structuredOf } = suite;

  describe(TOOLS.search, () => {
    it('returns ranked hits with the scope, the mode and the best follow-up', async () => {
      const outcome = await call(TOOLS.search, { query: 'query features', kind: 'api' });
      const data = structuredOf(TOOLS.search, outcome);
      expect(data).toMatchObject({
        query: 'query features',
        mode: 'local+site',
        total: 2,
        scope: { products: ['js-maps-sdk'], kind: 'api', line: 'latest' },
        results: [
          { rank: 1, match: 'symbol', symbolKind: 'method', licenseTier: 'esri-website-terms' },
          { rank: 2, kind: 'brief', licenseTier: 'project' },
        ],
      });
      expect(outcome.text.split('\n')[0]).toBe(
        'Search "query features" | products: js-maps-sdk (sources: references), detected in the project | line: latest | kind: api | mode: local index + Esri site search | hits 1-2 of 2',
      );
      expect(outcome.text).toContain(
        '1. FeatureLayer.queryFeatures [api, method] js-maps-sdk/references 5.1',
      );
      expect(outcome.text).toContain(
        '   In: Reference > layers\n   Runs a query against the layer.',
      );
      expect(outcome.text).toMatch(
        /\nNext: arcgis_docs_read\(\{"ref":"[^"]+#queryFeatures"\}\)\nSource: Esri documentation at the refs above/,
      );
    });

    it('offers further pages as a remark first and as Next: once paging', async () => {
      const first = await call(TOOLS.search, { query: 'many', product: 'javascript' });
      const cursor = String(structuredOf(TOOLS.search, first).nextCursor);
      expect(first.text).toContain(
        `Note: More hits: arcgis_docs_search({"query":"many","product":"javascript","cursor":"${cursor}"})`,
      );
      expect(first.text).toContain('\nNext: arcgis_docs_read(');

      const second = await call(TOOLS.search, { query: 'many', cursor });
      const data = structuredOf(TOOLS.search, second);
      expect(data.results).toMatchObject([{ rank: 9 }, { rank: 10 }]);
      expect(second.text).toContain('hits 9-10 of 40');
      expect(second.text).toContain('\nNext: arcgis_docs_read(');
    });

    it('numbers from one when the cursor is not one of its own', async () => {
      suite.harness.services.search.search = async (req) => ({
        query: req.query,
        scope: { products: [], line: 'latest' },
        mode: 'local',
        total: 30,
        hits: [],
        nextCursor: 'opaque',
        notes: [],
      });
      const outcome = await call(TOOLS.search, { query: 'paged', cursor: 'not-a-cursor' });
      expect(outcome.text.split('\n')[0]).toBe(
        'Search "paged" | products: none | line: latest | mode: local index (site search off) | 0 hits',
      );
      expect(outcome.text).toContain(
        'Next: arcgis_docs_search({"query":"paged","cursor":"opaque"})',
      );
      suite.harness.services.search = makeFakeServices(suite.harness.ctx).search;
    });

    it('treats zero hits as a normal result that says where else to look', async () => {
      const outcome = await call(TOOLS.search, { query: 'nothing' });
      const data = structuredOf(TOOLS.search, outcome);
      expect(data).toMatchObject({ total: 0, results: [], mode: 'local' });
      expect(outcome.text).toContain('| 0 hits\nNote: No hits; absence here is not proof');
      expect(outcome.text).toContain(
        'Next: arcgis_docs_list_products({"query":"nothing","limit":8})',
      );
      expect(outcome.text).not.toContain('Source:');
    });

    // Regression: the continuation fell back to the default page size of 8.
    it('repeats a chosen page size in the continuation, and omits the default one', async () => {
      const chosen = await call(TOOLS.search, { query: 'many', product: 'javascript', limit: 20 });
      const cursor = String(structuredOf(TOOLS.search, chosen).nextCursor);
      expect(chosen.text).toContain(
        `Note: More hits: arcgis_docs_search({"query":"many","product":"javascript","limit":20,"cursor":"${cursor}"})`,
      );
      const byDefault = await call(TOOLS.search, { query: 'many', limit: 8 });
      expect(byDefault.text).toContain(
        'Note: More hits: arcgis_docs_search({"query":"many","cursor":',
      );
    });

    it('says in plain words how a scope the caller did not name was chosen', async () => {
      const search = suite.harness.services.search.search.bind(suite.harness.services.search);
      const origins: Array<[string | undefined, string]> = [
        ['router', 'products: js-maps-sdk, chosen from the query |'],
        ['query', 'products: js-maps-sdk, named by the query |'],
        ['none', 'products: js-maps-sdk |'],
        [undefined, 'products: js-maps-sdk |'],
      ];
      for (const [resolvedFrom, expected] of origins) {
        suite.harness.services.search.search = async (req, options) => {
          const response = await search(req, options);
          const { resolvedFrom: _from, sources: _sources, ...scope } = response.scope;
          return {
            ...response,
            scope: { ...scope, ...(resolvedFrom === undefined ? {} : { resolvedFrom }) },
          };
        };
        const outcome = await call(TOOLS.search, { query: 'query features' });
        expect(outcome.text.split('\n')[0], String(resolvedFrom)).toContain(expected);
      }
      suite.harness.services.search = makeFakeServices(suite.harness.ctx).search;
      // A product argument is echoed as the caller wrote it.
      const named = await call(TOOLS.search, { query: 'query features', product: 'javascript' });
      expect(named.text.split('\n')[0]).toContain(', resolved from "javascript" |');
    });

    describe('without hits', () => {
      type IndexQuery = Parameters<IndexService['query']>[0];
      /** Scripts what the index finds for the query in any content type. */
      const scriptIndex = (found: number): IndexQuery[] => {
        const seen: IndexQuery[] = [];
        const hits = Array.from({ length: found }, () => makeHit({ product: 'js-maps-sdk' }));
        suite.harness.services.index.query = (query) => {
          seen.push(query);
          return { hits, total: hits.length };
        };
        return seen;
      };
      /** Makes the scripted search find nothing whatever the query is. */
      const findNothing = (): void => {
        const { search } = makeFakeServices(suite.harness.ctx);
        suite.harness.services.search.search = async (req, options) => ({
          ...(await search.search({ ...req, query: 'nothing' }, options)),
          query: req.query,
        });
      };
      const restore = (): void => {
        suite.harness.services.search = makeFakeServices(suite.harness.ctx).search;
      };
      const nextOf = (text: string): string | undefined =>
        text.split('\n').find((line) => line.startsWith('Next: '));

      // Regression: the note said "repeat without kind" while Next: listed the catalogue.
      it('offers the same search without `kind` when other content types have hits', async () => {
        const seen = scriptIndex(1);
        const outcome = await call(TOOLS.search, {
          query: 'nothing',
          product: 'javascript',
          kind: 'troubleshooting',
          version: '4.x',
          limit: 5,
        });
        expect(nextOf(outcome.text)).toBe(
          'Next: arcgis_docs_search({"query":"nothing","product":"javascript","version":"4.x","limit":5})',
        );
        expect(seen).toEqual([{ text: 'nothing', products: ['js-maps-sdk'], limit: 1, offset: 0 }]);
      });

      it('offers the nearest product outside a scope that was chosen for the caller', async () => {
        scriptIndex(0);
        findNothing();
        // The test registry routes "widgets" to widgets-sdk, which was not searched.
        const outcome = await call(TOOLS.search, {
          query: 'widgets testing',
          kind: 'guide',
          version: '4.x',
        });
        expect(nextOf(outcome.text)).toBe(
          'Next: arcgis_docs_search({"query":"widgets testing","product":"widgets-sdk","kind":"guide"})',
        );
        restore();
      });

      // Two products must not point at each other: a named product ends at its profile.
      it('offers the profile of a product the caller named, never another product', async () => {
        const seen = scriptIndex(0);
        suite.harness.services.search.search = async (req) => ({
          query: req.query,
          scope: { products: ['js-maps-sdk'], sources: ['references'], line: 'latest' },
          mode: 'local',
          total: 0,
          hits: [],
          notes: [],
        });
        const outcome = await call(TOOLS.search, {
          query: 'widgets testing',
          product: 'javascript/references',
          kind: 'guide',
        });
        expect(nextOf(outcome.text)).toBe(
          'Next: arcgis_docs_list_products({"product":"js-maps-sdk"})',
        );
        // Other content types are looked for where the search looked: in the scoped source.
        expect(seen).toMatchObject([{ products: ['js-maps-sdk'], sources: ['references'] }]);
        restore();
      });

      it('offers a short ranked product list when no product was searched at all', async () => {
        suite.harness.services.search.search = async (req) => ({
          query: req.query,
          // What the search service reports when no product matched: no line either.
          scope: { products: [], line: '', resolvedFrom: 'none' },
          mode: 'local',
          total: 0,
          hits: [],
          notes: [],
        });
        const outcome = await call(TOOLS.search, { query: 'zzz yyy', kind: 'api' });
        // Regression: the status line read "products: none, resolved from "none" | line:  |".
        expect(outcome.text.split('\n')[0]).toBe(
          'Search "zzz yyy" | products: none | mode: local index (site search off) | 0 hits',
        );
        expect(nextOf(outcome.text)).toBe(
          'Next: arcgis_docs_list_products({"query":"zzz yyy","limit":8})',
        );
        restore();
      });
    });
  });

  describe(TOOLS.findSamples, () => {
    it('returns hits with files, APIs and flags', async () => {
      const outcome = await call(TOOLS.findSamples, {
        query: 'cluster',
        uses_api: 'FeatureReductionCluster',
        platform: 'web',
      });
      const data = structuredOf(TOOLS.findSamples, outcome);
      expect(data).toMatchObject({
        scope: { product: 'js-maps-sdk', line: 'latest', platform: 'web', pinnedTo: 'v5.1.0' },
        total: 1,
        results: [
          {
            rank: 1,
            title: 'Cluster points',
            language: 'typescript',
            category: 'Visualization',
            origin: 'github',
            license: 'apache-2.0',
            apiConfirmed: false,
            legacyPattern: true,
            files: [{ name: 'main.ts', bytes: 512 }, { name: 'README.md' }],
          },
        ],
      });
      expect(data).not.toHaveProperty('code');
      expect(outcome.text.split('\n').slice(0, 2)).toEqual([
        'Samples for "cluster" | product: js-maps-sdk | line: latest | platform: web | pinned to v5.1.0 | uses: FeatureReductionCluster | 1 of 1',
        'Note: API use of FeatureReductionCluster was not confirmed for every hit.',
      ]);
      expect(outcome.text).toContain('   Note: API use not confirmed; uses a legacy pattern');
      expect(outcome.text).toMatch(
        /\nNext: arcgis_docs_read\(\{"ref":"[^"]+","section":"source"\}\)\nSource: Esri documentation/,
      );
    });

    it('returns the main source file in a fence that survives backticks, with its own notice', async () => {
      const outcome = await call(TOOLS.findSamples, { query: 'cluster', with_code: true });
      const data = structuredOf(TOOLS.findSamples, outcome);
      expect(data.code).toMatchObject({ file: 'main.ts', language: 'ts', truncated: false });
      expect(outcome.text).toContain(
        '````ts\nconst fence = "```";\nexport const layer = 1;\n````\n\nNext: arcgis_docs_read({"ref":"https://developers.arcgis.com/javascript/latest/sample-code/cluster/"})\nCopyright Esri. Licensed under the Apache License, Version 2.0. Source: https://github.com/Esri/jsapi-resources/blob/v5.1.0/samples/cluster/main.ts',
      );
    });

    it('points at the rest of a file that did not fit', async () => {
      const outcome = await call(TOOLS.findSamples, {
        query: 'cluster',
        with_code: true,
        max_tokens: 500,
      });
      expect(outcome.text).toContain('main.ts), truncated to fit max_tokens\n');
      expect(outcome.text).toContain('main.ts","view":"full"})');
    });

    it('suggests a search when no sample matches and tolerates sparse records', async () => {
      const none = await call(TOOLS.findSamples, { query: 'nothing', product: 'javascript' });
      expect(structuredOf(TOOLS.findSamples, none).results).toEqual([]);
      expect(none.text).toContain(
        'Next: arcgis_docs_search({"query":"nothing","product":"javascript"})',
      );
      expect(none.text).not.toContain('Source:');

      const find = suite.harness.services.samples.find.bind(suite.harness.services.samples);
      suite.harness.services.samples.find = async (req, options) => {
        const response = await find(req, options);
        return {
          ...response,
          hits: response.hits.map(({ record, summary, origin }) => {
            const { language: _l, platform: _p, breadcrumb: _b, ...bare } = record;
            return { record: bare, summary, origin, relevantApis: [], apiConfirmed: true };
          }),
        };
      };
      const sparse = await call(TOOLS.findSamples, { query: 'cluster' });
      structuredOf(TOOLS.findSamples, sparse);
      // A sample without a stated language is in the language of its product (regression:
      // every site sample of the Swift SDK was listed as "unknown").
      expect(sparse.text).toContain(
        '1. Cluster points [js-maps-sdk, typescript, github, apache-2.0]',
      );
      expect(sparse.text).not.toContain('APIs:');
      expect(sparse.text).not.toContain('Note: API use');
      suite.harness.services.samples.find = find;
    });
  });

  it('renders every catalogued failure of a structured tool as text, never as structuredContent', async () => {
    suite.harness.services.search.search = async () => {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', 'The index could not be built', {
        host: 'developers.arcgis.com',
        retryable: true,
      });
    };
    const outcome = await call(TOOLS.search, { query: 'anything' });
    expect(outcome).toMatchObject({ isError: true, structured: undefined });
    expect(outcome.text).toBe(
      'Error [UPSTREAM_UNAVAILABLE]: The index could not be built. Next: developers.arcgis.com is temporarily unavailable; retry the same call once.',
    );
    suite.harness.services.search = makeFakeServices(suite.harness.ctx).search;
  });
});
