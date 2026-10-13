import { describe, expect, it } from 'vitest';
import { renderDocc } from '../../src/render/docc.js';
import { readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

const BASE = 'https://developers.arcgis.com/tides-swift/api-reference';
const meta = makeMeta({ url: `${BASE}/documentation/tides/tideclock` });
const json = readJsonFixture<Record<string, unknown>>(...structured('docc', 'symbol.json'));

describe('renderDocc', () => {
  const page = renderDocc({ json }, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('docc', 'symbol.expected.md'));
  });

  it('builds the header from role, module and available platforms', () => {
    expect(page.title).toBe('TideClock');
    expect(page.header).toBe('_Class_ · Tides · iOS 17.0+, visionOS 2.0+ (beta)');
  });

  it('joins declaration tokens into a swift fence', () => {
    expect(page.sections[0]?.markdown).toContain('```swift\nfinal class TideClock\n```');
  });

  it('orders the sections as the page does', () => {
    expect(sectionIds(page)).toEqual([
      'tideclock',
      'parameters',
      'overview',
      'topics',
      'initializers',
      'instance-properties',
      'relationships',
      'conforms-to',
      'see-also',
      'harbours',
    ]);
  });

  it('resolves references below the API reference base of the page URL', () => {
    const text = pageText(page);
    expect(text).toContain(`[\`Harbour\`](${BASE}/documentation/tides/harbour)`);
    // An article is linked by title, without code styling.
    expect(text).toContain(`[Getting started](${BASE}/documentation/tides/gettingstarted)`);
    // A type of another framework has no URL.
    expect(text).toContain(
      'see `Swift.Sendable` and the [tide primer](https://example.com/tides).',
    );
    expect(text).toContain(
      `- [\`init(harbour: Harbour?)\`](${BASE}/documentation/tides/tideclock/init(harbour:)): Creates a clock for a [\`Harbour\`](${BASE}/documentation/tides/harbour).`,
    );
  });

  it('renders every known block type', () => {
    const overview = page.sections.find((section) => section.id === 'overview')?.markdown ?? '';
    expect(overview).toContain('- **High** tides are reported first.\n- Low tides follow.');
    expect(overview).toContain(
      '```swift\nlet clock = TideClock(harbour: .brest)\nprint(clock.nextHighTide)\n```',
    );
    expect(overview).toContain('> **Since:** 2.1');
    expect(overview).toContain(
      '> **Warning:**\n>\n> Times are in UTC.\n>\n> Convert before display.',
    );
    expect(overview).toContain('| Unit | Meaning |\n| --- | --- |\n| `m` | Metres |');
    expect(overview).toContain('1. Create it.\n2. Read it.');
    expect(overview).toContain('- **Spring tide**: The largest range.');
    expect(overview).toContain('It is _not_ thread-safe');
  });

  it('shows an unknown node as plain text and reports it', () => {
    expect(pageText(page)).toContain('A node type nobody has seen yet.');
    expect(page.diagnostics.unknownIslands).toEqual(['docc:hologram']);
    expect(page.notices).toEqual(['Some DocC content types are shown as plain text: hologram.']);
  });

  it('lists the topic pages as members', () => {
    expect(page.members).toEqual([
      {
        id: 'init(harbour:)',
        name: 'init(harbour:)',
        kind: 'initializer',
        signature: 'init(harbour: Harbour?)',
        summary: 'Creates a clock for a `Harbour`.',
      },
      {
        id: 'nexthightide',
        name: 'nextHighTide',
        kind: 'instance property',
        signature: 'var nextHighTide: Date',
        summary: 'Time of the next high tide.',
        deprecated: true,
      },
    ]);
  });

  it('signature detail is abstract and declaration only', () => {
    const brief = renderDocc({ json }, meta, { detail: 'signature' });
    expect(sectionIds(brief)).toEqual(['tideclock']);
    expect(brief.sections[0]?.markdown).toBe(
      '# TideClock\n\nTracks tide times for one harbour. Pair it with a `GaugeView`.\n\n```swift\nfinal class TideClock\n```',
    );
  });

  it('summary detail adds parameters and a topic index without abstracts', () => {
    const summary = renderDocc({ json }, meta, { detail: 'summary' });
    expect(sectionIds(summary)).toEqual([
      'tideclock',
      'parameters',
      'topics',
      'initializers',
      'instance-properties',
    ]);
    expect(summary.sections.find((section) => section.id === 'parameters')?.markdown).toBe(
      '## Parameters\n\n- `harbour`: The harbour to follow. Pass `nil` for the nearest one.',
    );
    expect(summary.sections.at(-1)?.markdown).toBe(
      `### Instance Properties\n\n- [\`var nextHighTide: Date\`](${BASE}/documentation/tides/tideclock/nexthightide)`,
    );
    expect(summary.diagnostics.unknownIslands).toEqual([]);
  });

  it('returns one section for a selector', () => {
    const sliced = renderDocc({ json }, meta, { select: { section: 'topics' } });
    expect(sectionIds(sliced)).toEqual(['topics', 'initializers', 'instance-properties']);
  });

  it('reports sections and inline nodes it does not know, and deprecation', () => {
    const odd = renderDocc(
      {
        json: {
          metadata: { title: 'oldReading', roleHeading: 'Instance Property' },
          abstract: [
            { type: 'sparkle', text: 'Shiny' },
            { type: 'text', text: ' reading.' },
          ],
          deprecationSummary: [
            { type: 'paragraph', inlineContent: [{ type: 'text', text: 'Use reading.' }] },
          ],
          primaryContentSections: [
            {
              kind: 'restEndpoint',
              content: [{ type: 'paragraph', inlineContent: [{ type: 'text', text: 'GET /x' }] }],
            },
          ],
          references: {},
        },
      },
      makeMeta({ url: 'brief:not-a-url' }),
    );
    expect(odd.sections[0]?.markdown).toBe(
      '# oldReading\n\nShiny reading.\n\n> **Deprecated:** Use reading.\n\nGET /x',
    );
    expect(odd.diagnostics.unknownIslands).toEqual(['docc:sparkle', 'docc:section:restEndpoint']);
    expect(odd.members).toBeUndefined();
  });

  it('throws DOC_NOT_FOUND when the document is not DocC JSON', () => {
    expect(thrownBy(() => renderDocc({ json: { kind: 'symbol' } }, meta))).toEqual({
      code: 'DOC_NOT_FOUND',
      why: 'the document has no DocC metadata',
      url: meta.url,
    });
    expect(thrownBy(() => renderDocc({ json: [] }, meta)).code).toBe('DOC_NOT_FOUND');
  });
});
