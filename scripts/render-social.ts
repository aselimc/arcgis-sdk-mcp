/**
 * Renders the 1280x640 social preview of the GitHub repository card:
 * `docs/assets/social-preview.svg`, rasterized to `docs/assets/social-preview.png` with a
 * headless Microsoft Edge or Chrome when one is installed.
 *
 * The numbers come from the source tree and the terminal lines from the recording that
 * `scripts/render-hero.ts` saved (`docs/assets/hero-terminal.txt`), so run that first.
 *
 * Usage: `tsx scripts/render-social.ts` (set BROWSER to a Chromium binary if none is found)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { facts, type Facts } from './render-architecture.js';
import { fromText } from './render-hero.js';
import { ASSETS, clip, ensureAssets, esc, screenshot } from './render-shared.js';

const W = 1280;
const H = 640;
const SANS = "'Segoe UI', -apple-system, Helvetica, Arial, sans-serif";
const MONO = "Consolas, ui-monospace, SFMono-Regular, Menlo, 'Liberation Mono', monospace";

/** The first recorded call, cut to the lines that fit the card. */
export function terminalLines(recording: string): { command: string; lines: string[] } {
  const scene = fromText(recording).scenes[0];
  if (scene === undefined) throw new Error('hero-terminal.txt has no recorded call');
  const keep = scene.lines.filter((line) =>
    /^(Documentation describes|- @arcgis\/core|- next:|- rc:|Next:)/.test(line),
  );
  return {
    command: clip(scene.command, 56),
    lines: keep.map((line) => clip(line.replace(/ \(https?:[^)]*\)$/, ''), 58)),
  };
}

export function renderSocial(f: Facts, recording: string): string {
  const term = terminalLines(recording);
  const stats: Array<[string, string]> = [
    [String(f.developer), 'developer products'],
    [String(f.tools), 'read-only MCP tools'],
    [String(f.adapters), 'source adapters'],
  ];
  const tx = 640;
  const ty = 300;
  const tw = 580;
  const lineH = 26;
  const th = 64 + (term.lines.length + 1) * lineH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0b1220"/>
    <stop offset="1" stop-color="#111a2e"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g font-family="${SANS}">
  <text x="80" y="104" font-size="20" font-weight="600" letter-spacing="2" fill="#7aa7ff">MCP SERVER · OPEN SOURCE · APACHE-2.0</text>
  <text x="78" y="186" font-size="76" font-weight="700" fill="#f0f6fc">arcgis-sdk-mcp</text>
  <text x="80" y="240" font-size="30" fill="#c9d1d9">ArcGIS developer documentation, on demand,</text>
  <text x="80" y="280" font-size="30" fill="#c9d1d9">for coding agents.</text>
  ${stats
    .map(
      ([value, label], i) =>
        `<text x="140" y="${372 + i * 70}" text-anchor="end" font-size="46" font-weight="700" fill="#f0f6fc">${esc(value)}</text>
  <text x="158" y="${370 + i * 70}" font-size="24" fill="#9fb0c8">${esc(label)}</text>`,
    )
    .join('\n  ')}
  <text x="80" y="${H - 44}" font-size="20" fill="#9fb0c8">Unofficial. Not affiliated with Esri.</text>
  <text x="${W - 80}" y="${H - 44}" font-size="20" text-anchor="end" fill="#9fb0c8">github.com/aselimc/arcgis-sdk-mcp</text>
</g>
<g>
  <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="12" fill="#0d1117" stroke="#30363d"/>
  <circle cx="${tx + 22}" cy="${ty + 20}" r="6" fill="#ff5f57"/><circle cx="${tx + 42}" cy="${ty + 20}" r="6" fill="#febc2e"/><circle cx="${tx + 62}" cy="${ty + 20}" r="6" fill="#28c840"/>
  <text x="${tx + tw - 18}" y="${ty + 25}" text-anchor="end" font-family="${SANS}" font-size="14" fill="#8b949e">real output, trimmed</text>
  <g font-family="${MONO}" font-size="16">
    <text x="${tx + 22}" y="${ty + 66}" fill="#f0f6fc"><tspan fill="#7ee787">$ </tspan>${esc(term.command)}</text>
    ${term.lines
      .map(
        (line, i) =>
          `<text x="${tx + 22}" y="${ty + 66 + (i + 1) * lineH}" fill="${line.startsWith('Next:') ? '#a5d6ff' : '#c9d1d9'}" xml:space="preserve">${esc(line)}</text>`,
      )
      .join('\n    ')}
  </g>
</g>
</svg>
`;
}

async function main(): Promise<void> {
  ensureAssets();
  const svg = resolve(ASSETS, 'social-preview.svg');
  const png = resolve(ASSETS, 'social-preview.png');
  writeFileSync(svg, renderSocial(await facts(), readFileSync(resolve(ASSETS, 'hero-terminal.txt'), 'utf8')));
  console.log(`wrote ${svg}`);
  if (screenshot(svg, png, W, H)) console.log(`wrote ${png}`);
  else console.log('No Chromium browser found: the PNG was not written (set BROWSER).');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
