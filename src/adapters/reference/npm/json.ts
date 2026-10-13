/**
 * `npm-json`: reference data that a package ships as one JSON file. The adapter pins the
 * package and loads the file; the mapper named in the registry reads its structure. Both
 * current mappers read ArcGIS Arcade data from `@arcgis/coding-components`.
 */
import type { Ctx, ReadTarget, SourceAdapter } from '../../../core/ports.js';
import type { AdapterConfigMap, CatalogRecord, DocPage } from '../../../core/types.js';
import { arcadeApiMapper } from './arcade-api.js';
import { arcadeProfilesMapper } from './arcade-profiles.js';
import type { JsonMapper, JsonSrc, LoadedFile } from './json-mapper.js';
import { loadPackageJson } from './package-file.js';
import { resolvePackageVersion } from './resolve-version.js';
import { probeDeclared } from './shared.js';

const MAPPERS: Readonly<Record<AdapterConfigMap['npm-json']['mapper'], JsonMapper>> = {
  'arcade-api': arcadeApiMapper,
  'arcade-profiles': arcadeProfilesMapper,
};

async function load(ctx: Ctx, src: JsonSrc): Promise<LoadedFile> {
  const { config } = src.source;
  const pkg = await resolvePackageVersion(ctx, src, config.package);
  return { pkg, file: await loadPackageJson(ctx, src, pkg, config.file) };
}

async function read(ctx: Ctx, src: JsonSrc, target: ReadTarget): Promise<DocPage> {
  return MAPPERS[src.source.config.mapper].page(ctx, src, await load(ctx, src), target);
}

/**
 * The `npm-json` adapter. Every operation costs one version lookup and the one file, both
 * cached; the file of a pinned version never changes.
 */
export const npmJsonAdapter: SourceAdapter<'npm-json'> = {
  type: 'npm-json',
  // Version lookup (two requests when the registry fails over to the CDN) and the file.
  maxEnumerateRequests: 3,

  async enumerate(ctx, src): Promise<CatalogRecord[]> {
    return MAPPERS[src.source.config.mapper].records(src, await load(ctx, src));
  },

  read,

  async symbol(ctx, src, record, detail) {
    const mapper = MAPPERS[src.source.config.mapper];
    const loaded = await load(ctx, src);
    return (
      mapper.symbol?.(ctx, src, loaded, record, detail) ??
      mapper.page(ctx, src, loaded, { url: new URL(record.ref), record, detail })
    );
  },

  probe: probeDeclared,
};
