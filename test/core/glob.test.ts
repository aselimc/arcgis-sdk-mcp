import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAnyGlob } from '../../src/core/glob.js';

describe('globToRegExp', () => {
  const cases: Array<[glob: string, matching: string[], rejected: string[]]> = [
    ['README.md', ['README.md'], ['readme.md', 'docs/README.md', 'README.mdx', 'READMExmd']],
    ['ai/*', ['ai/overview', 'ai/'], ['ai/mcp/tools', 'auth/overview', 'ai']],
    ['requirements*.txt', ['requirements.txt', 'requirements-dev.txt'], ['a/requirements.txt']],
    ['templates/**', ['templates/a.md', 'templates/a/b/c.ts'], ['templates', 'other/a.md']],
    ['**/*.proto', ['a.proto', 'x/y/a.proto'], ['a.proto.txt', 'a.md']],
    ['_docs/**.md', ['_docs/a.md', '_docs/a/b.md'], ['docs/a.md', '_docs/a.txt']],
    [
      'widgets/**/README.md',
      ['widgets/README.md', 'widgets/a/README.md', 'widgets/a/b/README.md'],
      ['widgets/a/readme.md', 'themes/a/README.md', 'widgetsREADME.md'],
    ],
    ['samples/**/*.ipynb', ['samples/a.ipynb', 'samples/x/y/a.ipynb'], ['guide/a.ipynb']],
    ['v?.json', ['v1.json', 'v2.json'], ['v10.json', 'v/.json']],
    ['a+b (c) [d] {e}|f^$', ['a+b (c) [d] {e}|f^$'], ['aab (c) [d] {e}|f^$']],
    ['src\\lib', ['src\\lib'], ['src/lib']],
  ];

  it.each(cases)('%s', (glob, matching, rejected) => {
    const regex = globToRegExp(glob);
    for (const path of matching) expect(regex.test(path), `${glob} ~ ${path}`).toBe(true);
    for (const path of rejected) expect(regex.test(path), `${glob} !~ ${path}`).toBe(false);
  });
});

describe('matchesAnyGlob', () => {
  it('is true when any pattern matches and false for an empty list', () => {
    const globs = ['templates/**', 'README.md'];
    expect(matchesAnyGlob('README.md', globs)).toBe(true);
    expect(matchesAnyGlob('templates/ai/app.ts', globs)).toBe(true);
    expect(matchesAnyGlob('src/app.ts', globs)).toBe(false);
    expect(matchesAnyGlob('README.md', [])).toBe(false);
    // The second call is answered from the compiled-pattern cache and must agree.
    expect(matchesAnyGlob('templates/ai/app.ts', globs)).toBe(true);
  });
});
