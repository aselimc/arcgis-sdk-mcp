import { describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { McpDocError, isMcpDocError } from '../../../../src/core/errors.js';
import {
  docTemplate,
  fillTemplate,
  fragmentOf,
  matchTemplate,
  probeDeclared,
  renderOptionsOf,
  selectorOf,
  shapeError,
  summaryOf,
  tolerate,
} from '../../../../src/adapters/reference/npm/shared.js';
import { makeLine } from '../../../support/builders.js';
import { distTags, npmCtx, productOf, typingsSource } from './helpers.js';

const TEMPLATE = 'https://developers.arcgis.com/widgets/latest/references/{pkg}/components/{tag}/';
const bound = () => bindSource(productOf(typingsSource), typingsSource, makeLine());

describe('documentation URL templates', () => {
  it('places a path on developers.arcgis.com and substitutes line variables', () => {
    const src = bindSource(
      productOf(typingsSource),
      typingsSource,
      makeLine({ vars: { prefix: 'v7/' } }),
    );
    expect(docTemplate(src, '/widgets/{prefix}references/core/{path}/')).toBe(
      'https://developers.arcgis.com/widgets/v7/references/core/{path}/',
    );
    expect(docTemplate(src, 'https://example.org/{path}')).toBe('https://example.org/{path}');
  });

  it('fills the placeholders it has values for and leaves the others', () => {
    expect(fillTemplate(TEMPLATE, { pkg: 'widget-components' })).toBe(
      'https://developers.arcgis.com/widgets/latest/references/widget-components/components/{tag}/',
    );
  });

  it('reads placeholder values back from a URL, ignoring fragment, query and trailing slash', () => {
    const url = fillTemplate(TEMPLATE, { pkg: 'widget-components', tag: 'arcgis-gadget-panel' });
    const expected = { pkg: 'widget-components', tag: 'arcgis-gadget-panel' };
    expect(matchTemplate(TEMPLATE, url)).toEqual(expected);
    expect(matchTemplate(TEMPLATE, `${url}#heading`)).toEqual(expected);
    expect(matchTemplate(TEMPLATE, `${url.slice(0, -1)}?utm_source=x`)).toEqual(expected);
  });

  it('matches one segment per placeholder, several for {path}', () => {
    const base = 'https://developers.arcgis.com/widgets/latest/references/';
    expect(matchTemplate(TEMPLATE, `${base}a/components/b/c/`)).toBeUndefined();
    expect(matchTemplate(TEMPLATE, `${base}a/other/b/`)).toBeUndefined();
    expect(matchTemplate(`${base}core/{path}/`, `${base}core/layers/support/fieldUtils/`)).toEqual({
      path: 'layers/support/fieldUtils',
    });
  });

  it('handles templates without placeholders and repeated placeholders', () => {
    expect(matchTemplate('https://example.org/a/', 'https://example.org/a')).toEqual({});
    expect(matchTemplate('https://example.org/a/', 'https://example.org/b/')).toBeUndefined();
    expect(matchTemplate('https://example.org/{x}/{x}/', 'https://example.org/a/a/')).toEqual({
      x: 'a',
    });
    expect(
      matchTemplate('https://example.org/{x}/{x}/', 'https://example.org/a/b/'),
    ).toBeUndefined();
  });

  it('decodes values and survives malformed escapes', () => {
    expect(matchTemplate('https://example.org/{x}/', 'https://example.org/a%20b/')).toEqual({
      x: 'a b',
    });
    expect(matchTemplate('https://example.org/{x}/', 'https://example.org/a%zz/')).toEqual({
      x: 'a%zz',
    });
  });
});

describe('summaryOf', () => {
  it('takes the first sentence of the first paragraph on one line', () => {
    expect(summaryOf('Shows gadgets\nin a panel. Use it beside a map.\n\nMore.')).toBe(
      'Shows gadgets in a panel.',
    );
    expect(summaryOf('No full stop')).toBe('No full stop');
  });

  it('caps the length and ignores non-text', () => {
    const long = summaryOf(`${'word '.repeat(80)}end.`, 40);
    expect(long).toHaveLength(40);
    expect(long?.endsWith('…')).toBe(true);
    expect(summaryOf(undefined)).toBeUndefined();
    expect(summaryOf('   ')).toBeUndefined();
    expect(summaryOf(42)).toBeUndefined();
  });
});

describe('selectors', () => {
  const url = new URL('https://developers.arcgis.com/widgets/x/#event-ready');

  it('reads the decoded fragment', () => {
    expect(fragmentOf(url)).toBe('event-ready');
    expect(fragmentOf(new URL('https://developers.arcgis.com/widgets/x/#%24row'))).toBe('$row');
    expect(fragmentOf(new URL('https://developers.arcgis.com/widgets/x/#'))).toBeUndefined();
  });

  it('selects the member a fragment names unless the caller selected something', () => {
    expect(selectorOf({ url })).toEqual({ member: 'event-ready' });
    expect(selectorOf({ url, select: { section: 'overview' } })).toEqual({ section: 'overview' });
    expect(
      selectorOf({ url: new URL('https://developers.arcgis.com/widgets/x/') }),
    ).toBeUndefined();
  });

  it('builds renderer options only when there is something to ask for', () => {
    expect(
      renderOptionsOf({ url: new URL('https://developers.arcgis.com/widgets/x/') }),
    ).toBeUndefined();
    expect(renderOptionsOf({ url, detail: 'signature', focusedCode: true })).toEqual({
      select: { member: 'event-ready' },
      detail: 'signature',
      focusedCode: true,
    });
  });
});

describe('failure classification', () => {
  it('describes a changed file format as a failure that a retry cannot fix', () => {
    const error = shapeError('https://cdn.jsdelivr.net/npm/x', 'a file listing');
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ host: 'cdn.jsdelivr.net', retryable: false });
  });

  it('logs and returns an upstream failure', () => {
    const ctx = npmCtx();
    const failure = new McpDocError('DOC_NOT_FOUND', 'gone', { url: 'https://example.org/x' });
    expect(tolerate(ctx, bound(), failure, 'The listing')).toBe(failure);
    expect(ctx.logger.entries.at(-1)).toMatchObject({ level: 'warn' });
  });

  it('rethrows defects and failures caused by a spent budget', () => {
    const ctx = npmCtx();
    expect(() => tolerate(ctx, bound(), new TypeError('bug'), 'The listing')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    const spent = { ...bound(), budget: newBudget(0, 1000, ctx.clock) };
    const failure = new McpDocError('UPSTREAM_UNAVAILABLE', 'request budget');
    expect(() => tolerate(ctx, spent, failure, 'The listing')).toThrow(failure);
  });
});

