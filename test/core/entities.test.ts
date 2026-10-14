import { describe, expect, it } from 'vitest';
import { decodeEntities } from '../../src/core/entities.js';

describe('decodeEntities', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('A&nbsp;B &#8212; &#x2014; &lt;tag&gt; &quot;q&quot; &apos;')).toBe(
      'A B — — <tag> "q" \'',
    );
    expect(decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &#39;c&#x27; &nbsp;x')).toBe(
      '<a> & "b" \'c\'  x',
    );
    expect(decodeEntities('&mdash;&ndash;&reg;&trade;&copy;')).toBe('—–®™©');
  });

  it('is case-insensitive for names and hexadecimal digits', () => {
    expect(decodeEntities('&AMP; &#X41; &#x6a;')).toBe('& A j');
  });

  it('leaves unknown and out-of-range references as written', () => {
    expect(decodeEntities('&unknown; &#0; &#x110000; & alone')).toBe(
      '&unknown; &#0; &#x110000; & alone',
    );
  });

  it('decodes in one pass, so an escaped entity stays escaped once', () => {
    expect(decodeEntities('&amp;lt; &amp;quot;')).toBe('&lt; &quot;');
  });
});
