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
