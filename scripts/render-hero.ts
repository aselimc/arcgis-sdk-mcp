/**
 * Renders `docs/assets/hero-terminal.svg`, the animated terminal at the top of the README,
 * from three real tool calls of the built CLI.
 *
 * The calls are run live (or answered from your local cache), trimmed with the same rules as
 * the examples (Esri's documentation prose becomes `[...]`), and saved to
 * `docs/assets/hero-terminal.txt`, so the recording can be reviewed as text and re-rendered
 * without the network. The SVG animates with SMIL, which GitHub renders in an `<img>`.
 *
 * Usage:
 *   npm run build && tsx scripts/render-hero.ts            run the calls, write .txt and .svg
 *   tsx scripts/render-hero.ts --offline                   re-render the .svg from the .txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trim } from '../examples/shared/trim.js';
import { ASSETS, clip, ensureAssets, esc, runCli } from './render-shared.js';

/** The calls the hero shows: three products, three tools. */
export const HERO_CALLS: ReadonlyArray<{
  tool: string;
  args: Record<string, unknown>;
  maxLines: number;
}> = [
  { tool: 'get_versions', args: { product: 'js-maps-sdk' }, maxLines: 11 },
  {
    tool: 'lookup_symbol',
    args: { symbol: 'arcpy.da.SearchCursor', detail: 'signature' },
    maxLines: 11,
  },
  {
    tool: 'find_samples',
    args: { query: 'download offline map', product: 'swift-maps-sdk', limit: 2 },
    maxLines: 8,
  },
];

const TXT = resolve(ASSETS, 'hero-terminal.txt');
const SVG = resolve(ASSETS, 'hero-terminal.svg');

const WIDTH = 960;
const MAX_CHARS = 110;
const LINE = 19;
const PAD = 22;
const TITLE = 36;

/** One recorded call: the command line and the trimmed output lines. */
export interface Scene {
  command: string;
  lines: string[];
}

/** Shortens one tool result for the hero: prose elided, blank runs collapsed, lines clipped. */
export function heroLines(text: string, maxLines: number): string[] {
  const out: string[] = [];
  for (const raw of trim(text, maxLines, 400).split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) continue;
    if (line === '' && (out.length === 0 || out.at(-1) === '')) continue;
    // One elision marker is enough, even across a blank line.
    if (line.trim() === '[...]' && out.filter((l) => l !== '').at(-1)?.trim() === '[...]') continue;
    // A long signature is wrapped at its commas rather than cut.
    if (line.length > MAX_CHARS && /^[A-Za-z_.]+\(/.test(line)) {
      let current = '';
      for (const part of line.split(/(?<=,) /)) {
        if (current !== '' && current.length + part.length + 1 > MAX_CHARS) {
          out.push(current);
          current = `    ${part}`;
        } else {
          current = current === '' ? part : `${current} ${part}`;
        }
      }
      out.push(current);
      continue;
    }
    out.push(clip(line, MAX_CHARS));
  }
  while (out.at(-1) === '') out.pop();
  return out;
}

export function record(): Scene[] {
  return HERO_CALLS.map(({ tool, args, maxLines }) => ({
    command: `node dist/cli/main.js call ${tool} '${JSON.stringify(args)}'`,
    lines: heroLines(runCli(tool, args), maxLines),
  }));
}

export function toText(scenes: Scene[], date: string): string {
  const header = [
    `# Real output of the built CLI, recorded ${date} by scripts/render-hero.ts.`,
    "# Trimmed: Esri's documentation prose is replaced by [...]; long lines are cut.",
  ];
  const body = scenes.flatMap((scene) => ['', `$ ${scene.command}`, ...scene.lines]);
  return `${[...header, ...body].join('\n')}\n`;
}

export function fromText(text: string): { scenes: Scene[]; date: string } {
  const date = /recorded (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? '';
  const scenes: Scene[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) continue;
    if (line.startsWith('$ ')) scenes.push({ command: line.slice(2), lines: [] });
    else if (scenes.length > 0) scenes.at(-1)?.lines.push(line);
  }
  for (const scene of scenes) while (scene.lines.at(-1) === '') scene.lines.pop();
  return { scenes, date };
}

