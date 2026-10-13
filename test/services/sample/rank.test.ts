import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../../src/core/budget.js';
import type { SampleHit } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import {
  confirmsApi,
  fitCode,
  fitListing,
  hitTokens,
  matchesPlatform,
  mentionsApi,
  mergeSampleTwins,
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

  it('lists a sample once when the site and the repository both have it', () => {
    const page = (slug: string, title: string, extra = {}) =>
      makeRecord({
        ref: `https://developers.arcgis.com/widgets/sample-code/${slug}/`,
        kind: 'sample',
        title,
        ...extra,
      });
    const repo = (path: string, title: string, extra = {}) =>
      makeRecord({
        ref: `https://github.com/Esri/widgets-samples/blob/v3.1.0/${path}/README.md`,
        kind: 'sample',
        title,
        license: 'apache-2.0',
        ...extra,
      });
    const sitePlanned = page('download-planned-area', 'Download planned area', {
      description: 'Take a planned area offline.',
      breadcrumb: 'Offline',
    });
    const repoPlanned = repo('samples/download-planned-area', 'Download planned area');
    const repoOffline = repo('samples/go-offline', 'Go offline', { description: 'Own summary.' });
    const siteOnly = page('show-tides', 'Show tides');
    const siteOffline = page('go-offline', 'Go Offline', { description: 'Site summary.' });

    expect(
      mergeSampleTwins([sitePlanned, repoPlanned, repoOffline, siteOnly, siteOffline]),
    ).toEqual([
      // The repository copy takes the page's rank, description and location.
      { ...repoPlanned, description: 'Take a planned area offline.', breadcrumb: 'Offline' },
      repoOffline,
      siteOnly,
    ]);
    // The repository copy moves up to the rank of a better-placed page.
    expect(mergeSampleTwins([siteOffline, siteOnly, repoOffline]).map((r) => r.ref)).toEqual([
      repoOffline.ref,
      siteOnly.ref,
    ]);
  });

  it('keeps per-platform copies apart from a page of another platform', () => {
    const maui = makeRecord({
      ref: 'https://github.com/Esri/widgets-samples/blob/main/src/MAUI/ShowTides/readme.md',
      title: 'Show tides',
      platform: 'maui',
    });
    const wpf = { ...maui, ref: maui.ref.replace('MAUI', 'WPF'), platform: 'wpf' };
    const wpfPage = makeRecord({
      ref: 'https://developers.arcgis.com/widgets/wpf/sample-code/show-tides/',
      title: 'Show tides',
      platform: 'WPF',
    });
    expect(mergeSampleTwins([wpfPage, maui, wpf]).map((r) => r.ref)).toEqual([wpf.ref, maui.ref]);
    const winuiPage = { ...wpfPage, ref: wpfPage.ref.replace('wpf', 'winui'), platform: 'winui' };
    expect(mergeSampleTwins([winuiPage, maui]).map((r) => r.ref)).toEqual([
      winuiPage.ref,
      maui.ref,
    ]);
  });

  describe('listing budget', () => {
    const repo = 'https://github.com/Esri/widgets-samples/blob/v3.1.0/samples';
    const hit = (slug: string, files: number): SampleHit => ({
      record: makeRecord({ ref: `${repo}/${slug}/README.md`, title: slug, kind: 'sample' }),
      summary: 'Shows one thing the toolkit can do, in a sentence.',
      relevantApis: ['TideLayer', 'TideLayer.refresh'],
      origin: 'github',
      ...(files === 0
        ? {}
        : {
            files: Array.from({ length: files }, (_, index) => ({
              name: `src/main/java/com/example/widgets/${slug}/Screen${index}.kt`,
              ref: `${repo}/${slug}/src/main/java/com/example/widgets/${slug}/Screen${index}.kt`,
            })),
          }),
    });

    it('counts the file lines of a hit, which are most of its size', () => {
      const bare = hitTokens(hit('show-tides', 0));
      const withFiles = hitTokens(hit('show-tides', 3));
      expect(withFiles).toBeGreaterThan(bare * 2);
      // The estimate covers what the listing prints for the hit.
      const printed = hit('show-tides', 3);
      const text = [
        printed.record.title,
        printed.record.ref,
        printed.summary,
        ...(printed.files ?? []).map((file) => `File: ${file.name} ${file.ref}`),
      ].join('\n');
      expect(withFiles).toBeGreaterThanOrEqual(estimateTokens(text));
    });

    it('keeps everything when the listing fits', () => {
      const hits = [hit('a', 3), hit('b', 3)];
      const fitted = fitListing(hits, 5000);
      expect(fitted.hits).toEqual(hits);
      expect(fitted.trimmed).toBe(0);
      expect(fitted.tokens).toBe(hitTokens(hits[0]!) + hitTokens(hits[1]!));
    });

    it('drops file lists from the lowest-ranked hits first and never from the top hit', () => {
      const hits = [hit('a', 3), hit('b', 3), hit('c', 0), hit('d', 3)];
      const all = hits.reduce((total, entry) => total + hitTokens(entry), 0);
      const one = fitListing(hits, all - 1);
      expect(one.trimmed).toBe(1);
      expect(one.hits.map((entry) => entry.files?.length)).toEqual([3, 3, undefined, undefined]);
      expect(one.tokens).toBeLessThan(all);
      expect(one.tokens).toBe(one.hits.reduce((total, entry) => total + hitTokens(entry), 0));

      const tight = fitListing(hits, 1);
      expect(tight.trimmed).toBe(2);
      expect(tight.hits.map((entry) => entry.files?.length)).toEqual([
        3,
        undefined,
        undefined,
        undefined,
      ]);
      // Hits themselves are never dropped: the caller asked for this many.
      expect(tight.hits.map((entry) => entry.record.ref)).toEqual(hits.map((e) => e.record.ref));
      expect(hits[3]?.files).toHaveLength(3);
    });
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
