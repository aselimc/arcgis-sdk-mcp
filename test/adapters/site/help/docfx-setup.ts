import { bindSource } from '../../../../src/core/adapter-helpers.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import type { FakeRenderer } from '../../../support/fake-render.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';

/**
 * Sources, products and contexts shared by the `docfx-esri` test files: an invented product
 * with a tool reference and a Python reference, and an invented help product with two books.
 */

export const ROOT = 'https://doc.esri.com/en/widgets-pro/latest/';
export const TOOLS = `${ROOT}tool-reference/`;
export const PYTHON = `${ROOT}arcpy/`;
export const TOOLS_TOC = `${TOOLS}toc.json`;
export const SITEMAP = `${ROOT}sitemap.xml`;
export const BEVEL = `${TOOLS}shaping/bevel-2.html`;
export const EXPLORER = `${TOOLS}data-management/open-widget-explorer.html`;

export const tools = makeSource(
  'docfx-esri',
  {
    slug: 'widgets-pro',
    scope: 'tool-reference/',
    toc: 'tool-reference/toc.json',
    symbols: 'toc',
    gpParameters: true,
  },
  {
    id: 'tools',
    title: 'Tool reference',
    kinds: ['api', 'guide'],
    floor: false,
    probe: { url: TOOLS_TOC, expect: 'json', family: 'docfx-esri', minRecords: 5 },
  },
);
export const python = makeSource(
  'docfx-esri',
  { slug: 'widgets-pro', scope: 'arcpy/', symbols: 'toc' },
  {
    id: 'arcpy',
    title: 'Python reference',
    kinds: ['api', 'guide'],
    probe: { url: `${PYTHON}toc.json`, expect: 'json', family: 'docfx-esri' },
  },
);
export const product = makeProduct({
  id: 'widgets-pro',
  name: 'Widgets Pro',
  homepage: ROOT,
  languages: ['python'],
  sources: [python, tools],
});

export const HELP_ROOT = 'https://doc.esri.com/en/widget-server/latest/';
export const help = makeSource(
  'docfx-esri',
  { slug: 'widget-server', sections: ['install', 'use/'] },
  {
    id: 'help',
    title: 'Widget Server help',
    kinds: ['help'],
    probe: { url: `${HELP_ROOT}sitemap.xml`, expect: 'xml', family: 'docfx-esri', minRecords: 2 },
  },
);
export const helpProduct = makeProduct({
  id: 'widget-server',
  name: 'Widget Server',
  homepage: HELP_ROOT,
  sources: [help],
});

export const proCassette = () => loadCassette('cassettes', 'site', 'help', 'docfx-pro.json');
export const helpCassette = () => loadCassette('cassettes', 'site', 'help', 'docfx-help.json');
export const proCtx = (): TestCtx => makeCtx({ cassette: proCassette() });
export const helpCtx = (render?: FakeRenderer): TestCtx =>
  makeCtx({ cassette: helpCassette(), ...(render === undefined ? {} : { render }) });
export const boundTools = () => bindSource(product, tools, makeLine());
export const withoutSiteIndex = (ctx: TestCtx): TestCtx => {
  ctx.policy = fakePolicy({
    enabled: [...ctx.config.capabilities].filter((cap) => cap !== 'site-index'),
  });
  return ctx;
};
export const byRef = (records: CatalogRecord[], ref: string) =>
  records.find((record) => record.ref === ref);
export const symbols = (records: CatalogRecord[]) =>
  records.flatMap((record) => (record.qualified === undefined ? [] : [record.qualified]));
