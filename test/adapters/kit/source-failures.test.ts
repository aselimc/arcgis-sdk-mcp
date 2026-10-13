import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  assertLive,
  budgetOf,
  indexRequest,
  licenseOf,
  siteIndexEnabled,
  skipOptional,
  tolerate,
  unusableIndex,
} from '../../../src/adapters/kit/index.js';
import { bindSource } from '../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../src/core/async.js';
import { McpDocError } from '../../../src/core/errors.js';
import { makeLine, makeProduct, makeSource } from '../../support/builders.js';
import { fakePolicy } from '../../support/fake-policy.js';
import { makeCtx } from '../../support/make-ctx.js';

const source = makeSource('astro', { base: '/widgets/{prefix}' }, { id: 'guide' });
const product = makeProduct({ sources: [source], licenseTier: 'esri-website-terms' });
const line = makeLine({ vars: { prefix: 'v2/' } });
const bound = () => bindSource(product, source, line);

describe('adapter kit: the bound source', () => {
  it('keeps full URLs, puts rooted paths on developers.arcgis.com and joins the rest to the source', () => {
    expect(absoluteUrl('https://example.com/a', bound())).toBe('https://example.com/a');
    expect(absoluteUrl('/gadgets/{prefix}x/', bound())).toBe(
      'https://developers.arcgis.com/gadgets/v2/x/',
    );
    expect(absoluteUrl('sitemap-0.xml', bound())).toBe(
      'https://developers.arcgis.com/widgets/v2/sitemap-0.xml',
    );
  });

  it('takes the licence of the source before the one of the product', () => {
    expect(licenseOf(bound())).toBe('esri-website-terms');
    const own = { ...source, license: 'apache-2.0' as const };
    expect(licenseOf(bindSource(product, own, line))).toBe('apache-2.0');
  });

  it('passes a budget on only when the source is bound to one', () => {
    const ctx = makeCtx();
    const budget = newBudget(3, 1000, ctx.clock);
    expect(budgetOf(bound())).toEqual({});
    expect(budgetOf(bindSource(product, source, line, undefined, budget))).toEqual({ budget });
    expect(indexRequest(bound(), 'https://developers.arcgis.com/widgets/i.json', 'json')).toEqual({
      url: 'https://developers.arcgis.com/widgets/i.json',
      expect: 'json',
      ttl: 'index',
    });
  });

  it('refuses a link-only line with the link', () => {
    const src = bindSource(
      product,
      source,
      makeLine({ id: 'v1', label: '1.x', access: 'link-only' }),
    );
    const url = 'https://archive.developers.arcgis.com/widgets/';
    const why = 'Documentation of version line "v1" is available as a link only';
    expect(() => assertLive(src, url)).toThrowError(
      expect.objectContaining({
        code: 'LINK_ONLY',
        details: { why, url, host: 'archive.developers.arcgis.com' },
      }),
    );
    expect(() => assertLive(bound(), 'https://developers.arcgis.com/widgets/')).not.toThrow();
  });

  it('says why a source is not enumerated while site-index is off', () => {
    const ctx = makeCtx({ policy: fakePolicy({ enabled: ['website'] }) });
    expect(siteIndexEnabled(ctx, bound())).toBe(false);
    expect(ctx.logger.messages('info')).toHaveLength(1);
    expect(siteIndexEnabled(makeCtx(), bound())).toBe(true);
  });
});

describe('adapter kit: tolerate', () => {
  const notFound = new McpDocError('DOC_NOT_FOUND', 'gone', { url: 'https://example.com/x' });

  it('logs an upstream failure and returns it', () => {
    const ctx = makeCtx();
    expect(tolerate(ctx, bound(), notFound, 'The index')).toBe(notFound);
    expect(ctx.logger.entries).toEqual([
      {
        level: 'warn',
        msg: 'The index is unavailable; continuing without it',
        fields: {
          product: 'widgets-sdk',
          source: 'guide',
          line: 'latest',
          code: 'DOC_NOT_FOUND',
          url: 'https://example.com/x',
        },
      },
    ]);
  });

  it('rethrows when the request budget is spent, and wraps anything that is not a typed error', () => {
    const ctx = makeCtx();
    const spent = bindSource(product, source, line, undefined, newBudget(0, 60_000, ctx.clock));
    expect(() => tolerate(ctx, spent, notFound, 'The index')).toThrow(notFound);
    expect(() => tolerate(ctx, bound(), new TypeError('boom'), 'The index')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    expect(ctx.logger.entries).toEqual([]);
  });

  // The hub-dev finding: with one request per minute the gateway refuses the third document
  // of five long before the budget object itself counts as spent. Carrying on would store
  // two fifths of the catalogue as the whole.
  it.each(['budget', 'pacing', 'cancelled'])(
    'rethrows a request the gateway declined (%s) although the budget is not spent',
    (declined) => {
      const ctx = makeCtx();
      const src = bindSource(product, source, line, undefined, newBudget(8, 120_000, ctx.clock));
      const refused = new McpDocError('UPSTREAM_UNAVAILABLE', 'The request was not sent', {
        url: 'https://hub.arcgis.com/api/feed/definition',
        retryable: true,
        // The gateway's own detail; the error catalogue of src/core does not declare it.
        ...({ declined } as object),
      });
      expect(() => tolerate(ctx, src, refused, 'OpenAPI document feed')).toThrow(refused);
      expect(ctx.logger.entries).toEqual([]);
    },
  );
});

describe('adapter kit: skipOptional', () => {
  const missing = new McpDocError('DOC_NOT_FOUND', 'gone', { url: 'https://example.com/x' });

  it('notes a skipped part at debug level and says whether more can be asked for', () => {
    const ctx = makeCtx();
    expect(skipOptional(ctx, bound(), missing, 'src/Main.cs')).toBe(false);
    expect(ctx.logger.messages('debug')).toEqual(['src/Main.cs was skipped']);

    const spent = bindSource(product, source, line, undefined, newBudget(0, 1000, ctx.clock));
    expect(skipOptional(ctx, spent, missing, 'src/Other.cs')).toBe(true);
  });

  it('rethrows a defect', () => {
    expect(() => skipOptional(makeCtx(), bound(), new TypeError('bug'), 'x')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
  });
});

describe('adapter kit: unusableIndex', () => {
  it('is a failure a retry cannot fix', () => {
    const error = unusableIndex('https://developers.arcgis.com/widgets/index.json', 'It is empty');
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toEqual({
      why: 'It is empty',
      url: 'https://developers.arcgis.com/widgets/index.json',
      host: 'developers.arcgis.com',
      retryable: false,
    });
  });
});
