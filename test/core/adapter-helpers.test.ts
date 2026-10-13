import { describe, expect, it, vi } from 'vitest';
import {
  bindSource,
  classifyUrl,
  defaultSymbolRead,
  humanizeSlug,
  matchUrlFilter,
} from '../../src/core/adapter-helpers.js';
import type { ReadTarget } from '../../src/core/ports.js';
import type { UrlFilter } from '../../src/core/types.js';
import { makeDocPage, makeLine, makeProduct, makeRecord, makeSource } from '../support/builders.js';
import { makeCtx } from '../support/make-ctx.js';

const latest = makeLine();

describe('matchUrlFilter and classifyUrl', () => {
  const filter: UrlFilter = {
    include: ['^guide/', '^tutorials/', '^release-notes'],
    exclude: ['/live/$', '^guide/internal/'],
    classify: [
      ['^tutorials/', 'tutorial'],
      ['^release-notes', 'release-notes'],
    ],
  };

  it('requires an include match when include is given and no exclude match', () => {
    expect(matchUrlFilter('guide/intro/', filter)).toBe(true);
    expect(matchUrlFilter('tutorials/first-map/', filter)).toBe(true);
    expect(matchUrlFilter('api-reference/x/', filter)).toBe(false);
    expect(matchUrlFilter('guide/intro/live/', filter)).toBe(false);
    expect(matchUrlFilter('guide/internal/notes/', filter)).toBe(false);
  });

  it('accepts everything without rules, and treats an empty include as absent', () => {
    expect(matchUrlFilter('anything/', {})).toBe(true);
    expect(matchUrlFilter('anything/', { include: [] })).toBe(true);
    expect(matchUrlFilter('anything/', { exclude: ['^any'] })).toBe(false);
  });

  it('classifies by the first matching rule, else the fallback', () => {
    expect(classifyUrl('tutorials/first-map/', filter)).toBe('tutorial');
    expect(classifyUrl('release-notes/5.1/', filter)).toBe('release-notes');
    expect(classifyUrl('guide/intro/', filter)).toBe('guide');
    expect(classifyUrl('guide/intro/', filter, 'help')).toBe('help');
    expect(classifyUrl('x/', {})).toBe('guide');
    expect(
      classifyUrl('tutorials/x/', {
        classify: [
          ['^tut', 'sample'],
          ['^tutorials/', 'tutorial'],
        ],
      }),
    ).toBe('sample');
  });

  it('throws for a pattern that is not a regular expression', () => {
    expect(() => matchUrlFilter('x', { include: ['('] })).toThrow(SyntaxError);
  });
});

describe('defaultSymbolRead', () => {
  const page = makeDocPage();
  const ctx = makeCtx();
  const src = bindSource(makeProduct(), makeSource('astro', { base: '/widgets/' }), latest);

  async function targetFor(record: Parameters<typeof makeRecord>[0]): Promise<ReadTarget> {
    const read = vi.fn(async () => page);
    const symbol = defaultSymbolRead({ read });
    const full = makeRecord(record);
    await expect(symbol(ctx, src, full, 'summary')).resolves.toBe(page);
    expect(read).toHaveBeenCalledTimes(1);
    const [calledCtx, calledSrc, target] = read.mock.calls[0] as unknown as [
      unknown,
      unknown,
      ReadTarget,
    ];
    expect(calledCtx).toBe(ctx);
    expect(calledSrc).toBe(src);
    expect(target.record).toBe(full);
    expect(target.detail).toBe('summary');
    return target;
  }

  it('reads a type page without a member selection', async () => {
    const target = await targetFor({
      ref: 'https://developers.arcgis.com/widgets/api/Widget/',
      symbol: 'Widget',
      qualified: 'Widget',
    });
    expect(target.url.href).toBe('https://developers.arcgis.com/widgets/api/Widget/');
    expect('select' in target).toBe(false);
  });

  it('selects the member when the record has a parent', async () => {
    const target = await targetFor({
      ref: 'https://developers.arcgis.com/widgets/api/Widget/#render',
      symbol: 'render',
      qualified: 'Widget.render',
      parent: 'Widget',
    });
    expect(target.url.hash).toBe('#render');
    expect(target.select).toEqual({ member: 'render' });
  });

  it('derives the member name from the qualified name when symbol is absent', async () => {
    expect(
      (await targetFor({ qualified: 'arcgis.gis.GIS.content', parent: 'arcgis.gis.GIS' })).select,
    ).toEqual({ member: 'content' });
    expect((await targetFor({ qualified: 'Map::setBasemap', parent: 'Map' })).select).toEqual({
      member: 'setBasemap',
    });
    expect('select' in (await targetFor({ parent: 'Widget' }))).toBe(false);
  });
});

describe('humanizeSlug', () => {
  it.each([
    ['get-started-with-oauth', 'Get started with oauth'],
    ['https://developers.arcgis.com/widgets/guide/add-a-layer/', 'Add a layer'],
    ['tool-reference/analysis/buffer.html', 'Buffer'],
    ['ProConcepts-Editing.html', 'ProConcepts Editing'],
    ['snake_case_name.md', 'Snake case name'],
    ['000012345', '000012345'],
    ['error-000735-value-is-required/?utm=1#fix', 'Error 000735 value is required'],
    ['How%20to%20publish', 'How to publish'],
    ['100%-broken', '100% broken'],
    ['notebook.ipynb', 'Notebook'],
    ['', ''],
    ['///', ''],
  ])('%j -> %j', (slug, title) => {
    expect(humanizeSlug(slug)).toBe(title);
  });
});
