import { load, type CheerioAPI } from 'cheerio';
import type { HtmlExtractor, RenderMeta, RenderOptions } from '../../src/core/ports.js';
import type { DocKind, DocPage, HtmlFamily } from '../../src/core/types.js';
import { createHtmlExtractor } from '../../src/extract/index.js';
import type { Pass, PassEnv } from '../../src/extract/types.js';
import { FAKE_NOW_ISO } from '../support/builders.js';
import { readFixture } from '../support/fixtures.js';

/** One synthetic page per family: `test/fixtures/synthetic/html/<family>/page.html`. */
export interface FamilyCase {
  family: HtmlFamily;
  /** The URL the page pretends to live at; relative links resolve against it. */
  url: string;
  kind: DocKind;
}

/** Every family with its fixture. The hosts are fictional. */
export const FAMILY_CASES: readonly FamilyCase[] = [
  {
    family: 'astro',
    url: 'https://docs.example.com/harbor/latest/tutorials/plot-tide-stations/',
    kind: 'tutorial',
  },
  {
    family: 'astro-js-ref',
    url: 'https://docs.example.com/harbor/latest/references/core/layers/TideLayer/',
    kind: 'api',
  },
  {
    family: 'astro-sample',
    url: 'https://docs.example.com/harbor/latest/sample-code/intro-charts/',
    kind: 'sample',
  },
  {
    family: 'gatsby',
    url: 'https://docs.example.com/quay/function-reference/text_functions/',
    kind: 'api',
  },
  { family: 'gatsby-rest', url: 'https://docs.example.com/harbor-rest/berths/find/', kind: 'api' },
  {
    family: 'qdoc',
    url: 'https://docs.example.com/harbor-qt/cpp/api-reference/harbor-chart.html',
    kind: 'api',
  },
  {
    family: 'dokka',
    url: 'https://docs.example.com/kotlin/api/harbor-maps-kotlin/com.example.harbor.mapping/-harbor-chart/index.html',
    kind: 'api',
  },
  {
    family: 'dartdoc',
    url: 'https://docs.example.com/flutter/api/harbor_maps/HarborChart-class.html',
    kind: 'api',
  },
  {
    family: 'docfx-net',
    url: 'https://docs.example.com/net/api/Example.Harbor.Mapping.HarborChart.html',
    kind: 'api',
  },
  {
    family: 'docfx-esri',
    url: 'https://desk.example.com/en/latest/tool-reference/channel/dredge.html',
    kind: 'api',
  },
  {
    family: 'documentx',
    url: 'https://desk.example.com/en/latest/sdk/api-reference/topic102.html',
    kind: 'api',
  },
  {
    family: 'javadoc',
    url: 'https://docs.example.com/java/api/com.example.harbor/com/example/harbor/mapping/HarborChart.html',
    kind: 'api',
  },
  {
    family: 'javadoc-legacy',
    url: 'https://docs.example.com/server/api/java/com/example/harbor/server/IBerthServer.html',
    kind: 'api',
  },
  {
    family: 'legacy-help',
    url: 'https://help.example.com/en/harbor-field/alerts/tide-alerts.htm',
    kind: 'help',
  },
  {
    family: 'support-kb',
    url: 'https://support.example.com/en-us/knowledge-base/export-gauge-readings-000990001',
    kind: 'troubleshooting',
  },
  { family: 'generic', url: 'https://tools.example.com/release-notes/2-1/', kind: 'release-notes' },
];

const extractor = createHtmlExtractor();

/** The extractor shared by the tests of this package. */
export function sharedExtractor(): HtmlExtractor {
  return extractor;
}

/** Looks a family case up. */
export function caseOf(family: HtmlFamily): FamilyCase {
  const found = FAMILY_CASES.find((entry) => entry.family === family);
  if (found === undefined) throw new Error(`no fixture for family ${family}`);
  return found;
}

/** The HTML of a family's fixture page. */
export function fixtureHtml(family: HtmlFamily): string {
  return readFixture('synthetic', 'html', family, 'page.html');
}

/** Render metadata for a URL, as an adapter without a response would pass it. */
export function metaFor(url: string, kind: DocKind = 'guide'): RenderMeta {
  return { url, kind, license: 'esri-website-terms', retrievedAt: FAKE_NOW_ISO };
}

/** Converts a family's fixture page. */
export function extractFixture(family: HtmlFamily, opts?: RenderOptions): DocPage {
  const { url, kind } = caseOf(family);
  return extractor.extract({ html: fixtureHtml(family) }, metaFor(url, kind), opts);
}

/** Converts arbitrary HTML at a fictional URL. */
export function extractHtml(
  html: string,
  opts?: RenderOptions,
  url = 'https://docs.example.com/page/',
): DocPage {
  return extractor.extract({ html }, metaFor(url), opts);
}

/** The text a golden file holds: the header block, then every section, then a newline. */
export function pageMarkdown(page: DocPage): string {
  const blocks = [page.header ?? '', ...page.sections.map((section) => section.markdown)];
  return `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
}

/** A pass environment with empty counters. */
export function passEnv(overrides: Partial<PassEnv> = {}): PassEnv {
  return {
    url: 'https://docs.example.com/guide/page/',
    title: 'Page',
    focusedCode: false,
    defaultLanguage: '',
    overview: false,
    counters: { tables: {}, unknownIslands: new Set<string>() },
    ...overrides,
  };
}

/** Runs passes over an HTML fragment and returns the document for inspection. */
export function runPasses(
  html: string,
  passes: readonly Pass[],
  env: PassEnv = passEnv(),
): CheerioAPI {
  const $ = load(html, null, false);
  for (const pass of passes) pass($, env);
  return $;
}

/** Runs passes over an HTML fragment and returns the resulting HTML. */
export function applyPass(html: string, pass: Pass, env: PassEnv = passEnv()): string {
  return runPasses(html, [pass], env).html();
}
