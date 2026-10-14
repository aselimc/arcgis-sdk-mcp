/**
 * Renders `docs/assets/architecture-light.svg` and `docs/assets/architecture-dark.svg`: the
 * layers a tool call passes through, from the MCP host to the documentation hosts.
 *
 * The counts in the boxes (tools, registry entries, adapters, HTML page families) are read
 * from the source, so the diagram follows the code. docs/architecture.md has the details.
 *
 * Usage: `tsx scripts/render-architecture.ts`
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOL_ORDER } from '../src/core/names.js';
import { PROFILES } from '../src/extract/families/registry.js';
import {
  ASSETS,
  ROOT,
  countRegistry,
  ensureAssets,
  esc,
  registryProducts,
  type RegistryCounts,
} from './render-shared.js';

interface Palette {
  surface: string;
  border: string;
  box: string;
  boxBorder: string;
  accent: string;
  text: string;
  muted: string;
  arrow: string;
}

const LIGHT: Palette = {
  surface: '#ffffff',
  border: '#d0d7de',
  box: '#f6f8fa',
  boxBorder: '#d0d7de',
  accent: '#2a78d6',
  text: '#1f2328',
  muted: '#59636e',
  arrow: '#8c959f',
};
const DARK: Palette = {
  surface: '#0d1117',
  border: '#30363d',
  box: '#161b22',
  boxBorder: '#30363d',
  accent: '#3987e5',
  text: '#e6edf3',
  muted: '#9198a1',
  arrow: '#6e7681',
};

const WIDTH = 960;
const M = 28;
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Counts shown in the diagram, all read from the source tree. */
export interface Facts extends RegistryCounts {
  tools: number;
  prompts: number;
  resources: number;
  families: number;
}

function countTs(dir: string, exclude: string[] = []): number {
  return readdirSync(resolve(ROOT, dir)).filter(
    (name) => name.endsWith('.ts') && !exclude.includes(name),
  ).length;
}

