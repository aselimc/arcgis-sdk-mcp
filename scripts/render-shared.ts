/**
 * Helpers shared by the `scripts/render-*.ts` generators of the images under `docs/assets/`:
 * running the built CLI, reading the registry, escaping text for SVG and rasterizing an
 * SVG with a headless browser.
 *
 * Every number or line of output an image shows comes from the registry or from a real run
 * of `node dist/cli/main.js call ...`; nothing is typed in by hand.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Product } from '../src/core/types.js';
import { createRegistry } from '../src/registry/index.js';

export const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
export const ASSETS = resolve(ROOT, 'docs', 'assets');
export const CLI = resolve(ROOT, 'dist', 'cli', 'main.js');

/** Creates `docs/assets/` when it does not exist yet. */
export function ensureAssets(): void {
  mkdirSync(ASSETS, { recursive: true });
}

/** Runs one tool through the built CLI and returns the text an agent would receive. */
export function runCli(tool: string, args: Record<string, unknown>): string {
  if (!existsSync(CLI)) throw new Error('dist/cli/main.js is missing: run "npm run build" first');
  return execFileSync(process.execPath, [CLI, 'call', tool, JSON.stringify(args)], {
    encoding: 'utf8',
    // An empty directory: no project manifests steer the answers.
    cwd: ASSETS,
    env: process.env,
    timeout: 60_000,
  });
}

/** Every registry entry, read from the source (no build needed). */
export function registryProducts(): readonly Product[] {
  return createRegistry().all();
}

/** Counts used by several images, all derived from the registry. */
export interface RegistryCounts {
  entries: number;
  developer: number;
  legacy: number;
  help: number;
  adapters: number;
  sources: number;
}

export function countRegistry(products: readonly Product[]): RegistryCounts {
  const isLegacy = (p: Product): boolean => p.status === 'retired' || p.status === 'deprecated';
  const developer = products.filter((p) => p.category !== 'product-help' && !isLegacy(p));
  return {
    entries: products.length,
    developer: developer.length,
    legacy: products.filter((p) => p.category !== 'product-help' && isLegacy(p)).length,
    help: products.filter((p) => p.category === 'product-help').length,
    adapters: new Set(products.flatMap((p) => p.sources.map((s) => s.adapter))).size,
    sources: developer.reduce((sum, p) => sum + p.sources.length, 0),
  };
}

/** Escapes text for SVG character data and attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cuts a line to `max` characters, marking the cut. */
export function clip(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}

/** Splits text into lines of at most `width` characters at spaces. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current !== '' && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current === '' ? word : `${current} ${word}`;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Microsoft Edge or Chrome, if one is installed in a usual place. */
export function findBrowser(): string | undefined {
  const candidates = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find((path): path is string => path !== undefined && existsSync(path));
}

/**
 * Rasterizes an SVG (or HTML) file to PNG with a headless Chromium browser. Returns false
 * when no browser was found, so the caller can keep the SVG and say so.
 */
export function screenshot(input: string, output: string, width: number, height: number): boolean {
  const browser = findBrowser();
  if (browser === undefined) return false;
  execFileSync(
    browser,
    [
      '--headless=new',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${output}`,
      pathToFileURL(input).href,
    ],
    { stdio: 'ignore', timeout: 60_000 },
  );
  return existsSync(output);
}
