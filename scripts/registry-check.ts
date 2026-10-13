/**
 * Registry lint (design section 4, invariants INV-1 to INV-5).
 *
 * Usage: `tsx scripts/registry-check.ts [--json] [--live] [--product <id>]`
 *
 * Without `--live` nothing is requested: the registry data is checked against the schemas
 * and the invariants, and the process exits 1 when an error is found (warnings do not fail).
 * With `--live` every source probe additionally runs through the server's own HTTP gateway,
 * so policy, rate limits and the cache apply exactly as they do in the server.
 *
 * {@link checkRegistry} is also what the registry tests call.
 */
import { pathToFileURL } from 'node:url';
import { bindSource } from '../src/core/adapter-helpers.js';
import { loadConfig } from '../src/core/config.js';
import type { AdapterRegistry, Ctx, ProbeResult } from '../src/core/ports.js';
import { expandTemplate, sourceBaseUrls } from '../src/core/source-urls.js';
import type { AdapterType, Capability, HostPolicy, Product } from '../src/core/types.js';
import { parseGithubUrl } from '../src/core/url.js';
import { GITHUB_OWNERS } from '../src/registry/hosts.js';
import { plainKey } from '../src/registry/resolve.js';
import { briefSchema, hostPolicySchema, validateProducts } from '../src/registry/schema.js';

/** One finding of the lint. */
export interface RegistryIssue {
  rule: 'SCHEMA' | 'INV-1' | 'INV-2' | 'INV-3' | 'INV-4' | 'INV-5';
  severity: 'error' | 'warning';
  /** Product id, or `(hosts)` / `(briefs)` for the other tables. */
  product: string;
  message: string;
}

/** What the lint looks at. */
export interface RegistryData {
  products: readonly Product[];
  hosts: readonly HostPolicy[];
  briefs?: ReadonlyArray<{ slug: string; verifiedOn: string }>;
}

/** Adapters that can serve a floor source: they need no site-published index file. */
const FLOOR_ADAPTERS: ReadonlySet<AdapterType> = new Set([
  'astro',
  'gatsby',
  'docfx-esri',
  'legacy-help',
  'sitemap',
  'github-repo',
  'static',
  'openapi',
  'brief',
]);

const FLOOR_CAPABILITIES: ReadonlySet<Capability | undefined> = new Set([
  undefined,
  'website',
  'github',
]);

/** A manual verification older than this is worth a second look. */
const STALE_AFTER_DAYS = 180;

/** Content-hashed file names rotate with every site build and must be discovered at run time. */
const HASH_NAME = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i;

const GITHUB_HOSTS = new Set(['github.com', 'raw.githubusercontent.com', 'api.github.com']);

/** The values that occur more than once. */
function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

/** Every string anywhere inside a value. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** The repository owner a GitHub URL names, whichever GitHub host it is on. */
function githubOwner(url: URL): string | undefined {
  if (url.hostname === 'api.github.com') return /^\/repos\/([^/]+)\//.exec(url.pathname)?.[1];
  return parseGithubUrl(url.href)?.repo.split('/')[0] ?? url.pathname.split('/')[1];
}

/** Every URL a product would have the server fetch or hand out, with where it was found. */
function urlsOf(product: Product): Array<[where: string, url: string]> {
  const current = product.lines.find((line) => line.current) ?? product.lines[0];
  const found: Array<[string, string]> = [
    ['homepage', product.homepage],
    ...product.startHere.map((entry): [string, string] => ['startHere', entry.ref]),
    ...(product.compatibility ?? []).map((entry): [string, string] => ['compatibility', entry.url]),
  ];
  if (product.releaseNotes?.current !== undefined) {
    found.push(['releaseNotes.current', product.releaseNotes.current]);
  }
  for (const oracle of product.oracles) {
    for (const key of ['url', 'sitemap'] as const) {
      const value = oracle.options[key];
      if (value !== undefined) found.push([`oracle ${oracle.type}`, value]);
    }
  }
  for (const source of product.sources) {
    found.push([`${source.id} probe`, source.probe.url]);
    for (const line of product.lines) {
      if (source.lines !== undefined && !source.lines.includes(line.id)) continue;
      for (const base of sourceBaseUrls(source, line)) found.push([`${source.id} base`, base]);
    }
  }
  return found
    .filter(([, url]) => !url.startsWith('brief:'))
    .map(([where, url]) => [where, current === undefined ? url : expandTemplate(url, current)]);
}

