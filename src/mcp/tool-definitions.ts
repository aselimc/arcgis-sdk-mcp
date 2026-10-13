/**
 * The six tool definitions in registration order (design section 3.1). One list drives the
 * server, the `tools/list` snapshot and the generated tools documentation.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { McpContainer } from './container.js';
import type { ToolDefinition } from './tool.js';
import { findSamplesTool, registerFindSamples } from './tools/find-samples.js';
import { getVersionsTool, registerGetVersions } from './tools/get-versions.js';
import { listProductsTool, registerListProducts } from './tools/list-products.js';
import { lookupSymbolTool, registerLookupSymbol } from './tools/lookup-symbol.js';
import { readTool, registerRead } from './tools/read.js';
import { registerSearch, searchTool } from './tools/search.js';

/** Name, title, description and schemas of every tool, in the fixed order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  listProductsTool,
  getVersionsTool,
  searchTool,
  readTool,
  lookupSymbolTool,
  findSamplesTool,
];

/** Registers the six tools on `server` in the fixed order. */
export function registerTools(server: McpServer, container: McpContainer): void {
  registerListProducts(server, container);
  registerGetVersions(server, container);
  registerSearch(server, container);
  registerRead(server, container);
  registerLookupSymbol(server, container);
  registerFindSamples(server, container);
}
