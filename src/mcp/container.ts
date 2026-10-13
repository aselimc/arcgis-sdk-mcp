/**
 * What the MCP surface needs from the application: the shared context and the services.
 *
 * The composition root's container satisfies this structurally. Both members may be lazy
 * getters: `createServer` reads `ctx` (configuration and the registry, both free of I/O) and
 * touches `services` only inside request handlers, so nothing is built before the handshake.
 */
import type { Ctx, Services } from '../core/ports.js';

/** Dependencies of {@link createServer}. */
export interface McpContainer {
  readonly ctx: Ctx;
  readonly services: Services;
}
