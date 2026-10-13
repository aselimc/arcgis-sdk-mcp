import { describe, expect, it } from 'vitest';
import { readFixture } from '../support/fixtures.js';
import {
  expectGolden,
  makeMeta,
  makeRenderer,
  pageText,
  sectionIds,
  structured,
} from './helpers.js';

const URL = 'https://developers.arcgis.com/tides-python/api-reference/tides.harbour.html';
const meta = makeMeta({ url: URL });
const html = readFixture(...structured('sphinx', 'module.html'));

describe('sphinx renderer: class by anchor', () => {
  const { renderer, html: extractor } = makeRenderer();
  const page = renderer.render('sphinx', { html, anchor: 'tides.harbour.TideClock' }, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('sphinx', 'class.expected.md'));
  });

  it('takes the enclosing dl.py of the anchor', () => {
    expect(page.title).toBe('TideClock');
    expect(page.header).toBe('_class_ · `tides.harbour`');
    expect(page.sections[0]?.markdown).toContain(
      "```python\nclass tides.harbour.TideClock(harbour, units='m')\n```",
    );
  });

  it('uses the fully qualified ids as section ids', () => {
    expect(sectionIds(page)).toEqual([
      'tides.harbour.TideClock',
      'tides.harbour.TideClock-methods',
      'tides.harbour.TideClock.next_high_tide',
      'tides.harbour.TideClock-properties',
      'tides.harbour.TideClock.units',
    ]);
    expect(page.members).toEqual([
      {
        id: 'tides.harbour.TideClock.next_high_tide',
        name: 'next_high_tide',
        kind: 'method',
        signature: 'next_high_tide(after: datetime | None = None)',
        summary: 'The `next_high_tide` method finds the next high tide.',
      },
      {
        id: 'tides.harbour.TideClock.units',
        name: 'units',
        kind: 'property',
        signature: 'property units',
        summary: 'The unit of every reported height.',
      },
    ]);
  });

  it('hands docstrings to the HTML extractor as plain, absolute HTML', () => {
    const fragments = extractor.calls.map((call) => call.html).join('\n');
    expect(extractor.calls.every((call) => call.familyHint === 'generic')).toBe(true);
    // Member docstrings are converted on their own, not as part of the class docstring.
    expect(extractor.calls[0]?.html).not.toContain('next_high_tide method finds');
    expect(fragments).not.toContain('headerlink');
    expect(fragments).not.toContain('class="pre"');
    expect(fragments).toContain(
      '<pre data-language="python"><code class="language-python">clock = TideClock("brest")\nclock.next_high_tide()</code></pre>',
    );
    // The directory-style link of the JSON build becomes the public page URL.
    expect(fragments).toContain(
      'href="https://developers.arcgis.com/tides-python/api-reference/tides.gauge.html#tides.gauge.Gauge"',
    );
  });

  it('keeps what the extractor produced', () => {
    const text = pageText(page);
    expect(text).toContain('> **Note:** Times are reported in UTC.');
    expect(text).toContain('```python\nclock = TideClock("brest")\nclock.next_high_tide()\n```');
    expect(text).toContain('**Returns:** A datetime in UTC.');
    expect(page.diagnostics).toMatchObject({ family: 'structured', renderer: 'sphinx' });
  });
});

describe('sphinx renderer: member, detail and whole page', () => {
  it('renders a member under the name of its owner', () => {
    const { renderer } = makeRenderer();
    const page = renderer.render(
      'sphinx',
      { html, anchor: 'tides.harbour.TideClock.next_high_tide' },
      meta,
    );
    expect(page.title).toBe('TideClock.next_high_tide');
    expect(page.header).toBe('_method_ · `tides.harbour`');
    expect(sectionIds(page)).toEqual(['tides.harbour.TideClock.next_high_tide']);
    expect(page.sections[0]?.markdown).toContain('- after: Optional datetime.');
  });

  it('summary detail is the docstring plus a one-line member index', () => {
    const { renderer, html: extractor } = makeRenderer();
    const page = renderer.render('sphinx', { html, anchor: 'tides.harbour.TideClock' }, meta, {
      detail: 'summary',
    });
    expect(sectionIds(page)).toEqual([
      'tides.harbour.TideClock',
      'tides.harbour.TideClock-methods',
      'tides.harbour.TideClock-properties',
    ]);
    expect(page.sections[1]?.markdown).toBe(
      '## Methods\n\n- `next_high_tide`: The next_high_tide method finds the next high tide.',
    );
    // Member docstrings are not converted for an index.
    expect(extractor.calls).toHaveLength(1);
  });

  it('signature detail converts nothing', () => {
    const { renderer, html: extractor } = makeRenderer();
    const page = renderer.render(
      'sphinx',
      { html, anchor: 'tides.harbour.nearest_harbour' },
      meta,
      {
        detail: 'signature',
      },
    );
    expect(page.sections[0]?.markdown).toBe(
      '# `nearest_harbour`\n\n```python\ntides.harbour.nearest_harbour(x, y)\n```\n\nFinds the harbour closest to a coordinate.',
    );
    expect(extractor.calls).toHaveLength(0);
  });

  it('selects a member of the class by name', () => {
    const { renderer } = makeRenderer();
    const page = renderer.render('sphinx', { html, anchor: 'tides.harbour.TideClock' }, meta, {
      select: { member: 'units' },
    });
    expect(sectionIds(page)).toEqual(['tides.harbour.TideClock.units']);
    expect(page.title).toBe('TideClock');
  });

  it('renders the whole page without an anchor: prose, then every top-level object', () => {
    const { renderer } = makeRenderer();
    const page = renderer.render('sphinx', { html }, meta);
    expectGolden(page, ...structured('sphinx', 'module.expected.md'));
    expect(page.title).toBe('tides.harbour module');
    expect(sectionIds(page)).toEqual([
      'tidesharbour-module',
      'tides.harbour.TideClock',
      'tides.harbour.TideClock-methods',
      'tides.harbour.TideClock.next_high_tide',
      'tides.harbour.TideClock-properties',
      'tides.harbour.TideClock.units',
      'tides.harbour.nearest_harbour',
    ]);
    expect(page.members?.map((member) => member.id)).toEqual([
      'tides.harbour.TideClock',
      'tides.harbour.TideClock.next_high_tide',
      'tides.harbour.TideClock.units',
      'tides.harbour.nearest_harbour',
    ]);
    // A same-page link resolves against the page URL.
    expect(pageText(page)).toContain(`[\`TideClock\`](${URL}#tides.harbour.TideClock)`);
  });

  it('falls back to the whole page when the anchor is not on it or is not an object', () => {
    const { renderer } = makeRenderer();
    const missing = renderer.render('sphinx', { html, anchor: 'tides.harbour.Nope' }, meta);
    const module = renderer.render('sphinx', { html, anchor: 'module-tides.harbour' }, meta);
    expect(missing.sections).toHaveLength(7);
    expect(module.sections).toHaveLength(7);
  });

  it('reads a full HTML page as well as a body fragment', () => {
    const { renderer } = makeRenderer();
    const fullPage = `<!DOCTYPE html><html><body><nav>Site menu</nav><div role="main">${html}</div><footer>Footer</footer></body></html>`;
    const page = renderer.render('sphinx', { html: fullPage }, meta);
    expect(pageText(page)).not.toContain('Site menu');
    expect(page.sections).toHaveLength(7);
  });
});
