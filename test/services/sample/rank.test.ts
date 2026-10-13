import { describe, expect, it } from 'vitest';
import type { DocPage } from '../../../src/core/types.js';
import {
  confirmsApi,
  fitCode,
  matchesPlatform,
  mentionsApi,
  parseApi,
} from '../../../src/services/sample/rank.js';
import { makeDocPage, makeRecord } from '../../support/builders.js';

describe('sample rank helpers', () => {
  it('parses uses_api into its names', () => {
    expect(parseApi('FeatureLayer.applyEdits()')).toEqual({
      full: 'FeatureLayer.applyEdits',
      simple: 'applyEdits',
      type: 'FeatureLayer',
    });
    expect(parseApi('OGC3DTilesLayer')).toEqual({
      full: 'OGC3DTilesLayer',
      simple: 'OGC3DTilesLayer',
    });
    expect(parseApi('()')).toBeUndefined();
    expect(parseApi(undefined)).toBeUndefined();
  });

  it('checks whether a record names an API', () => {
    const record = makeRecord({
      title: 'Edit sample',
      description: 'Uses applyEdits on a FeatureLayer.',
      keywords: ['editing'],
    });
    const member = { full: 'FeatureLayer.applyEdits', simple: 'applyEdits', type: 'FeatureLayer' };
    expect(mentionsApi(record, member)).toBe(true);
    expect(mentionsApi(record, { full: 'applyEdits', simple: 'applyEdits' })).toBe(true);
    expect(
      mentionsApi(record, { ...member, full: 'SceneLayer.applyEdits', type: 'SceneLayer' }),
    ).toBe(false);
    expect(mentionsApi(makeRecord(), { full: 'X', simple: 'X' })).toBe(false);
  });

  it('confirms from metadata or from the main source file', () => {
    const member = { full: 'FeatureLayer.applyEdits', simple: 'applyEdits', type: 'FeatureLayer' };
    const type = { full: 'FeatureLayer', simple: 'FeatureLayer' };
    const anyMember = { full: 'applyEdits', simple: 'applyEdits' };
    const listing = (...relevantApis: string[]): DocPage => makeDocPage({ relevantApis });
    expect(confirmsApi(listing('FeatureLayer.applyEdits'), member)).toBe(true);
    expect(confirmsApi(listing('featurelayer.applyedits'), member)).toBe(true);
    // A sample that lists only the type does not confirm one of its members.
    expect(confirmsApi(listing('FeatureLayer'), member)).toBe(false);
    expect(confirmsApi(listing('FeatureLayer'), type)).toBe(true);
    expect(confirmsApi(listing('SceneLayer.applyEdits'), member)).toBe(false);
    expect(confirmsApi(listing('SceneLayer.applyEdits'), anyMember)).toBe(true);

    const withCode = (text: string): DocPage =>
      makeDocPage({ files: [{ name: 'a.js', language: 'js', text, ref: 'r', bytes: 1 }] });
    expect(confirmsApi(withCode('const l = new FeatureLayer(); l.applyEdits(e)'), member)).toBe(
      true,
    );
    expect(confirmsApi(withCode('table.applyEdits(e)'), member)).toBe(false);
    expect(confirmsApi(withCode('layer.applyEditsLater(e)'), anyMember)).toBe(false);
    expect(confirmsApi(makeDocPage(), type)).toBe(false);
  });

  it('matches platforms by field or by path', () => {
    const inRepo = (path: string) =>
      makeRecord({ ref: `https://github.com/Esri/x/tree/main/src/${path}` });
    expect(matchesPlatform(makeRecord({ platform: 'MAUI' }), 'maui')).toBe(true);
    expect(matchesPlatform(makeRecord({ platform: 'wpf, winui' }), 'winui')).toBe(true);
    expect(matchesPlatform(makeRecord({ platform: 'wpf' }), 'maui')).toBe(false);
    expect(matchesPlatform(inRepo('MAUI/Sample'), 'maui')).toBe(true);
    expect(matchesPlatform(inRepo('WPF/Sample'), 'maui')).toBe(false);
    expect(matchesPlatform(makeRecord(), ' ')).toBe(true);
  });

  it('cuts code at a line boundary', () => {
    expect(fitCode('a\nb', 100)).toEqual({ text: 'a\nb', truncated: false });
    const long = Array.from({ length: 200 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const cut = fitCode(long, 100);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(350);
    expect(long.startsWith(`${cut.text}\n`)).toBe(true);
    expect(fitCode('x'.repeat(2000), 10)).toEqual({ text: 'x'.repeat(35), truncated: true });
  });
});
