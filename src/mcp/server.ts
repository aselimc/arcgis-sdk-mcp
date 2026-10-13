/**
 * The MCP surface (design section 3): six tools in a fixed order, four resources and four
 * prompts on one `McpServer`. The same factory serves stdio and HTTP, and both protocol eras.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_NAME, SERVER_TITLE } from '../core/names.js';
import type { McpContainer } from './container.js';
import { buildInstructions } from './instructions.js';
import { registerAgenticAppDesignPrompt } from './prompts/agentic-app-design.js';
import { registerAppKickoffPrompt } from './prompts/app-kickoff.js';
import { registerProjectInstructionsPrompt } from './prompts/project-instructions.js';
import { registerUpgradeReviewPrompt } from './prompts/upgrade-review.js';
import { registerBriefResource } from './resources/brief.js';
import { registerCatalogResource } from './resources/catalog.js';
import { registerProductResource } from './resources/product.js';
import { registerStatusResource } from './resources/status.js';
import { registerTools } from './tool-definitions.js';

/**
 * Creates a server over the application container.
 *
 * Construction is synchronous and does no I/O: it reads the configuration and the registry
 * (pure data) and registers handlers. Services are first touched when a request arrives, so
 * a host's handshake is answered before anything is fetched or read from disk.
 *
 * In HTTP mode the SDK calls the factory once per request; create the container once and
 * pass the same one to every call.
 */
export function createServer(container: McpContainer): McpServer {
  const { config, registry } = container.ctx;
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: config.version,
      websiteUrl: config.repoUrl,
    },
    { instructions: buildInstructions(registry.all().map((product) => product.id)) },
  );

  registerTools(server, container);

  registerCatalogResource(server, container);
  registerProductResource(server, container);
  registerBriefResource(server, container);
  registerStatusResource(server, container);

  registerAppKickoffPrompt(server);
  registerUpgradeReviewPrompt(server);
  registerAgenticAppDesignPrompt(server);
  registerProjectInstructionsPrompt(server, container);

  return server;
}
