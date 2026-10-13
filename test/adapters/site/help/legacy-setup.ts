import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import type { FakeRenderer } from '../../../support/fake-render.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';

/**
 * The source, product and contexts shared by the `legacy-help` test files: an invented
 * product with two books, one of which names its table-of-contents script.
 */

export const HOST = 'https://doc.arcgis.com';
export const BASE = `${HOST}/en/widget-earth/latest/`;
export const API = `${BASE}automation/`;
export const START = `${BASE}get-started/`;
export const API_SCRIPT = `${HOST}/en/widget-earth/3.1/automation/4101.js`;
export const START_SCRIPT = `${HOST}/en/widget-earth/3.1/get-started/4102.js`;

export const help = makeSource(
  'legacy-help',
  {
    host: 'doc.arcgis.com',
    base: '/en/widget-earth/latest/',
    books: [
      { path: 'automation', tocScript: '/en/widget-earth/3.1/automation/4101.js' },
      { path: 'get-started' },
    ],
  },
  {
    id: 'help',
    title: 'Widget Earth help',
    kinds: ['help'],
    probe: { url: `${API}sitemap.xml`, expect: 'xml', minRecords: 1, family: 'legacy-help' },
  },
);
export const product = makeProduct({
  id: 'widget-earth',
  name: 'Widget Earth',
  category: 'product-help',
  tier: 'help',
  homepage: `${START}what-is-widget-earth.htm`,
  sources: [help],
});

export const cassette = () => loadCassette('cassettes', 'site', 'help', 'legacy.json');
export const ctxOf = (render?: FakeRenderer): TestCtx =>
  makeCtx({ cassette: cassette(), ...(render === undefined ? {} : { render }) });
export const bound = () => bindSource(product, help, makeLine());
export const withoutSiteIndex = (ctx: TestCtx): TestCtx => {
  ctx.policy = fakePolicy({
    enabled: [...ctx.config.capabilities].filter((cap) => cap !== 'site-index'),
  });
  return ctx;
};
export const urls = (ctx: TestCtx) =>
  ctx.http.requests.map((request) => request.url.slice(HOST.length));
