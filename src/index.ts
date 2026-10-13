/**
 * Library entry of `arcgis-sdk-mcp`: everything needed to embed the server in another
 * process instead of running the binary.
 *
 * @example
 * ```ts
 * import { serveStdio } from '@modelcontextprotocol/server/stdio';
 * import { createContainer, createServer, loadConfig, readPackageInfo } from 'arcgis-sdk-mcp';
 *
 * const config = loadConfig(process.env, { mode: 'stdio' }, readPackageInfo());
 * const container = createContainer(config);
 * serveStdio(() => createServer(container));
 * ```
 */
export { createContainer, FACTORIES } from './app/composition-root.js';
export {
  buildContainer,
  type Container,
  type ContainerOptions,
  type Factories,
} from './app/container.js';
export { createAdapterRegistry } from './app/adapter-registry.js';
export { readPackageInfo, type PackageInfo } from './app/package-info.js';
export { createServer } from './mcp/server.js';

export {
  loadConfig,
  ConfigSchema,
  type Config,
  type Limits,
  type LogLevel,
} from './core/config.js';
export { ConfigError, CAPABILITIES, PRESETS, type Preset } from './core/capabilities.js';
export {
  McpDocError,
  isMcpDocError,
  ERROR_CODES,
  type ErrorCode,
  type ErrorDetails,
} from './core/errors.js';
export { SERVER_NAME, SERVER_TITLE, TOOLS, TOOL_ORDER, type ToolName } from './core/names.js';
export type * from './core/ports.js';
export type * from './core/types.js';
