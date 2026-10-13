import { describe, expect, it } from 'vitest';
import { sectionSubtree } from '../../src/core/sections.js';
import type { DocPage, HtmlFamily } from '../../src/core/types.js';
import { extractFixture, extractHtml, FAMILY_CASES } from './support.js';

const ids = (page: DocPage): string[] => page.sections.map((section) => section.id);
const text = (page: DocPage): string =>
  page.sections.map((section) => section.markdown).join('\n\n');

describe('section slicing', () => {
  describe.each(FAMILY_CASES)('$family', ({ family }) => {
    const full = extractFixture(family);

    it('returns for every section id exactly that section and its descendants', () => {
      expect(full.sections.length).toBeGreaterThan(1);
      for (const section of full.sections) {
        const expected = sectionSubtree(full.sections, section.id);
        const sliced = extractFixture(family, { select: { section: section.id } });
        expect(ids(sliced), section.id).toEqual(expected.map((part) => part.id));
        expect(text(sliced), section.id).toBe(expected.map((part) => part.markdown).join('\n\n'));
      }
    });

    it('keeps title, header and members of the whole page on a slice', () => {
      const last = full.sections.at(-1);
      const sliced = extractFixture(family, { select: { section: last?.id ?? '' } });
      expect(sliced.title).toBe(full.title);
      expect(sliced.header).toBe(full.header);
      expect(sliced.members).toEqual(full.members);
      expect(sliced.files).toEqual(full.files);
    });

    it('returns the whole page for a selector that matches nothing', () => {
      expect(ids(extractFixture(family, { select: { section: 'no-such-section' } }))).toEqual(
        ids(full),
      );
      expect(ids(extractFixture(family, { select: { member: 'noSuchMember' } }))).toEqual(
        ids(full),
      );
      expect(ids(extractFixture(family, { select: {} }))).toEqual(ids(full));
    });
  });

  const expectations: Array<[HtmlFamily, string, string[]]> = [
    ['astro', 'steps', ['steps', 'add-the-station-layer', 'label-the-gauges']],
    ['astro', 'label-the-gauges', ['label-the-gauges']],
    ['astro-js-ref', 'overview', ['overview']],
    ['astro-js-ref', 'properties', ['properties', 'id', 'labelField']],
    ['astro-sample', '2-create-the-chart', ['2-create-the-chart']],
    ['gatsby', 'count', ['count', 'countvalue-number']],
    ['gatsby-rest', 'request-parameters', ['request-parameters', 'sort-order']],
    ['qdoc', 'details', ['details']],
    ['dokka', 'properties', ['properties', 'backgroundcolor']],
    ['dartdoc', 'instance-properties', ['instance-properties']],
    ['docfx-net', 'properties', ['properties']],
    ['docfx-esri', 'parameters', ['parameters', 'code-sample']],
    ['documentx', 'publicProperties', ['publicProperties']],
    ['javadoc', 'method-detail', ['method-detail', 'getMaxScale()', 'setMaxScale(double)']],
    ['javadoc-legacy', 'method.detail', ['method.detail', 'getBerthName-int-', 'getBerthCount--']],
    ['legacy-help', 'create-an-alert', ['create-an-alert', 'alert-properties']],
    ['support-kb', 'procedure', ['procedure']],
    ['generic', 'fixed', ['fixed']],
  ];

  it.each(expectations)('cuts %s at #%s', (family, section, expected) => {
    expect(ids(extractFixture(family, { select: { section } }))).toEqual(expected);
  });

  it('answers to the opaque anchor of a legacy help section', () => {
    const sliced = extractFixture('legacy-help', { select: { section: 'ESRI_SECTION2_E5F6A7B8' } });
    expect(ids(sliced)).toEqual(['alert-properties']);
    expect(text(sliced)).toContain('**`direction`**');
  });

  it('cuts at a heading that sits in a wrapper of its own', () => {
    const html =
      '<html><head><title>T</title></head><body><article><div class="heading-wrap"><div><h2 id="a">Alpha</h2><a class="permalink" href="#a"></a></div></div><p>first</p><div class="heading-wrap"><h2 id="b">Beta</h2></div><p>second</p></article></body></html>';
    expect(text(extractHtml(html, { select: { section: 'a' } }))).toBe('## Alpha\n\nfirst');
    expect(text(extractHtml(html, { select: { section: 'b' } }))).toBe('## Beta\n\nsecond');
  });

  it('stops a section at a wrapper that holds the next peer heading, but not at a table', () => {
    const html =
      '<html><head><title>T</title></head><body><article><h2 id="a">Alpha</h2><table><tr><th><h2>In a cell</h2></th></tr><tr><td>1</td></tr></table><p>tail</p><div><h2 id="b">Beta</h2><p>second</p></div></article></body></html>';
    const sliced = text(extractHtml(html, { select: { section: 'a' } }));
    expect(sliced).toContain('tail');
    expect(sliced).not.toContain('second');
  });
});

