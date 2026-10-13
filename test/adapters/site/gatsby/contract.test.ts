import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import { describeSiteAdapterContract } from '../contract.js';
import { D, guide, replaceResponse, rest } from './sites.js';

/** Every site-published index file of a Gatsby site: page-data, static queries, hashed files. */
const INDEX_FILES = [/\/page-data\//, /\/static\/[0-9a-f]{32}\./];

const GUIDE_STORE = `${D}/widgets/static/0f1e2d3c4b5a69788796a5b4c3d2e1f0.store.json`;

describeSiteAdapterContract('gatsby guide (pointers inline in page-data)', () => {
  const site = guide();
  return {
    adapter: gatsbyAdapter,
    product: site.product,
    source: site.source,
    ctx: () => site.ctx(),
    allowedHosts: ['developers.arcgis.com'],
    minRecords: 8,
    readRef: `${D}/widgets/get-started/`,
    siteIndexFiles: INDEX_FILES,
    failures: {
      // The store answers, but its records have lost `url`: titles come from the nav tree.
      renamedField: {
        arrange: (ctx) =>
          replaceResponse(ctx, 'guide', GUIDE_STORE, {
            json: [{ id: 'a1', title: 'Get started', path: '/get-started/' }],
          }),
        outcome: 'degraded',
        minRecords: 8,
      },
      // Without the sitemap the nav tree and the store still list the pages.
      missingFile: {
        arrange: (ctx) => ctx.http.fail(/sitemap-0\.xml$/, 404),
        outcome: 'degraded',
        minRecords: 7,
      },
      emptyIndex: {
        arrange: (ctx) => ctx.http.fail(GUIDE_STORE, 'empty'),
        outcome: 'degraded',
        minRecords: 8,
      },
      // A catch-all page instead of page-data leaves the sitemap rung.
      htmlInsteadOfJson: {
        arrange: (ctx) => ctx.http.fail(/\/page-data\//, 'html'),
        outcome: 'degraded',
        minRecords: 8,
      },
    },
  };
});

describeSiteAdapterContract('gatsby REST reference (pointers in static queries)', () => {
  const site = rest();
  const render = new FakeRenderer();
  render.family = 'gatsby-rest';
  return {
    adapter: gatsbyAdapter,
    product: site.product,
    source: site.source,
    ctx: () => site.ctx({ render }),
    allowedHosts: ['developers.arcgis.com'],
    minRecords: 6,
    readRef: `${D}/rest/gadgets/apply-changes-gadget-service/`,
    siteIndexFiles: INDEX_FILES,
    failures: {
      // The static query that held `nav` and `search` now holds neither.
      renamedField: {
        arrange: (ctx) =>
          replaceResponse(ctx, 'rest', `${D}/rest/gadgets/page-data/sq/d/3000000003.json`, {
            json: { data: { navigation: { tree: [] }, lookup: { store: null } } },
          }),
        outcome: 'degraded',
        minRecords: 6,
      },
      // Neither the sitemap nor any index file: the source cannot be listed.
      missingFile: {
        arrange: (ctx) => ctx.http.fail(/sitemap-0\.xml$|\/page-data\//, 404),
        outcome: 'typed-failure',
        codes: ['DOC_NOT_FOUND'],
      },
      emptyIndex: {
        arrange: (ctx) => ctx.http.fail(/sitemap-0\.xml$|\/page-data\//, 'empty'),
        outcome: 'typed-failure',
      },
      htmlInsteadOfJson: {
        arrange: (ctx) => ctx.http.fail(/\/page-data\/sq\//, 'html'),
        outcome: 'degraded',
        minRecords: 6,
      },
    },
  };
});