export function facts(): Facts {
  return {
    ...countRegistry(registryProducts()),
    tools: TOOL_ORDER.length,
    // One file per prompt and per resource; message.ts holds shared prompt helpers.
    prompts: countTs('src/mcp/prompts', ['message.ts']),
    resources: countTs('src/mcp/resources'),
    families: Object.keys(PROFILES).length,
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  accent?: boolean;
  dashed?: boolean;
}

function box(b: Box, p: Palette): string {
  const stroke = b.accent === true ? p.accent : p.boxBorder;
  const dash = b.dashed === true ? ' stroke-dasharray="5 4"' : '';
  return [
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="${p.box}" stroke="${stroke}" stroke-width="${b.accent === true ? 1.6 : 1}"${dash}/>`,
    `<text x="${b.x + 14}" y="${b.y + 23}" font-size="14" font-weight="600" fill="${p.text}">${esc(b.title)}</text>`,
    ...b.lines.map(
      (line, i) =>
        `<text x="${b.x + 14}" y="${b.y + 43 + i * 17}" font-size="12.5" fill="${p.muted}">${esc(line)}</text>`,
    ),
  ].join('\n');
}

function arrow(x1: number, y1: number, x2: number, y2: number, p: Palette, label?: string): string {
  const line = `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${p.arrow}" stroke-width="1.4" fill="none" marker-end="url(#head)"/>`;
  if (label === undefined) return line;
  return `${line}\n<text x="${x1 + 10}" y="${(y1 + y2) / 2 + 4}" font-size="12" fill="${p.muted}">${esc(label)}</text>`;
}

export function renderArchitecture(f: Facts, p: Palette): string {
  const full = WIDTH - 2 * M;
  const gap = 16;
  const quarter = (full - 3 * gap) / 4;
  const col = (i: number): number => M + i * (quarter + gap);

  const host: Box = {
    x: M,
    y: 70,
    w: full,
    h: 58,
    title: 'MCP host',
    lines: [
      'Claude Code, Claude Desktop, Cursor, VS Code, or any MCP client; it starts the server itself',
    ],
  };
  const surface: Box = {
    x: M,
    y: 166,
    w: full,
    h: 58,
    title: 'MCP surface (src/mcp)',
    lines: [
      `${f.tools} read-only tools · ${f.prompts} prompts · ${f.resources} resources · instructions that tell the agent the order of calls`,
    ],
    accent: true,
  };
  const services: Box = {
    x: M,
    y: 250,
    w: full,
    h: 58,
    title: 'Services (src/services, src/versions, src/workspace)',
    lines: [
      'catalog · search · read · symbol lookup · samples · versions · project detection; token budgets',
    ],
  };
  const row = 346;
  const rowH = 110;
  const registry: Box = {
    x: col(0),
    y: row,
    w: quarter,
    h: rowH,
    title: 'Registry',
    lines: [
      `${f.entries} entries as typed data:`,
      `${f.developer} developer products,`,
      'ids, URLs and patterns only',
    ],
  };
  const indexes: Box = {
    x: col(1),
    y: row,
    w: quarter,
    h: rowH,
    title: 'Local indexes',
    lines: [
      'one per product source,',
      'built on first use from the',
      "site's own index or sitemap",
    ],
  };
  const adapters: Box = {
    x: col(2),
    y: row,
    w: quarter,
    h: rowH,
    title: `${f.adapters} source adapters`,
    lines: [
      'Astro, Gatsby, DocFX, DocC,',
      'Dokka, dartdoc, Sphinx, OpenAPI,',
      'npm typings, GitHub, ...',
    ],
  };
  const renderers: Box = {
    x: col(3),
    y: row,
    w: quarter,
    h: rowH,
    title: 'Renderers',
    lines: [
      `HTML pipeline (${f.families} page`,
      'families) and structured',
      'formats, to compact Markdown',
    ],
  };
  const gateway: Box = {
    x: M,
    y: 494,
    w: full,
    h: 58,
    title: 'HTTP gateway (src/net): the only code that calls fetch',
    lines: [
      'host allow-list · capability policy · robots.txt · per-user disk cache · per-host rate limit · retries · circuit breaker',
    ],
  };
  const upstream: Box = {
    x: M,
    y: 590,
    w: full,
    h: 58,
    title: 'Public sources, fetched only when a tool is called',
    lines: [
      "Esri's documentation sites · GitHub · npm, PyPI, NuGet, pub.dev · jsDelivr · nothing at start-up, no crawling, no telemetry",
    ],
    dashed: true,
  };
  const height = upstream.y + upstream.h + 52;
  const mid = (b: Box): number => b.x + b.w / 2;

  const body = [
    box(host, p),
    arrow(
      WIDTH / 2,
      host.y + host.h,
      WIDTH / 2,
      surface.y - 4,
      p,
      'MCP over stdio, or stateless HTTP',
    ),
    box(surface, p),
    arrow(WIDTH / 2, surface.y + surface.h, WIDTH / 2, services.y - 4, p),
    box(services, p),
    arrow(mid(registry), services.y + services.h, mid(registry), row - 4, p),
    arrow(mid(indexes), services.y + services.h, mid(indexes), row - 4, p),
    arrow(mid(adapters), services.y + services.h, mid(adapters), row - 4, p),
    box(registry, p),
    box(indexes, p),
    box(adapters, p),
    box(renderers, p),
    arrow(adapters.x + adapters.w, row + rowH / 2, renderers.x - 4, row + rowH / 2, p),
    arrow(mid(adapters), row + rowH, mid(adapters), gateway.y - 4, p),
    box(gateway, p),
    arrow(
      WIDTH / 2,
      gateway.y + gateway.h,
      WIDTH / 2,
      upstream.y - 4,
      p,
      'HTTPS, identified User-Agent',
    ),
    box(upstream, p),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(`Architecture of arcgis-sdk-mcp: an MCP host calls the MCP surface (${f.tools} tools), which calls the services; they use the registry (${f.entries} entries), local indexes and ${f.adapters} source adapters with renderers; every request goes through one HTTP gateway to public documentation sources, only when a tool is called.`)}">
<title>arcgis-sdk-mcp architecture</title>
<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${p.arrow}"/></marker></defs>
<g font-family="${SANS}">
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${p.surface}" stroke="${p.border}"/>
<text x="${M}" y="46" font-size="22" font-weight="700" fill="${p.text}">How a tool call is answered</text>
${body.join('\n')}
<text x="${M}" y="${height - 20}" font-size="12" fill="${p.muted}">Generated by scripts/render-architecture.ts from the source tree. Details: docs/architecture.md.</text>
</g>
</svg>
`;
}

function main(): void {
  ensureAssets();
  const f = facts();
  for (const [name, palette] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    const file = resolve(ASSETS, `architecture-${name}.svg`);
    writeFileSync(file, renderArchitecture(f, palette));
    console.log(`wrote ${file}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
