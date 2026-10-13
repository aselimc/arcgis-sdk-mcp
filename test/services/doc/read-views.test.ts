import { describe, expect, it } from 'vitest';
import { joinSections } from '../../../src/core/budget.js';
import { type McpDocError } from '../../../src/core/errors.js';
import type { DocPage } from '../../../src/core/types.js';
import { makeDocPage } from '../../support/builders.js';
import {
  API_URL,
  DEV,
  GUIDE_MD,
  GUIDE_URL,
  LONG_MD,
  SAMPLE_URL,
  apiPage,
  guidePage,
  harness,
  longPage,
  read,
  samplePage,
} from './fixtures.js';

describe('read: views', () => {
  it('returns a page that fits whole, with its outline', async () => {
    const h = harness();
    const response = await read(h, { ref: GUIDE_URL });
    expect(response.text).toBe(joinSections(guidePage().sections));
    expect(response).toMatchObject({
      truncated: false,
      page: { title: 'Cluster points', product: 'js-maps-sdk', source: 'guide', line: 'latest' },
    });
    expect(response.next).toBeUndefined();
    expect(response.nextCursor).toBeUndefined();
    expect(response.outline.map((entry) => entry.id)).toEqual([
      'cluster-points',
      'enable-clustering',
      'cluster-popups',
    ]);
    expect(h.adapter('gatsby').calls).toEqual([
      expect.objectContaining({
        method: 'read',
        product: 'js-maps-sdk',
        source: 'guide',
        ref: GUIDE_URL,
      }),
    ]);
  });

  it('adds what it read to the body index', async () => {
    const h = harness();
    await read(h, { ref: GUIDE_URL });
    const hits = h.index.queryBodies({
      text: 'feature reduction',
      products: ['js-maps-sdk'],
      limit: 3,
    });
    expect(hits[0]?.ref).toBe(`${GUIDE_URL}#enable-clustering`);
    expect(h.ctx.cache.derivedKeys()).toContainEqual(['bodies', 'js-maps-sdk']);
  });

  it('returns only the outline for view "outline"', async () => {
    const h = harness();
    const response = await read(h, { ref: GUIDE_URL, view: 'outline' });
    expect(response.text).toContain('- `cluster-points` Cluster points');
    expect(response.text).not.toContain('Clusters group nearby points');
    expect(response.truncated).toBe(false);
    expect(response.next).toBe(
      `arcgis_docs_read({"ref":"${GUIDE_URL}","section":"enable-clustering"})`,
    );
  });

  it('answers a large page with its opening, the outline and the next section to read', async () => {
    const h = harness();
    const big = guidePage({
      sections: makeDocPage({
        markdown: `${GUIDE_MD}\n\n## Reference tables\n\n${'cell '.repeat(3000)}`,
      }).sections,
    });
    h.adapter('gatsby').addPage(big);
    const response = await read(h, { ref: GUIDE_URL, maxTokens: 500 });
    expect(response.truncated).toBe(true);
    expect(response.text).toContain('Clusters group nearby points.');
    expect(response.text).toContain('- `reference-tables` Reference tables');
    expect(response.next).toBe(
      `arcgis_docs_read({"ref":"${GUIDE_URL}","section":"reference-tables"})`,
    );
    expect(response.nextCursor).toBeUndefined();
  });

  it('pages through a document with view "full" and a cursor', async () => {
    const h = harness();
    h.adapter('gatsby').addPage(longPage());
    const pages: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const response = await read(h, {
        ref: GUIDE_URL,
        view: 'full',
        maxTokens: 500,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages.push(response.text);
      cursor = response.nextCursor;
      if (cursor === undefined) {
        expect(response.truncated).toBe(false);
        break;
      }
      expect(response.truncated).toBe(true);
      expect(response.next).toBe(
        `arcgis_docs_read(${JSON.stringify({ ref: GUIDE_URL, view: 'full', max_tokens: 500, cursor })})`,
      );
    }
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.join('\n\n')).toBe(joinSections(longPage().sections));
  });

  it('pages inside one oversized section and reassembles it exactly', async () => {
    const h = harness();
    const long = makeDocPage({
      url: GUIDE_URL,
      product: 'js-maps-sdk',
      markdown: `# Long\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${'lorem '.repeat(60)}`).join('\n\n')}`,
    });
    h.adapter('gatsby').addPage(long);
    const pages: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await read(h, {
        ref: GUIDE_URL,
        maxTokens: 600,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages.push(response.text);
      cursor = response.nextCursor;
    } while (cursor !== undefined);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.join('\n\n')).toBe(joinSections(long.sections));
  });

  it('rejects a foreign, altered or outdated cursor with the call that restarts', async () => {
    const h = harness();
    h.adapter('gatsby').addPage(longPage());
    const first = await read(h, { ref: GUIDE_URL, view: 'full', maxTokens: 500 });
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const restart = {
      code: 'CURSOR_EXPIRED',
      details: { next: `arcgis_docs_read({"ref":"${API_URL}","view":"full"})` },
    };
    await expect(read(h, { ref: API_URL, view: 'full', cursor })).rejects.toMatchObject(restart);
    await expect(
      read(h, { ref: API_URL, view: 'full', cursor: 'not-a-cursor!' }),
    ).rejects.toMatchObject(restart);
    await expect(
      read(h, { ref: GUIDE_URL, section: 'part-2', view: 'full', cursor }),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });

    h.adapter('gatsby').addPage(longPage(`${LONG_MD}\n\nEdited since.`));
    await expect(read(h, { ref: GUIDE_URL, view: 'full', cursor })).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { why: 'The underlying content changed since the cursor was issued' },
    });
  });
});

describe('read: sections', () => {
  it('reads one section and its children, asking the adapter to slice', async () => {
    const h = harness();
    const response = await read(h, { ref: API_URL, section: 'methods' });
    expect(response.text).toContain('## Methods');
    expect(response.text).toContain('### applyEdits');
    expect(response.text).not.toContain('A layer of features.');
    // The metadata block is always shown first.
    expect(response.text.startsWith('import FeatureLayer from')).toBe(true);
    expect(h.adapter('astro').calls[0]?.target?.select).toEqual({
      section: 'methods',
      member: 'methods',
    });
  });

  it('accepts heading text, a member name and a fuzzy spelling', async () => {
    const h = harness();
    expect((await read(h, { ref: GUIDE_URL, section: 'Cluster Popups' })).text).toBe(
      '## Cluster popups\n\nDescribe the cluster in a popup.',
    );
    expect((await read(h, { ref: API_URL, section: 'queryFeatures()' })).text).toContain(
      '### queryFeatures\n\nRuns a query.',
    );
    expect((await read(h, { ref: GUIDE_URL, section: 'cluster-popup' })).text).toContain(
      '## Cluster popups',
    );
  });

  it('works the same when the adapter returns only the selected slice', async () => {
    const h = harness({ adapters: { astro: { slices: true } } });
    h.adapter('astro').addPage(apiPage());
    const response = await read(h, { ref: API_URL, section: 'applyEdits' });
    expect(response.text).toBe(
      'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";\n\n### applyEdits\n\nSends edits.',
    );
    expect(response.page.members).toHaveLength(2);
  });

  it('treats the #fragment of the ref as the section', async () => {
    const h = harness();
    const response = await read(h, { ref: `${API_URL}#queryFeatures` });
    expect(response.text).toContain('### queryFeatures');
    expect(response.text).not.toContain('### applyEdits');
    // An explicit section wins over the fragment.
    expect(
      (await read(h, { ref: `${API_URL}#queryFeatures`, section: 'applyEdits' })).text,
    ).toContain('### applyEdits');
  });

  it('reads the whole page when a fragment names nothing', async () => {
    const h = harness();
    const response = await read(h, { ref: `${GUIDE_URL}#some-ui-tab` });
    expect(response.text).toBe(joinSections(guidePage().sections));
  });

  it('raises SECTION_NOT_FOUND with the outline ids for an explicit section that matches nothing', async () => {
    const h = harness();
    await expect(
      read(h, { ref: `${GUIDE_URL}#x`, section: 'licensing terms' }),
    ).rejects.toMatchObject({
      code: 'SECTION_NOT_FOUND',
      details: {
        candidates: ['cluster-points', 'enable-clustering', 'cluster-popups'],
        next: `arcgis_docs_read({"ref":"${GUIDE_URL}","view":"outline"})`,
      },
    });
  });

  // Regression: the follow-up call of an outline dropped the fragment of the ref. For an
  // operation of an API description the fragment is what names the operation, so the
  // follow-up read the overview of the whole description and found no such section.
  describe('a ref whose fragment addresses the document', () => {
    const SPEC_URL = `${DEV}/rest/services-reference/enterprise/api.json`;
    const operation = (): DocPage =>
      makeDocPage({
        url: SPEC_URL,
        kind: 'api',
        product: 'rest-api',
        source: 'services',
        markdown: [
          '# GET /things/{id}',
          '',
          'Returns one thing.',
          '',
          '## Path parameters',
          '',
          '- `id`: the thing.',
          '',
          '## Responses',
          '',
          'response '.repeat(3000),
        ].join('\n'),
      });

    it('keeps the fragment in the follow-up of an outline', async () => {
      const h = harness();
      h.adapter('javadoc').addPage(operation());
      const response = await read(h, { ref: `${SPEC_URL}#getThing`, maxTokens: 500 });
      expect(response.truncated).toBe(true);
      expect(response.next).toBe(
        `arcgis_docs_read({"ref":"${SPEC_URL}#getThing","section":"responses"})`,
      );
    });

    it('keeps the fragment in the follow-up of SECTION_NOT_FOUND', async () => {
      const h = harness();
      h.adapter('javadoc').addPage(operation());
      await expect(
        read(h, { ref: `${SPEC_URL}#getThing`, section: 'request body' }),
      ).rejects.toMatchObject({
        code: 'SECTION_NOT_FOUND',
        details: { next: `arcgis_docs_read({"ref":"${SPEC_URL}#getThing","view":"outline"})` },
      });
    });

    it('drops a fragment that names a part of the document that was read', async () => {
      const h = harness();
      h.adapter('javadoc').addPage(operation());
      await expect(
        read(h, { ref: `${SPEC_URL}#responses`, section: 'request body' }),
      ).rejects.toMatchObject({
        details: { next: `arcgis_docs_read({"ref":"${SPEC_URL}","view":"outline"})` },
      });
    });
  });

  it('lists at most thirty candidates', async () => {
    const h = harness();
    const markdown = Array.from({ length: 45 }, (_, i) => `## Heading ${i}\n\nBody.`).join('\n\n');
    h.adapter('gatsby').addPage(guidePage({ sections: makeDocPage({ markdown }).sections }));
    const error = await read(h, { ref: GUIDE_URL, section: 'zzzzzzzz' }).catch(
      (caught: unknown) => caught,
    );
    expect((error as McpDocError).details?.candidates).toHaveLength(30);
  });

  it('shows a sample as description and main file, and only code for section "source"', async () => {
    const h = harness();
    const whole = await read(h, { ref: SAMPLE_URL });
    expect(whole.text).toContain('Adds and deletes features.');
    expect(whole.text).toContain('## Relevant APIs\n\n- FeatureLayer.applyEdits');
    expect(whole.text).toContain('```html\n<script>layer.applyEdits(edits)</script>\n```');
    expect(whole.text).not.toContain('margin: 0');
    expect(whole.outline.map((entry) => entry.id)).toContain('source-2');

    const code = await read(h, { ref: SAMPLE_URL, section: 'source' });
    expect(code.text).not.toContain('Adds and deletes features.');
    expect(code.text).toContain('margin: 0');
    // A pseudo-section is assembled by the service: the adapter is not asked to slice.
    expect(h.adapter('docc').calls.at(-1)?.target?.select).toBeUndefined();

    const full = await read(h, { ref: SAMPLE_URL, view: 'full' });
    expect(full.text).toContain('margin: 0');
  });

  it('continues a paged sample over the list the cursor was issued for', async () => {
    const h = harness();
    const big = samplePage();
    h.adapter('docc').addPage({
      ...big,
      sections: makeDocPage({ markdown: '# Apply edits sample\n\nShort.' }).sections,
      files: [
        {
          name: 'index.html',
          language: 'html',
          text: Array.from(
            { length: 200 },
            (_, i) => `<p>line ${i} ${'x'.repeat(40)}</p>\n\n`,
          ).join(''),
          ref: 'r',
          bytes: 1,
        },
      ],
    });
    const first = await read(h, { ref: SAMPLE_URL, maxTokens: 500 });
    expect(first.next).toContain('"section":"source"');
    const paged = await read(h, { ref: SAMPLE_URL, view: 'full', maxTokens: 500 });
    expect(paged.nextCursor).toBeDefined();
    const second = await read(h, {
      ref: SAMPLE_URL,
      view: 'full',
      maxTokens: 500,
      cursor: paged.nextCursor ?? '',
    });
    expect(second.text.length).toBeGreaterThan(0);
  });
});
