import { describe, expect, it } from 'vitest';
import { checkRegistry, type RegistryIssue } from '../../scripts/registry-check.js';
import type { Product } from '../../src/core/types.js';
import { HOSTS } from '../../src/registry/hosts.js';
import { makeLine, makeProduct, makeSource } from '../support/builders.js';
import { loadData } from './load-data.js';

/** One day after the date the registry was last verified, so nothing is stale. */
const TODAY = new Date('2026-10-14T00:00:00Z');

const data = await loadData();

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
  const issues = checkRegistry({ products: data.products, hosts: HOSTS, briefs: data.briefs }, TODAY);

  it('finds products to check', () => {
    expect(data.products.length).toBeGreaterThanOrEqual(31);
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
    for (const product of data.products) {
      for (const source of product.sources) {
        expect(source.probe.url, `${product.id}/${source.id}`).toMatch(/^https:\/\//);
      }
    }
  });

  // References to products of a data file that is not there cannot resolve.
  it.skipIf(!data.complete)(
    'INV-4: ids and aliases are unique, references resolve, one line is current',
    () => {
      expect(ofRule(issues, 'INV-4')).toEqual([]);
    },
  );

  it('INV-4 within each data file that exists: lines, sources and fallbacks are consistent', () => {
    const local = ofRule(issues, 'INV-4').filter((line) => !line.includes('does not resolve'));
    expect(local).toEqual([]);
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
      sources: [
        makeSource('docc', { base: '/widgets/api/' }, { capability: 'package-cdn' }),
      ],
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
      homepage: 'https://developers.arcgis.com/widgets/static/f013f9dda2d4e9af0b8d489f7bdaf2c1.store.json',
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
