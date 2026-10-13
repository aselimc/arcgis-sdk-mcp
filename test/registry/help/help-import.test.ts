import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_RULES,
  buildHelpRegistry,
  generateHelpModule,
  renderHelpModule,
  ruleFor,
  type ImportRule,
} from '../../../scripts/import-help-registry.js';
import {
  RulesFileSchema,
  SourceFileSchema,
  type Entry,
  type RulesFile,
  type SourceFile,
} from '../../../scripts/data/help-registry.schema.js';
import {
  helpDeveloperLinks,
  helpDeveloperSources,
  helpImportLedger,
  helpProducts,
} from '../../../src/registry/data/help.generated.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

const sourceJson: unknown = JSON.parse(read('scripts/data/help-registry.source.json'));
const rulesJson: unknown = JSON.parse(read('scripts/data/help-registry.rules.json'));
const source = SourceFileSchema.parse(sourceJson);
const rules = RulesFileSchema.parse(rulesJson);

/** Deep copies of the committed inputs, for tests that break one thing. */
function inputs(): { source: SourceFile; rules: RulesFile } {
  return { source: structuredClone(source), rules: structuredClone(rules) };
}

function entry(id: string): Entry {
  const found = source.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no research entry ${id}`);
  return found;
}

describe('help import: the committed module', () => {
  it('is what the generator produces from the committed inputs', () => {
    expect(generateHelpModule()).toBe(read('src/registry/data/help.generated.ts'));
  });

  it('is deterministic and uses LF line ends only', () => {
    const first = generateHelpModule();
    expect(generateHelpModule()).toBe(first);
    expect(first).not.toContain('\r');
    expect(first.endsWith('\n')).toBe(true);
  });

  it('exports exactly what the importer builds', () => {
    const built = buildHelpRegistry(sourceJson, rulesJson);
    expect(helpProducts).toEqual(built.products);
    expect(helpDeveloperSources).toEqual(built.developerSources);
    expect(helpDeveloperLinks).toEqual(built.developerLinks);
    expect(helpImportLedger).toEqual(built.ledger);
    expect(renderHelpModule(built)).toBe(read('src/registry/data/help.generated.ts'));
  });

  it('leaves the input documents untouched', () => {
    const copy = inputs();
    buildHelpRegistry(copy.source, copy.rules);
    expect(copy.source).toEqual(source);
    expect(copy.rules).toEqual(rules);
  });
});

describe('help import: every research entry is accounted for', () => {
  it('reads 114 entries from four hosts', () => {
    const perHost = new Map<string, number>();
    for (const item of source.entries) perHost.set(item.host, (perHost.get(item.host) ?? 0) + 1);
    expect(source.entries).toHaveLength(114);
    expect(Object.fromEntries(perHost)).toEqual({
      'doc.esri.com': 36,
      'doc.arcgis.com': 55,
      'enterprise.arcgis.com': 22,
      'pro.arcgis.com': 1,
    });
  });

  it('consumes each of the 114 entries with exactly one rule', () => {
    const consumed = helpImportLedger.map((row) => row.entry);
    expect(consumed).toHaveLength(114);
    expect(new Set(consumed).size).toBe(114);
    expect([...consumed].sort()).toEqual(source.entries.map((item) => item.id).sort());
    for (const row of helpImportLedger) expect(IMPORT_RULES, row.entry).toContain(row.rule);
  });

  it('applies each rule to the number of entries the design states', () => {
    const perRule: Partial<Record<string, number>> = {};
    for (const row of helpImportLedger) perRule[row.rule] = (perRule[row.rule] ?? 0) + 1;
    expect(perRule).toEqual({
      'docesri-product': 36,
      'standalone-help': 11,
      // 3 SaaS twins of the `full` rule plus doc-excalibur from the search-and-link rule.
      'saas-twin': 4,
      // doc-cityengine and ent-geoevent.
      'developer-books': 2,
      'standalone-link': 20,
      'migrated-alias': 10,
      // 6 on doc.arcgis.com, doc-microsoft-365, and 2 on enterprise.arcgis.com.
      tombstone: 9,
      'developer-tombstone-link': 2,
      'enterprise-legacy-lines': 11,
      'migrated-legacy': 8,
      'pro-legacy-lines': 1,
    } satisfies Record<ImportRule, number>);
  });

  it('points every ledger row at a generated product, source or developer target', () => {
    const products = new Map(helpProducts.map((product) => [product.id, product]));
    for (const row of helpImportLedger) {
      const [productId = '', sourceId] = row.target.split('/');
      const product = products.get(productId);
      if (product === undefined) {
        const developerTarget =
          Object.hasOwn(helpDeveloperSources, row.target) ||
          Object.hasOwn(helpDeveloperLinks, row.target);
        expect(developerTarget, `${row.entry} -> ${row.target}`).toBe(true);
      } else if (sourceId !== undefined) {
        expect(
          product.sources.map((candidate) => candidate.id),
          row.entry,
        ).toContain(sourceId);
      }
    }
  });
});

describe('help import: choice of rule', () => {
  it.each<[string, ImportRule]>([
    ['esri-arcgis-pro', 'docesri-product'],
    ['esri-accessibility', 'docesri-product'],
    ['arcgis-online', 'standalone-help'],
    ['doc-survey123', 'standalone-help'],
    ['doc-velocity', 'saas-twin'],
    ['doc-excalibur', 'saas-twin'],
    ['doc-cityengine', 'developer-books'],
    ['ent-geoevent', 'developer-books'],
    ['doc-power-bi', 'standalone-link'],
    ['doc-hub', 'migrated-alias'],
    ['doc-microsoft-365', 'tombstone'],
    ['doc-insights', 'tombstone'],
    ['doc-appstudio', 'developer-tombstone-link'],
    ['ent-legacy-portal', 'enterprise-legacy-lines'],
    ['ent-legacy-video', 'migrated-legacy'],
    ['ent-legacy-inspire', 'tombstone'],
    ['legacy-pro-app', 'pro-legacy-lines'],
  ])('%s is consumed by %s', (id, rule) => {
    expect(ruleFor(entry(id), rules)).toBe(rule);
    expect(helpImportLedger.find((row) => row.entry === id)?.rule).toBe(rule);
  });
});

describe('help import: failures name the cause', () => {
  it('rejects an entry whose rule has no id mapping', () => {
    const { rules: broken } = inputs();
    delete broken.standalone['doc-survey123'];
    expect(() => buildHelpRegistry(source, broken)).toThrow(
      /doc-survey123: no entry in rules\.standalone/,
    );
  });

  it('rejects a new research entry that no rule input covers', () => {
    const { source: grown } = inputs();
    grown.entries.push({ ...entry('doc-teams'), id: 'doc-new-app', url_slug: 'new-app' });
    expect(() => buildHelpRegistry(grown, rules)).toThrow(/doc-new-app: no entry in rules/);
  });

  it('rejects a doc.esri.com product without wording', () => {
    const { source: grown } = inputs();
    grown.entries.push({
      ...entry('esri-arcgis-urban'),
      id: 'esri-new-product',
      url_slug: 'new-product',
    });
    expect(() => buildHelpRegistry(grown, rules)).toThrow(
      /esri-new-product: rules\.products has no "new-product"/,
    );
  });

  it('rejects rule input that refers to a research entry that is gone', () => {
    const { source: shrunk } = inputs();
    shrunk.entries = shrunk.entries.filter((item) => item.id !== 'doc-hub');
    expect(() => buildHelpRegistry(shrunk, rules)).toThrow(
      /rules\.migratedAliases: unknown research entry "doc-hub"/,
    );
  });

  it('rejects wording for a product that is not generated', () => {
    const { rules: extra } = inputs();
    extra.products['ghost-product'] = { summary: 'A product nobody generates.', keywords: ['x'] };
    expect(() => buildHelpRegistry(source, extra)).toThrow(
      /rules\.products: "ghost-product" is not generated/,
    );
  });

  it('rejects an id or alias that a developer product already uses', () => {
    const { rules: clash } = inputs();
    clash.standalone['doc-dashboards'] = 'calcite';
    clash.products.calcite = { summary: 'Takes the id of a developer product.', keywords: ['x'] };
    delete clash.products.dashboards;
    expect(() => buildHelpRegistry(source, clash)).toThrow(
      /"calcite" of calcite is also a developer/,
    );
  });

  it('rejects a reference to an unknown product', () => {
    const { rules: dangling } = inputs();
    const meta = dangling.products.survey123;
    if (meta !== undefined) meta.related = ['no-such-product'];
    expect(() => buildHelpRegistry(source, dangling)).toThrow(
      /survey123: unknown product "no-such-product"/,
    );
  });

  it('rejects two entries that would generate the same product', () => {
    const { rules: twice } = inputs();
    twice.standalone['doc-teams'] = 'dashboards';
    expect(() => buildHelpRegistry(source, twice)).toThrow(/product dashboards is generated twice/);
  });

  it('rejects a research file whose shape changed', () => {
    const renamed = structuredClone(sourceJson) as { entries: Array<Record<string, unknown>> };
    const first = renamed.entries[0];
    if (first !== undefined) delete first.url_slug;
    expect(() => buildHelpRegistry(renamed, rulesJson)).toThrow(/url_slug/);

    const { source: unknownHost } = inputs();
    const altered = { ...entry('doc-teams'), host: 'help.example.com' };
    expect(() =>
      buildHelpRegistry({ ...unknownHost, entries: [...unknownHost.entries, altered] }, rules),
    ).toThrow(/host/);
  });

  it('rejects a summary longer than 160 characters', () => {
    const { rules: wordy } = inputs();
    const meta = wordy.products.dashboards;
    if (meta !== undefined) meta.summary = 'x'.repeat(161);
    expect(() => buildHelpRegistry(source, wordy)).toThrow(/summary/);
  });

  it('rejects an ArcGIS Online start-here group the research does not have', () => {
    const { rules: stale } = inputs();
    stale.onlineStartHere.push({ group: 'no such group', title: 'Nothing' });
    expect(() => buildHelpRegistry(source, stale)).toThrow(/no research group "no such group"/);
  });

  it('rejects a section of the old ArcGIS Pro host that the research does not list', () => {
    const { rules: stale } = inputs();
    stale.pro.sources['arcgis-pro/legacy']?.sections.push('no-such-section');
    expect(() => buildHelpRegistry(source, stale)).toThrow(/no section "no-such-section"/);
  });
});
