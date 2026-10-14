import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/core/names.js';
import { LEGACY_PRODUCT } from './support/catalogue.js';
import { useToolSuite } from './support/tool-suite.js';

describe('catalogue tools', () => {
  const suite = useToolSuite();
  const { call, structuredOf } = suite;

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
        `Next: arcgis_docs_list_products({"category":"all","include_legacy":true,"limit":2,"cursor":"${String(data.nextCursor)}"})`,
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
        capabilities: { symbols: 'symbols', samples: true, releaseNotes: true, search: 'local' },
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
      // The nested page is headed by its ancestors instead of being indented.
      expect(outcome.text).toContain('\n\n**Layers**\n- Feature layers: https://');
      expect(outcome.text).toContain(`"section":"guide","cursor":"${String(data.nextCursor)}"`);

      const scoped = await call(TOOLS.listProducts, {
        product: 'js-maps-sdk/references',
        cursor: String(data.nextCursor),
      });
      expect(structuredOf(TOOLS.listProducts, scoped).mode).toBe('toc');
      expect(scoped.text).toContain('| section: references | 1 of 3 entries');
      expect(scoped.text).toContain('Next: arcgis_docs_read({"ref":"https://');
    });

    // Regression: a table of contents is enumerated from Esri's site like search hits are,
    // but ended without a Source line, as if it were registry data.
    it('attributes a table of contents, unlike the list and the profile', async () => {
      const toc = await call(TOOLS.listProducts, { product: 'js-maps-sdk', section: 'guide' });
      expect(toc.text.split('\n').at(-1)).toMatch(
        /^Source: Esri documentation at the refs above \(retrieved 2026-10-13\)\. Copyright \(c\) Esri/,
      );
      expect(toc.text.split('\n').at(-2)).toMatch(/^Next: arcgis_docs_list_products\(/);
      for (const args of [{}, { product: 'js-maps-sdk' }]) {
        expect((await call(TOOLS.listProducts, args)).text).not.toContain('Source:');
      }
    });

    it("does not attribute a table of contents of this project's own briefs or an empty one", async () => {
      const tocOf = suite.harness.services.catalog.toc.bind(suite.harness.services.catalog);
      suite.harness.services.catalog.toc = async (...args) => {
        const toc = await tocOf(...args);
        return { ...toc, entries: toc.entries.map((entry) => ({ ...entry, license: 'project' })) };
      };
      const briefs = await call(TOOLS.listProducts, { product: 'js-maps-sdk', section: 'briefs' });
      expect(briefs.text).not.toContain('Source:');
      suite.harness.services.catalog.toc = async () => ({ entries: [], total: 0 });
      const empty = await call(TOOLS.listProducts, { product: 'js-maps-sdk', section: 'guide' });
      expect(empty.text).toContain('Note: This source has no table of contents yet');
      expect(empty.text).not.toContain('Source:');
      suite.harness.services.catalog.toc = tocOf;
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

    // Regression: the real version service explains the empty report, and the tool said it
    // a second time.
    it('does not repeat what the version service already explained', async () => {
      const report = suite.harness.services.versions.report.bind(suite.harness.services.versions);
      suite.harness.services.versions.report = async (req, options) => ({
        ...(await report(req, options)),
        notes: [
          'No Esri SDK was detected in the current project. Pass "product" to report on one.',
        ],
      });
      const outcome = await call(TOOLS.getVersions);
      expect(outcome.text.match(/No Esri SDK was detected/g)).toHaveLength(1);
      suite.harness.services.versions.report = report;
    });
  });
});
