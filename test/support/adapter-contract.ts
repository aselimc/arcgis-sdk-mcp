import { describe, expect, it } from 'vitest';
import { bindSource } from '../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../src/core/errors.js';
import { BRIEF_PREFIX } from '../../src/core/names.js';
import type { SourceAdapter } from '../../src/core/ports.js';
import {
  DOC_KINDS,
  LICENSE_TIERS,
  type AdapterType,
  type Product,
  type SourceDef,
  type VersionLine,
} from '../../src/core/types.js';
import type { TestCtx } from './make-ctx.js';

/** One adapter under the shared contract suite. */
export interface AdapterContractCase<A extends AdapterType> {
  adapter: SourceAdapter<A>;
  product: Product;
  source: SourceDef<A>;
  /** Default: the product's current line. */
  line?: VersionLine;
  /** A fresh context holding the happy-path cassette. Called once per test. */
  ctx: () => TestCtx;
  /** Hosts catalogue refs may point to. Default: no host check. */
  allowedHosts?: readonly string[];
  /** Smallest acceptable number of records from `enumerate`. Default 1. */
  minRecords?: number;
  /** A ref from the cassette to read; omit to skip the `read` check. */
  readRef?: string;
}

/**
 * Registers the contract every source adapter must meet (design section 9, WP5 and WP6):
 *
 * - `enumerate()` returns absolute, de-duplicated refs with a valid kind, bound to the
 *   product, source and line it was called for, within `maxEnumerateRequests`, without
 *   touching anything outside the cassette;
 * - `probe()` uses at most two requests;
 * - `read()` returns a page with sections and the attribution line of its licence tier;
 * - when every upstream request fails, nothing but `McpDocError` crosses the adapter boundary.
 *
 * Adapter-specific behaviour (renamed fields, rotated hashes, empty indexes) is tested by
 * the owning package next to its cassettes.
 */
export function describeAdapterContract<A extends AdapterType>(
  name: string,
  makeCase: () => AdapterContractCase<A>,
): void {
  describe(`adapter contract: ${name}`, () => {
    const bound = (c: AdapterContractCase<A>) => {
      const line = c.line ?? c.product.lines.find((candidate) => candidate.current);
      if (line === undefined) throw new Error('the contract case needs a current version line');
      return bindSource(c.product, c.source, line);
    };

    it('declares its type and a positive enumerate budget', () => {
      const c = makeCase();
      expect(c.adapter.type).toBe(c.source.adapter);
      expect(c.adapter.maxEnumerateRequests).toBeGreaterThan(0);
    });

    it('enumerates well-formed, de-duplicated records within its request budget', async () => {
      const c = makeCase();
      if (c.adapter.enumerate === undefined) return;
      const ctx = c.ctx();
      const src = bound(c);
      const records = await c.adapter.enumerate(ctx, src);

      expect(ctx.http.unrecorded).toEqual([]);
      expect(ctx.http.count()).toBeLessThanOrEqual(c.adapter.maxEnumerateRequests);
      expect(records.length).toBeGreaterThanOrEqual(c.minRecords ?? 1);

      const refs = records.map((record) => record.ref);
      expect(new Set(refs).size, 'refs are unique').toBe(refs.length);
      for (const record of records) {
        if (!record.ref.startsWith(BRIEF_PREFIX)) {
          const url = new URL(record.ref);
          expect(url.protocol, record.ref).toBe('https:');
          if (c.allowedHosts !== undefined) expect(c.allowedHosts, record.ref).toContain(url.host);
        }
        expect(DOC_KINDS, record.ref).toContain(record.kind);
        expect(LICENSE_TIERS, record.ref).toContain(record.license);
        expect(record.title.trim(), record.ref).not.toBe('');
        expect(record.product).toBe(c.product.id);
        expect(record.source).toBe(c.source.id);
        expect(record.line).toBe(src.line.id);
        if (record.parent !== undefined) {
          // A member must be findable by its qualified name and say what it is.
          expect(record.qualified, record.ref).toBeDefined();
          expect(record.symbolKind, record.ref).toBeDefined();
        }
      }
    });

    it('probes with at most two requests', async () => {
      const c = makeCase();
      const ctx = c.ctx();
      const result = await c.adapter.probe(ctx, bound(c));
      expect(ctx.http.unrecorded).toEqual([]);
      expect(ctx.http.count()).toBeLessThanOrEqual(2);
      expect(result.ok).toBe(true);
      expect(result.ms).toBeGreaterThanOrEqual(0);
    });

    it('reads a page with sections and attribution', async () => {
      const c = makeCase();
      if (c.readRef === undefined) return;
      const ctx = c.ctx();
      const page = await c.adapter.read(ctx, bound(c), { url: new URL(c.readRef) });
      expect(ctx.http.unrecorded).toEqual([]);
      expect(page.sections.length).toBeGreaterThan(0);
      expect(LICENSE_TIERS).toContain(page.license);
      if (page.license !== 'project') expect(page.attribution).not.toBe('');
    });

    it('lets nothing but McpDocError cross its boundary when upstream fails', async () => {
      const c = makeCase();
      const ctx = c.ctx();
      ctx.http.fail(/.*/, 503);
      const src = bound(c);
      const attempts: Array<Promise<unknown>> = [c.adapter.probe(ctx, src)];
      if (c.adapter.enumerate !== undefined) attempts.push(c.adapter.enumerate(ctx, src));
      if (c.readRef !== undefined) {
        attempts.push(c.adapter.read(ctx, src, { url: new URL(c.readRef) }));
      }
      for (const outcome of await Promise.allSettled(attempts)) {
        if (outcome.status === 'rejected') {
          expect(isMcpDocError(outcome.reason), String(outcome.reason)).toBe(true);
        }
      }
    });
  });
}
