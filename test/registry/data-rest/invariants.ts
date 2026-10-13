import { expandTemplate, sourceBaseUrls } from '../../../src/core/source-urls.js';
import type { AnySourceDef, Product } from '../../../src/core/types.js';
import { GITHUB_OWNERS, HOSTS } from '../../../src/registry/hosts.js';

/**
 * The registry invariants of design section 4 (INV-1 to INV-5), as far as they can be
 * checked on a subset of the products. Each function returns the violations it found, as
 * readable strings, so a failing test names the product and the rule.
 */

/** Adapters a floor source may use (INV-1): the ones that work from a page or a file list alone. */
const FLOOR_ADAPTERS = new Set([
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

const HOST_ROWS = new Map(HOSTS.map((host) => [host.host, host]));
const OWNERS = new Set<string>(GITHUB_OWNERS);

/** INV-1: every product with sources has exactly one floor source of an allowed kind. */
export function floorViolations(products: readonly Product[]): string[] {
  const found: string[] = [];
  for (const product of products) {
    const floors = product.sources.filter((source) => source.floor === true);
    if (product.sources.length === 0) {
      if (product.status !== 'retired') found.push(`${product.id}: no sources but not retired`);
      continue;
    }
    if (floors.length !== 1) found.push(`${product.id}: ${floors.length} floor sources`);
    for (const floor of floors) {
      if (!FLOOR_ADAPTERS.has(floor.adapter)) {
        found.push(`${product.id}/${floor.id}: floor adapter ${floor.adapter}`);
      }
      if (!['website', 'github', undefined].includes(floor.capability)) {
        found.push(`${product.id}/${floor.id}: floor capability ${floor.capability}`);
      }
    }
  }
  return found;
}

/** Every absolute URL a product names, with the place it was found. */
export function urlsOf(product: Product): Array<{ where: string; url: string }> {
  const urls: Array<{ where: string; url: string }> = [
    { where: 'homepage', url: product.homepage },
  ];
  for (const link of product.startHere) urls.push({ where: 'startHere', url: link.ref });
  for (const row of product.compatibility ?? [])
    urls.push({ where: 'compatibility', url: row.url });
  if (product.releaseNotes?.current !== undefined) {
    urls.push({ where: 'releaseNotes', url: product.releaseNotes.current });
  }
  for (const oracle of product.oracles) {
    for (const value of Object.values(oracle.options)) {
      if (value.startsWith('https://')) urls.push({ where: `oracle ${oracle.type}`, url: value });
    }
  }
  for (const source of product.sources) {
    urls.push({ where: `${source.id} probe`, url: source.probe.url });
    for (const line of product.lines) {
      if (source.lines !== undefined && !source.lines.includes(line.id)) continue;
      for (const base of sourceBaseUrls(source, line)) {
        urls.push({ where: `${source.id} base (${line.id})`, url: base });
      }
    }
  }
  return urls.filter((entry) => !entry.url.startsWith('brief:'));
}

/**
 * INV-2: every URL is https on a host of the host table and on a path that host allows;
 * GitHub URLs name an allowed owner.
 */
export function hostViolations(products: readonly Product[]): string[] {
  const found: string[] = [];
  for (const product of products) {
    for (const { where, url } of urlsOf(product)) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        found.push(`${product.id} ${where}: not a URL: ${url}`);
        continue;
      }
      if (parsed.protocol !== 'https:') found.push(`${product.id} ${where}: not https: ${url}`);
      // github.com is a ref format (rewritten before any request), so it has no host row.
      const github = ['github.com', 'api.github.com', 'raw.githubusercontent.com'];
      if (github.includes(parsed.hostname)) {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const owner = parsed.hostname === 'api.github.com' ? segments[1] : segments[0];
        if (owner === undefined || !OWNERS.has(owner)) {
          found.push(`${product.id} ${where}: GitHub owner not allowed: ${url}`);
        }
      }
      const row = HOST_ROWS.get(parsed.hostname);
      if (row === undefined) {
        if (parsed.hostname !== 'github.com') {
          found.push(`${product.id} ${where}: host not in HOSTS: ${url}`);
        }
      } else if (row.allowPaths?.some((path) => new RegExp(path).test(parsed.pathname)) === false) {
        found.push(`${product.id} ${where}: path not allowed on ${row.host}: ${url}`);
      }
    }
    for (const repo of [...product.repos.map((ref) => ref.repo), ...sourceRepos(product)]) {
      if (!OWNERS.has(repo.split('/')[0] ?? '')) found.push(`${product.id}: repo owner of ${repo}`);
    }
  }
  return found;
}

function sourceRepos(product: Product): string[] {
  return product.sources.flatMap((source) =>
    source.adapter === 'github-repo' || source.adapter === 'xmldoc' ? [source.config.repo] : [],
  );
}

