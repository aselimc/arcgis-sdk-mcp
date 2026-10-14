import { CAPABILITIES, PRESETS } from '../../src/core/capabilities.js';
import { McpDocError } from '../../src/core/errors.js';
import type { SourcePolicy } from '../../src/core/ports.js';
import type { Capability, HostPolicy } from '../../src/core/types.js';

/** Options of {@link fakePolicy}. */
export interface FakePolicyOptions {
  /** Enabled capabilities. Default: preset `standard`. */
  enabled?: readonly Capability[];
  /**
   * Host table. When given, hosts outside it are `HOST_NOT_ALLOWED` and hosts with
   * `capability: null` are `LINK_ONLY`. When omitted, every https host is allowed under
   * capability `website`, which suits tests that are not about policy.
   */
  hosts?: readonly HostPolicy[];
  offline?: boolean;
}

/** A permissive host row for hosts not described by the test. */
export function permissiveHost(host: string, capability: Capability = 'website'): HostPolicy {
  return {
    host,
    capability,
    robotsDisallow: [],
    revalidate: 'etag',
    ratePerSec: 1000,
    maxConcurrent: 100,
  };
}

/**
 * A {@link SourcePolicy} for tests. It applies the same three decisions as the real one
 * (allow-list, link-only, capability switch) without robots handling; the real policy has
 * its own tests under test/policy. `checked` lists every URL passed to `check`, in order.
 */
export function fakePolicy(options: FakePolicyOptions = {}): SourcePolicy & { checked: string[] } {
  const enabled = new Set<Capability>(options.enabled ?? PRESETS.standard);
  const checked: string[] = [];
  return {
    checked,
    enabled: (cap) => enabled.has(cap),
    check(url) {
      checked.push(url.href);
      if (url.protocol !== 'https:') {
        throw new McpDocError(
          'HOST_NOT_ALLOWED',
          `Only https URLs can be read, not ${url.protocol}`,
          {
            url: url.href,
            host: url.host,
          },
        );
      }
      const host =
        options.hosts === undefined
          ? permissiveHost(url.host)
          : options.hosts.find((candidate) => candidate.host === url.host);
      if (host === undefined) {
        throw new McpDocError('HOST_NOT_ALLOWED', `${url.host} is not a documentation host`, {
          url: url.href,
          host: url.host,
        });
      }
      if (host.capability === null) {
        throw new McpDocError('LINK_ONLY', `${url.host} is not fetched; open the link directly`, {
          url: url.href,
          host: url.host,
        });
      }
      if (!enabled.has(host.capability)) {
        throw new McpDocError(
          'SOURCE_DISABLED',
          `${url.host} needs capability "${host.capability}"`,
          {
            why: `Capability "${host.capability}" is switched off`,
            next: `Set ARCGIS_DOCS_SOURCES=+${host.capability}`,
            url: url.href,
            host: url.host,
            capability: host.capability,
          },
        );
      }
      return { host, capability: host.capability };
    },
    summary: () => ({
      preset: 'test',
      enabled: CAPABILITIES.filter((cap) => enabled.has(cap)),
      disabled: CAPABILITIES.filter((cap) => !enabled.has(cap)),
      offline: options.offline ?? false,
    }),
  };
}
