import { describe, expect, it } from 'vitest';
import {
  npmAdapters,
  npmCemAdapter,
  npmDtsAdapter,
  npmJsonAdapter,
} from '../../../../src/adapters/reference/npm/index.js';
import { ADAPTER_TYPES } from '../../../../src/core/types.js';

describe('npmAdapters', () => {
  it('returns one adapter per npm adapter type', () => {
    const adapters = npmAdapters();
    expect(adapters).toEqual([npmDtsAdapter, npmCemAdapter, npmJsonAdapter]);
    expect(adapters.map((adapter) => adapter.type)).toEqual(['npm-dts', 'npm-cem', 'npm-json']);
    for (const adapter of adapters) expect(ADAPTER_TYPES).toContain(adapter.type);
  });

  it('returns the same stateless instances on every call', () => {
    expect(npmAdapters()[0]).toBe(npmAdapters()[0]);
  });

  it('gives every adapter a symbol reader and a canary', () => {
    for (const adapter of npmAdapters()) {
      expect(adapter.enumerate).toBeTypeOf('function');
      expect(adapter.symbol).toBeTypeOf('function');
      expect(adapter.probe).toBeTypeOf('function');
      expect(adapter.sample).toBeUndefined();
    }
  });
});
