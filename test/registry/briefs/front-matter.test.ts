import { describe, expect, it } from 'vitest';

import {
  BriefFormatError,
  compactTables,
  parseBrief,
  parseFrontMatter,
} from '../../../scripts/gen-briefs.js';

const VALID = [
  '---',
  'title: Example brief',
  'verifiedOn: 2026-10-13',
  'sources:',
  '  - https://developers.arcgis.com/documentation/',
  '  - https://developers.arcgis.com/rest/',
  '---',
  '',
  '# Example brief',
  '',
  'Body text.',
  '',
].join('\n');

/** The valid brief with one front matter line replaced or removed. */
function withLine(match: RegExp, replacement?: string): string {
  return VALID.split('\n')
    .flatMap((line) => (match.test(line) ? (replacement === undefined ? [] : [replacement]) : line))
    .join('\n');
}

function reasonOf(text: string): string {
  try {
    parseFrontMatter(text, 'briefs/x.md');
  } catch (error) {
    if (error instanceof BriefFormatError) return error.message;
    throw error;
  }
  return 'no error';
}

describe('parseFrontMatter', () => {
  it('reads the three keys and separates the body', () => {
    expect(parseFrontMatter(VALID, 'briefs/x.md')).toEqual({
      meta: {
        title: 'Example brief',
        verifiedOn: '2026-10-13',
        sources: [
          'https://developers.arcgis.com/documentation/',
          'https://developers.arcgis.com/rest/',
        ],
      },
      body: '# Example brief\n\nBody text.',
    });
  });

  it('gives the same result for CRLF line ends and a byte-order mark', () => {
    const windows = `\uFEFF${VALID.replaceAll('\n', '\r\n')}`;
    expect(parseFrontMatter(windows, 'briefs/x.md')).toEqual(
      parseFrontMatter(VALID, 'briefs/x.md'),
    );
  });

  it('accepts quoted scalars, comments, blank lines and unindented list items', () => {
    const text = [
      '---',
      '# a comment',
      'title: "Colons: allowed \\"here\\""',
      '',
      "verifiedOn: '2026-01-31'",
      'sources:',
      "- 'https://developers.arcgis.com/it''s/'",
      '---',
      'Body',
    ].join('\n');
    expect(parseFrontMatter(text, 'briefs/x.md').meta).toEqual({
      title: 'Colons: allowed "here"',
      verifiedOn: '2026-01-31',
      sources: ["https://developers.arcgis.com/it's/"],
    });
  });

  it('keeps a colon inside a plain scalar', () => {
    const text = withLine(/^title:/, 'title: REST docs: variants');
    expect(parseFrontMatter(text, 'briefs/x.md').meta.title).toBe('REST docs: variants');
  });

  it('strips trailing whitespace from body lines', () => {
    const text = VALID.replace('Body text.', 'Body text.   ');
    expect(parseFrontMatter(text, 'briefs/x.md').body).toBe('# Example brief\n\nBody text.');
  });

  it.each([
    ['no front matter', '# Example brief\n', 'must start with a "---"'],
    ['unclosed front matter', '---\ntitle: x\n', 'not closed'],
    ['missing title', withLine(/^title:/), 'lacks "title"'],
    ['missing verifiedOn', withLine(/^verifiedOn:/), 'lacks "verifiedOn"'],
    ['empty title', withLine(/^title:/, 'title: ""'), '"title" must be a non-empty string'],
    ['title given as a list', withLine(/^title:/, 'title:'), '"title" must be a non-empty string'],
    ['unknown key', withLine(/^title:/, 'title: x\nauthor: someone'), 'unknown front matter key'],
    ['duplicate key', withLine(/^title:/, 'title: x\ntitle: y'), 'duplicate key "title"'],
    ['date in another format', withLine(/^verifiedOn:/, 'verifiedOn: 13.10.2026'), 'YYYY-MM-DD'],
    ['impossible date', withLine(/^verifiedOn:/, 'verifiedOn: 2026-02-30'), 'YYYY-MM-DD'],
    ['no sources', withLine(/^\s+- /), '"sources" must be a non-empty list'],
    ['sources as a scalar', withLine(/^sources:/, 'sources: none'), 'list item without a "key:"'],
    [
      'http source',
      withLine(/rest\/$/, '  - http://developers.arcgis.com/rest/'),
      'not an https URL',
    ],
    ['source that is no URL', withLine(/rest\/$/, '  - see the REST docs'), 'not an https URL'],
    [
      'repeated source',
      withLine(/rest\/$/, '  - https://developers.arcgis.com/documentation/'),
      'lists a URL twice',
    ],
    ['flow sequence', withLine(/^sources:/, 'sources: [a, b]'), 'unsupported YAML syntax'],
    ['block scalar', withLine(/^title:/, 'title: |'), 'unsupported YAML syntax'],
    ['broken double quotes', withLine(/^title:/, 'title: "open'), 'malformed double-quoted'],
    ['broken single quotes', withLine(/^title:/, "title: 'open"), 'unterminated single-quoted'],
    ['line that is not a pair', withLine(/^title:/, 'just some words'), 'cannot read line'],
  ])('rejects %s', (_name, text, reason) => {
    expect(reasonOf(text)).toContain(reason);
  });

  it('reports the file and the line of a syntax problem', () => {
    const text = withLine(/^verifiedOn:/, 'verified on 2026');
    expect(reasonOf(text)).toMatch(/^briefs\/x\.md:3: cannot read line/);
  });
});

describe('parseBrief', () => {
  it('returns the embedded record', () => {
    expect(parseBrief('group/example-brief', VALID)).toEqual({
      slug: 'group/example-brief',
      title: 'Example brief',
      verifiedOn: '2026-10-13',
      sources: [
        'https://developers.arcgis.com/documentation/',
        'https://developers.arcgis.com/rest/',
      ],
      markdown: '# Example brief\n\nBody text.',
    });
  });

  it.each(['Upper/case', 'a b', 'trailing/', '/leading', 'double--dash', 'dot.name'])(
    'rejects the slug %j',
    (slug) => {
      expect(() => parseBrief(slug, VALID)).toThrow(/slug must be lower-case/);
    },
  );

  it('requires the body to open with the title as its heading', () => {
    expect(() => parseBrief('x', VALID.replace('# Example brief', '# Another heading'))).toThrow(
      /must start with the heading "# Example brief"/,
    );
    expect(() => parseBrief('x', VALID.replace('# Example brief\n', ''))).toThrow(BriefFormatError);
  });
});

describe('compactTables', () => {
  it('removes column padding and shortens the delimiter row', () => {
    const padded = [
      '| Goal            | Product id    |',
      '| --------------- | :-----------: |',
      '| Two  words here | `js-maps-sdk` |',
    ].join('\n');
    expect(compactTables(padded)).toBe(
      ['| Goal | Product id |', '| --- | :---: |', '| Two  words here | `js-maps-sdk` |'].join(
        '\n',
      ),
    );
  });

  it('leaves prose, lists and fenced code alone', () => {
    const text = [
      'A  line with   spaces | and a pipe',
      '',
      '- item   one',
      '',
      '```text',
      '| kept   | as is   |',
      '```',
      '',
      '~~~',
      '| also   | kept    |',
      '~~~',
    ].join('\n');
    expect(compactTables(text)).toBe(text);
  });

  it('is idempotent', () => {
    const once = compactTables('| a    | b   |\n| ---- | --- |\n| 1    | 2   |');
    expect(compactTables(once)).toBe(once);
  });
});
