import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import type { BoundSource } from '../../../../src/core/ports.js';
import type {
  AdapterConfigMap,
  Product,
  SourceDef,
  VersionLine,
} from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { FakeGithub, type FakeRepo } from '../../../support/fake-github.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import { fixturePath } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';

/** Configuration of a `github-repo` source. */
export type GithubConfig = AdapterConfigMap['github-repo'];

/**
 * The files of a synthetic repository under `test/fixtures/cassettes/reference/github/<name>`,
 * by repository path, with line endings normalised.
 */
export function repoFiles(name: string): Record<string, string> {
  const root = fixturePath('cassettes', 'reference', 'github', name);
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else files[path] = readFileSync(join(dir, entry.name), 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk(root, '');
  return files;
}

/** The pages of the fixture wiki by wiki path, without `.md`. */
export function wikiPages(name = 'wiki'): Record<string, string> {
  return Object.fromEntries(
    Object.entries(repoFiles(name)).map(([path, text]) => [path.replace(/\.md$/, ''), text]),
  );
}

/** A product with one `github-repo` source (id `samples`) and lines `latest` and `v200`. */
export function githubProduct(
  config: GithubConfig,
  overrides: Partial<Omit<SourceDef<'github-repo'>, 'adapter' | 'config'>> = {},
  product: Partial<Product> = {},
): { product: Product; source: SourceDef<'github-repo'> } {
  const source = makeSource('github-repo', config, {
    id: 'samples',
    title: 'Samples (GitHub)',
    kinds: ['sample'],
    capability: 'github',
    license: 'apache-2.0',
    floor: false,
    probe: { url: `https://api.github.com/repos/${config.repo}`, expect: 'json' },
    ...overrides,
  });
  return {
    source,
    product: makeProduct({
      languages: ['swift'],
      lines: [
        makeLine({ label: '300.x' }),
        makeLine({ id: 'v200', label: '200.x LTS', current: false }),
      ],
      repos: [{ repo: config.repo, role: 'samples', license: 'apache-2.0', defaultBranch: 'main' }],
      sources: [source],
      ...product,
    }),
  };
}

/** Options of {@link bound}. */
export interface BindOptions {
  version?: string;
  line?: VersionLine;
  /** Upstream requests the source may issue; no budget when omitted. */
  maxRequests?: number;
}

/** Binds the product's source to its current line (or `options.line`). */
export function bound(
  ctx: TestCtx,
  product: Product,
  source: SourceDef<'github-repo'>,
  options: BindOptions = {},
): BoundSource<'github-repo'> {
  const line = options.line ?? product.lines.find((candidate) => candidate.current);
  if (line === undefined) throw new Error('the test product has no current line');
  const budget =
    options.maxRequests === undefined
      ? undefined
      : newBudget(options.maxRequests, 60_000, ctx.clock);
  return bindSource(product, source, line, options.version, budget);
}

/** A test context whose renderer is known to be the recording fake. */
export interface GithubTestCtx extends TestCtx {
  render: FakeRenderer;
}

/** A context whose GitHub fake knows the given repositories. */
export function githubCtx(repos: Record<string, FakeRepo>): GithubTestCtx {
  const clock = new FakeClock();
  const render = new FakeRenderer();
  return { ...makeCtx({ clock, github: new FakeGithub(repos, clock), render }), render };
}

/** The version line of a test product with the given id. */
export function lineOf(product: Product, id: string): VersionLine {
  const line = product.lines.find((candidate) => candidate.id === id);
  if (line === undefined) throw new Error(`the test product has no line "${id}"`);
  return line;
}
