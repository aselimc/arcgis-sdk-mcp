import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  fragmentOf,
  oneLine,
  plainInline,
  recordOf,
  safeDecode,
  summaryOf,
  symbolRecord,
} from '../../../src/adapters/kit/index.js';
import { bindSource } from '../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../support/builders.js';

const source = makeSource('dokka', { base: '/widgets/api-reference/kotlin/' }, { id: 'api' });
const product = makeProduct({ sources: [source], licenseTier: 'esri-website-terms' });
const bound = () => bindSource(product, source, makeLine());

describe('adapter kit: records', () => {
  it('builds records without empty fields and with the breadcrumb joined', () => {
    const record = symbolRecord(bound(), 'https://developers.arcgis.com/widgets/x.html', 'X', {
      symbol: 'X',
      qualified: '',
      parent: undefined,
      breadcrumb: ['', 'pkg', 'Outer'],
      deprecated: true,
    });

    expect(record).toEqual({
      ref: 'https://developers.arcgis.com/widgets/x.html',
      product: 'widgets-sdk',
      source: 'api',
      line: 'latest',
      kind: 'api',
      title: 'X',
      breadcrumb: 'pkg > Outer',
      symbol: 'X',
      deprecated: true,
      license: 'esri-website-terms',
    });
    expect(
      symbolRecord(bound(), 'https://developers.arcgis.com/widgets/y.html', 'Y'),
    ).not.toHaveProperty('breadcrumb');
  });

  it('lets an index entry of a reference be something other than a symbol', () => {
    const ref = 'https://developers.arcgis.com/widgets/articles/intro.html';
    expect(symbolRecord(bound(), ref, 'Intro', { kind: 'guide' }).kind).toBe('guide');
  });

  it('takes the kind as given and lets a repository state its own licence', () => {
    const ref = 'https://github.com/Esri/widgets/blob/main/README.md';
    expect(recordOf(bound(), ref, 'sample', 'Widgets', { license: 'apache-2.0' })).toEqual({
      ref,
      product: 'widgets-sdk',
      source: 'api',
      line: 'latest',
      kind: 'sample',
      title: 'Widgets',
      license: 'apache-2.0',
    });
  });
});

describe('adapter kit: plain text for descriptions', () => {
  it('flattens and caps index text', () => {
    expect(oneLine('  two\n  lines ')).toBe('two lines');
    expect(oneLine('   ')).toBeUndefined();
    expect(oneLine(42)).toBeUndefined();
    expect(oneLine('abcdefghij', 6)).toBe('abcde…');
  });

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

  it('reduces links to their labels, also links with parentheses in the target', () => {
    expect(
      plainInline(
        'See [the gadget](https://developers.arcgis.com/widgets/gadget_(v2)/), ![an icon](i.png), [a ref][1], `code` and {@link Gadget#spin the spin method}.',
      ),
    ).toBe('See the gadget, an icon, a ref, code and the spin method.');
    expect(plainInline('{@link Gadget}')).toBe('Gadget');
  });

  // A description that is cut before its Markdown is removed can end inside a link target,
  // and then no reader of the record can show the label any more.
  it('never ends a shortened description inside a link', () => {
    const target = `https://developers.arcgis.com/widgets/latest/references/${'x'.repeat(120)}/#selectedGadgetIndex`;
    const text = `Indicates whether to update the location when the [selectedGadgetIndex](${target}) changes. More text follows here.`;

    expect(summaryOf(text, 80)).toBe(
      'Indicates whether to update the location when the selectedGadgetIndex changes.',
    );
    const cut = summaryOf(text, 60);
    expect(cut).toBe('Indicates whether to update the location when the selectedG…');
    expect(cut).not.toMatch(/[[\]()]|https?:/);
    expect(oneLine(text, 60)).toBe(cut);
  });
});

describe('adapter kit: URL parts', () => {
  it('decodes what it can and keeps a malformed escape as written', () => {
    expect(safeDecode('a%20b')).toBe('a b');
    expect(safeDecode('a%zz')).toBe('a%zz');
  });

  it('reads the decoded fragment', () => {
    expect(fragmentOf(new URL('https://developers.arcgis.com/widgets/x/#event-ready'))).toBe(
      'event-ready',
    );
    expect(fragmentOf(new URL('https://developers.arcgis.com/widgets/x/#%24row'))).toBe('$row');
    expect(fragmentOf(new URL('https://developers.arcgis.com/widgets/x/#'))).toBeUndefined();
  });

  it('escapes a literal for a regular expression', () => {
    expect(new RegExp(`^${escapeRegExp('a.b(c)[d]')}$`).test('a.b(c)[d]')).toBe(true);
    expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
  });
});