function checkProduct(
  product: Product,
  ids: ReadonlySet<string>,
  hosts: ReadonlySet<string>,
  today: Date,
): Array<Omit<RegistryIssue, 'product'>> {
  const issues: Array<Omit<RegistryIssue, 'product'>> = [];
  const error = (rule: RegistryIssue['rule'], message: string): void => {
    issues.push({ rule, severity: 'error', message });
  };

  // INV-1: one floor source that works without index files or optional capabilities.
  const floors = product.sources.filter((source) => source.floor === true);
  const tombstone = product.status === 'retired';
  if (floors.length > 1 || (floors.length === 0 && !tombstone)) {
    error('INV-1', `expected exactly one floor source, found ${floors.length}`);
  }
  for (const floor of floors) {
    if (!FLOOR_ADAPTERS.has(floor.adapter)) {
      error('INV-1', `floor source ${floor.id} uses adapter ${floor.adapter}`);
    }
    if (!FLOOR_CAPABILITIES.has(floor.capability)) {
      error('INV-1', `floor source ${floor.id} needs capability ${floor.capability}`);
    }
  }

  // INV-2: hosts and GitHub owners.
  for (const [where, text] of urlsOf(product)) {
    if (!URL.canParse(text)) {
      error('INV-2', `${where}: "${text}" is not an absolute URL`);
      continue;
    }
    const url = new URL(text);
    if (url.hostname !== 'github.com' && !hosts.has(url.hostname)) {
      error('INV-2', `${where}: host ${url.hostname} is not in HOSTS`);
    }
    const owner = GITHUB_HOSTS.has(url.hostname) ? githubOwner(url) : undefined;
    if (GITHUB_HOSTS.has(url.hostname) && !isAllowedOwner(owner)) {
      error('INV-2', `${where}: GitHub owner of ${text} is not allowed`);
    }
  }
  const repos = [
    ...product.repos.map((repo) => repo.repo),
    ...product.sources.flatMap((source) =>
      source.adapter === 'github-repo' || source.adapter === 'xmldoc' ? [source.config.repo] : [],
    ),
  ];
  for (const repo of new Set(repos)) {
    if (!isAllowedOwner(repo.split('/')[0])) error('INV-2', `repository ${repo}: owner not allowed`);
  }

  // INV-4: references inside the product and to other products.
  const lineIds = product.lines.map((line) => line.id);
  const sourceIds = product.sources.map((source) => source.id);
  const currentLines = product.lines.filter((line) => line.current).length;
  if (currentLines !== 1) error('INV-4', `expected one current line, found ${currentLines}`);
  for (const id of duplicates(lineIds)) error('INV-4', `duplicate line id ${id}`);
  for (const id of duplicates(sourceIds)) error('INV-4', `duplicate source id ${id}`);
  for (const source of product.sources) {
    const configLines = source.adapter === 'legacy-help' ? (source.config.lines ?? []) : [];
    for (const line of [...(source.lines ?? []), ...configLines]) {
      if (!lineIds.includes(line)) error('INV-4', `source ${source.id} names unknown line ${line}`);
    }
    for (const fallback of source.fallbacks ?? []) {
      if (fallback === source.id || !sourceIds.includes(fallback)) {
        error('INV-4', `source ${source.id} has an invalid fallback ${fallback}`);
      }
    }
  }
  for (const target of [...product.related, ...(product.successor ? [product.successor] : [])]) {
    if (target === product.id || !ids.has(target)) {
      error('INV-4', `reference to ${target} does not resolve to another product`);
    }
  }

  // INV-5: no build hashes; verification dates.
  for (const text of strings(product)) {
    if (/^https?:|^\//.test(text) && HASH_NAME.test(text)) {
      error('INV-5', `"${text}" contains a content hash`);
    }
  }
  const age = (today.getTime() - Date.parse(product.verifiedOn)) / 86_400_000;
  if (age > STALE_AFTER_DAYS) {
    issues.push({
      rule: 'INV-5',
      severity: 'warning',
      message: `verifiedOn ${product.verifiedOn} is ${Math.floor(age)} days old`,
    });
  }
  return issues;
}

function isAllowedOwner(owner: string | undefined): boolean {
  return (
    owner !== undefined &&
    GITHUB_OWNERS.some((allowed) => allowed.toLowerCase() === owner.toLowerCase())
  );
}

/**
 * Checks registry data against the schemas and invariants INV-1 to INV-5. INV-3 (every
 * source has a probe) and the "every pattern compiles" half of INV-5 are part of the
 * schemas and are reported under their invariant.
 *
 * @param today the date `verifiedOn` values are compared with (injected so tests are stable).
 */
