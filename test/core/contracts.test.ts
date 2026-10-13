import { describe, expect, expectTypeOf, it } from 'vitest';
import { CAPABILITIES } from '../../src/core/capabilities.js';
import { ERROR_CODES, type ErrorCode } from '../../src/core/errors.js';
import type * as F from '../../src/core/factories.js';
import type {
  BoundSource,
  Ctx,
  ProductResolution,
  Registry,
  Services,
  SourceAdapter,
} from '../../src/core/ports.js';
import {
  ADAPTER_TYPES,
  CATEGORIES,
  DOC_KINDS,
  HTML_FAMILIES,
  LICENSE_TIERS,
  type AdapterConfigMap,
  type AdapterType,
  type AnySourceDef,
  type Capability,
  type Category,
  type DocKind,
  type HtmlFamily,
  type LicenseTier,
  type Product,
  type SourceDef,
} from '../../src/core/types.js';
import { makeProduct, makeSource } from '../support/builders.js';

/**
 * The contracts are types, so most of this file is checked by `tsc` (`npm run typecheck`):
 * an `expectTypeOf` mismatch or a missing `@ts-expect-error` target fails the build. The
 * runtime assertions keep the literal lists honest.
 */
describe('literal lists cover their union types', () => {
  it('has no duplicates and the sizes the design states', () => {
    const lists = {
      ADAPTER_TYPES,
      CATEGORIES,
      DOC_KINDS,
      HTML_FAMILIES,
      LICENSE_TIERS,
      CAPABILITIES,
      ERROR_CODES,
    };
    for (const [name, list] of Object.entries(lists)) {
      expect(new Set<string>(list).size, name).toBe(list.length);
    }
    expect(ADAPTER_TYPES).toHaveLength(20);
    expect(HTML_FAMILIES).toHaveLength(16);
    expect(CATEGORIES).toHaveLength(11);
    expect(DOC_KINDS).toHaveLength(9);
    expect(LICENSE_TIERS).toHaveLength(6);
  });

  it('is exhaustive at the type level', () => {
    expectTypeOf<(typeof ADAPTER_TYPES)[number]>().toEqualTypeOf<AdapterType>();
    expectTypeOf<(typeof CATEGORIES)[number]>().toEqualTypeOf<Category>();
    expectTypeOf<(typeof DOC_KINDS)[number]>().toEqualTypeOf<DocKind>();
    expectTypeOf<(typeof HTML_FAMILIES)[number]>().toEqualTypeOf<HtmlFamily>();
    expectTypeOf<(typeof LICENSE_TIERS)[number]>().toEqualTypeOf<LicenseTier>();
    expectTypeOf<(typeof CAPABILITIES)[number]>().toEqualTypeOf<Capability>();
    expectTypeOf<(typeof ERROR_CODES)[number]>().toEqualTypeOf<ErrorCode>();
    expectTypeOf<keyof AdapterConfigMap>().toEqualTypeOf<AdapterType>();
  });
});

describe('source definitions are a discriminated union', () => {
  it('narrows config by adapter', () => {
    const product = makeProduct({
      sources: [
        makeSource('astro', { base: '/widgets/', sitemap: 'sitemap-0.xml' }),
        makeSource(
          'github-repo',
          { repo: 'Esri/example-samples', preset: 'samples-metadata' },
          { id: 'samples', floor: false },
        ),
      ],
    });
    const described = product.sources.map((source: AnySourceDef) => {
      switch (source.adapter) {
        case 'astro':
          expectTypeOf(source.config).toEqualTypeOf<AdapterConfigMap['astro']>();
          return `astro:${source.config.base}`;
        case 'github-repo':
          expectTypeOf(source.config).toEqualTypeOf<AdapterConfigMap['github-repo']>();
          return `repo:${source.config.repo}`;
        default:
          return source.adapter;
      }
    });
    expect(described).toEqual(['astro:/widgets/', 'repo:Esri/example-samples']);
  });

  it('rejects a config that does not belong to the adapter', () => {
    const wrong: Product['sources'] = [
      {
        id: 'guide',
        title: 'Guide',
        kinds: ['guide'],
        adapter: 'astro',
        // @ts-expect-error a github-repo config on an astro source must not compile
        config: { repo: 'Esri/example', preset: 'wiki' },
        probe: { url: 'https://developers.arcgis.com/widgets/', expect: 'html' },
      },
    ];
    expect(wrong).toHaveLength(1);
  });

  it('keeps concrete and union source types mutually usable', () => {
    expectTypeOf<SourceDef<'astro'>>().toExtend<AnySourceDef>();
    expectTypeOf<AnySourceDef>().toExtend<SourceDef>();
    expectTypeOf<NonNullable<ProductResolution['source']>>().toEqualTypeOf<AnySourceDef>();
    expectTypeOf<BoundSource<'gatsby'>['source']['config']>().toEqualTypeOf<
      AdapterConfigMap['gatsby']
    >();
  });
});

describe('ports and factories fit together', () => {
  it('lets typed adapters be collected as SourceAdapter[]', () => {
    expectTypeOf<SourceAdapter<'astro'>>().toExtend<SourceAdapter>();
    expectTypeOf<ReturnType<F.SiteAdapters>>().toEqualTypeOf<SourceAdapter[]>();
    expectTypeOf<ReturnType<F.ReferenceAdapters>>().toEqualTypeOf<SourceAdapter[]>();
  });

  it('wires the composition root without casts', () => {
    expectTypeOf<ReturnType<F.CreateRegistry>>().toEqualTypeOf<Registry>();
    expectTypeOf<Parameters<F.CreateVersionService>[0]>().toEqualTypeOf<Ctx>();
    expectTypeOf<ReturnType<F.CreateServices>>().toEqualTypeOf<Omit<Services, 'versions'>>();
    expectTypeOf<
      ReturnType<F.CreateServices> & { versions: ReturnType<F.CreateVersionService> }
    >().toExtend<Services>();
    expectTypeOf<Parameters<F.CreateRenderer>[0]>().toEqualTypeOf<
      ReturnType<F.CreateHtmlExtractor>
    >();
    expectTypeOf<Ctx['render']['detectMetaRefresh']>().toExtend<
      Parameters<F.CreateHttpClient>[0]['detectMetaRefresh']
    >();
  });
});
