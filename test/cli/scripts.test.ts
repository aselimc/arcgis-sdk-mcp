import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAGE_MARKERS,
  REQUIRED_FILES,
  SHEBANG,
  checkFileList,
  checkFileText,
  checkPackage,
} from '../../scripts/check-package-contents.js';
import {
  EXAMPLES,
  describeType,
  exampleProblems,
  renderToolsDoc,
  type JsonSchema,
  type ToolListing,
} from '../../scripts/gen-tools-doc.js';
import { fileNameFor, parseManifest, selectEntries } from '../../scripts/record-fixtures.js';
import { TOOLS, TOOL_ORDER } from '../../src/core/names.js';
import { ADAPTER_TYPES, HTML_FAMILIES } from '../../src/core/types.js';
import { createRegistry } from '../../src/registry/index.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

/** Every `.ts` file under a directory, as paths relative to the repository root. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replace(/\\/g, '/'));
}

describe('check-package-contents', () => {
  const good = [...REQUIRED_FILES, 'dist/core/url.js', 'dist/core/url.d.ts'];

  it('accepts the build output and the root documents', () => {
    expect(checkFileList(good)).toEqual([]);
  });

  it.each([
    'src/index.ts',
    'test/fixtures/synthetic/html/astro/page.html',
    'scripts/gen-briefs.ts',
    'briefs/ai/overview.md',
    'docs/tools.md',
    '.env',
    'CHANGELOG.md',
  ])('rejects %s outside dist', (path) => {
    expect(checkFileList([...good, path])).toEqual([
      { path, message: expect.stringContaining('not part of the published package') as string },
    ]);
  });

  it.each(['dist/core/url.js.map', 'dist/fixtures/page.html', 'dist/data.json'])(
    'rejects %s inside dist',
    (path) => {
      expect(checkFileList([...good, path])).toEqual([
        { path, message: 'only .js and .d.ts files belong in dist' },
      ]);
    },
  );

  it('reports each missing required file', () => {
    const problems = checkFileList(['package.json', 'dist/index.js']);
    expect(problems.map((problem) => problem.path)).toEqual(
      REQUIRED_FILES.filter((path) => path !== 'package.json' && path !== 'dist/index.js'),
    );
    expect(problems.every((problem) => problem.message === 'missing')).toBe(true);
  });

  it('requires the shebang on the binary only', () => {
    expect(checkFileText('dist/cli/main.js', `${SHEBANG}\nimport './run.js';\n`)).toEqual([]);
    expect(checkFileText('dist/cli/main.js', "import './run.js';\n")).toEqual([
      { path: 'dist/cli/main.js', message: expect.stringContaining(SHEBANG) as string },
    ]);
    expect(checkFileText('dist/cli/run.js', 'export {};\n')).toEqual([]);
  });

  it.each([
    ['Astro island element', '<astro-island uid="a1" component-url="/_astro/x.js">'],
    ['Astro scoped-style attribute', '<div data-astro-cid-j7pv25f6 class="page">'],
    ['Gatsby root element', '<div id="___gatsby"><div id="gatsby-focus-wrapper">'],
    ['Gatsby runtime global', 'window.___chunkMapping={"app":["/app.js"]};'],
    ['Gatsby page-data key', '{"componentChunkName": "component---src-templates-doc"}'],
    ['generator meta tag', '<meta name="generator" content="Example 5.14.1">'],
    ['Esri page footer', 'Copyright © 2026 Esri.'],
    ['rights statement', 'All rights reserved.'],
  ])('flags text carrying a %s', (name, text) => {
    const problems = checkFileText('dist/x.js', `const a = 1;\nconst page = \`${text}\`;\n`);
    expect(problems).toEqual([
      { path: 'dist/x.js', message: `line 2: contains a marker of fetched page content (${name})` },
    ]);
  });

  it('does not flag the selectors and names the extractor works with', () => {
    const code = [
      "$('astro-island').remove();",
      "if (html.includes('/_astro/')) return 'astro';",
      "const generator = $('meta[name=generator]').attr('content');",
      "const root = $('#___gatsby');",
      "return 'Copyright Esri. Licensed under the Apache License, Version 2.0.';",
      'const { componentChunkName } = result;',
    ].join('\n');
    expect(checkFileText('dist/extract/x.js', code)).toEqual([]);
  });

  it('finds no page marker in the source tree that becomes dist', () => {
    const flagged = sourceFiles('src').flatMap((path) =>
      checkFileText(path, readFileSync(join(ROOT, path), 'utf8')),
    );
    expect(flagged).toEqual([]);
  });

  it('reads the listed build files from disk', () => {
    // This test file stands in for a built file: it contains marker strings by design.
    const self = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/');
    const asBuilt = `dist/${self.replace(/\.ts$/, '.js')}`;
    expect(checkPackage(ROOT, ['README.md'])).toEqual(
      REQUIRED_FILES.filter((path) => path !== 'README.md').map((path) => ({
        path,
        message: 'missing',
      })),
    );
    expect(() => checkPackage(ROOT, [asBuilt])).toThrow(/ENOENT/);
    expect(PAGE_MARKERS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('fixtures manifest', () => {
  const manifest = parseManifest(
    readFileSync(join(ROOT, 'test', 'fixtures', 'fixtures.manifest.json'), 'utf8'),
  );
  const hosts = new Map(
    createRegistry()
      .hosts()
      .map((host) => [host.host, host]),
  );

  it('lists only https URLs on fetchable allow-listed hosts', () => {
    for (const entry of manifest.entries) {
      const host = hosts.get(new URL(entry.url).host);
      expect(host, `${entry.id}: ${entry.url}`).toBeDefined();
      expect(host?.capability, `${entry.id} is on a link-only host`).not.toBeNull();
    }
  });

  it('needs no opt-in capability', () => {
    const optIn = manifest.entries.filter((entry) =>
      ['site-search', 'lifecycle-api'].includes(
        hosts.get(new URL(entry.url).host)?.capability ?? '',
      ),
    );
    expect(optIn).toEqual([]);
  });

  it('covers every HTML family except the generic fallback', () => {
    const covered = new Set(manifest.entries.map((entry) => entry.family));
    expect(HTML_FAMILIES.filter((family) => !covered.has(family))).toEqual(['generic']);
  });

  it('covers every adapter that reads from the network', () => {
    const covered = new Set(manifest.entries.map((entry) => entry.adapter));
    // Briefs are bundled with the server: there is nothing to record.
    expect(ADAPTER_TYPES.filter((type) => !covered.has(type))).toEqual(['brief']);
  });

  it('gives every recording a distinct file name', () => {
    const names = manifest.entries.map(fileNameFor);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks binary bodies for base64 transfer', () => {
    const inventory = manifest.entries.find((entry) => entry.url.endsWith('objects.inv'));
    expect(inventory).toMatchObject({ expect: 'text', encoding: 'base64' });
  });
});

describe('record-fixtures helpers', () => {
  const entry = (overrides: Record<string, unknown>) =>
    parseManifest(
      JSON.stringify({
        schema: 1,
        about: 'test',
        entries: [
          {
            id: 'one',
            url: 'https://developers.arcgis.com/widgets/',
            expect: 'html',
            covers: 'a page for the test',
            ...overrides,
          },
        ],
      }),
    ).entries[0]!;

  it('derives the file extension from the expected shape', () => {
    expect(fileNameFor(entry({}))).toBe('one.html');
    expect(fileNameFor(entry({ expect: 'json' }))).toBe('one.json');
    expect(fileNameFor(entry({ expect: 'xml' }))).toBe('one.xml');
    expect(fileNameFor(entry({ expect: 'yaml', url: 'https://x.example/net.xrefmap.yml' }))).toBe(
      'one.yml',
    );
  });

  it('keeps the extension of text files', () => {
    const text = (url: string) => fileNameFor(entry({ expect: 'text', url }));
    expect(text('https://cdn.jsdelivr.net/npm/@arcgis/core@5.1.27/layers/FeatureLayer.d.ts')).toBe(
      'one.d.ts',
    );
    expect(text('https://developers.arcgis.com/java/reference/type-search-index.js')).toBe(
      'one.js',
    );
    expect(text('https://developers.arcgis.com/geoanalytics/api-reference/objects.inv')).toBe(
      'one.inv',
    );
    expect(text('https://raw.githubusercontent.com/Esri/x/main/README.md')).toBe('one.md');
    expect(text('https://raw.githubusercontent.com/Esri/x/main/LICENSE')).toBe('one.txt');
    expect(text('https://raw.githubusercontent.com/Esri/x/main/.gitignore')).toBe('one.txt');
  });

  it('rejects invalid manifests with the path of the problem', () => {
    expect(() => entry({ url: 'http://developers.arcgis.com/' })).toThrow(/entries\.0\.url/);
    expect(() => entry({ id: 'Not An Id' })).toThrow(/entries\.0\.id/);
    expect(() => entry({ family: 'wordpress' })).toThrow(/entries\.0\.family/);
    expect(() => entry({ surprise: true })).toThrow(/fixtures\.manifest\.json/);
    expect(() => parseManifest('{"schema":2,"about":"x","entries":[]}')).toThrow(/schema/);
  });

  it('rejects duplicate ids', () => {
    const one = { id: 'one', url: 'https://a.example/', expect: 'html', covers: 'first of two' };
    expect(() =>
      parseManifest(JSON.stringify({ schema: 1, about: 'x', entries: [one, one] })),
    ).toThrow(/duplicate id "one"/);
  });

  it('selects entries by id, in the order asked for', () => {
    const manifest = parseManifest(
      JSON.stringify({
        schema: 1,
        about: 'x',
        entries: ['a', 'b', 'c'].map((id) => ({
          id,
          url: `https://a.example/${id}`,
          expect: 'html',
          covers: 'one of three pages',
        })),
      }),
    );
    expect(selectEntries(manifest)).toHaveLength(3);
    expect(selectEntries(manifest, ['c', 'a']).map((e) => e.id)).toEqual(['c', 'a']);
    expect(() => selectEntries(manifest, ['z'])).toThrow(/No fixture with id "z"/);
  });
});

describe('gen-tools-doc', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 300, description: 'What to find.' },
      kind: { type: 'string', enum: ['guide', 'api'], description: 'One type | no more.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
      with_code: { type: 'boolean', default: false },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['query', 'limit'],
  };
  const listing = (name: string): ToolListing => ({
    name,
    title: `Title of ${name}`,
    description: `Describes ${name}.`,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        (EXAMPLES[name] ?? []).flatMap((example) => Object.keys(example)).map((key) => [key, {}]),
      ),
    },
  });

  it('accepts valid example arguments', () => {
    expect(exampleProblems(schema, { query: 'clustering', kind: 'api', limit: 5 })).toEqual([]);
    expect(exampleProblems(schema, { query: 'ab', with_code: true, tags: ['x'] })).toEqual([]);
  });

  it('reports unknown, missing, mistyped and out-of-range arguments', () => {
    expect(exampleProblems(schema, {})).toEqual(['missing required argument "query"']);
    expect(exampleProblems(schema, { query: 'ok', colour: 'red' })).toEqual([
      'unknown argument "colour"',
    ]);
    expect(exampleProblems(schema, { query: 7 })).toEqual(['"query" must be of type string']);
    expect(exampleProblems(schema, { query: 'ok', limit: 2.5 })).toEqual([
      '"limit" must be of type integer',
    ]);
    expect(exampleProblems(schema, { query: 'ok', kind: 'sample' })).toEqual([
      '"kind" must be one of ["guide","api"]',
    ]);
    expect(exampleProblems(schema, { query: 'x' })).toEqual([
      '"query" is outside the allowed range',
    ]);
    expect(exampleProblems(schema, { query: 'ok', limit: 21 })).toEqual([
      '"limit" is outside the allowed range',
    ]);
    expect(exampleProblems(schema, { query: 'ok', tags: 'x', with_code: 'yes' })).toHaveLength(2);
  });

  it('describes types in one phrase', () => {
    expect(describeType({ type: 'string' })).toBe('string');
    expect(describeType({ type: 'string', maxLength: 80 })).toBe('string (max 80 chars)');
    expect(describeType({ type: 'integer', minimum: 1, maximum: 20 })).toBe('integer 1..20');
    expect(describeType({ type: 'string', enum: ['a', 'b'] })).toBe('"a" \\| "b"');
    expect(describeType({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(describeType({ type: 'array' })).toBe('any[]');
    expect(describeType({ type: ['string', 'null'] })).toBe('string \\| null');
    expect(describeType({})).toBe('any');
  });

  it('has examples for every tool, naming products the registry knows', () => {
    const registry = createRegistry();
    expect(Object.keys(EXAMPLES)).toEqual([...TOOL_ORDER]);
    for (const tool of TOOL_ORDER) {
      expect(EXAMPLES[tool]?.length).toBeGreaterThan(0);
      for (const example of EXAMPLES[tool] ?? []) {
        if (typeof example.product === 'string') {
          expect(() => registry.resolve(example.product as string)).not.toThrow();
        }
      }
    }
  });

  it('renders every tool in registration order with arguments, examples and result', () => {
    const tools = [...TOOL_ORDER].reverse().map(listing);
    const search = tools.find((tool) => tool.name === TOOLS.search)!;
    search.inputSchema = { ...schema, properties: { ...schema.properties, product: {} } };
    search.outputSchema = {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        results: {
          type: 'array',
          items: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
        },
        nextCursor: { type: 'string' },
      },
      required: ['total', 'results'],
    };

    const text = renderToolsDoc(tools);
    const headings = [...text.matchAll(/^## (\S+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([...TOOL_ORDER]);
    expect(text).toContain('Generated by scripts/gen-tools-doc.ts');
    expect(text).toContain(`**Title of ${TOOLS.read}**`);
    expect(text).toContain('| `query` | string (max 300 chars) | yes |  | What to find. |');
    // A defaulted argument is optional for the caller, and a pipe in a description is escaped.
    expect(text).toContain('| `limit` | integer 1..20 | no | `8` |  |');
    expect(text).toContain('| `kind` | "guide" \\| "api" | no |  | One type \\| no more. |');
    expect(text).toContain('{"query":"cluster points with popups","product":"js-maps-sdk"}');
    expect(text).toContain('- `total`: integer\n- `results`: object[]\n  - `ref`: string');
    expect(text).toContain('- `nextCursor`: string (optional)');
    expect(text).toContain('Markdown text only (no `structuredContent`).');
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('rejects an example that names an argument the schema lacks', () => {
    const tools = TOOL_ORDER.map(listing);
    const versions = tools.find((tool) => tool.name === TOOLS.getVersions)!;
    versions.inputSchema = { type: 'object' };
    expect(() => renderToolsDoc(tools)).toThrow(/unknown argument "product"/);
  });

  it('refuses to write a document when a tool is missing or an example is invalid', () => {
    expect(() => renderToolsDoc(TOOL_ORDER.slice(1).map(listing))).toThrow(
      `The server does not register ${TOOLS.listProducts}`,
    );
    const tools = TOOL_ORDER.map(listing);
    tools[2]!.inputSchema = { type: 'object', properties: { q: {} }, required: ['q'] };
    expect(() => renderToolsDoc(tools)).toThrow(
      /Example .* of arcgis_docs_search: missing required/,
    );
  });
});
