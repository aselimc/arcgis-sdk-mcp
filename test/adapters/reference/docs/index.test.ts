import { describe, expect, it } from 'vitest';
import { dartdocAdapter } from '../../../../src/adapters/reference/dartdoc.js';
import { doccAdapter } from '../../../../src/adapters/reference/docc.js';
import { docfxNetAdapter } from '../../../../src/adapters/reference/docfx-net.js';
import { dokkaAdapter } from '../../../../src/adapters/reference/dokka.js';
import { referenceAdapters } from '../../../../src/adapters/reference/index.js';
import { javadocAdapter } from '../../../../src/adapters/reference/javadoc.js';
import { pkgdownAdapter } from '../../../../src/adapters/reference/pkgdown.js';
import { sphinxAdapter } from '../../../../src/adapters/reference/sphinx.js';
import { xmldocAdapter } from '../../../../src/adapters/reference/xmldoc.js';
import type { SourceAdapter } from '../../../../src/core/ports.js';
import { ADAPTER_TYPES } from '../../../../src/core/types.js';

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

  it('referenceAdapters() covers every reference adapter type once', () => {
    const types = referenceAdapters().map((adapter) => adapter.type);

    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...ADAPTER_TYPES.slice(8)].sort());
    for (const adapter of OWN) expect(referenceAdapters()).toContain(adapter);
    expect(referenceAdapters()[0]).toBe(referenceAdapters()[0]);
  });
});
