import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertLive,
  continueWithout,
  dartdocAdapter,
  oneLine,
  recordOf,
  siteIndexEnabled,
  symbolTarget,
} from '../../../../src/adapters/reference/dartdoc.js';
import { doccAdapter } from '../../../../src/adapters/reference/docc.js';
import { docfxNetAdapter } from '../../../../src/adapters/reference/docfx-net.js';
import { dokkaAdapter } from '../../../../src/adapters/reference/dokka.js';
import { javadocAdapter } from '../../../../src/adapters/reference/javadoc.js';
import { pkgdownAdapter } from '../../../../src/adapters/reference/pkgdown.js';
import { sphinxAdapter } from '../../../../src/adapters/reference/sphinx.js';
import { xmldocAdapter } from '../../../../src/adapters/reference/xmldoc.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { McpDocError } from '../../../../src/core/errors.js';
import type { SourceAdapter } from '../../../../src/core/ports.js';
import { ADAPTER_TYPES } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeRecord, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { makeCtx } from '../../../support/make-ctx.js';

const OWN: SourceAdapter[] = [
  doccAdapter,
  dokkaAdapter,
  dartdocAdapter,
  docfxNetAdapter,
  javadocAdapter,
  sphinxAdapter,
  xmldocAdapter,
  pkgdownAdapter,
];

/** The npm and GitHub adapters are written by another work package and may not be there yet. */
const siblingsPresent = ['npm/index.ts', 'github/index.ts'].every((file) =>
  existsSync(fileURLToPath(new URL(`../../../../src/adapters/reference/${file}`, import.meta.url))),
);

describe('reference adapters', () => {
  it('has one stateless adapter per API-reference type, each with every operation', () => {
    expect(OWN.map((adapter) => adapter.type)).toEqual([
      'docc',
      'dokka',
      'dartdoc',
      'docfx-net',
      'javadoc',
      'sphinx',
      'xmldoc',
      'pkgdown',
    ]);
    for (const adapter of OWN) {
      expect(adapter.maxEnumerateRequests, adapter.type).toBeGreaterThan(0);
      expect(adapter.enumerate, adapter.type).toBeTypeOf('function');
      expect(adapter.symbol, adapter.type).toBeTypeOf('function');
    }
  });

  it.skipIf(!siblingsPresent)(
    'referenceAdapters() covers every reference adapter type once',
    async () => {
      const { referenceAdapters } = await import('../../../../src/adapters/reference/index.js');
      const types = referenceAdapters().map((adapter) => adapter.type);

      expect(new Set(types).size).toBe(types.length);
      expect([...types].sort()).toEqual([...ADAPTER_TYPES.slice(8)].sort());
      for (const adapter of OWN) expect(referenceAdapters()).toContain(adapter);
      expect(referenceAdapters()[0]).toBe(referenceAdapters()[0]);
    },
  );
});

describe('shared building blocks', () => {
  const source = makeSource('dokka', { base: '/widgets/api-reference/kotlin/' }, { id: 'api' });
  const product = makeProduct({ sources: [source], licenseTier: 'esri-website-terms' });
  const bound = () => bindSource(product, source, makeLine());

  it('builds records without empty fields and with the breadcrumb joined', () => {
    const record = recordOf(bound(), 'https://developers.arcgis.com/widgets/x.html', 'X', {
      symbol: 'X',
      qualified: '',
      parent: undefined,
      breadcrumb: ['', 'pkg', 'Outer'],
      deprecated: true,
    });

    expect(record).toEqual({
      ref: 'https://developers.arcgis.com/widgets/x.html',
      product: 'widgets-sdk',
      source: 'api',
      line: 'latest',
      kind: 'api',
      title: 'X',
      breadcrumb: 'pkg > Outer',
      symbol: 'X',
      deprecated: true,
      license: 'esri-website-terms',
    });
    expect(
      recordOf(bound(), 'https://developers.arcgis.com/widgets/y.html', 'Y'),
    ).not.toHaveProperty('breadcrumb');
  });

  it('flattens and caps index text', () => {
    expect(oneLine('  two\n  lines ')).toBe('two lines');
    expect(oneLine('   ')).toBeUndefined();
    expect(oneLine(42)).toBeUndefined();
    expect(oneLine('abcdefghij', 6)).toBe('abcde…');
  });

  it('selects a member by its anchor only when the record is a member', () => {
    const member = makeRecord({
      ref: 'https://developers.arcgis.com/w/T.html#go(int)',
      parent: 'T',
    });
    const broken = makeRecord({
      ref: 'https://developers.arcgis.com/w/T.html#%E0%A4%A',
      parent: 'T',
    });
    const type = makeRecord({ ref: 'https://developers.arcgis.com/w/T.html#top' });

    expect(symbolTarget(member, 'summary')).toMatchObject({
      select: { member: 'go(int)' },
      detail: 'summary',
      record: member,
    });
    expect(symbolTarget(broken, 'full').select).toEqual({ member: '%E0%A4%A' });
    expect(symbolTarget(type, 'full').select).toBeUndefined();
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

  it('continues after an upstream failure but not after a defect or a spent budget', () => {
    const ctx = makeCtx();
    const missing = new McpDocError('DOC_NOT_FOUND', 'gone', { url: 'https://example.com/x' });

    expect(() => continueWithout(ctx, bound(), missing, 'The file')).not.toThrow();
    expect(ctx.logger.messages('warn')).toEqual([
      'The file is unavailable; enumerating without it',
    ]);
    expect(() => continueWithout(ctx, bound(), new TypeError('boom'), 'The file')).toThrowError(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    const spent = bindSource(product, source, makeLine(), undefined, newBudget(0, 1000, ctx.clock));
    expect(() => continueWithout(ctx, spent, missing, 'The file')).toThrowError(missing);
  });
});