describe('member slicing', () => {
  it('cuts one member card of the JavaScript reference by id or by name', () => {
    const byId = extractFixture('astro-js-ref', { select: { member: 'queryGauges' } });
    expect(ids(byId)).toEqual(['queryGauges']);
    expect(text(byId)).toContain(
      '```ts\nqueryGauges (filter?: GaugeFilter): Promise<Gauge[]>\n```',
    );
    expect(text(byId)).toContain('**Parameters**');
    expect(text(byId)).not.toContain('labelField');

    const byName = extractFixture('astro-js-ref', { select: { member: 'refresh' } });
    expect(ids(byName)).toEqual(['event-refresh']);
  });

  it('selects a card by its own header: a type definition keeps its nested cards', () => {
    const type = extractFixture('astro-js-ref', { select: { member: 'RefreshEvent' } });
    expect(ids(type)).toEqual(['RefreshEvent', 'RefreshEvent-count']);
    expect(type.sections.map((section) => section.level)).toEqual([3, 4]);

    const nested = extractFixture('astro-js-ref', { select: { member: 'RefreshEvent-count' } });
    expect(ids(nested)).toEqual(['RefreshEvent-count']);
    expect(text(nested)).toBe(
      '#### count\n\n_Property_\n\n- **Type:** number\n\nHow many gauges changed.',
    );
  });

  it('treats a member id given as a section selector as that member', () => {
    expect(ids(extractFixture('astro-js-ref', { select: { section: 'labelField' } }))).toEqual([
      'labelField',
    ]);
  });

  it('compares javadoc member ids as strings', () => {
    const member = '<init>(com.example.harbor.mapping.Basemap)';
    const sliced = extractFixture('javadoc', { select: { member } });
    expect(ids(sliced)).toEqual([member]);
    expect(text(sliced)).toContain('```java\npublic HarborChart(Basemap basemap)\n```');
    expect(ids(extractFixture('javadoc', { select: { member: 'getMaxScale' } }))).toEqual([
      'getMaxScale()',
    ]);
  });

  it('cuts a javadoc 1.8 member at its anchor', () => {
    const sliced = extractFixture('javadoc-legacy', { select: { member: 'getBerthName-int-' } });
    expect(ids(sliced)).toEqual(['getBerthName-int-']);
    expect(text(sliced)).toContain('- **Returns:** The berth name');
    expect(text(sliced)).not.toContain('getBerthCount');
  });

  it('cuts a QDoc member up to the next member', () => {
    const sliced = extractFixture('qdoc', { select: { member: 'Chart' } });
    expect(ids(sliced)).toEqual(['Chart']);
    expect(text(sliced)).toBe(
      '### Chart\n\n```cpp\n[explicit] Chart::Chart(QObject *parent = nullptr)\n```\n\nCreates an empty chart.\n\n- _parent_ - The optional parent object.',
    );
  });

  it('reduces a member to declaration and summary for detail "signature"', () => {
    const page = extractFixture('astro-js-ref', {
      select: { member: 'queryGauges' },
      detail: 'signature',
    });
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0]).toMatchObject({ id: 'queryGauges', level: 3, title: 'queryGauges' });
    expect(text(page)).toBe(
      '### queryGauges\n\n```ts\nqueryGauges (filter?: GaugeFilter): Promise<Gauge[]>\n```\n\nReturns the gauges that match a filter.',
    );
    expect(page.diagnostics.fences).toBe(1);

    const java = extractFixture('javadoc', {
      select: { member: 'getMaxScale()' },
      detail: 'signature',
    });
    expect(text(java)).toBe(
      '### getMaxScale\n\n```java\npublic double getMaxScale()\n```\n\nGets the largest scale the chart can be shown at.',
    );
  });

  it('keeps the whole member for the other detail levels', () => {
    const summary = extractFixture('astro-js-ref', {
      select: { member: 'queryGauges' },
      detail: 'summary',
    });
    const full = extractFixture('astro-js-ref', {
      select: { member: 'queryGauges' },
      detail: 'full',
    });
    expect(text(summary)).toBe(text(full));
    expect(text(full)).toContain('console.log(gauges.length);');
  });
});
