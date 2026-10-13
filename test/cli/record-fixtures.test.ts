import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileNameFor, parseManifest, selectEntries } from '../../scripts/record-fixtures.js';
import { ADAPTER_TYPES, HTML_FAMILIES } from '../../src/core/types.js';
import { createRegistry } from '../../src/registry/index.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

describe('fixtures manifest', () => {
  const manifest = parseManifest(
    readFileSync(join(ROOT, 'test', 'fixtures', 'fixtures.manifest.json'), 'utf8'),
  );
  const hosts = new Map(
    createRegistry()
      .hosts()
      .map((host) => [host.host, host]),
  );

  it('lists only https URLs on fetchable allow-listed hosts', () => {
    for (const entry of manifest.entries) {
      const host = hosts.get(new URL(entry.url).host);
      expect(host, `${entry.id}: ${entry.url}`).toBeDefined();
      expect(host?.capability, `${entry.id} is on a link-only host`).not.toBeNull();
    }
  });

  it('needs no opt-in capability', () => {
    const optIn = manifest.entries.filter((entry) =>
      ['site-search', 'lifecycle-api'].includes(
        hosts.get(new URL(entry.url).host)?.capability ?? '',
      ),
    );
    expect(optIn).toEqual([]);
  });

  it('covers every HTML family except the generic fallback', () => {
    const covered = new Set(manifest.entries.map((entry) => entry.family));
    expect(HTML_FAMILIES.filter((family) => !covered.has(family))).toEqual(['generic']);
  });

  it('covers every adapter that reads from the network', () => {
    const covered = new Set(manifest.entries.map((entry) => entry.adapter));
    // Briefs are bundled with the server: there is nothing to record.
    expect(ADAPTER_TYPES.filter((type) => !covered.has(type))).toEqual(['brief']);
  });

  it('gives every recording a distinct file name', () => {
    const names = manifest.entries.map(fileNameFor);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks binary bodies for base64 transfer', () => {
    const inventory = manifest.entries.find((entry) => entry.url.endsWith('objects.inv'));
    expect(inventory).toMatchObject({ expect: 'text', encoding: 'base64' });
  });
});

describe('record-fixtures helpers', () => {
  const entry = (overrides: Record<string, unknown>) =>
    parseManifest(
      JSON.stringify({
        schema: 1,
        about: 'test',
        entries: [
          {
            id: 'one',
            url: 'https://developers.arcgis.com/widgets/',
            expect: 'html',
            covers: 'a page for the test',
            ...overrides,
          },
        ],
      }),
    ).entries[0]!;

  it('derives the file extension from the expected shape', () => {
    expect(fileNameFor(entry({}))).toBe('one.html');
    expect(fileNameFor(entry({ expect: 'json' }))).toBe('one.json');
    expect(fileNameFor(entry({ expect: 'xml' }))).toBe('one.xml');
    expect(fileNameFor(entry({ expect: 'yaml', url: 'https://x.example/net.xrefmap.yml' }))).toBe(
      'one.yml',
    );
  });

  it('keeps the extension of text files', () => {
    const text = (url: string) => fileNameFor(entry({ expect: 'text', url }));
    expect(text('https://cdn.jsdelivr.net/npm/@arcgis/core@5.1.27/layers/FeatureLayer.d.ts')).toBe(
      'one.d.ts',
    );
    expect(text('https://developers.arcgis.com/java/reference/type-search-index.js')).toBe(
      'one.js',
    );
    expect(text('https://developers.arcgis.com/geoanalytics/api-reference/objects.inv')).toBe(
      'one.inv',
    );
    expect(text('https://raw.githubusercontent.com/Esri/x/main/README.md')).toBe('one.md');
    expect(text('https://raw.githubusercontent.com/Esri/x/main/LICENSE')).toBe('one.txt');
    expect(text('https://raw.githubusercontent.com/Esri/x/main/.gitignore')).toBe('one.txt');
  });

  it('rejects invalid manifests with the path of the problem', () => {
    expect(() => entry({ url: 'http://developers.arcgis.com/' })).toThrow(/entries\.0\.url/);
    expect(() => entry({ id: 'Not An Id' })).toThrow(/entries\.0\.id/);
    expect(() => entry({ family: 'wordpress' })).toThrow(/entries\.0\.family/);
    expect(() => entry({ surprise: true })).toThrow(/fixtures\.manifest\.json/);
    expect(() => parseManifest('{"schema":2,"about":"x","entries":[]}')).toThrow(/schema/);
  });

  it('rejects duplicate ids', () => {
    const one = { id: 'one', url: 'https://a.example/', expect: 'html', covers: 'first of two' };
    expect(() =>
      parseManifest(JSON.stringify({ schema: 1, about: 'x', entries: [one, one] })),
    ).toThrow(/duplicate id "one"/);
  });

  it('selects entries by id, in the order asked for', () => {
    const manifest = parseManifest(
      JSON.stringify({
        schema: 1,
        about: 'x',
        entries: ['a', 'b', 'c'].map((id) => ({
          id,
          url: `https://a.example/${id}`,
          expect: 'html',
          covers: 'one of three pages',
        })),
      }),
    );
    expect(selectEntries(manifest)).toHaveLength(3);
    expect(selectEntries(manifest, ['c', 'a']).map((e) => e.id)).toEqual(['c', 'a']);
    expect(() => selectEntries(manifest, ['z'])).toThrow(/No fixture with id "z"/);
  });
});
