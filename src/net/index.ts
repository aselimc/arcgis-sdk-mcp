/**
 * Public entry point of the network package: the HTTP gateway factory. The GitHub client
 * factory is exported from `github.ts`, as the factory contract places it there.
 */
import type { HttpClient } from '../core/ports.js';
import type { GatewayDeps } from './gateway-deps.js';
import { createGateway } from './http-client.js';
import type { QuotaSource } from './rate-limit-info.js';

export type { GatewayDeps } from './gateway-deps.js';
export type { QuotaSource, RateLimitSnapshot } from './rate-limit-info.js';

/**
 * Creates the single gateway through which every upstream request of this server passes
 * (design section 6.2). Satisfies `CreateHttpClient`; nothing is fetched until `get` is called.
 */
export function createHttpClient(deps: GatewayDeps): HttpClient & QuotaSource {
  return createGateway(deps);
}
