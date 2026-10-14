import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../../src/core/capabilities.js';
import type { IndexState, SymbolRequest } from '../../../src/core/ports.js';
import type { Capability } from '../../../src/core/types.js';
import { unsearchedError } from '../../../src/services/symbol/not-found.js';
import type { Target } from '../../../src/services/symbol/target.js';
import { makeLine, makeProduct } from '../../support/builders.js';
import { fakePolicy } from '../../support/fake-policy.js';
import { makeCtx } from '../../support/make-ctx.js';

const request: SymbolRequest = { symbol: 'ArcGISMap', detail: 'summary', maxTokens: 3000 };

const target = (): Target => ({
  product: makeProduct(),
  line: makeLine(),
  explicit: false,
  preferVersioned: false,
});

const state = (value: IndexState['state']): IndexState => ({
  product: 'widgets-sdk',
  source: 'guide',
  line: 'latest',
  state: value,
  records: 0,
});

const ctxWith = (enabled: readonly Capability[]) => makeCtx({ policy: fakePolicy({ enabled }) });

const without = (...off: Capability[]): Capability[] =>
  PRESETS.standard.filter((cap) => !off.includes(cap));

describe('unsearchedError', () => {
  it('names site-index when a website source built an empty index with site-index off', () => {
    const error = unsearchedError(
      ctxWith(without('site-index')),
      request,
      [target()],
      [state('partial')],
    );
    expect(error?.code).toBe('SOURCE_DISABLED');
    expect(error?.details?.capability).toBe('site-index');
    expect(error?.details?.next).toBe('Set ARCGIS_DOCS_SOURCES=+site-index');
    expect(error?.details?.retryable).toBeUndefined();
  });

  it('prefers the source capability itself over site-index', () => {
    const error = unsearchedError(
      ctxWith(without('website', 'site-index')),
      request,
      [target()],
      [state('unavailable')],
    );
    expect(error?.details?.capability).toBe('website');
  });

  it('still reports an upstream failure when every capability is on', () => {
    const error = unsearchedError(
      ctxWith(PRESETS.standard),
      request,
      [target()],
      [state('partial')],
    );
    expect(error?.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error?.details?.retryable).toBe(true);
  });

  it('is not an error once any index was searched', () => {
    const error = unsearchedError(
      ctxWith(without('site-index')),
      request,
      [target()],
      [state('ready')],
    );
    expect(error).toBeUndefined();
  });
});
