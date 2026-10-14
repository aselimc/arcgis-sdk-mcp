/**
 * Imports the product-help research into the registry:
 * `scripts/data/help-registry.source.json` (research facts) plus
 * `scripts/data/help-registry.rules.json` (id maps and this project's wording) become
 * `src/registry/data/help.generated.ts`.
 *
 * Usage: `tsx scripts/import-help-registry.ts` writes the module; `--check` only compares
 * and exits 1 when the committed module is out of date.
 *
 * Every research entry is consumed by exactly one rule, and the ledger in the generated
 * module records which. The output depends on the two input files alone (no timestamps, LF
 * line ends), which is what lets CI assert that `npm run gen` leaves no diff.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Importer } from './data/help-registry.importer.js';
import { ruleFor, type HelpRegistry, type ImportRule } from './data/help-registry.rules.js';
import { RulesFileSchema, SourceFileSchema, type Entry } from './data/help-registry.schema.js';

export { IMPORT_RULES, ruleFor } from './data/help-registry.rules.js';
export type { HelpRegistry, ImportRule, LedgerRow } from './data/help-registry.rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(HERE, 'data', 'help-registry.source.json');
const RULES_PATH = join(HERE, 'data', 'help-registry.rules.json');
const OUTPUT_PATH = join(HERE, '..', 'src', 'registry', 'data', 'help.generated.ts');

/** Applies the import rules to the two (unvalidated) input documents. */
export function buildHelpRegistry(sourceJson: unknown, rulesJson: unknown): HelpRegistry {
  const source = SourceFileSchema.parse(sourceJson);
  const rules = RulesFileSchema.parse(rulesJson);
  const importer = new Importer(source, rules);
  const later: Array<[Entry, ImportRule]> = [];
  for (const entry of source.entries) {
    const rule = ruleFor(entry, rules);
    if (!importer.create(entry, rule)) later.push([entry, rule]);
  }
  for (const [entry, rule] of later) importer.attach(entry, rule);
  return importer.finish();
}

const literal = (value: unknown): string => JSON.stringify(value, null, 2);

/** Renders the generated module. Deterministic: the same registry gives the same text. */
export function renderHelpModule(registry: HelpRegistry): string {
  return `// GENERATED FILE, DO NOT EDIT. Written by scripts/import-help-registry.ts from
// scripts/data/help-registry.source.json and scripts/data/help-registry.rules.json.
// Change those files and run \`npm run gen\`.
import type { AnySourceDef, Product } from '../../core/types.js';

/**
 * Product help: ${registry.products.length} products of category \`product-help\`,
 * tombstones included.
 */
export const helpProducts: readonly Product[] = ${literal(registry.products)};

/**
 * Help books that belong to developer-tier products, as ready-made sources keyed
 * \`product/source\`. The data file of that product takes its source from here.
 */
export const helpDeveloperSources: Readonly<Record<string, AnySourceDef>> = ${literal(registry.developerSources)};

/** The retired end-user help of developer-tier tombstones, keyed by product id. */
export const helpDeveloperLinks: Readonly<Record<string, { title: string; ref: string }>> = ${literal(registry.developerLinks)};

/**
 * One row per research entry: the import rule that consumed it and the product or
 * \`product/source\` it produced or extended.
 */
export const helpImportLedger: ReadonlyArray<{ entry: string; rule: string; target: string }> = ${literal(registry.ledger)};
`;
}

/** Reads the committed inputs and renders the module they produce. */
export function generateHelpModule(): string {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  return renderHelpModule(buildHelpRegistry(read(SOURCE_PATH), read(RULES_PATH)));
}

function main(argv: readonly string[]): void {
  const generated = generateHelpModule();
  if (argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      // A missing module is reported like a stale one.
    }
    if (current !== generated) {
      process.stderr.write(
        'src/registry/data/help.generated.ts is out of date: run `npm run gen`.\n',
      );
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
}

// Run only as a script: tests import the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
