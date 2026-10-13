import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { isMcpDocError, type ErrorCode } from '../../../../src/core/errors.js';
import type { BoundSource } from '../../../../src/core/ports.js';
import type { AdapterType, CatalogRecord } from '../../../../src/core/types.js';
import { canonicalize } from '../../../../src/core/url.js';
import {
  describeAdapterContract,
  type AdapterContractCase,
} from '../../../support/adapter-contract.js';
import { FakeHttp, type Cassette, type RecordedResponse } from '../../../support/fake-http.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import type { TestCtx } from '../../../support/make-ctx.js';

/**
 * The shared contract of the API-reference adapters (design section 9, work package 6): the
 * generic adapter contract plus the upstream failure modes of the test plan (section 10) and
 * the rules for symbol records.
 */

/** The upstream failure modes every reference adapter must state its behaviour for. */
export const FAILURE_MODES = [
  'renamedField',
  'missingFile',
  'emptyIndex',
  'htmlInsteadOfJson',
  'oversizedBody',
  'secondary5xx',
] as const;

/** One of {@link FAILURE_MODES}. */
export type FailureMode = (typeof FAILURE_MODES)[number];

/** How `enumerate()` must behave when one failure mode is injected. */
export interface FailureScenario {
  /** Injects the failure into a fresh happy-path context. */
  arrange: (ctx: TestCtx) => void;
  /**
   * - `typed-failure`: `enumerate()` rejects with an `McpDocError`;
   * - `degraded`: `enumerate()` answers from what is left with at least `minRecords` records.
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

/** One reference adapter under the contract suite. */
export interface ReferenceContractCase<A extends AdapterType> extends AdapterContractCase<A> {
  /** Hosts catalogue refs may point to. */
  allowedHosts: readonly string[];
  failures: Record<FailureMode, FailureScenario | NotApplicable>;
  /** Index files that may not be requested while capability `site-index` is off. */
  siteIndexFiles?: ReadonlyArray<string | RegExp>;
  /** False for a source whose index lists no members (a JDK 8 class list, a package site). */
  hasMembers?: boolean;
}

/**
 * Gives a context a new HTTP fake over `cassette` in which the listed URLs answer with other
 * responses. `FakeHttp.on` can only queue a response behind a recorded one, so a scenario
 * that needs a recorded URL to answer differently from the first request on uses this.
 */
export function replaceResponses(
  ctx: TestCtx,
  cassette: Cassette,
  responses: Readonly<Record<string, RecordedResponse>>,
): void {
  const kept = cassette.interactions.filter((interaction) => !(interaction.url in responses));
  const replaced = Object.entries(responses).map(([url, response]) => ({ url, response }));
  ctx.http = new FakeHttp({ clock: ctx.clock, cassette: { interactions: [...kept, ...replaced] } });
}

/** The context's renderer as the fake it is, to inspect what an adapter passed in. */
export function rendererOf(ctx: TestCtx): FakeRenderer {
  if (!(ctx.render instanceof FakeRenderer)) {
    throw new Error('this context was built with a renderer of its own');
  }
  return ctx.render;
}

function boundTo<A extends AdapterType>(c: ReferenceContractCase<A>): BoundSource<A> {
  const line = c.line ?? c.product.lines.find((candidate) => candidate.current);
  if (line === undefined) throw new Error('the contract case needs a current version line');
  return bindSource(c.product, c.source, line);
}

function requests(ctx: TestCtx): number {
  return ctx.http.count() + ctx.github.count();
}

/** Refs are absolute https URLs on an allowed host and unique also in canonical form. */
function expectWellFormedRefs(records: CatalogRecord[], allowedHosts: readonly string[]): void {
  const canonical = new Set<string>();
  for (const record of records) {
    const url = new URL(record.ref);
    expect(url.protocol, record.ref).toBe('https:');
    expect(allowedHosts, record.ref).toContain(url.host);
    canonical.add(canonicalize(record.ref));
    expect(record.title.trim(), record.ref).not.toBe('');
  }
  expect(canonical.size, 'refs are unique in canonical form').toBe(records.length);
}

function isScenario(value: FailureScenario | NotApplicable): value is FailureScenario {
  return 'arrange' in value;
}

/**
 * Registers the generic adapter contract (`describeAdapterContract`) plus the rules of the
 * reference adapters:
 *
 * - refs are allow-listed and unique in canonical form;
 * - a record that names a symbol carries `qualified` and `symbolKind`; a member's parent is a
 *   proper prefix of its qualified name; the catalogue has members unless the index has none;
 * - each failure mode ends in a typed failure or a declared degradation, never in another
 *   exception, and never over the enumerate request budget;
 * - with `site-index` off no index file is requested and nothing is listed;
 * - a failing `probe()` reports `ok: false` within two requests;
 * - `read()` of a missing page is a typed failure, and a `link-only` line is never fetched.
 */
export function describeReferenceContract<A extends AdapterType>(
  name: string,
  makeCase: () => ReferenceContractCase<A>,
): void {
  describeAdapterContract(name, makeCase);

  describe(`reference adapter contract: ${name}`, () => {
    it('enumerates allow-listed symbol records with qualified names, kinds and parents', async () => {
      const c = makeCase();
      const records = await c.adapter.enumerate!(c.ctx(), boundTo(c));
      expectWellFormedRefs(records, c.allowedHosts);

      const symbols = records.filter((record) => record.symbol !== undefined);
      expect(symbols.length).toBeGreaterThan(0);
      for (const record of symbols) {
        expect(record.qualified, record.ref).toBeDefined();
        expect(record.symbolKind, record.ref).toBeDefined();
        expect(record.kind, record.ref).toBe('api');
      }
      const members = records.filter((record) => record.parent !== undefined);
      for (const member of members) {
        expect(member.qualified, member.ref).not.toBe(member.parent);
        expect(member.qualified?.startsWith(member.parent ?? ''), member.ref).toBe(true);
      }
      if (c.hasMembers ?? true) expect(members.length).toBeGreaterThan(0);
      else expect(members).toEqual([]);
    });

    for (const mode of FAILURE_MODES) {
      const declared = makeCase().failures[mode];
      if (!isScenario(declared)) {
        it.skip(`${mode}: not applicable (${declared.notApplicable})`, () => undefined);
        continue;
      }
      it(`${mode}: ${declared.outcome}`, async () => {
        const c = makeCase();
        const scenario = c.failures[mode];
        if (!isScenario(scenario)) return;
        const ctx = c.ctx();
        scenario.arrange(ctx);
        const [outcome] = await Promise.allSettled([c.adapter.enumerate!(ctx, boundTo(c))]);

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
      if (c.siteIndexFiles === undefined) return;
      const ctx = c.ctx();
      ctx.policy = fakePolicy({
        enabled: [...ctx.config.capabilities].filter((cap) => cap !== 'site-index'),
      });
      const records = await c.adapter.enumerate!(ctx, boundTo(c));

      expect(records).toEqual([]);
      expect(requests(ctx)).toBe(0);
      const probe = await c.adapter.probe(ctx, boundTo(c));
      for (const file of c.siteIndexFiles) {
        expect(ctx.http.count(file), `index file requested: ${String(file)}`).toBe(0);
      }
      expect(probe.ok).toBe(false);
      expect(probe.error).toMatch(/site-index/);
    });

    it('reports a failing probe within two requests', async () => {
      const c = makeCase();
      const ctx = c.ctx();
      ctx.http.fail(/.*/, 503);
      ctx.github.outage();
      const result = await c.adapter.probe(ctx, boundTo(c));

      expect(requests(ctx)).toBeGreaterThan(0);
      expect(requests(ctx)).toBeLessThanOrEqual(2);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/UPSTREAM_UNAVAILABLE/);
    });

    it('answers a missing page with a typed failure', async () => {
      const c = makeCase();
      if (c.readRef === undefined) return;
      const ctx = c.ctx();
      ctx.http.fail(/.*/, 404);
      const before = ctx.github.count();
      const [outcome] = await Promise.allSettled([
        c.adapter.read(ctx, boundTo(c), { url: new URL(c.readRef) }),
      ]);
      // A source read through the GitHub client is not affected by an HTTP fault.
      if (ctx.github.count() > before) return;
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected' && isMcpDocError(outcome.reason)) {
        expect(outcome.reason.code).toBe('DOC_NOT_FOUND');
      } else if (outcome.status === 'rejected') {
        expect.fail(`expected DOC_NOT_FOUND, got ${String(outcome.reason)}`);
      }
    });

    it('does not fetch anything of a link-only version line', async () => {
      const c = makeCase();
      const networked = c.source.capability === 'website' || c.source.capability === 'site-index';
      if (c.readRef === undefined || !networked) return;
      const ctx = c.ctx();
      const src = bindSource(c.product, c.source, { ...boundTo(c).line, access: 'link-only' });
      const outcomes = await Promise.allSettled([
        c.adapter.read(ctx, src, { url: new URL(c.readRef) }),
        c.adapter.enumerate!(ctx, src),
      ]);

      expect(requests(ctx)).toBe(0);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected' && isMcpDocError(outcome.reason)) {
          expect(outcome.reason.code).toBe('LINK_ONLY');
          expect(outcome.reason.details?.url).toBeDefined();
        } else if (outcome.status === 'rejected') {
          expect.fail(`expected LINK_ONLY, got ${String(outcome.reason)}`);
        }
      }
      expect((await c.adapter.probe(ctx, src)).ok).toBe(false);
      expect(requests(ctx)).toBe(0);
    });
  });
}
