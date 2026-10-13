import { describe, expect, it } from 'vitest';
import type { CachedHttpEntry, HttpRequest } from '../../src/core/ports.js';
import type { HostPolicy, TtlClass } from '../../src/core/types.js';
import { STALE_IF_ERROR_MS, TTL_MS, freshness } from '../../src/cache/ttl.js';
import {
  cacheKey,
  conditionalHeaders,
  defaultTtl,
  isFresh,
  usableEntry,
} from '../../src/net/freshness.js';
import { DAY, HOUR } from '../support/fake-clock.js';
import { hostRow } from './harness.js';

const NOW = Date.UTC(2026, 9, 13);

describe('TTL table (design section 6.2)', () => {
  it.each<[TtlClass, number]>([
    ['immutable', 365 * DAY],
    ['page', DAY],
    ['index', DAY],
    ['volatile', 6 * HOUR],
    ['github-meta', 7 * DAY],
    ['spec', 7 * DAY],
    ['remote-search', DAY],
    ['negative', HOUR],
  ])('%s is fresh for the specified time', (ttl, ms) => {
    expect(TTL_MS[ttl]).toBe(ms);
    expect(freshness(ttl, NOW).freshUntil).toBe(NOW + ms);
  });

  it('allows stale-if-error for 30 days, except for misses and remote search', () => {
    expect(STALE_IF_ERROR_MS).toBe(30 * DAY);
    expect(freshness('page', NOW).staleUntil).toBe(NOW + 30 * DAY);
    expect(freshness('volatile', NOW).staleUntil).toBe(NOW + 30 * DAY);
    // An immutable entry is fresh for longer than the stale window.
    expect(freshness('immutable', NOW).staleUntil).toBe(NOW + 365 * DAY);
    expect(freshness('negative', NOW).staleUntil).toBe(NOW + HOUR);
    expect(freshness('remote-search', NOW).staleUntil).toBe(NOW + DAY);
  });
});

describe('defaultTtl', () => {
  const website = hostRow('developers.arcgis.com');
  const hub = hostRow('hub.arcgis.com', { revalidate: 'none' });
  const cdn = hostRow('cdn.jsdelivr.net', { capability: 'package-cdn' });
  const raw = hostRow('raw.githubusercontent.com', { capability: 'github' });
  const api = hostRow('api.github.com', { capability: 'github' });
  const npm = hostRow('registry.npmjs.org', { capability: 'registries' });
  const esearch = hostRow('esearchapi.esri.com', { capability: 'site-search' });
  const plc = hostRow('plc-api.esri.com', { capability: 'lifecycle-api' });
  const sha = 'a'.repeat(40);

  it.each<[string, HostPolicy, string, HttpRequest['expect'], TtlClass]>([
    ['a page', website, '/javascript/latest/', 'html', 'page'],
    ['a search index', website, '/javascript/latest/search.json', 'json', 'index'],
    ['a sitemap', website, '/javascript/latest/sitemap-0.xml', 'xml', 'index'],
    ['a published OpenAPI document', hub, '/api/v3/docs-json', 'json', 'spec'],
    [
      'a pinned CDN file',
      cdn,
      '/npm/@arcgis/core@5.1.0/layers/FeatureLayer.d.ts',
      'text',
      'immutable',
    ],
    [
      'a pinned prerelease',
      cdn,
      '/npm/@arcgis/core@5.2.0-next.3/package.json',
      'json',
      'immutable',
    ],
    ['a CDN file at a dist-tag', cdn, '/npm/@arcgis/core@latest/package.json', 'json', 'volatile'],
    ['a CDN file at a range', cdn, '/npm/@arcgis/core@5/package.json', 'json', 'volatile'],
    ['raw content at a commit', raw, `/Esri/repo/${sha}/README.md`, 'text', 'immutable'],
    ['raw content at a branch', raw, '/Esri/repo/main/README.md', 'text', 'volatile'],
    ['a GitHub API answer', api, '/repos/Esri/repo', 'json', 'volatile'],
    ['registry metadata', npm, '/-/package/@arcgis/core/dist-tags', 'json', 'volatile'],
    ['site search results', esearch, '/search', 'json', 'remote-search'],
    ['lifecycle data', plc, '/api/PLC', 'json', 'volatile'],
  ])('%s', (_label, host, path, expectation, ttl) => {
    expect(defaultTtl(host, new URL(`https://${host.host}${path}`), expectation)).toBe(ttl);
  });
});

describe('cacheKey', () => {
  const url = new URL('https://developers.arcgis.com/x?b=1');

  it('separates method, body and encoding', () => {
    const keys = new Set([
      cacheKey('GET', url, undefined, undefined, 'json'),
      cacheKey('GET', url, undefined, 'base64', 'json'),
      cacheKey('POST', url, '{"q":1}', undefined, 'json'),
      cacheKey('POST', url, '{"q":2}', undefined, 'json'),
    ]);
    expect(keys.size).toBe(4);
    expect(cacheKey('GET', url, undefined, 'utf8', 'json')).toBe(
      cacheKey('GET', url, undefined, undefined, 'json'),
    );
  });

  it('separates the shapes a body is validated as', () => {
    const key = (expectation: HttpRequest['expect']) =>
      cacheKey('GET', url, undefined, undefined, expectation);
    expect(new Set([key('html'), key('json'), key('xml'), key('text')]).size).toBe(4);
    // yaml and text pass the same check, so one stored copy serves both.
    expect(key('yaml')).toBe(key('text'));
  });

  it('does not put the body itself into the key', () => {
    expect(cacheKey('POST', url, 'secret-query', undefined, 'json')).not.toContain('secret-query');
  });
});

describe('entry helpers', () => {
  const entry: CachedHttpEntry = {
    url: 'https://x.example.com/',
    finalUrl: 'https://x.example.com/',
    aliasChain: [],
    status: 200,
    contentType: 'text/html',
    body: '<p></p>',
    etag: '"e"',
    lastModified: 'Mon, 05 Oct 2026 08:00:00 GMT',
    fetchedAt: NOW,
    freshUntil: NOW + DAY,
    staleUntil: NOW + 30 * DAY,
    ttl: 'page',
  };

  it('knows fresh from expired from unusable', () => {
    expect(isFresh(entry, NOW + DAY - 1)).toBe(true);
    expect(isFresh(entry, NOW + DAY)).toBe(false);
    expect(usableEntry(entry, NOW + 30 * DAY - 1)).toBe(entry);
    expect(usableEntry(entry, NOW + 30 * DAY)).toBeUndefined();
    expect(usableEntry(undefined, NOW)).toBeUndefined();
  });

  it('omits a validator the entry does not have', () => {
    const { etag: _etag, ...withoutEtag } = entry;
    expect(
      conditionalHeaders(hostRow('x.example.com', { revalidate: 'both' }), withoutEtag),
    ).toEqual({ 'if-modified-since': entry.lastModified });
    expect(
      conditionalHeaders(hostRow('x.example.com', { revalidate: 'etag' }), withoutEtag),
    ).toEqual({});
  });
});
