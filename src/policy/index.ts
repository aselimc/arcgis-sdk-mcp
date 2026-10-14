/**
 * The source policy (design sections 4.7 and 6.3): the one place that decides whether a URL
 * may be requested. The HTTP gateway calls `check` for the initial URL and again for every
 * redirect and meta-refresh hop, so a response can never steer a request off the allow-list.
 */
import { CAPABILITIES } from '../core/capabilities.js';
import type { CreatePolicy } from '../core/factories.js';
import type { SourcePolicy } from '../core/ports.js';
import {
  compileHost,
  methodViolation,
  pathViolation,
  robotsViolation,
  type CompiledHost,
} from './host-rules.js';
import { hostNotAllowed, linkOnly, robotsDenied, sourceDisabled } from './policy-errors.js';
import { effectiveCapabilities } from './presets.js';

/**
 * Builds the policy from the configuration and the host table.
 *
 * `check` applies its rules in a fixed order, so that a URL which no setting could make
 * readable is never reported as merely disabled:
 *
 * 1. scheme, credentials and port: https on the default port only (`HOST_NOT_ALLOWED`);
 * 2. host on the table, exact match (`HOST_NOT_ALLOWED`);
 * 3. link-only host (`LINK_ONLY`);
 * 4. allowed paths and GitHub owners (`HOST_NOT_ALLOWED`);
 * 5. request method (`HOST_NOT_ALLOWED`);
 * 6. static robots denials (`LINK_ONLY`);
 * 7. the host's capability is switched on (`SOURCE_DISABLED`).
 *
 * @throws SyntaxError when a host row carries an invalid `allowPaths` expression.
 */
export const createPolicy: CreatePolicy = ({ config, hosts }): SourcePolicy => {
  const enabled = effectiveCapabilities(config);
  const table = new Map<string, CompiledHost>(
    hosts.map((host) => [host.host.toLowerCase(), compileHost(host)]),
  );

  return {
    enabled: (capability) => enabled.has(capability),

    check(url, method = 'GET') {
      if (url.protocol !== 'https:') {
        throw hostNotAllowed(url, `Only https URLs are read, not ${url.protocol}`, hosts);
      }
      if (url.username !== '' || url.password !== '' || url.port !== '') {
        throw hostNotAllowed(url, 'URLs with credentials or an explicit port are not read', hosts);
      }
      const host = table.get(url.hostname);
      if (host === undefined) {
        throw hostNotAllowed(
          url,
          'Only the hosts on the allow-list are read: Esri documentation sites, the GitHub repositories of Esri and a few related owners, and package registries',
          hosts,
        );
      }
      const capability = host.policy.capability;
      if (capability === null) {
        throw linkOnly(url, `${url.hostname} excludes automated access`);
      }
      const violation = pathViolation(host, url) ?? methodViolation(host, method);
      if (violation !== undefined) throw hostNotAllowed(url, violation, hosts);

      const pattern = robotsViolation(host, url);
      if (pattern !== undefined) throw robotsDenied(url, pattern);

      if (!enabled.has(capability)) throw sourceDisabled(url, capability, config);
      return { host: host.policy, capability };
    },

    summary: () => ({
      preset: config.preset,
      enabled: CAPABILITIES.filter((capability) => enabled.has(capability)),
      disabled: CAPABILITIES.filter((capability) => !enabled.has(capability)),
      offline: config.offline,
    }),
  };
};
