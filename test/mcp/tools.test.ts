import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimateTokens } from '../../src/core/budget.js';
import { McpDocError } from '../../src/core/errors.js';
import { TOOLS, type ToolName } from '../../src/core/names.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/tool-definitions.js';
import { LEGACY_PRODUCT, REFS } from './support/fake-services.js';
import {
  type Connection,
  connectLegacy,
  firstText,
  type Harness,
  makeHarness,
} from './support/harness.js';

interface Outcome {
  text: string;
  structured: Record<string, unknown> | undefined;
  meta: Record<string, unknown> | undefined;
  isError: boolean;
}

/** Every string stored under a key named `ref`, anywhere in a structured result. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'ref' && typeof entry === 'string' ? [entry] : refsIn(entry),
  );
}

describe('tool handlers', () => {
  let harness: Harness;
  let connection: Connection;

  const call = async (name: ToolName, args: Record<string, unknown> = {}): Promise<Outcome> => {
    const result = await connection.client.callTool({ name, arguments: args });
    return {
      text: firstText(result),
      structured: result.structuredContent,
      meta: result._meta,
      isError: result.isError === true,
    };
  };

  /** Asserts the invariants of a structured result and returns it parsed. */
  const structuredOf = (name: ToolName, outcome: Outcome): Record<string, unknown> => {
    const schema = TOOL_DEFINITIONS.find((definition) => definition.name === name)?.outputSchema;
    expect(outcome.isError).toBe(false);
    // Parsing strips unknown keys: equality proves the result has exactly the declared shape.
    expect(schema?.parse(outcome.structured)).toEqual(outcome.structured);
    const refs = refsIn(outcome.structured);
    for (const ref of refs) expect(outcome.text, `ref ${ref} in text`).toContain(ref);
    return outcome.structured ?? {};
  };

  beforeAll(async () => {
    harness = makeHarness();
    connection = await connectLegacy(harness);
  });
  afterAll(() => connection.close());

  describe(TOOLS.listProducts, () => {
    it('lists developer products grouped by category, without retired ones', async () => {
      const outcome = await call(TOOLS.listProducts);
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(data).toMatchObject({ mode: 'list', total: 2, notes: [] });
      expect(outcome.text).toMatch(
        /^ArcGIS products \| category: developer categories \| 2 of 2\n/,
      );
      expect(outcome.text).toContain('## web\n- js-maps-sdk: Maps SDK for JavaScript (test), 5.x.');
      expect(outcome.text).not.toContain(LEGACY_PRODUCT.id);
      expect(outcome.text).toContain(
        '\nNext: arcgis_docs_list_products({"product":"js-maps-sdk"})',
      );
      expect(outcome.text).not.toContain('Source:');
    });

    it('shows retired products with status and successor on request, and pages with a cursor', async () => {
      const outcome = await call(TOOLS.listProducts, {
        include_legacy: true,
        category: 'all',
        limit: 2,
      });
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(data.nextCursor).toEqual(expect.any(String));
      expect(outcome.text).toContain(
        `Next: arcgis_docs_list_products({"category":"all","include_legacy":true,"cursor":"${String(data.nextCursor)}"})`,
      );
      const rest = await call(TOOLS.listProducts, {
        include_legacy: true,
        category: 'native',
      });
      expect(rest.text).toContain(
        '## native\n- old-viewer: Old Viewer (test), Current, retired. Invented retired product. Successor: widgets-sdk.',
      );
    });

    it('explains an empty list and ignores a section given without a product', async () => {
      const outcome = await call(TOOLS.listProducts, { query: 'zzz', section: 'guide' });
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(data).toMatchObject({ mode: 'list', products: [], total: 0 });
      expect(outcome.text).toContain('filter: "zzz" | 0 of 0');
      expect(outcome.text).toContain('Note: `section` needs `product`; it was ignored.');
      expect(outcome.text).toContain('Note: No product matched.');
      expect(outcome.text).not.toContain('Next:');
    });

    it('returns a profile and echoes how the product was resolved', async () => {
      const outcome = await call(TOOLS.listProducts, { product: '@arcgis/core' });
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(data.mode).toBe('profile');
      expect(outcome.text.split('\n')[0]).toBe(
        'Maps SDK for JavaScript (test) (js-maps-sdk), resolved from "@arcgis/core" | web | status: active',
      );
      expect(data.product).toMatchObject({
        id: 'js-maps-sdk',
        capabilities: { symbols: true, samples: true, releaseNotes: true, search: 'local' },
        sources: [
          { id: 'guide', pages: 118, enabled: true, health: 'ok' },
          { id: 'references', enabled: true, health: 'degraded' },
          { id: 'samples', enabled: false, health: 'unknown' },
          { id: 'typings', enabled: true, health: 'unknown' },
          { id: 'briefs', ref: 'brief:js/4x-to-5x', enabled: true },
        ],
      });
      expect(outcome.text).toContain('samples: Samples [sample], disabled by the source policy.');
      expect(outcome.text).toContain(
        'Next: arcgis_docs_list_products({"product":"js-maps-sdk","section":"guide"})',
      );
    });

    it('does not echo a resolution for an exact id and carries the status note', async () => {
      const outcome = await call(TOOLS.listProducts, { product: 'old-viewer' });
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(outcome.text.split('\n').slice(0, 2)).toEqual([
        'Old Viewer (test) (old-viewer) | native | status: retired',
        'Note: Retired in 2024; use widgets-sdk.',
      ]);
      expect(data.notes).toEqual(['Retired in 2024; use widgets-sdk.']);
      expect(outcome.text).toContain('- Successor: widgets-sdk');
    });

    it('returns a table of contents for a section, also in scope form', async () => {
      const outcome = await call(TOOLS.listProducts, { product: 'js-maps-sdk', section: 'guide' });
      const data = structuredOf(TOOLS.listProducts, outcome);
      expect(data).toMatchObject({
        mode: 'toc',
        total: 3,
        toc: [
          { title: 'Layers', depth: 0, kind: 'guide' },
          { title: 'Feature layers', depth: 1 },
        ],
      });
      expect(outcome.text).toContain('\n- Layers: https://');
      expect(outcome.text).toContain('\n  - Feature layers: https://');
      expect(outcome.text).toContain(`"section":"guide","cursor":"${String(data.nextCursor)}"`);

      const scoped = await call(TOOLS.listProducts, {
        product: 'js-maps-sdk/references',
        cursor: String(data.nextCursor),
      });
      expect(structuredOf(TOOLS.listProducts, scoped).mode).toBe('toc');
      expect(scoped.text).toContain('| section: references | 1 of 3 entries');
      expect(scoped.text).toContain('Next: arcgis_docs_read({"ref":"https://');
    });

    it('renders an unknown product as an error with the nearest ids', async () => {
      const outcome = await call(TOOLS.listProducts, { product: 'js-maps-sdx' });
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(
        /^Error \[UNKNOWN_PRODUCT\]: .+ Next: .+\.\nNearest product ids: js-maps-sdk/,
      );
      expect(outcome.structured).toBeUndefined();
    });
  });

  describe(TOOLS.getVersions, () => {
    it('reports documented and installable versions separately, with every source', async () => {
      const outcome = await call(TOOLS.getVersions, { product: 'javascript', version: '5.1' });
      const data = structuredOf(TOOLS.getVersions, outcome);
      expect(data.products).toMatchObject([
        {
          id: 'js-maps-sdk',
          documented: { version: '5.1', released: '2026-06-24' },
          installable: [
            { registry: 'npm', package: '@arcgis/core', version: '5.1.2', tag: 'latest' },
            { registry: 'unknown', package: 'js-maps-sdk', version: '4.34.8' },
          ],
          project: { version: '4.31.0', file: 'package.json', behind: 'current is 5.1.2' },
          prerelease: [
            { tag: 'next', version: '5.2.0-next.3' },
            { tag: 'prerelease', version: '5.2.0-rc.1' },
          ],
          lines: [
            { id: 'latest', access: 'live', symbols: 'live' },
            { id: '4.x', access: 'link-only', symbols: 'npm-any-version' },
          ],
          install: ['npm install @arcgis/core'],
          lifecycle: { ga: '2026-06-24', retirement: '2028-06-24' },
        },
      ]);
      expect(outcome.text.split('\n')[0]).toBe(
        'Versions as of 2026-10-13 | checked version: 5.1 | js-maps-sdk',
      );
      expect(outcome.text).toContain('In this project: 4.31.0 (package.json); current is 5.1.2');
      expect(outcome.text).toContain('- ArcGIS Enterprise: 12.0 (unreleased)');
      expect(outcome.text).toContain(
        'Mismatches:\n- Documentation describes 5.1; npm latest is 5.1.2.',
      );
      expect(outcome.text).toMatch(
        /\nNext: arcgis_docs_read\(\{"ref":".+release-notes\/"\}\)\nSource: Esri documentation/,
      );
    });

    it('reports a product without facts as unknown rather than failing', async () => {
      const outcome = await call(TOOLS.getVersions, { product: 'widgets-sdk' });
      const data = structuredOf(TOOLS.getVersions, outcome);
      expect(data.notes).toEqual(['No version oracle answered.']);
      expect(outcome.text).toContain('Documentation describes: unknown');
      expect(outcome.text).toContain('(live; symbols: none)');
      expect(outcome.text).not.toContain('Next:');
    });

    it('says so when no SDK is detected in the project', async () => {
      const outcome = await call(TOOLS.getVersions);
      const data = structuredOf(TOOLS.getVersions, outcome);
      expect(data.products).toEqual([]);
      expect(outcome.text).toContain('| no product\nNote: No Esri SDK was detected');
      expect(outcome.text).toContain('Next: arcgis_docs_list_products({})');
      expect(outcome.text).not.toContain('Source:');
    });
  });

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
        'Search "query features" | products: js-maps-sdk (sources: references), resolved from "workspace" | line: latest | kind: api | mode: local index + Esri site search | hits 1-2 of 2',
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
      harness.services.search.search = async (req) => ({
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
      harness.services.search = makeHarness().services.search;
    });

    it('treats zero hits as a normal result that says where else to look', async () => {
      const outcome = await call(TOOLS.search, { query: 'nothing' });
      const data = structuredOf(TOOLS.search, outcome);
      expect(data).toMatchObject({ total: 0, results: [], mode: 'local' });
      expect(outcome.text).toContain('| 0 hits\nNote: No hits; absence here is not proof');
      expect(outcome.text).toContain('Next: arcgis_docs_list_products({"query":"nothing"})');
      expect(outcome.text).not.toContain('Source:');
    });
  });

  describe(TOOLS.read, () => {
    it('wraps the body in the envelope and reports the facts in _meta', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.page });
      const lines = outcome.text.split('\n');
      expect(lines[0]).toBe(
        'Get started | Maps SDK for JavaScript (test) (js-maps-sdk) | version 5.1 | guide | fetched now',
      );
      expect(lines.at(-2)).toBe(
        `Next: arcgis_docs_read({"ref":"${REFS.page}","section":"install"})`,
      );
      expect(lines.at(-1)).toMatch(
        /^Source: Esri, https:.+ \(retrieved 2026-10-13\)\. Copyright \(c\) Esri\./,
      );
      expect(outcome.structured).toBeUndefined();
      expect(outcome.meta).toEqual({
        'arcgis-docs/ref': REFS.page,
        'arcgis-docs/product': 'js-maps-sdk',
        'arcgis-docs/kind': 'guide',
        'arcgis-docs/version': '5.1',
        'arcgis-docs/truncated': false,
      });
    });

    it('ends a truncated response with the call that continues it', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.long, view: 'full', section: 'options' });
      const cursor = String(outcome.meta?.['arcgis-docs/nextCursor']);
      expect(outcome.meta?.['arcgis-docs/truncated']).toBe(true);
      expect(outcome.text).toContain(
        `\nNext: arcgis_docs_read({"ref":"${REFS.long}","section":"options","view":"full","cursor":"${cursor}"})\nSource:`,
      );
      const auto = await call(TOOLS.read, { ref: REFS.long });
      expect(auto.text).toContain(
        `Next: arcgis_docs_read({"ref":"${REFS.long}","cursor":"${cursor}"})`,
      );
    });

    it('makes a lower rung, a stale copy and a redirect visible', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.degraded });
      expect(outcome.text.split('\n').slice(0, 3)).toEqual([
        'Get started | Maps SDK for JavaScript (test) (js-maps-sdk) | version 5.1 | guide | stale cached copy | degraded: stale, upstream timeout',
        'Note: Served from a stale copy.',
        'Note: Redirected from https://developers.arcgis.com/javascript/latest/old-name/',
      ]);
    });

    it('keeps the envelope small next to a default-budget body', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.page });
      const body = (
        await harness.services.docs.read(
          { ref: REFS.page, view: 'auto', maxTokens: 6000 },
          { budget: { maxRequests: 1, used: 0, deadline: 0 } },
        )
      ).text;
      expect(estimateTokens(outcome.text) - estimateTokens(body)).toBeLessThan(150);
      expect(estimateTokens(outcome.text)).toBeLessThan(6000);
    });

    it('falls back to the line label, the bare product id or no version at all', async () => {
      const read = harness.services.docs.read.bind(harness.services.docs);
      const withPage = (patch: Record<string, unknown>): void => {
        harness.services.docs.read = async (req, options) => {
          const response = await read(req, options);
          return { ...response, page: { ...response.page, ...patch } };
        };
      };
      withPage({ product: 'widgets-sdk', line: 'missing' });
      expect((await call(TOOLS.read, { ref: REFS.page })).text.split('\n')[0]).toBe(
        'Get started | Widgets SDK (widgets-sdk) | version Current | guide | fetched now',
      );
      withPage({ product: 'not-in-registry' });
      const unknown = await call(TOOLS.read, { ref: REFS.page });
      expect(unknown.text.split('\n')[0]).toBe(
        'Get started | not-in-registry | guide | fetched now',
      );
      expect(unknown.meta).not.toHaveProperty('arcgis-docs/version');
      withPage({ product: undefined, cache: 'revalidated' });
      expect((await call(TOOLS.read, { ref: REFS.page })).text.split('\n')[0]).toBe(
        'Get started | guide | cached, revalidated',
      );
      harness.services.docs.read = read;
    });

    it('renders a missing page as DOC_NOT_FOUND with a search to try', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.missing });
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toBe(
        'Error [DOC_NOT_FOUND]: The page does not exist. The host answered 404. Next: arcgis_docs_search({"query":"Gone page"}).',
      );
    });

    it('renders an unexpected failure as INTERNAL without leaking it', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.crash });
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(
        /^Error \[INTERNAL\]: Internal error \(ref [0-9a-f]+\)\. Next: /,
      );
      expect(outcome.text).not.toContain('kaboom');
      expect(harness.ctx.logger.messages('error')).toContain('internal error in tool call');
    });

    it('gives each call a fresh request budget and the abort signal', async () => {
      const seen: Array<{ used: number; max: number; signal: boolean }> = [];
      const read = harness.services.docs.read.bind(harness.services.docs);
      harness.services.docs.read = async (req, options) => {
        seen.push({
          used: options.budget.used,
          max: options.budget.maxRequests,
          signal: options.signal instanceof AbortSignal,
        });
        options.budget.used += 5;
        return read(req, options);
      };
      await call(TOOLS.read, { ref: REFS.page });
      await call(TOOLS.read, { ref: REFS.page });
      expect(seen).toEqual([
        { used: 0, max: 12, signal: true },
        { used: 0, max: 12, signal: true },
      ]);
      harness.services.docs.read = read;
    });
  });

  describe(TOOLS.lookupSymbol, () => {
    it('states the symbol, the resolved product and the exact version', async () => {
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      const lines = outcome.text.split('\n');
      expect(lines[0]).toBe(
        'layers.FeatureLayer (class) | Maps SDK for JavaScript (test) (js-maps-sdk), resolved from "javascript" | version 5.1.2 | api | fetched now',
      );
      expect(outcome.text).toContain('```ts\nclass FeatureLayer extends Layer\n```');
      expect(outcome.text).toContain(
        'Other matches:\n- {"symbol":"FeatureLayerView","product":"js-maps-sdk"} (class): https://',
      );
      expect(lines.at(-2)).toBe(
        'Next: arcgis_docs_lookup_symbol({"symbol":"FeatureLayer.queryFeatures","product":"js-maps-sdk"})',
      );
      expect(lines.at(-1)).toMatch(/^Source: Esri, /);
      expect(outcome.structured).toBeUndefined();
    });

    it('does not echo a resolution when the product was given by id', async () => {
      const outcome = await call(TOOLS.lookupSymbol, {
        symbol: 'FeatureLayer',
        product: 'js-maps-sdk',
      });
      expect(outcome.text.split('\n')[0]).toContain(
        '| Maps SDK for JavaScript (test) (js-maps-sdk) | version',
      );
    });

    it('falls back to the title of a record without symbol fields and omits empty parts', async () => {
      const lookup = harness.services.symbols.lookup.bind(harness.services.symbols);
      harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        const { symbol: _s, qualified: _q, symbolKind: _k, ...record } = response.record;
        const { next: _next, ...rest } = response;
        return { ...rest, record, alternates: [] };
      };
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      expect(outcome.text.split('\n')[0]).toMatch(/^FeatureLayer \| Maps SDK/);
      expect(outcome.text).not.toContain('Other matches');
      expect(outcome.text).not.toContain('Next:');
      harness.services.symbols.lookup = lookup;
    });

    it('lists the candidates of an ambiguous name as complete calls', async () => {
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'Graphic' });
      expect(outcome.isError).toBe(true);
      expect(outcome.text.split('\n')).toEqual([
        'Error [AMBIGUOUS_SYMBOL]: Several symbols are named "Graphic". Next: Repeat the lookup with one of the candidates below.',
        'Candidates:',
        '- arcgis_docs_lookup_symbol({"symbol":"Graphic","product":"js-maps-sdk"})',
        '- arcgis_docs_lookup_symbol({"symbol":"Graphic","product":"widgets-sdk"})',
      ]);
    });

    it('says that a missing symbol is unverified, not absent', async () => {
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'Nope' });
      expect(outcome.text).toBe(
        [
          'Error [SYMBOL_NOT_FOUND]: No symbol named "Nope" was found. Not verified; this does not prove it does not exist. Next: arcgis_docs_search({"query":"Nope","kind":"api"}).',
          'Nearest names (not verified; this does not prove the symbol does not exist): Node, Note',
        ].join('\n'),
      );
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

      const find = harness.services.samples.find.bind(harness.services.samples);
      harness.services.samples.find = async (req, options) => {
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
      expect(sparse.text).toContain('1. Cluster points [js-maps-sdk, unknown, github, apache-2.0]');
      expect(sparse.text).not.toContain('APIs:');
      expect(sparse.text).not.toContain('Note: API use');
      harness.services.samples.find = find;
    });
  });

  it('renders every catalogued failure of a structured tool as text, never as structuredContent', async () => {
    harness.services.search.search = async () => {
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
    harness.services.search = makeHarness().services.search;
  });
});
