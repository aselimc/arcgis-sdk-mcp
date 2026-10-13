/**
 * Names that appear on the wire (design section 0). Services build `Next:` calls from these
 * and the MCP layer registers tools under them, so they are defined exactly once.
 */

/** MCP server `name`. */
export const SERVER_NAME = 'arcgis-sdk-docs';

/** MCP server `title`. */
export const SERVER_TITLE = 'ArcGIS SDK and Developer Docs (unofficial)';

/** npm package, repository and binary name; also the cache directory name. */
export const PACKAGE_NAME = 'arcgis-sdk-mcp';

/** Prefix of every environment variable this server reads (except `GITHUB_TOKEN`). */
export const ENV_PREFIX = 'ARCGIS_DOCS_';

/** URI scheme of the MCP resources, without `://`. */
export const RESOURCE_SCHEME = 'arcgis-docs';

/** Prefix of a curated-brief ref: `brief:<slug>`. */
export const BRIEF_PREFIX = 'brief:';

/** Joins the ancestor titles of a breadcrumb: `Guide > Layers > Feature layers`. */
export const BREADCRUMB_SEPARATOR = ' > ';

/** Host that paths starting with `/` in the registry belong to. */
export const DEVELOPERS_ORIGIN = 'https://developers.arcgis.com';

/** Tool names, in registration order. */
export const TOOLS = {
  listProducts: 'arcgis_docs_list_products',
  getVersions: 'arcgis_docs_get_versions',
  search: 'arcgis_docs_search',
  read: 'arcgis_docs_read',
  lookupSymbol: 'arcgis_docs_lookup_symbol',
  findSamples: 'arcgis_docs_find_samples',
} as const;

/** Name of one of the six tools. */
export type ToolName = (typeof TOOLS)[keyof typeof TOOLS];

/** The fixed registration order of design section 3.1. */
export const TOOL_ORDER = [
  TOOLS.listProducts,
  TOOLS.getVersions,
  TOOLS.search,
  TOOLS.read,
  TOOLS.lookupSymbol,
  TOOLS.findSamples,
] as const satisfies readonly ToolName[];
