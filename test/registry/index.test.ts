import { describe, expect, it } from 'vitest';
import { checkRegistry } from '../../scripts/registry-check.js';
import { McpDocError } from '../../src/core/errors.js';
import { CATEGORIES } from '../../src/core/types.js';
import { HOSTS } from '../../src/registry/hosts.js';
import { createRegistry } from '../../src/registry/index.js';

const registry = createRegistry();

describe('createRegistry', () => {
  it('assembles every data file into one list without duplicate ids', () => {
    const ids = registry.all().map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 60 developer-tier ids and the product help of design section 4.6.
    expect(ids.length).toBeGreaterThanOrEqual(120);
    expect(registry.all().filter((product) => product.tier === 'developer')).toHaveLength(60);
    for (const category of CATEGORIES) {
      expect(
        registry.all().some((product) => product.category === category),
        category,
      ).toBe(true);
    }
  });

  it('passes the registry lint as a whole', () => {
    const issues = checkRegistry(
      { products: registry.all(), hosts: registry.hosts(), briefs: registry.briefs() },
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(issues).toEqual([]);
  });

  it('lists developer products first, in the category order of the design', () => {
    const categories = registry
      .all()
      .filter((product) => product.tier === 'developer' && product.status !== 'retired')
      .map((product) => product.category);
    const order = [...new Set(categories)];
    expect(order.slice(0, 5)).toEqual([
      'web',
      'native',
      'game-engine',
      'python',
      'desktop-enterprise',
    ]);
    expect(registry.all()[0]?.id).toBe('js-maps-sdk');
  });

  it('looks products up by id', () => {
    expect(registry.get('kotlin-maps-sdk')?.name).toBe('ArcGIS Maps SDK for Kotlin');
    expect(registry.get('kotlin')).toBeUndefined();
    for (const product of registry.all()) expect(registry.get(product.id)).toBe(product);
  });

  it('resolves, routes and finds owners through one object', () => {
    expect(registry.resolve('@arcgis/core')).toMatchObject({
      product: { id: 'js-maps-sdk' },
      how: 'alias',
      resolvedFrom: '@arcgis/core',
    });
    expect(registry.resolve('rest-api/portal')).toMatchObject({
      product: { id: 'rest-api' },
      source: { id: 'portal' },
      how: 'scope',
    });
    expect(registry.resolve('arcpy/tools').source?.id).toBe('tools');
    expect(registry.route('kotlin offline map')[0]?.product).toBe('kotlin-maps-sdk');
    expect(registry.route('kotlin offline map', 1)).toHaveLength(1);
    const owner = registry.ownerOf(
      new URL('https://developers.arcgis.com/kotlin/v200/api-reference/some/index.html'),
    );
    expect(owner).toMatchObject({
      product: { id: 'kotlin-maps-sdk' },
      source: { id: 'api' },
      line: { id: 'v200' },
    });
  });

  it('suggests routed products when a name matches nothing', () => {
    try {
      registry.resolve('offline maps on android phones');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpDocError);
      expect((error as McpDocError).code).toBe('UNKNOWN_PRODUCT');
      expect((error as McpDocError).details?.candidates).toContain('kotlin-maps-sdk');
    }
  });

  it('resolves every id and alias of the whole registry to its product', () => {
    for (const product of registry.all()) {
      expect(registry.resolve(product.id)).toMatchObject({
        product: { id: product.id },
        how: 'id',
      });
      for (const alias of product.aliases) {
        expect(registry.resolve(alias).product.id, alias).toBe(product.id);
      }
    }
  });

  it('returns the version lines', () => {
    const kotlin = registry.get('kotlin-maps-sdk')!;
    expect(registry.line(kotlin).id).toBe('latest');
    expect(registry.line(kotlin, '200.8').id).toBe('v200');
    expect(() => registry.line(kotlin, '100.15')).toThrow(McpDocError);
    for (const product of registry.all()) {
      expect(registry.line(product).current, product.id).toBe(true);
    }
  });

  it('serves the host table and copies of the briefs', () => {
    expect(registry.hosts()).toBe(HOSTS);
    const briefs = registry.briefs();
    expect(briefs.length).toBeGreaterThan(0);
    for (const brief of briefs) {
      expect(brief.slug).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
      expect(brief.markdown.startsWith('# ')).toBe(true);
    }
    briefs[0]!.sources.push('changed');
    briefs[0]!.title = 'changed';
    expect(registry.briefs()[0]!.title).not.toBe('changed');
    expect(registry.briefs()[0]!.sources).not.toContain('changed');
  });

  it('owns every brief-independent start-here link or leaves it to a listed host', () => {
    const hosts = new Set(registry.hosts().map((host) => host.host));
    for (const product of registry.all()) {
      for (const link of product.startHere) {
        if (link.ref.startsWith('brief:')) {
          const slug = link.ref.slice('brief:'.length);
          expect(
            registry.briefs().some((brief) => brief.slug === slug),
            link.ref,
          ).toBe(true);
        } else {
          const host = new URL(link.ref).hostname;
          expect(host === 'github.com' || hosts.has(host), link.ref).toBe(true);
        }
      }
    }
  });

  it('is independent between calls', () => {
    const other = createRegistry();
    expect(other).not.toBe(registry);
    expect(other.all()).toEqual(registry.all());
  });
});
