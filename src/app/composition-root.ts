/**
 * The composition root: the one module that imports every package (design section 5, rule 3).
 * It names the real factories; `container.ts` holds the wiring, so that the wiring is
 * testable without them.
 *
 * Importing this module loads the whole server (registry data, HTML and structured
 * renderers, adapters, search). The CLI therefore imports it lazily, after `--version` and
 * `--help` have been answered.
 */
import { referenceAdapters } from '../adapters/reference/index.js';
import { siteAdapters } from '../adapters/site/index.js';
import { createCache } from '../cache/index.js';
import type { Config } from '../core/config.js';
import { createHtmlExtractor } from '../extract/index.js';
import { createGithubClient } from '../net/github.js';
import { createHttpClient } from '../net/index.js';
import { createPolicy } from '../policy/index.js';
import { createRegistry } from '../registry/index.js';
import { createRenderer } from '../render/index.js';
import { createServices } from '../services/index.js';
import { createVersionService } from '../versions/index.js';
import { detectWorkspace } from '../workspace/index.js';
import {
  buildContainer,
  type Container,
  type ContainerOptions,
  type Factories,
} from './container.js';

/** The production factory of every package. */
export const FACTORIES: Readonly<Factories> = {
  createCache,
  createPolicy,
  createHttpClient,
  createGithubClient,
  createRegistry,
  createVersionService,
  detectWorkspace,
  createHtmlExtractor,
  createRenderer,
  siteAdapters,
  referenceAdapters,
  createServices,
};

/**
 * Creates the container of one server process from its configuration.
 *
 * Nothing is constructed until it is read, and nothing is fetched or written until a tool
 * call or CLI command needs it: the stdio handshake completes without I/O. In HTTP mode the
 * MCP server factory runs once per request, so the caller creates this container once and
 * closes over it.
 *
 * @param options a logger, clock or `fetch` replacement; `factories` swaps individual
 *   packages (integration tests replace the gateway, embedders the cache).
 */
export function createContainer(
  config: Config,
  options: ContainerOptions & { factories?: Partial<Factories> } = {},
): Container {
  const { factories, ...rest } = options;
  return buildContainer(config, { ...FACTORIES, ...factories }, rest);
}
