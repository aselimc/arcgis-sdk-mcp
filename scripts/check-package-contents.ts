/**
 * Release gate, run by `prepack`: fails when the npm tarball would contain anything other
 * than the build output and the three root documents, or when a built file carries text
 * that only a fetched Esri page would contain. The project ships no Esri-authored content
 * (docs/adr/0003-no-shipped-esri-content.md); this script is what keeps that true.
 *
 * Usage: `tsx scripts/check-package-contents.ts`
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Root files a tarball may hold besides `dist/`. npm always adds `package.json`. */
export const ALLOWED_ROOT_FILES: readonly string[] = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
];

/** Files the package cannot work without. */
export const REQUIRED_FILES: readonly string[] = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cli/main.js',
];

/** The binary must start with this line, or `npx arcgis-sdk-mcp` does not run on POSIX. */
export const SHEBANG = '#!/usr/bin/env node';

/**
 * Strings that occur in pages served by Esri's documentation sites and have no reason to
 * occur in this project's compiled code: framework hydration markup, page-data keys and
 * page footers. Selectors the extractor uses (`astro-island`, `main#main`) are deliberately
 * not on the list; these are the forms only real markup has.
 */
export const PAGE_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Astro island element', pattern: /<astro-island[\s>]/ },
  { name: 'Astro scoped-style attribute', pattern: /data-astro-cid-[a-z0-9]{6,}/ },
  { name: 'Gatsby root element', pattern: /id="___gatsby"/ },
  {
    name: 'Gatsby runtime global',
    pattern: /window\.___(?:gatsby|chunkMapping|webpackCompilationHash)/,
  },
  { name: 'Gatsby page-data key', pattern: /"componentChunkName"\s*:/ },
  { name: 'generator meta tag', pattern: /<meta\s+name="generator"\s+content="/i },
  { name: 'Esri page footer', pattern: /Copyright\s*(?:©|&copy;|\(c\))\s*\d{4}\s+Esri/i },
  { name: 'rights statement', pattern: /All rights reserved/i },
];

/** One reason the tarball is not publishable. */
export interface Problem {
  path: string;
  message: string;
}

const isBuildOutput = (path: string): boolean => /^dist\/.+\.(?:js|d\.ts)$/.test(path);

/**
 * Checks the list of packed paths (forward slashes, relative to the package root).
 *
 * Allowed: the root documents and JavaScript or declaration files under `dist/`. Anything
 * else (sources, tests, fixtures, source maps, data files) is a problem, as is a missing
 * required file.
 */
export function checkFileList(paths: readonly string[]): Problem[] {
  const problems: Problem[] = [];
  for (const path of paths) {
    if (ALLOWED_ROOT_FILES.includes(path) || isBuildOutput(path)) continue;
    problems.push({
      path,
      message: path.startsWith('dist/')
        ? 'only .js and .d.ts files belong in dist'
        : 'not part of the published package (allowed: dist, README.md, LICENSE, NOTICE)',
    });
  }
  for (const required of REQUIRED_FILES) {
    if (!paths.includes(required)) problems.push({ path: required, message: 'missing' });
  }
  return problems;
}

/** Checks the text of one built file for page markers and, for the binary, the shebang. */
export function checkFileText(path: string, text: string): Problem[] {
  const problems: Problem[] = [];
  if (path === 'dist/cli/main.js' && !text.startsWith(SHEBANG)) {
    problems.push({ path, message: `the binary must start with "${SHEBANG}"` });
  }
  for (const marker of PAGE_MARKERS) {
    const match = marker.pattern.exec(text);
    if (match === null) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push({
      path,
      message: `line ${line}: contains a marker of fetched page content (${marker.name})`,
    });
  }
  return problems;
}

/**
 * The paths `npm pack` would put into the tarball.
 *
 * `--ignore-scripts` matters: this script runs from `prepack`, and a nested pack that ran
 * `prepack` again would never finish.
 */
export function packedPaths(root: string): string[] {
  const output = execSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const parsed = JSON.parse(output) as Array<{ files?: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map((file) => file.path.replace(/\\/g, '/'));
}

/** Runs both checks against the package at `root`. */
export function checkPackage(
  root: string,
  paths: readonly string[] = packedPaths(root),
): Problem[] {
  const problems = checkFileList(paths);
  for (const path of paths) {
    if (!isBuildOutput(path)) continue;
    problems.push(...checkFileText(path, readFileSync(resolve(root, path), 'utf8')));
  }
  return problems;
}

function main(): void {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..');
  const paths = packedPaths(root);
  const problems = checkPackage(root, paths);
  if (problems.length === 0) {
    console.log(`package contents ok: ${paths.length} files`);
    return;
  }
  console.error(`package contents check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem.path}: ${problem.message}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
