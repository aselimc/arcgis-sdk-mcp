import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../../src/core/errors.js';
import type { AdapterType } from '../../../src/core/types.js';
import { describeAdapterContract } from '../../support/adapter-contract.js';
import { fakePolicy } from '../../support/fake-policy.js';
import {
  boundTo,
  expectWellFormedRefs,
  itHandlesFailureModes,
  requests,
  type FailureContractCase,
} from '../contract-kit.js';

export { rendererOf, replaceResponses } from '../contract-kit.js';

/**
 * The shared contract of the site adapters (test/support/adapter-contract.ts). Every adapter
 * of `src/adapters/site` runs it against its own cassette:
 *
 * ```ts
 * describeSiteAdapterContract('astro guide', () => ({
 *   adapter: astroAdapter,
 *   product,
 *   source,
 *   ctx: () => makeCtx({ cassette: loadCassette('cassettes', 'site', 'core', 'astro.json') }),
 *   allowedHosts: ['developers.arcgis.com'],
 *   readRef: 'https://developers.arcgis.com/widgets/get-started/',
 *   siteIndexFiles: [/search\.json$/],
 *   failures: {
 *     renamedField: {
 *       arrange: (ctx) => replaceResponses(ctx, cassette, { [indexUrl]: { json: renamed } }),
 *       outcome: 'degraded',
 *     },
 *     missingFile: { arrange: (ctx) => ctx.http.fail(sitemapUrl, 404), outcome: 'typed-failure' },
 *     emptyIndex: { arrange: (ctx) => ctx.http.fail(sitemapUrl, 'empty'), outcome: 'typed-failure' },
 *     htmlInsteadOfJson: { notApplicable: 'the source reads no JSON' },
 *   },
 * }));
 * ```
 */

/** The upstream failure modes every site adapter must state its behaviour for. */
export const SITE_FAILURE_MODES = [
  'renamedField',
  'missingFile',
  'emptyIndex',
  'htmlInsteadOfJson',
] as const;

/** One of {@link SITE_FAILURE_MODES}. */
export type SiteFailureMode = (typeof SITE_FAILURE_MODES)[number];

/** One site adapter under the shared contract suite. */
export interface SiteContractCase<A extends AdapterType> extends FailureContractCase<
  A,
  SiteFailureMode
> {
  /**
   * URLs of the site-published index files the adapter reads (search and symbol indexes, nav
   * and TOC JSON). With capability `site-index` off none of them may be requested.
   */
  siteIndexFiles?: ReadonlyArray<string | RegExp>;
  /**
   * Whether `read()` on a `link-only` version line must answer `LINK_ONLY`. Default: true
   * when the source's capability is `website` or `site-index` and `readRef` is set.
   */
  linkOnlyRead?: boolean;
}

/**
 * Registers the generic adapter contract (`describeAdapterContract`) plus the site-adapter
 * rules:
 *
 * - refs are allow-listed and unique in canonical form;
 * - renamed field, missing file, empty index and HTML-instead-of-JSON each end in a typed
 *   failure or a declared lower rung, never in another exception, and never over the
 *   enumerate request budget;
 * - with `site-index` off no index file is requested;
 * - a failing `probe()` reports `ok: false` (or rejects with `McpDocError`) within two requests;
 * - `read()` of a missing page is a typed failure, and a `link-only` line is never fetched.
 */
export function describeSiteAdapterContract<A extends AdapterType>(
  name: string,
  makeCase: () => SiteContractCase<A>,
): void {
  describeAdapterContract(name, makeCase);

  describe(`site adapter contract: ${name}`, () => {
    it('enumerates allow-listed refs that stay unique in canonical form', async () => {
      const c = makeCase();
      if (c.adapter.enumerate === undefined) return;
      const records = await c.adapter.enumerate(c.ctx(), boundTo(c));
      expectWellFormedRefs(records, c.allowedHosts);
    });

    itHandlesFailureModes(SITE_FAILURE_MODES, makeCase);

    it('requests no site-published index file while site-index is off', async () => {
      const c = makeCase();
      if (c.adapter.enumerate === undefined) return;
      const ctx = c.ctx();
      ctx.policy = fakePolicy({
        enabled: [...ctx.config.capabilities].filter((cap) => cap !== 'site-index'),
      });
      const [outcome] = await Promise.allSettled([c.adapter.enumerate(ctx, boundTo(c))]);

      expect(ctx.http.unrecorded).toEqual([]);
      for (const file of c.siteIndexFiles ?? []) {
        expect(ctx.http.count(file), `index file requested: ${String(file)}`).toBe(0);
      }
      if (outcome.status === 'rejected') {
        expect(isMcpDocError(outcome.reason), String(outcome.reason)).toBe(true);
      } else {
        expectWellFormedRefs(outcome.value, c.allowedHosts);
      }
    });

    it('reports a failing probe within two requests', async () => {
      const c = makeCase();
      const ctx = c.ctx();
      ctx.http.fail(/.*/, 503);
      ctx.github.outage();
      const [outcome] = await Promise.allSettled([c.adapter.probe(ctx, boundTo(c))]);

      expect(requests(ctx)).toBeLessThanOrEqual(2);
      if (outcome.status === 'rejected') {
        expect(isMcpDocError(outcome.reason), String(outcome.reason)).toBe(true);
      } else if (requests(ctx) > 0) {
        // A probe that needs the network cannot succeed while every request fails.
        expect(outcome.value.ok).toBe(false);
        expect(outcome.value.error?.trim()).not.toBe('');
      }
    });

    it('answers a missing page with a typed failure', async () => {
      const c = makeCase();
      if (c.readRef === undefined) return;
      const ctx = c.ctx();
      ctx.http.fail(/.*/, 404);
      const before = requests(ctx);
      const [outcome] = await Promise.allSettled([
        c.adapter.read(ctx, boundTo(c), { url: new URL(c.readRef) }),
      ]);
      // A source that reads without the network (bundled briefs) is not affected by the fault.
      if (requests(ctx) === before) return;
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(isMcpDocError(outcome.reason), String(outcome.reason)).toBe(true);
      }
    });

    it('does not fetch a page of a link-only version line', async () => {
      const c = makeCase();
      const networked = c.source.capability === 'website' || c.source.capability === 'site-index';
      if (c.readRef === undefined || !(c.linkOnlyRead ?? networked)) return;
      const ctx = c.ctx();
      const live = boundTo(c);
      const src = bindSource(c.product, c.source, { ...live.line, access: 'link-only' });
      const [outcome] = await Promise.allSettled([
        c.adapter.read(ctx, src, { url: new URL(c.readRef) }),
      ]);

      expect(requests(ctx)).toBe(0);
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected' && isMcpDocError(outcome.reason)) {
        expect(outcome.reason.code).toBe('LINK_ONLY');
        expect(outcome.reason.details?.url).toBeDefined();
      } else if (outcome.status === 'rejected') {
        expect.fail(`expected LINK_ONLY, got ${String(outcome.reason)}`);
      }
    });
  });
}