/** The colour class of one output line. */
function lineClass(line: string, index: number): string {
  if (index === 0) return 'st';
  const t = line.trim();
  if (t === '[...]') return 'el';
  if (t.startsWith('Note:')) return 'nt';
  if (t.startsWith('Next:')) return 'nx';
  if (t.startsWith('Source:')) return 'sr';
  if (t.startsWith('#')) return 'hd';
  if (/^(https?:\/\/|File:)/.test(t)) return 'ur';
  if (/^[A-Za-z_.]+\(|^ {4}\{/.test(line)) return 'cd';
  if (/^\d+\. /.test(t)) return 'hd';
  return 'tx';
}

const fmt = (n: number): string => Number(n.toFixed(4)).toString();

export function renderSvg(scenes: Scene[], date: string): string {
  const rows = Math.max(...scenes.map((scene) => scene.lines.length)) + 2;
  const height = TITLE + PAD + rows * LINE + PAD - 4;
  const typeChar = 0.032;
  const timings = scenes.map((scene) => {
    const typing = Math.min(2.2, scene.command.length * typeChar);
    const printing = 0.6 + scene.lines.length * 0.07;
    return { typing, printing, total: typing + printing + 5.2 };
  });
  const cycle = timings.reduce((sum, t) => sum + t.total, 0);
  const charWidth = 7.8;

  let offset = 0;
  const groups = scenes.map((scene, s) => {
    const t = timings[s] ?? { typing: 1, printing: 1, total: 6 };
    const start = offset;
    const end = offset + t.total;
    offset = end;
    const k = (seconds: number): string => fmt(Math.min(1, Math.max(0, seconds / cycle)));
    // Visible only during its own window of the cycle.
    const show =
      start === 0
        ? `<animate attributeName="opacity" calcMode="discrete" values="1;0" keyTimes="0;${k(end)}" dur="${fmt(cycle)}s" repeatCount="indefinite"/>`
        : `<animate attributeName="opacity" calcMode="discrete" values="0;1;0" keyTimes="0;${k(start)};${k(end)}" dur="${fmt(cycle)}s" repeatCount="indefinite"/>`;

    // The command is typed: a clip rectangle widens one character at a time.
    const full = (scene.command.length + 2) * charWidth + 4;
    const steps = Math.max(1, Math.round(t.typing / typeChar));
    const widths: string[] = ['0'];
    const keys: string[] = ['0'];
    for (let i = 0; i <= steps; i++) {
      const typed = 2 + (i / steps) * scene.command.length;
      widths.push(fmt((typed / (scene.command.length + 2)) * full));
      keys.push(k(start + 0.25 + (i / steps) * t.typing));
    }
    widths.push(fmt(full), '0');
    keys.push(k(end - 0.001), k(end));
    // keyTimes must be strictly increasing for SMIL: drop repeats.
    const pairs = keys.map((key, i) => [key, widths[i] ?? '0'] as const);
    const unique = pairs.filter((pair, i) => i === 0 || pair[0] !== pairs[i - 1]?.[0]);
    const clipAnim = `<animate attributeName="width" calcMode="discrete" values="${unique.map((p) => p[1]).join(';')}" keyTimes="${unique.map((p) => p[0]).join(';')}" dur="${fmt(cycle)}s" repeatCount="indefinite"/>`;

    const y0 = TITLE + PAD + 12;
    const command = `<g clip-path="url(#type${s})"><text x="${PAD}" y="${y0}" class="cm"><tspan class="pr">$ </tspan>${esc(scene.command)}</text></g>`;
    const lines = scene.lines.map((line, i) => {
      const appear = start + 0.25 + t.typing + 0.35 + i * 0.07;
      const anim =
        start === 0
          ? `<animate attributeName="opacity" calcMode="discrete" values="0;1" keyTimes="0;${k(appear)}" dur="${fmt(cycle)}s" repeatCount="indefinite"/>`
          : `<animate attributeName="opacity" calcMode="discrete" values="0;1;0" keyTimes="0;${k(appear)};${k(end)}" dur="${fmt(cycle)}s" repeatCount="indefinite"/>`;
      const y = y0 + (i + 1.4) * LINE;
      return `<text x="${PAD}" y="${fmt(y)}" class="${lineClass(line, i)}" xml:space="preserve">${esc(line)}${anim}</text>`;
    });
    return [
      `<clipPath id="type${s}"><rect x="0" y="${y0 - LINE}" height="${LINE * 1.6}" width="${s === 0 ? fmt(full) : '0'}">${clipAnim}</rect></clipPath>`,
      `<g opacity="${s === 0 ? 1 : 0}">${show}`,
      command,
      ...lines,
      '</g>',
    ].join('\n');
  });

  const title = `arcgis-sdk-mcp · real CLI output, trimmed · recorded ${date}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Terminal recording: three arcgis-sdk-mcp tool calls (get_versions for the ArcGIS Maps SDK for JavaScript, lookup_symbol for arcpy.da.SearchCursor, find_samples for the Swift Maps SDK) with their trimmed real output.">
<title>arcgis-sdk-mcp: three real tool calls</title>
<style>
  text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 13px; fill: #c9d1d9; }
  .cm { fill: #f0f6fc; }
  .pr { fill: #7ee787; font-weight: 600; }
  .st { fill: #79c0ff; }
  .nt { fill: #d29922; }
  .nx { fill: #a5d6ff; }
  .sr { fill: #8b949e; }
  .el { fill: #6e7681; }
  .hd { fill: #f0f6fc; font-weight: 600; }
  .ur { fill: #8b949e; }
  .cd { fill: #ffa657; }
  .tt { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12.5px; fill: #8b949e; }
</style>
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="#0d1117" stroke="#30363d"/>
<path d="M0.5 ${TITLE} H${WIDTH - 0.5}" stroke="#30363d"/>
<circle cx="20" cy="${TITLE / 2}" r="6" fill="#ff5f57"/><circle cx="40" cy="${TITLE / 2}" r="6" fill="#febc2e"/><circle cx="60" cy="${TITLE / 2}" r="6" fill="#28c840"/>
<text x="${WIDTH / 2}" y="${TITLE / 2 + 4}" text-anchor="middle" class="tt">${esc(title)}</text>
${groups.join('\n')}
</svg>
`;
}

function main(): void {
  ensureAssets();
  let scenes: Scene[];
  let date: string;
  if (process.argv.includes('--offline')) {
    ({ scenes, date } = fromText(readFileSync(TXT, 'utf8')));
  } else {
    scenes = record();
    date = new Date().toISOString().slice(0, 10);
    writeFileSync(TXT, toText(scenes, date));
    console.log(`wrote ${TXT}`);
  }
  writeFileSync(SVG, renderSvg(scenes, date));
  console.log(`wrote ${SVG}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
