import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../src/core/adapter-helpers.js';
import { isMcpDocError, type ErrorCode } from '../../../src/core/errors.js';
import { BRIEF_PREFIX } from '../../../src/core/names.js';
import type { BoundSource } from '../../../src/core/ports.js';
import type { AdapterType, CatalogRecord } from '../../../src/core/types.js';
import { canonicalize } from '../../../src/core/url.js';
import {
  describeAdapterContract,
  type AdapterContractCase,
} from '../../support/adapter-contract.js';
import { fakePolicy } from '../../support/fake-policy.js';
import type { TestCtx } from '../../support/make-ctx.js';

/**
 * The shared contract of the site adapters (design section 9, work package 5). Every adapter
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
 *     renamedField: { arrange: (ctx) => ctx.http.on(indexUrl, { json: renamed }), outcome: 'degraded' },
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

/** How `enumerate()` must behave when one failure mode is injected. */
export interface SiteFailureScenario {
  /**
   * Injects the failure into a fresh happy-path context: `ctx.http.fail(url, 404)`,
   * `ctx.http.fail(url, 'html')`, or `ctx.http.on(url, { json: ... })` on a context whose
   * cassette does not already record that URL.
   */
  arrange: (ctx: TestCtx) => void;
  /**
   * - `typed-failure`: `enumerate()` rejects with an `McpDocError` (the failed file is one the
   *   source cannot be listed without);
   * - `degraded`: `enumerate()` answers from a lower rung with at least `minRecords` records.
   */
  outcome: 'typed-failure' | 'degraded';
  /** `typed-failure`: the acceptable error codes. Default: any `McpDocError`. */
  codes?: readonly ErrorCode[];
  /** `degraded`: smallest acceptable number of records. Default 1. */
  minRecords?: number;
}

/** A failure mode that cannot happen to an adapter, with the reason shown in the test name. */
export interface NotApplicable {
  notApplicable: string;
}

/** One site adapter under the shared contract suite. */
export interface SiteContractCase<A extends AdapterType> extends AdapterContractCase<A> {
  /** Hosts catalogue refs may point to; required for site adapters. */
  allowedHosts: readonly string[];
  /** Behaviour under each failure mode; a mode that cannot occur says why. */
  failures: Record<SiteFailureMode, SiteFailureScenario | NotApplicable>;
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

function boundTo<A extends AdapterType>(c: SiteContractCase<A>): BoundSource<A> {
  const line = c.line ?? c.product.lines.find((candidate) => candidate.current);
  if (line === undefined) throw new Error('the contract case needs a current version line');
  return bindSource(c.product, c.source, line);
}

function requests(ctx: TestCtx): number {
  return ctx.http.count() + ctx.github.count();
}

/** Refs must be absolute https URLs on an allowed host (or briefs), unique also after canonicalisation. */
function expectWellFormedRefs(records: CatalogRecord[], allowedHosts: readonly string[]): void {
  const canonical = new Set<string>();
  for (const record of records) {
    if (record.ref.startsWith(BRIEF_PREFIX)) {
      canonical.add(record.ref);
      continue;
    }
    const url = new URL(record.ref);
    expect(url.protocol, record.ref).toBe('https:');
    expect(allowedHosts, record.ref).toContain(url.host);
    canonical.add(canonicalize(record.ref));
    expect(record.title.trim(), record.ref).not.toBe('');
  }
  expect(canonical.size, 'refs are unique in canonical form').toBe(records.length);
}

function isScenario(value: SiteFailureScenario | NotApplicable): value is SiteFailureScenario {
  return 'arrange' in value;
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

    for (const mode of SITE_FAILURE_MODES) {
      const declared = makeCase().failures[mode];
      if (!isScenario(declared)) {
        it.skip(`${mode}: not applicable (${declared.notApplicable})`, () => undefined);
        continue;
      }
      it(`${mode}: ${declared.outcome}`, async () => {
        const c = makeCase();
        const scenario = c.failures[mode];
        if (!isScenario(scenario) || c.adapter.enumerate === undefined) return;
        const ctx = c.ctx();
        scenario.arrange(ctx);
        const [outcome] = await Promise.allSettled([c.adapter.enumerate(ctx, boundTo(c))]);

        expect(ctx.http.unrecorded).toEqual([]);
        expect(requests(ctx)).toBeLessThanOrEqual(c.adapter.maxEnumerateRequests);
        if (outcome.status === 'rejected') {
          expect(isMcpDocError(outcome.reason), String(outcome.reason)).toBe(true);
          expect(scenario.outcome, `rejected with ${String(outcome.reason)}`).toBe('typed-failure');
          if (scenario.codes !== undefined && isMcpDocError(outcome.reason)) {
            expect(scenario.codes).toContain(outcome.reason.code);
          }
          return;
        }
        expect(scenario.outcome, `returned ${outcome.value.length} records`).toBe('degraded');
        expect(outcome.value.length).toBeGreaterThanOrEqual(scenario.minRecords ?? 1);
        expectWellFormedRefs(outcome.value, c.allowedHosts);
      });
    }

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
