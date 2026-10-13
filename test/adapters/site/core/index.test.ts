import { describe, expect, it } from 'vitest';
import { siteAdapters } from '../../../../src/adapters/site/index.js';
import { ADAPTER_TYPES } from '../../../../src/core/types.js';

describe('siteAdapters', () => {
  it('returns one adapter per site adapter type, in the order of the type list', () => {
    const types = siteAdapters().map((adapter) => adapter.type);
    // The first eight adapter types are the site adapters; the rest are reference adapters.
    expect(types).toEqual(ADAPTER_TYPES.slice(0, 8));
  });

  it('returns adapters that declare a positive enumerate budget and the required operations', () => {
    for (const adapter of siteAdapters()) {
      expect(adapter.maxEnumerateRequests, adapter.type).toBeGreaterThan(0);
      expect(typeof adapter.read, adapter.type).toBe('function');
      expect(typeof adapter.probe, adapter.type).toBe('function');
    }
  });
});
