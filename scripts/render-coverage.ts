/**
 * Renders `docs/assets/coverage-light.svg` and `docs/assets/coverage-dark.svg`: the developer
 * products of the registry per category, as bars with the product names written out.
 *
 * Counts and names come from the registry (`src/registry`), so the image changes when a
 * product is added. Names are shortened for the image by the rules in `shortName`; the full
 * names are in docs/products.md.
 *
 * Usage: `tsx scripts/render-coverage.ts`
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Product } from '../src/core/types.js';
import {
  ASSETS,
  countRegistry,
  ensureAssets,
  esc,
  registryProducts,
  type RegistryCounts,
} from './render-shared.js';

/** Category headings, as in docs/products.md. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  web: 'Web',
  native: 'Native',
  'game-engine': 'Game engines',
  python: 'Python, data science and R',
  'desktop-enterprise': 'Desktop and Enterprise',
  'rest-services': 'REST APIs, services, platform',
  ai: 'AI, agents and MCP',
  specs: 'Specifications and formats',
  'devops-oss': 'DevOps and open source',
  support: 'Support',
};

/** Shorter display names where the official name is long. */
const SHORT: Readonly<Record<string, string>> = {
  'experience-builder': 'Experience Builder',
  'python-api': 'ArcGIS API for Python',
  'r-arcgis': 'R-ArcGIS Bridge',
  'i3s-spec': 'I3S',
  'cim-spec': 'CIM',
  'arcgis-pbf': 'Feature service PBF',
  'knowledge-pbf': 'Knowledge PBF',
  lerc: 'LERC',
  'tile-package-spec': 'Tile package (TPKX)',
  '3d-tiles-esri-crs': '3D Tiles with Esri CRS',
  'projection-engine-db': 'Projection engine database',
  'ai-agents': 'AI, agents and MCP across ArcGIS',
  'enterprise-devops': 'Enterprise deployment automation',
  'developer-support': 'Developer support samples',
  'oss-libraries': 'Open-source libraries',
  'support-kb': 'Esri Support knowledge base',
  'velocity-grpc': 'Velocity gRPC feeds',
  'site-scan-api': 'Site Scan API',
  'location-platform': 'Location Platform',
};

export function shortName(product: Product): string {
  return (
    SHORT[product.id] ??
    product.name
      .replace(/^ArcGIS Maps SDK for /, 'Maps SDK for ')
      .replace(/^ArcGIS (?=[A-Z])/, '')
      .replace(/ with ArcGIS$/, '')
      .replace(/ specification$/, ' spec')
  );
}

/** Joins names with middle dots into lines of at most `width` characters, never splitting a name. */
export function wrapItems(names: string[], width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const name of names) {
    const next = current === '' ? name : `${current} · ${name}`;
    if (current !== '' && next.length > width) {
      lines.push(current);
      current = name;
    } else {
      current = next;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

export interface Row {
  category: string;
  label: string;
  names: string[];
}

export function rows(products: readonly Product[]): Row[] {
  const developer = products.filter(
    (p) => p.category !== 'product-help' && p.status !== 'retired' && p.status !== 'deprecated',
  );
  return Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({
      category,
      label,
      names: developer.filter((p) => p.category === category).map(shortName),
    }))
    .filter((row) => row.names.length > 0)
    .sort((a, b) => b.names.length - a.names.length);
}

interface Palette {
  surface: string;
  border: string;
  text: string;
  muted: string;
  grid: string;
  bar: string;
}

const LIGHT: Palette = {
  surface: '#ffffff',
  border: '#d0d7de',
  text: '#1f2328',
  muted: '#59636e',
  grid: '#eaeef2',
  bar: '#2a78d6',
};
const DARK: Palette = {
  surface: '#0d1117',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#9198a1',
  grid: '#21262d',
  bar: '#3987e5',
};

const WIDTH = 960;
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function renderCoverage(data: Row[], counts: RegistryCounts, palette: Palette): string {
  const labelX = 28;
  const barX = 262;
  const barMax = 170;
  const namesX = 486;
  const namesChars = 70;
  const max = Math.max(...data.map((row) => row.names.length));
  const top = 112;

  let y = top;
  const body = data.map((row) => {
    const lines = wrapItems(row.names, namesChars);
    const height = Math.max(34, lines.length * 17 + 15);
    const mid = y + 17;
    const width = Math.max(6, (row.names.length / max) * barMax);
    const parts = [
      `<line x1="${labelX}" x2="${WIDTH - labelX}" y1="${y}" y2="${y}" stroke="${palette.grid}"/>`,
      `<text x="${labelX}" y="${mid + 5}" font-size="14" font-weight="600" fill="${palette.text}">${esc(row.label)}</text>`,
      `<rect x="${barX}" y="${mid - 7}" width="${width.toFixed(1)}" height="14" rx="4" fill="${palette.bar}"/>`,
      `<text x="${(barX + width + 8).toFixed(1)}" y="${mid + 5}" font-size="14" font-weight="600" fill="${palette.text}">${row.names.length}</text>`,
      ...lines.map(
        (line, i) =>
          `<text x="${namesX}" y="${mid + 4 + i * 17}" font-size="12.5" fill="${palette.muted}">${esc(line)}</text>`,
      ),
    ];
    y += height;
    return parts.join('\n');
  });
  const height = y + 58;
  const subtitle = `${counts.developer} developer products in ${data.length} categories, plus ${counts.help} product-help entries and ${counts.legacy} retired or deprecated products: ${counts.entries} registry entries.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${esc(`Product coverage. ${subtitle} ${data.map((row) => `${row.label}: ${row.names.length} (${row.names.join(', ')})`).join('. ')}.`)}">
<title>arcgis-sdk-mcp product coverage</title>
<g font-family="${SANS}">
<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="${palette.surface}" stroke="${palette.border}"/>
<text x="${labelX}" y="46" font-size="22" font-weight="700" fill="${palette.text}">Developer products covered, by category</text>
<text x="${labelX}" y="74" font-size="13.5" fill="${palette.muted}">${esc(subtitle)}</text>
<text x="${barX}" y="${top - 10}" font-size="11.5" fill="${palette.muted}">PRODUCTS</text>
<text x="${namesX}" y="${top - 10}" font-size="11.5" fill="${palette.muted}">NAMES (SHORTENED)</text>
${body.join('\n')}
<line x1="${labelX}" x2="${WIDTH - labelX}" y1="${y}" y2="${y}" stroke="${palette.grid}"/>
<text x="${labelX}" y="${y + 32}" font-size="12" fill="${palette.muted}">Generated from the registry by scripts/render-coverage.ts. Unofficial project, not affiliated with Esri. Esri, ArcGIS and related names are trademarks of Esri.</text>
</g>
</svg>
`;
}

function main(): void {
  ensureAssets();
  const products = registryProducts();
  const data = rows(products);
  const counts = countRegistry(products);
  for (const [name, palette] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    const file = resolve(ASSETS, `coverage-${name}.svg`);
    writeFileSync(file, renderCoverage(data, counts, palette));
    console.log(`wrote ${file}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
