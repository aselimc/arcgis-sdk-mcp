import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import type { AdapterType } from '../../../../src/core/types.js';
import { describeAdapterContract } from '../../../support/adapter-contract.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import {
  boundTo,
  expectWellFormedRefs,
  itHandlesFailureModes,
  requests,
  type FailureContractCase,
} from '../../contract-kit.js';

export { rendererOf, replaceResponses } from '../../contract-kit.js';

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

/** One reference adapter under the contract suite. */
export interface ReferenceContractCase<A extends AdapterType> extends FailureContractCase<
  A,
  FailureMode
> {
  /** Index files that may not be requested while capability `site-index` is off. */
  siteIndexFiles?: ReadonlyArray<string | RegExp>;
  /** False for a source whose index lists no members (a JDK 8 class list, a package site). */
  hasMembers?: boolean;
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

    itHandlesFailureModes(FAILURE_MODES, makeCase);

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
