import { expect, it } from 'vitest';
import { bindSource } from '../../src/core/adapter-helpers.js';
import { isMcpDocError, type ErrorCode } from '../../src/core/errors.js';
import { BRIEF_PREFIX } from '../../src/core/names.js';
import type { BoundSource } from '../../src/core/ports.js';
import type { AdapterType, CatalogRecord } from '../../src/core/types.js';
import { canonicalize } from '../../src/core/url.js';
import type { AdapterContractCase } from '../support/adapter-contract.js';
import { FakeHttp, type Cassette, type RecordedResponse } from '../support/fake-http.js';
import { FakeRenderer } from '../support/fake-render.js';
import type { TestCtx } from '../support/make-ctx.js';

/**
 * What the contract suites of the adapter packages share: the description of an upstream
 * failure mode, the runner that injects each one into `enumerate()`, and the helpers a
 * scenario is written with. The site and the reference suite add their own rules on top
 * (`site/contract.ts`, `reference/docs/contract.ts`).
 */

/** How `enumerate()` must behave when one failure mode is injected. */
export interface FailureScenario {
  /**
   * Injects the failure into a fresh happy-path context: `ctx.http.fail(url, 404)`,
   * `ctx.http.fail(url, 'html')`, or {@link replaceResponses} to answer a recorded URL with a
   * different body (a renamed field, an index without entries).
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

/** An adapter under a contract suite that injects the failure modes `M`. */
export interface FailureContractCase<
  A extends AdapterType,
  M extends string,
> extends AdapterContractCase<A> {
  /** Hosts catalogue refs may point to. */
  allowedHosts: readonly string[];
  /** Behaviour under each failure mode; a mode that cannot occur says why. */
  failures: Record<M, FailureScenario | NotApplicable>;
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

/**
 * The context's renderer as the fake it is, to script it (`when`, `family`) and to inspect
 * what an adapter passed in (`calls`). `TestCtx` types it as the port only.
 */
export function rendererOf(ctx: TestCtx): FakeRenderer {
  if (!(ctx.render instanceof FakeRenderer)) {
    throw new Error('this context was built with a renderer of its own');
  }
  return ctx.render;
}

/** The case's source bound to its line (default: the current line of its product). */
export function boundTo<A extends AdapterType>(c: AdapterContractCase<A>): BoundSource<A> {
  const line = c.line ?? c.product.lines.find((candidate) => candidate.current);
  if (line === undefined) throw new Error('the contract case needs a current version line');
  return bindSource(c.product, c.source, line);
}

/** Requests a context has seen, over HTTP and through the GitHub client. */
export function requests(ctx: TestCtx): number {
  return ctx.http.count() + ctx.github.count();
}

/** Refs must be absolute https URLs on an allowed host (or briefs), unique also after canonicalisation. */
export function expectWellFormedRefs(
  records: CatalogRecord[],
  allowedHosts: readonly string[],
): void {
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

function isScenario(value: FailureScenario | NotApplicable): value is FailureScenario {
  return 'arrange' in value;
}

/**
 * Registers one test per failure mode: the failure is injected into a fresh context and
 * `enumerate()` must end in a typed failure or the declared lower rung, never in another
 * exception and never over the enumerate request budget. A mode that cannot happen to the
 * adapter is listed as skipped with its reason. Call inside a `describe`.
 */
export function itHandlesFailureModes<A extends AdapterType, M extends string>(
  modes: readonly M[],
  makeCase: () => FailureContractCase<A, M>,
): void {
  for (const mode of modes) {
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
}
