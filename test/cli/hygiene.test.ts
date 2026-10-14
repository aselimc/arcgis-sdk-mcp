/**
 * Repository hygiene: nothing Esri-authored is committed. Synthetic
 * fixtures, cassettes, briefs and sources must not carry the footer of a fetched page, the
 * open-source fixtures must be listed with their provenance, and live recordings must stay
 * out of version control.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

/** Text only a page served by Esri's sites ends with; no hand-written file has a reason to. */
const PAGE_FOOTERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Esri copyright footer', pattern: /Copyright\s*(?:©|&copy;|\(c\))\s*\d{4}\s+Esri/i },
  { name: 'rights statement', pattern: /All rights reserved/i },
  { name: 'Gatsby runtime global', pattern: /window\.___(?:gatsby|chunkMapping)/ },
  { name: 'Astro scoped-style attribute', pattern: /data-astro-cid-[a-z0-9]{6,}/ },
];

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const posix = (path: string): string => relative(ROOT, path).replace(/\\/g, '/');

describe('no fetched page content is committed', () => {
  const scanned = ['test/fixtures/synthetic', 'test/fixtures/cassettes', 'briefs', 'src'].flatMap(
    (directory) => filesUnder(join(ROOT, directory)),
  );

  it('scans the fixtures, the briefs and the sources', () => {
    expect(scanned.length).toBeGreaterThan(300);
  });

  it.each(PAGE_FOOTERS)('no file contains a $name', ({ pattern }) => {
    const offenders = scanned.filter((path) => pattern.test(readFileSync(path, 'utf8'))).map(posix);
    expect(offenders).toEqual([]);
  });
});

describe('open-source fixtures', () => {
  const directory = join(ROOT, 'test', 'fixtures', 'oss');
  const provenance = readFileSync(join(directory, 'README.md'), 'utf8');

  it('lists every copied file with its source, revision and licence', () => {
    const copied = filesUnder(directory)
      .map((path) => relative(directory, path).replace(/\\/g, '/'))
      // Expected outputs are this project's renderings; the README covers them as a group.
      .filter((path) => path !== 'README.md' && !path.endsWith('.expected.md'));
    expect(copied.length).toBeGreaterThan(0);
    for (const path of copied) {
      const row = provenance.split('\n').find((line) => line.startsWith(`| \`${path}\``));
      expect(row, `${path} has no row in test/fixtures/oss/README.md`).toBeDefined();
      expect(row, path).toMatch(
        /https:\/\/(?:github\.com\/Esri\/|cdn\.jsdelivr\.net\/npm\/@esri\/)/,
      );
      expect(row, path).toMatch(/Apache-2\.0/);
    }
  });
});

describe('live recordings', () => {
  it('are git-ignored and absent from the package', () => {
    const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored).toContain('test/fixtures/recorded/');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE', 'NOTICE']);
  });
});
