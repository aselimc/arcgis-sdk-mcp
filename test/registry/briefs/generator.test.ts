import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BRIEFS_DIR,
  BriefFormatError,
  loadBriefs,
  OUTPUT_FILE,
  type ParsedBrief,
  renderModule,
} from '../../../scripts/gen-briefs.js';
import { BRIEFS } from '../../../src/registry/data/briefs.generated.js';

function brief(slug: string, title: string, body = 'Text.'): string {
  return [
    '---',
    `title: ${title}`,
    'verifiedOn: 2026-10-13',
    'sources:',
    '  - https://developers.arcgis.com/documentation/',
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
  ].join('\n');
}

const temporary: string[] = [];

/** Writes files (path relative to a new temporary directory) and returns the directory. */
function briefsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arcgis-briefs-'));
  temporary.push(dir);
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('gen-briefs on the project briefs', () => {
  it('reproduces the committed module byte for byte', () => {
    const committed = readFileSync(OUTPUT_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(renderModule(loadBriefs(BRIEFS_DIR))).toBe(committed);
  });

  it('gives the same output on every run', () => {
    expect(renderModule(loadBriefs())).toBe(renderModule(loadBriefs()));
  });

  it('embeds exactly what the Markdown files contain', () => {
    expect(BRIEFS).toEqual(loadBriefs());
  });
});

describe('loadBriefs', () => {
  it('derives slugs from nested paths, sorts them and ignores other files', () => {
    const dir = briefsDir({
      'zeta/last.md': brief('zeta/last', 'Last'),
      'alpha/first.md': brief('alpha/first', 'First'),
      'alpha/deep/second.md': brief('alpha/deep/second', 'Second'),
      'top.md': brief('top', 'Top'),
      'alpha/notes.txt': 'not a brief',
    });
    expect(loadBriefs(dir).map((item) => item.slug)).toEqual([
      'alpha/deep/second',
      'alpha/first',
      'top',
      'zeta/last',
    ]);
  });

  it('names the file that breaks a rule', () => {
    const dir = briefsDir({ 'ok.md': brief('ok', 'Fine'), 'bad/one.md': '# no front matter\n' });
    expect(() => loadBriefs(dir)).toThrow(BriefFormatError);
    expect(() => loadBriefs(dir)).toThrow(/^briefs\/bad\/one\.md:1: /);
  });

  it('returns nothing for an empty directory', () => {
    expect(loadBriefs(briefsDir({}))).toEqual([]);
  });
});

describe('renderModule', () => {
  const one: ParsedBrief = {
    slug: 'b/one',
    title: 'Quotes "and" \\ backslashes',
    verifiedOn: '2026-10-13',
    sources: ['https://developers.arcgis.com/documentation/'],
    markdown:
      '# Quotes "and" \\ backslashes\n\nLine with `code`, ${not} a template and \'quotes\'.',
  };
  const two: ParsedBrief = { ...one, slug: 'a/two', title: 'Two', markdown: '# Two' };

  it('does not depend on the order of its input', () => {
    expect(renderModule([one, two])).toBe(renderModule([two, one]));
    expect(renderModule([one, two]).indexOf('"a/two"')).toBeLessThan(
      renderModule([one, two]).indexOf('"b/one"'),
    );
  });

  it('writes LF line ends, one final newline and no trailing whitespace', () => {
    const module = renderModule([one, two]);
    expect(module).not.toContain('\r');
    expect(module.endsWith('];\n')).toBe(true);
    expect(module).not.toMatch(/[ \t]+$/m);
  });

  it('round-trips every character of a brief through the generated literals', () => {
    const module = renderModule([one]);
    const literals = [...module.matchAll(/^ {6}(".*"),$/gm)].map(
      (match) => JSON.parse(match[1] ?? '""') as string,
    );
    expect(literals).toEqual([...one.sources, ...one.markdown.split('\n')]);
    expect(module).toContain(`title: ${JSON.stringify(one.title)},`);
  });

  it('is the same for a CRLF checkout of the sources', () => {
    const files = { 'a/one.md': brief('a/one', 'One', '| x   | y |\n| --- | - |\n| 1   | 2 |') };
    const crlf = { 'a/one.md': files['a/one.md'].replaceAll('\n', '\r\n') };
    expect(renderModule(loadBriefs(briefsDir(crlf)))).toBe(
      renderModule(loadBriefs(briefsDir(files))),
    );
  });

  it('renders an empty list as a valid module', () => {
    expect(renderModule([])).toContain('export const BRIEFS: readonly Brief[] = [\n];\n');
  });
});