/** The regular-expression sources a source config carries. */
function patternsOf(source: AnySourceDef): string[] {
  if (source.adapter !== 'astro' && source.adapter !== 'gatsby' && source.adapter !== 'sitemap') {
    return [];
  }
  const { include = [], exclude = [], classify = [] } = source.config;
  const slug = 'symbolsFromSlug' in source.config ? [source.config.symbolsFromSlug ?? ''] : [];
  return [...include, ...exclude, ...classify.map(([pattern]) => pattern), ...slug].filter(
    (pattern) => pattern !== '',
  );
}

/** INV-3 and INV-5: probes, compilable patterns, no hash-named URLs, source ids and lines consistent. */
export function sourceViolations(products: readonly Product[]): string[] {
  const found: string[] = [];
  for (const product of products) {
    const lineIds = new Set(product.lines.map((line) => line.id));
    const sourceIds = product.sources.map((source) => source.id);
    if (new Set(sourceIds).size !== sourceIds.length)
      found.push(`${product.id}: duplicate source id`);
    for (const source of product.sources) {
      const at = `${product.id}/${source.id}`;
      if (!source.probe.url.startsWith('https://')) found.push(`${at}: probe URL`);
      for (const pattern of patternsOf(source)) {
        try {
          new RegExp(pattern);
        } catch {
          found.push(`${at}: pattern does not compile: ${pattern}`);
        }
      }
      for (const line of source.lines ?? []) {
        if (!lineIds.has(line)) found.push(`${at}: unknown line ${line}`);
      }
      for (const fallback of source.fallbacks ?? []) {
        if (!sourceIds.includes(fallback)) found.push(`${at}: unknown fallback ${fallback}`);
      }
      for (const line of product.lines) {
        const probe = expandTemplate(source.probe.url, line);
        if (/\{[a-z]+\}/i.test(probe) && (source.lines ?? [line.id]).includes(line.id)) {
          found.push(`${at}: probe URL has an unexpanded placeholder on line ${line.id}`);
        }
      }
    }
    for (const { where, url } of urlsOf(product)) {
      if (/[0-9a-f]{32}/i.test(url)) found.push(`${product.id} ${where}: hash-named URL ${url}`);
    }
  }
  return found;
}

/**
 * INV-4 on a subset: ids and aliases are unique among `products`, exactly one line is
 * current, and `successor` / `related` name a product of the subset or one of `otherIds`.
 */
export function identityViolations(
  products: readonly Product[],
  otherIds: ReadonlySet<string> = new Set(),
): string[] {
  const found: string[] = [];
  const owners = new Map<string, string>();
  for (const product of products) {
    for (const name of [product.id, ...product.aliases]) {
      const owner = owners.get(name);
      if (owner !== undefined) found.push(`"${name}" is used by ${owner} and ${product.id}`);
      if (otherIds.has(name)) found.push(`"${name}" of ${product.id} is another product's id`);
      owners.set(name, product.id);
    }
    const current = product.lines.filter((line) => line.current);
    if (current.length !== 1) found.push(`${product.id}: ${current.length} current lines`);
  }
  const ids = new Set(products.map((product) => product.id));
  for (const product of products) {
    const refs = [
      ...product.related,
      ...(product.successor === undefined ? [] : [product.successor]),
    ];
    for (const ref of refs) {
      if (ref === product.id) found.push(`${product.id}: refers to itself`);
      if (!ids.has(ref) && !otherIds.has(ref)) found.push(`${product.id}: unknown product ${ref}`);
    }
  }
  return found;
}

/** Limits on the text this project writes: summary length, pitfall count, a recent `verifiedOn`. */
export function wordingViolations(products: readonly Product[]): string[] {
  const found: string[] = [];
  for (const product of products) {
    if (product.summary.length > 160) found.push(`${product.id}: summary over 160 characters`);
    if (product.pitfalls.length > 4) found.push(`${product.id}: more than four pitfalls`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(product.verifiedOn)) found.push(`${product.id}: verifiedOn`);
    if (product.keywords.length === 0) found.push(`${product.id}: no keywords`);
  }
  return found;
}

/**
 * Ids of the developer-tier products that live in the data files of the other half of the
 * registry package (design sections 4.1 to 4.4), which the products checked here refer to.
 */
export const OTHER_DEVELOPER_IDS: ReadonlySet<string> = new Set([
  'js-maps-sdk',
  'calcite',
  'arcade',
  'rest-js',
  'experience-builder',
  'esri-leaflet',
  'maplibre-arcgis',
  'openlayers-arcgis',
  'cesium-arcgis',
  'web-map-spec',
  'web-scene-spec',
  'swift-maps-sdk',
  'kotlin-maps-sdk',
  'dotnet-maps-sdk',
  'qt-maps-sdk',
  'flutter-maps-sdk',
  'java-maps-sdk',
  'unity-maps-sdk',
  'unreal-maps-sdk',
  'runtime-100',
  'python-api',
  'arcpy',
  'geoanalytics-engine',
  'geoanalytics-fabric',
  'r-arcgis',
  'arcgis-pro-sdk',
  'enterprise-sdk',
  'cityengine',
  'earth-automation-api',
  'autocad-api',
  'geoevent-server',
]);