export function checkRegistry(data: RegistryData, today: Date): RegistryIssue[] {
  const issues: RegistryIssue[] = [];

  for (const issue of validateProducts(data.products)) {
    const rule = /\.probe(?:\.|$)/.test(issue.path)
      ? 'INV-3'
      : issue.message.includes('regular expression')
        ? 'INV-5'
        : 'SCHEMA';
    issues.push({
      rule,
      severity: 'error',
      product: issue.product,
      message: `${issue.path}: ${issue.message}`,
    });
  }
  for (const host of data.hosts) {
    const result = hostPolicySchema.safeParse(host);
    for (const issue of result.success ? [] : result.error.issues) {
      const message = `${host.host} ${issue.path.join('.')}: ${issue.message}`;
      issues.push({ rule: 'SCHEMA', severity: 'error', product: '(hosts)', message });
    }
  }
  for (const host of duplicates(data.hosts.map((row) => row.host))) {
    issues.push({ rule: 'INV-2', severity: 'error', product: '(hosts)', message: `duplicate ${host}` });
  }
  for (const brief of data.briefs ?? []) {
    const result = briefSchema.safeParse(brief);
    for (const issue of result.success ? [] : result.error.issues) {
      const message = `${brief.slug} ${issue.path.join('.')}: ${issue.message}`;
      issues.push({ rule: 'SCHEMA', severity: 'error', product: '(briefs)', message });
    }
  }

  // INV-4: one namespace for ids and aliases.
  const owners = new Map<string, string>();
  for (const product of data.products) {
    for (const name of new Set([product.id, ...product.aliases].map(plainKey))) {
      const other = owners.get(name);
      if (other === undefined) {
        owners.set(name, product.id);
      } else {
        const message = `"${name}" is also an id or alias of ${other}`;
        issues.push({ rule: 'INV-4', severity: 'error', product: product.id, message });
      }
    }
  }

  const ids = new Set(data.products.map((product) => product.id));
  const hosts = new Set(data.hosts.map((host) => host.host));
  for (const product of data.products) {
    for (const issue of checkProduct(product, ids, hosts, today)) {
      issues.push({ ...issue, product: product.id });
    }
  }
  return issues;
}

/** Outcome of one live probe. */
interface LiveResult extends ProbeResult {
  product: string;
  source: string;
  skipped?: string;
}

/** What `--live` needs from the composition root. */
interface Container {
  ctx: Ctx;
  adapters: AdapterRegistry;
}

function isContainer(value: unknown): value is Container {
  const candidate = value as Partial<Container> | null;
  return typeof candidate?.ctx?.http === 'object' && typeof candidate.adapters?.get === 'function';
}

/** Builds the server's own container, so probes go through the real gateway and policy. */
async function loadContainer(): Promise<Container> {
  // Resolved at run time: the composition root belongs to another package, which this
  // script must not require for the offline lint to type-check and run.
  const specifier = '../src/app/composition-root.js';
  const loaded = (await import(specifier)) as { createContainer?: (config: unknown) => unknown };
  const config = loadConfig(
    process.env,
    { mode: 'http' },
    {
      version: process.env.npm_package_version ?? '0.0.0',
      repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp',
    },
  );
  const container = await loaded.createContainer?.(config);
  if (!isContainer(container)) {
    throw new Error('createContainer(config) did not return { ctx, adapters }');
  }
  return container;
}

/** Runs the probe of every source on its first documentation line, one after another. */
async function probeAll(products: readonly Product[]): Promise<LiveResult[]> {
  const { ctx, adapters } = await loadContainer();
  const results: LiveResult[] = [];
  for (const product of products) {
    for (const source of product.sources) {
      const line =
        product.lines.find(
          (candidate) => candidate.current && (source.lines?.includes(candidate.id) ?? true),
        ) ?? product.lines.find((candidate) => source.lines?.includes(candidate.id) ?? true);
      const base = { product: product.id, source: source.id };
      if (line === undefined) {
        results.push({ ...base, ok: false, ms: 0, error: 'the source exists on no line' });
      } else if (source.capability !== undefined && !ctx.policy.enabled(source.capability)) {
        results.push({ ...base, ok: true, ms: 0, skipped: `capability ${source.capability} is off` });
      } else {
        try {
          const adapter = adapters.get(source.adapter);
          results.push({ ...base, ...(await adapter.probe(ctx, bindSource(product, source, line))) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ ...base, ok: false, ms: 0, error: message });
        }
      }
    }
  }
  return results;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args: readonly string[]): Promise<number> {
  // Loaded here rather than at the top: the lint functions above work on any data, and
  // importing them must not pull in the whole registry.
  const { createRegistry } = await import('../src/registry/index.js');
  const registry = createRegistry();
  const only = option(args, '--product');
  const products = registry.all().filter((product) => only === undefined || product.id === only);
  const issues = checkRegistry(
    { products: registry.all(), hosts: registry.hosts(), briefs: registry.briefs() },
    new Date(),
  ).filter((issue) => only === undefined || issue.product === only);
  const live = args.includes('--live') ? await probeAll(products) : [];
  const failed =
    issues.some((issue) => issue.severity === 'error') || live.some((result) => !result.ok);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ products: products.length, issues, live }, null, 2));
    return failed ? 1 : 0;
  }
  for (const issue of issues) {
    console.log(`${issue.severity.padEnd(7)} ${issue.rule.padEnd(6)} ${issue.product}: ${issue.message}`);
  }
  for (const result of live) {
    const state = result.skipped ?? (result.ok ? 'ok' : `FAILED ${result.error ?? ''}`.trim());
    console.log(`probe   ${result.product}/${result.source}: ${state} (${result.ms} ms)`);
  }
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  console.log(
    `${products.length} products, ${errors} errors, ${issues.length - errors} warnings` +
      (live.length > 0 ? `, ${live.filter((result) => !result.ok).length} failed probes` : ''),
  );
  return failed ? 1 : 0;
}

// Importing this module (the tests do) must not run the command.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