describe('probeDeclared', () => {
  const url = distTags('@arcgis/widget-core');

  it('reports the measured size of a healthy source', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const result = await probeDeclared(ctx, bound());
    expect(result).toMatchObject({ ok: true, records: 3 });
    expect(result.chars).toBeGreaterThan(10);
    expect(ctx.http.count()).toBe(1);
  });

  it.each([
    [{ minRecords: 5 }, 'at least 5 records'],
    [{ minChars: 10_000 }, 'at least 10000 characters'],
    [{ mustContain: 'stable' }, 'does not contain "stable"'],
  ])('fails when the response misses what the probe promises: %j', async (extra, message) => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    const source = { ...typingsSource, probe: { url, expect: 'json' as const, ...extra } };
    const result = await probeDeclared(ctx, bindSource(productOf(source), source, makeLine()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
  });

  it('counts nothing for a body that is not JSON data', async () => {
    const ctx = npmCtx();
    ctx.http.on(url, { body: '{"latest": ' });
    const source = { ...typingsSource, probe: { url, expect: 'json' as const, minRecords: 1 } };
    const result = await probeDeclared(ctx, bindSource(productOf(source), source, makeLine()));
    expect(result).toMatchObject({ ok: false, error: 'Expected at least 1 records, found 0' });
  });

  it('never rejects', async () => {
    const ctx = npmCtx({ cassette: 'dts.json' });
    ctx.http.fail(url, 503);
    const result = await probeDeclared(ctx, bound());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^UPSTREAM_UNAVAILABLE: /);
    expect(isMcpDocError(result)).toBe(false);
  });
});
