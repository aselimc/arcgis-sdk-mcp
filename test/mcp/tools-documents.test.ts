import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../src/core/budget.js';
import { TOOLS } from '../../src/core/names.js';
import { REFS } from './support/catalogue.js';
import { useToolSuite } from './support/tool-suite.js';

describe('document tools', () => {
  const suite = useToolSuite();
  const { call } = suite;

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

    // Regression: a brief, which ships with the package, was labelled "fetched now".
    it('labels a brief as bundled, not as fetched or cached', async () => {
      const read = suite.harness.services.docs.read.bind(suite.harness.services.docs);
      suite.harness.services.docs.read = async (req, options) => {
        const response = await read(req, options);
        const { product: _product, ...page } = response.page;
        return { ...response, page: { ...page, kind: 'brief', cache: 'miss' } };
      };
      const outcome = await call(TOOLS.read, { ref: 'brief:ai/overview' });
      expect(outcome.text.split('\n')[0]).toBe('Get started | brief | bundled');
      suite.harness.services.docs.read = read;
    });

    it('keeps the envelope small next to a default-budget body', async () => {
      const outcome = await call(TOOLS.read, { ref: REFS.page });
      const body = (
        await suite.harness.services.docs.read(
          { ref: REFS.page, view: 'auto', maxTokens: 6000 },
          { budget: { maxRequests: 1, used: 0, deadline: 0 } },
        )
      ).text;
      expect(estimateTokens(outcome.text) - estimateTokens(body)).toBeLessThan(150);
      expect(estimateTokens(outcome.text)).toBeLessThan(6000);
    });

    it('gives the service max_tokens minus the room the envelope needs', async () => {
      const read = suite.harness.services.docs.read.bind(suite.harness.services.docs);
      const seen: number[] = [];
      suite.harness.services.docs.read = async (req, options) => {
        seen.push(req.maxTokens);
        return read(req, options);
      };
      await call(TOOLS.read, { ref: REFS.page, max_tokens: 2000 });
      expect(seen).toEqual([1800]);
    });

    // Regression: a continuation repeated the budget of the text (max_tokens less the
    // envelope), so each page of a paged read was 200 tokens smaller than the one before;
    // and ARCGIS_DOCS_MAX_TOKENS was read into the configuration but never applied.
    it('tells the service which max_tokens the caller passed, and uses the configured default otherwise', async () => {
      const read = suite.harness.services.docs.read.bind(suite.harness.services.docs);
      const seen: Array<[number, number | undefined]> = [];
      suite.harness.services.docs.read = async (req, options) => {
        seen.push([req.maxTokens, req.callerMaxTokens]);
        return read(req, options);
      };
      const configured = suite.harness.ctx.config.defaultMaxTokens;
      await call(TOOLS.read, { ref: REFS.page, max_tokens: 2000 });
      await call(TOOLS.read, { ref: REFS.page });
      suite.harness.ctx.config.defaultMaxTokens = 3000;
      await call(TOOLS.read, { ref: REFS.page });
      suite.harness.ctx.config.defaultMaxTokens = configured;
      expect(seen).toEqual([
        [1800, 2000],
        [configured - 200, undefined],
        [2800, undefined],
      ]);
    });

    it('falls back to a line label that names a version, the bare product id or no version at all', async () => {
      const read = suite.harness.services.docs.read.bind(suite.harness.services.docs);
      const withPage = (patch: Record<string, unknown>): void => {
        suite.harness.services.docs.read = async (req, options) => {
          const response = await read(req, options);
          return { ...response, page: { ...response.page, ...patch } };
        };
      };
      withPage({ product: 'widgets-sdk', line: 'missing' });
      // The label of an unversioned line ("Current") is not a version and is not printed.
      expect((await call(TOOLS.read, { ref: REFS.page })).text.split('\n')[0]).toBe(
        'Get started | Widgets SDK (widgets-sdk) | guide | fetched now',
      );
      const line = suite.harness.ctx.registry.get('widgets-sdk')?.lines[0];
      if (line === undefined) throw new Error('widgets-sdk has no line');
      const label = line.label;
      line.label = '2.x';
      expect((await call(TOOLS.read, { ref: REFS.page })).text.split('\n')[0]).toBe(
        'Get started | Widgets SDK (widgets-sdk) | version 2.x | guide | fetched now',
      );
      line.label = label;
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
      suite.harness.services.docs.read = read;
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
      expect(suite.harness.ctx.logger.messages('error')).toContain('internal error in tool call');
    });

    it('gives each call a fresh request budget and the abort signal', async () => {
      const seen: Array<{ used: number; max: number; signal: boolean }> = [];
      const read = suite.harness.services.docs.read.bind(suite.harness.services.docs);
      suite.harness.services.docs.read = async (req, options) => {
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
      suite.harness.services.docs.read = read;
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
      const lookup = suite.harness.services.symbols.lookup.bind(suite.harness.services.symbols);
      suite.harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        const { symbol: _s, qualified: _q, symbolKind: _k, ...record } = response.record;
        const { next: _next, ...rest } = response;
        return { ...rest, record, alternates: [] };
      };
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      expect(outcome.text.split('\n')[0]).toMatch(/^FeatureLayer \| Maps SDK/);
      expect(outcome.text).not.toContain('Other matches');
      expect(outcome.text).not.toContain('Next:');
      suite.harness.services.symbols.lookup = lookup;
    });

    // A second declaration of the answer's own name cannot be asked for by name again.
    it('lists another declaration of the same name as the ref to read', async () => {
      const lookup = suite.harness.services.symbols.lookup.bind(suite.harness.services.symbols);
      suite.harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        const other = { ...response.record, ref: 'https://developers.arcgis.com/widgets/other/' };
        return { ...response, alternates: [other, ...response.alternates] };
      };
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      expect(outcome.text).toContain(
        'Other matches:\n- another layers.FeatureLayer (class): arcgis_docs_read({"ref":"https://developers.arcgis.com/widgets/other/"})\n- {"symbol":"FeatureLayerView","product":"js-maps-sdk"} (class): https://',
      );
      suite.harness.services.symbols.lookup = lookup;
    });

    // Regression: every component lookup listed the answer again, as the record another
    // source of the product holds for the same page under its qualified name.
    it('does not list the answer itself under another name', async () => {
      const lookup = suite.harness.services.symbols.lookup.bind(suite.harness.services.symbols);
      suite.harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        const page = 'https://developers.arcgis.com/javascript/latest/references/arcgis-map';
        const twin = { ...response.record, source: 'typings', qualified: '@arcgis/x/arcgis-map' };
        return {
          ...response,
          record: { ...response.record, ref: `${page}/#openPopup` },
          alternates: [
            { ...twin, ref: `${page}#openpopup` },
            { ...twin, ref: `${page}/#goTo`, qualified: '@arcgis/x/arcgis-map.goTo' },
          ],
        };
      };
      const outcome = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      expect(outcome.text).toContain(
        'Other matches:\n- {"symbol":"@arcgis/x/arcgis-map.goTo","product":"js-maps-sdk"} (class): https://',
      );
      expect(outcome.text.match(/^- /gm)).toHaveLength(1);

      suite.harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        return { ...response, alternates: [{ ...response.record, qualified: 'other.Name' }] };
      };
      expect((await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' })).text).not.toContain(
        'Other matches',
      );
      suite.harness.services.symbols.lookup = lookup;
    });

    // Regression: after a lookup in 200.x the listed candidates led to 300.x, and after a
    // lookup scoped to one REST service they led to a namesake in another.
    it('repeats the version and the source scope of the request in the other matches', async () => {
      const versioned = await call(TOOLS.lookupSymbol, {
        symbol: 'FeatureLayer',
        product: 'js-maps-sdk',
        version: '4.x',
      });
      expect(versioned.text).toContain(
        '- {"symbol":"FeatureLayerView","product":"js-maps-sdk","version":"4.x"} (class): https://',
      );
      const scoped = await call(TOOLS.lookupSymbol, {
        symbol: 'FeatureLayer',
        product: 'js-maps-sdk/references',
      });
      expect(scoped.text.split('\n')[0]).toContain('resolved from "js-maps-sdk/references"');
      expect(scoped.text).toContain(
        '- {"symbol":"FeatureLayerView","product":"js-maps-sdk/guide"} (class): https://',
      );
    });

    it('says that the product was detected in the project when no product was named', async () => {
      const lookup = suite.harness.services.symbols.lookup.bind(suite.harness.services.symbols);
      suite.harness.services.symbols.lookup = async (req, options) => {
        const response = await lookup(req, options);
        return {
          ...response,
          resolvedProduct: { ...response.resolvedProduct, resolvedFrom: 'project' },
        };
      };
      const detected = await call(TOOLS.lookupSymbol, { symbol: 'FeatureLayer' });
      expect(detected.text.split('\n')[0]).toContain(
        '(js-maps-sdk), detected in the project | version',
      );
      // A product the caller happened to name "project" is echoed like any other.
      const named = await call(TOOLS.lookupSymbol, {
        symbol: 'FeatureLayer',
        product: 'javascript',
      });
      expect(named.text.split('\n')[0]).toContain('(js-maps-sdk), resolved from "project" |');
      suite.harness.services.symbols.lookup = lookup;
    });

    it('rejects a name that has no letter or digit before any lookup', async () => {
      for (const symbol of ['.', ' ', '->']) {
        const outcome = await call(TOOLS.lookupSymbol, { symbol });
        expect(outcome.isError, symbol).toBe(true);
        expect(outcome.text, symbol).toMatch(
          /Invalid arguments for tool arcgis_docs_lookup_symbol/,
        );
        expect(outcome.text, symbol).toMatch(/symbol/);
      }
      expect((await call(TOOLS.lookupSymbol, { symbol: '.' })).text).toContain(
        'Expected the name of a symbol',
      );
      expect((await call(TOOLS.lookupSymbol, { symbol: '$x' })).isError).toBe(false);
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
});
