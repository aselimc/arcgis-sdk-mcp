import { describe, expect, it } from 'vitest';
import {
  checkLinks,
  checkRegistry,
  undeclaredKinds,
  type RegistryIssue,
} from '../../scripts/registry-check.js';
import type { Product } from '../../src/core/types.js';
import { HOSTS } from '../../src/registry/hosts.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { makeCtx } from '../support/make-ctx.js';
import { BRIEFS, PRODUCTS, TODAY } from './registry-data.js';

/** Rules violated by a set of synthetic products, as `RULE product: message` lines. */
function violations(products: Product[], today = TODAY): string[] {
  return checkRegistry({ products, hosts: HOSTS }, today).map(
    (issue) => `${issue.rule} ${issue.product}: ${issue.message}`,
  );
}

function ofRule(issues: RegistryIssue[], rule: RegistryIssue['rule']): string[] {
  return issues
    .filter((issue) => issue.rule === rule && issue.severity === 'error')
    .map((issue) => `${issue.product}: ${issue.message}`);
}

describe('registry data', () => {
  const issues = checkRegistry({ products: PRODUCTS, hosts: HOSTS, briefs: BRIEFS }, TODAY);

  it('checks every product of the registry', () => {
    // 60 developer-tier products and 76 of product help: a data file that drops out of
    // the registry changes this number.
    expect(PRODUCTS).toHaveLength(136);
  });

  it('matches the schemas', () => {
    expect(ofRule(issues, 'SCHEMA')).toEqual([]);
  });

  it('INV-1: every live product has exactly one floor source that needs no optional capability', () => {
    expect(ofRule(issues, 'INV-1')).toEqual([]);
  });

  it('INV-2: every URL is on a listed host and every repository has an allowed owner', () => {
    expect(ofRule(issues, 'INV-2')).toEqual([]);
  });

  it('INV-3: every source has a valid probe', () => {
    expect(ofRule(issues, 'INV-3')).toEqual([]);
    for (const product of PRODUCTS) {
      for (const source of product.sources) {
        expect(source.probe.url, `${product.id}/${source.id}`).toMatch(/^https:\/\//);
      }
    }
  });

  it('INV-4: ids and aliases are unique, references resolve, one line is current', () => {
    expect(ofRule(issues, 'INV-4')).toEqual([]);
  });

  it('INV-5: no content hashes, every pattern compiles, nothing is stale', () => {
    expect(ofRule(issues, 'INV-5')).toEqual([]);
    expect(issues.filter((issue) => issue.severity === 'warning')).toEqual([]);
  });
});

describe('checkRegistry', () => {
  it('accepts a minimal valid product', () => {
    expect(violations([makeProduct()])).toEqual([]);
  });

  it('INV-1: counts floor sources and restricts their adapter and capability', () => {
    const none = makeProduct({
      sources: [makeSource('gatsby', { base: '/widgets/' }, { floor: false })],
    });
    expect(violations([none])).toEqual([
      'INV-1 widgets-sdk: expected exactly one floor source, found 0',
    ]);

    const two = makeProduct({
      sources: [
        makeSource('gatsby', { base: '/widgets/' }),
        makeSource('gatsby', { base: '/widgets/more/' }, { id: 'more' }),
      ],
    });
    expect(violations([two])).toEqual([
      'INV-1 widgets-sdk: expected exactly one floor source, found 2',
    ]);

    const indexOnly = makeProduct({
      sources: [makeSource('docc', { base: '/widgets/api/' }, { capability: 'package-cdn' })],
    });
    expect(violations([indexOnly])).toEqual([
      'INV-1 widgets-sdk: floor source guide uses adapter docc',
      'INV-1 widgets-sdk: floor source guide needs capability package-cdn',
    ]);
  });

  it('INV-1: lets a tombstone have no source at all', () => {
    expect(violations([makeProduct({ status: 'retired', sources: [] })])).toEqual([]);
  });

  it('INV-2: rejects unknown hosts and foreign GitHub owners', () => {
    const product = makeProduct({
      homepage: 'https://example.com/widgets/',
      repos: [
        { repo: 'someone/widgets', role: 'samples', license: 'apache-2.0', defaultBranch: 'main' },
      ],
      startHere: [
        { title: 'Readme', ref: 'https://github.com/someone/widgets/blob/main/README.md' },
        { title: 'Ours', ref: 'https://github.com/Esri/widgets/blob/main/README.md' },
        { title: 'Brief', ref: 'brief:ai/overview' },
      ],
    });
    expect(violations([product])).toEqual([
      'INV-2 widgets-sdk: homepage: host example.com is not in HOSTS',
      'INV-2 widgets-sdk: startHere: GitHub owner of https://github.com/someone/widgets/blob/main/README.md is not allowed',
      'INV-2 widgets-sdk: repository someone/widgets: owner not allowed',
    ]);
  });

  it('INV-2: rejects an address on a path its host does not allow', () => {
    const product = makeProduct({
      startHere: [
        { title: 'Notice', ref: 'https://support.esri.com/en-us/knowledge-base/some-000012345' },
        { title: 'Contact', ref: 'https://support.esri.com/en-us/contact' },
      ],
    });
    expect(violations([product])).toEqual([
      'INV-2 widgets-sdk: startHere: support.esri.com does not allow the path of https://support.esri.com/en-us/contact',
    ]);
  });

  it('INV-2: checks the address options of an oracle', () => {
    const product = makeProduct({
      oracles: [
        {
          type: 'sitemap-slug',
          options: { sitemap: 'https://example.com/sitemap-0.xml' },
          provides: ['documented'],
        },
      ],
    });
    expect(violations([product])).toEqual([
      'INV-2 widgets-sdk: oracle sitemap-slug: host example.com is not in HOSTS',
    ]);
  });

  it('INV-3: rejects a probe URL with a placeholder that a line does not fill', () => {
    const source = makeSource('gatsby', { base: '/widgets/' });
    const product = makeProduct({
      sources: [
        {
          ...source,
          probe: { url: 'https://developers.arcgis.com/widgets/{release}/x', expect: 'html' },
        },
      ],
    });
    expect(violations([product])).toEqual([
      'INV-3 widgets-sdk: source guide: probe URL has a placeholder left on line latest',
    ]);
  });

  it('requires keywords: the router finds a product through them', () => {
    expect(violations([makeProduct({ keywords: [] })])).toEqual([
      'SCHEMA widgets-sdk: keywords: at least one is needed',
    ]);
  });

  it('INV-4: an oracle may be limited to sources the product has', () => {
    const product = makeProduct({
      oracles: [
        {
          type: 'static',
          options: { version: '1.0', sources: 'guide, api' },
          provides: ['documented'],
        },
      ],
    });
    expect(violations([product])).toEqual([
      'INV-4 widgets-sdk: oracle static names unknown source api',
    ]);
  });

  it('INV-2: checks the base URL of every line of a source', () => {
    const product = makeProduct({
      lines: [
        makeLine({ vars: { host: 'developers.arcgis.com' } }),
        makeLine({ id: 'old', current: false, vars: { host: 'old.example.com' } }),
      ],
      sources: [makeSource('gatsby', { base: 'https://{host}/widgets/' })],
    });
    expect(violations([product])).toEqual([
      'INV-2 widgets-sdk: guide base: host old.example.com is not in HOSTS',
    ]);
  });

  it('INV-3: requires a probe with an https URL', () => {
    const source = makeSource('gatsby', { base: '/widgets/' });
    const product = makeProduct({
      sources: [{ ...source, probe: { url: 'ftp://developers.arcgis.com/x', expect: 'html' } }],
    });
    expect(violations([product]).filter((line) => line.startsWith('INV-3'))).toEqual([
      'INV-3 widgets-sdk: sources.0.probe.url: must be an https URL',
    ]);
  });

  it('INV-4: keeps ids and aliases in one namespace', () => {
    const first = makeProduct();
    const second = makeProduct({ id: 'gadgets-sdk', aliases: ['Widgets-SDK'.toLowerCase()] });
    const third = makeProduct({ id: 'gizmos-sdk', aliases: ['widgets'] });
    expect(violations([first, second, third])).toEqual([
      'INV-4 gadgets-sdk: "widgets-sdk" is also an id or alias of widgets-sdk',
      'INV-4 gizmos-sdk: "widgets" is also an id or alias of widgets-sdk',
    ]);
    expect(violations([first, makeProduct()])).toContain(
      'INV-4 widgets-sdk: "widgets-sdk" is also an id or alias of widgets-sdk',
    );
  });

  it('INV-4: resolves successor, related, fallbacks and line references', () => {
    const product = makeProduct({
      successor: 'nothing',
      related: ['widgets-sdk'],
      lines: [makeLine(), makeLine({ id: 'old' })],
      sources: [
        makeSource('gatsby', { base: '/widgets/' }, { lines: ['v9'], fallbacks: ['guide', 'api'] }),
        makeSource('gatsby', { base: '/widgets/b/' }, { floor: false }),
      ],
    });
    expect(violations([product])).toEqual([
      'INV-4 widgets-sdk: expected one current line, found 2',
      'INV-4 widgets-sdk: duplicate source id guide',
      'INV-4 widgets-sdk: source guide names unknown line v9',
      'INV-4 widgets-sdk: source guide has an invalid fallback guide',
      'INV-4 widgets-sdk: source guide has an invalid fallback api',
      'INV-4 widgets-sdk: reference to widgets-sdk does not resolve to another product',
      'INV-4 widgets-sdk: reference to nothing does not resolve to another product',
    ]);
  });

  it('INV-5: rejects hashed file names and patterns that do not compile', () => {
    const hashed = makeProduct({
      homepage:
        'https://developers.arcgis.com/widgets/static/f013f9dda2d4e9af0b8d489f7bdaf2c1.store.json',
    });
    expect(violations([hashed])).toEqual([
      `INV-5 widgets-sdk: "${hashed.homepage}" contains a content hash`,
    ]);

    const broken = makeProduct({
      sources: [makeSource('gatsby', { base: '/widgets/', exclude: ['^(api'] })],
    });
    expect(violations([broken])).toEqual([
      'INV-5 widgets-sdk: sources.0.config.exclude.0: must be a valid regular expression',
    ]);
  });

  it('INV-5: warns when a verification is older than 180 days', () => {
    const issues = checkRegistry(
      { products: [makeProduct({ verifiedOn: '2026-01-01' })], hosts: HOSTS },
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(issues).toEqual([
      {
        rule: 'INV-5',
        severity: 'warning',
        product: 'widgets-sdk',
        message: 'verifiedOn 2026-01-01 is 286 days old',
      },
    ]);
    expect(violations([makeProduct({ verifiedOn: '2026-06-01' })])).toEqual([]);
  });

  it('checks the host table and the briefs too', () => {
    const [first] = HOSTS;
    const issues = checkRegistry(
      {
        products: [],
        hosts: [first!, first!, { ...first!, host: 'Not A Host' }],
        briefs: [{ slug: 'Bad Slug', verifiedOn: 'yesterday' }],
      },
      TODAY,
    );
    expect(issues.map((issue) => `${issue.rule} ${issue.product}`)).toEqual([
      'SCHEMA (hosts)',
      'INV-2 (hosts)',
      'SCHEMA (briefs)',
      'SCHEMA (briefs)',
      'SCHEMA (briefs)',
      'SCHEMA (briefs)',
      'SCHEMA (briefs)',
    ]);
  });
});

describe('undeclaredKinds', () => {
  // Regression: 61 sample pages were indexed with kind `sample` by a source that declared
  // guide, tutorial and api, so `arcgis_docs_find_samples` said the product had no samples.
  it('names the kinds a source lists without declaring them, with their record counts', () => {
    const records = [
      { kind: 'guide' as const },
      { kind: 'sample' as const },
      { kind: 'sample' as const },
      { kind: 'release-notes' as const },
    ];
    expect(undeclaredKinds(['guide', 'tutorial', 'api'], records)).toEqual([
      { kind: 'sample', records: 2 },
      { kind: 'release-notes', records: 1 },
    ]);
    expect(undeclaredKinds(['guide', 'sample', 'release-notes'], records)).toEqual([]);
    expect(undeclaredKinds(['guide'], [])).toEqual([]);
  });
});

describe('checkLinks', () => {
  const D = 'https://developers.arcgis.com';
  const page = { body: '<html><title>Page</title></html>' };

  // Regression: three registry links were dead although every source probe passed, because
  // nothing ever requested the links a product hands out.
  it('requests the home page and every start-here link, and reports the dead ones', async () => {
    const ctx = makeCtx();
    ctx.http.on(`${D}/widgets/`, page).on(`${D}/widgets/intro/`, page);
    ctx.http.fail(`${D}/widgets/agentic-apps/`, 404);
    const product = makeProduct({
      homepage: `${D}/widgets/`,
      startHere: [
        { title: 'Intro', ref: `${D}/widgets/intro/` },
        { title: 'Agentic apps', ref: `${D}/widgets/agentic-apps/` },
        { title: 'Overview', ref: 'brief:ai/overview' },
        { title: 'Repository', ref: 'https://github.com/Esri/widgets' },
      ],
    });
    let pauses = 0;
    const results = await checkLinks(ctx, [product], async () => {
      pauses += 1;
    });
    expect(results.map((result) => [result.where, result.url, result.ok, result.skipped])).toEqual([
      ['homepage', `${D}/widgets/`, true, undefined],
      ['startHere', `${D}/widgets/intro/`, true, undefined],
      ['startHere', `${D}/widgets/agentic-apps/`, false, undefined],
      ['startHere', 'https://github.com/Esri/widgets', true, 'a repository ref'],
    ]);
    expect(results[2]?.error).toMatch(/^DOC_NOT_FOUND/);
    // One pause per request that went upstream: never faster than the pause allows.
    expect(pauses).toBe(3);
  });

  it('requests a link that several products share once', async () => {
    const ctx = makeCtx();
    ctx.http.on(`${D}/widgets/`, page);
    const first = makeProduct({ homepage: `${D}/widgets/` });
    const second = makeProduct({ id: 'gadgets-sdk', homepage: `${D}/widgets/` });
    const results = await checkLinks(ctx, [first, second], () => Promise.resolve());
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(ctx.http.count(`${D}/widgets/`)).toBe(1);
  });
});
