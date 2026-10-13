import { describe, expect, it } from 'vitest';
import {
  readCompatibility,
  rowsFromTable,
  subjectColumn,
} from '../../src/versions/compatibility.js';
import { htmlTables, largestTable, markdownTables } from '../../src/versions/tables.js';
import { LIBRARIES_HTML, MATRIX_HTML, SITES } from './cassettes-sites.js';
import { jsProduct } from './products.js';
import { makeDocPage, makeProduct } from '../support/builders.js';
import { FakeRenderer } from '../support/fake-render.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';

const MATRIX_URL = 'https://developers.arcgis.com/javascript/latest/version-matrix/';

const MATRIX_MARKDOWN = [
  '# Version matrix',
  '',
  '| JS SDK | Released | Enterprise | Calcite |',
  '| --- | --- | :---: | ---: |',
  '| **5.2.\\***| October 2026 | n/a | [5.2.\\*](https://example.org/c) |',
  '| 5.1.* | June 2026 | 12.2 | 5.1.* |',
  '| 4.33 | June 2025 | 12.0 | `3.2.1` |',
  '',
  'Text after the table.',
].join('\n');

describe('table readers', () => {
  it('reads GFM tables and strips inline Markdown from the cells', () => {
    const [table] = markdownTables(MATRIX_MARKDOWN);
    expect(table?.header).toEqual(['JS SDK', 'Released', 'Enterprise', 'Calcite']);
    expect(table?.rows).toEqual([
      ['5.2.*', 'October 2026', 'n/a', '5.2.*'],
      ['5.1.*', 'June 2026', '12.2', '5.1.*'],
      ['4.33', 'June 2025', '12.0', '3.2.1'],
    ]);
  });

  it('ignores pipe characters that are not a table', () => {
    expect(markdownTables('a | b\n\nplain text\n| lonely row |')).toEqual([]);
  });

  it('reads HTML tables with the first row as header', () => {
    const [table] = htmlTables(MATRIX_HTML);
    expect(table?.header).toEqual(['JS SDK', 'Released', 'Enterprise', 'Calcite']);
    expect(table?.rows[1]).toEqual(['5.1.*', 'June 2026', '12.2', '5.1.*']);
    expect(htmlTables('<p>no table</p>')).toEqual([]);
  });

  it('picks the table with the most rows', () => {
    const small = { header: ['a', 'b'], rows: [['1', '2']] };
    const big = {
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    };
    const oneColumn = { header: ['a'], rows: [['1'], ['2'], ['3']] };
    expect(largestTable([small, big, oneColumn])).toBe(big);
    expect(largestTable([])).toBeUndefined();
  });
});

describe('rowsFromTable', () => {
  const [matrix] = htmlTables(MATRIX_HTML);
  const about = {
    product: jsProduct,
    name: 'Version matrix',
    source: MATRIX_URL,
    wanted: new Set<string>(),
  };

  it('finds the column that holds the product itself', () => {
    expect(subjectColumn(matrix!, jsProduct)).toBe(0);
    const spec = makeProduct({ id: 'web-map-spec', name: 'Web map specification', aliases: [] });
    expect(
      subjectColumn({ header: ['JS SDK', 'Web scene spec', 'Web map spec'], rows: [] }, spec),
    ).toBe(2);
    expect(subjectColumn({ header: ['A', 'B'], rows: [] }, jsProduct)).toBe(0);
  });

  it('reports the row of the current version and flags rows above it as unreleased', () => {
    const rows = rowsFromTable(matrix!, { ...about, target: '5.1', current: '5.1' });
    expect(rows).toEqual([
      // 5.2 is listed ahead of its release; its empty Enterprise cell is skipped. The
      // "Released" column is a fact about the row itself, not a pairing, and is left out.
      { with: 'Calcite', value: '5.2.* (with JS SDK 5.2.*)', unreleased: true, source: MATRIX_URL },
      { with: 'Enterprise', value: '12.2', unreleased: false, source: MATRIX_URL },
      { with: 'Calcite', value: '5.1.*', unreleased: false, source: MATRIX_URL },
    ]);
  });

  it('reports the row of a requested older version', () => {
    const rows = rowsFromTable(matrix!, { ...about, target: '4.33.2', current: '5.1' });
    expect(rows.filter((row) => !row.unreleased)).toEqual([
      { with: 'Enterprise', value: '12.0', unreleased: false, source: MATRIX_URL },
      { with: 'Calcite', value: '3.2.1', unreleased: false, source: MATRIX_URL },
    ]);
  });

  it('falls back to the first row when no version is known', () => {
    const rows = rowsFromTable(matrix!, about);
    expect(rows.every((row) => !row.unreleased)).toBe(true);
    expect(rows[0]).toMatchObject({ with: 'Calcite', value: '5.2.*' });
  });

  it('reads a name / version list for the packages that matter', () => {
    const [list] = htmlTables(LIBRARIES_HTML);
    const rows = rowsFromTable(list!, { ...about, wanted: new Set(['python', 'arcgis']) });
    expect(rows).toEqual([
      { with: 'arcgis', value: '2.4.3', unreleased: false, source: MATRIX_URL },
      { with: 'python', value: '3.13.13', unreleased: false, source: MATRIX_URL },
    ]);
  });
});

describe('readCompatibility', () => {
  it('reads the table through the HTML renderer', async () => {
    const render = new FakeRenderer().when('html', ({ meta }) =>
      makeDocPage({ url: meta.url, markdown: MATRIX_MARKDOWN }),
    );
    const ctx = makeCtx({ cassette: SITES, render });
    const { rows, notices } = await readCompatibility(ctx, jsProduct, {
      target: '5.1',
      current: '5.1',
      call: makeCall(ctx),
    });
    expect(notices).toEqual([]);
    expect(rows.filter((row) => !row.unreleased).map((row) => [row.with, row.value])).toEqual([
      ['Enterprise', '12.2'],
      ['Calcite', '5.1.*'],
    ]);
    expect(render.calls[0]?.meta).toMatchObject({ url: MATRIX_URL, product: 'js-maps-sdk' });
  });

  it('falls back to the markup when the rendered page has no table', async () => {
    const ctx = makeCtx({ cassette: SITES });
    const { rows } = await readCompatibility(ctx, jsProduct, { target: '5.0', current: '5.1' });
    expect(rows.find((row) => row.with === 'Enterprise' && !row.unreleased)?.value).toBe('12.1');
  });

  it('picks related packages out of a package list', async () => {
    const arcpy = makeProduct({
      id: 'arcpy',
      name: 'ArcPy',
      aliases: [],
      related: ['python-api', 'missing-product'],
      compatibility: [
        { name: 'Python libraries', url: 'https://doc.esri.com/en/widgets/latest/libraries.html' },
      ],
    });
    const python = makeProduct({
      id: 'python-api',
      packages: [{ registry: 'pypi', name: 'arcgis', license: 'apache-2.0' }],
    });
    const ctx = makeCtx({ cassette: SITES, products: [arcpy, python] });
    const { rows } = await readCompatibility(ctx, arcpy, { current: '3.7' });
    expect(rows.map((row) => `${row.with} ${row.value}`)).toEqual([
      'arcgis 2.4.3',
      'python 3.13.13',
    ]);
  });

  it('turns an unreadable or table-less page into a notice', async () => {
    const ctx = makeCtx({ cassette: SITES });
    ctx.http.fail(MATRIX_URL, 503);
    const failed = await readCompatibility(ctx, jsProduct, {});
    expect(failed.rows).toEqual([]);
    expect(failed.notices).toEqual([
      `Compatibility table "Version matrix" could not be read (UPSTREAM_UNAVAILABLE): ${MATRIX_URL}`,
    ]);

    const noTable = makeProduct({
      compatibility: [{ name: 'Matrix', url: 'https://developers.arcgis.com/no-banner/' }],
    });
    const empty = await readCompatibility(makeCtx({ cassette: SITES }), noTable, {});
    expect(empty.notices[0]).toMatch(/No compatibility table was found/);
  });

  it('reads nothing with the website capability off or without configured pages', async () => {
    const off = makeCtx({
      cassette: SITES,
      config: { capabilities: new Set(['registries'] as const) },
    });
    expect(await readCompatibility(off, jsProduct, {})).toEqual({ rows: [], notices: [] });
    expect(off.http.count()).toBe(0);
    const ctx = makeCtx();
    expect(await readCompatibility(ctx, makeProduct(), {})).toEqual({ rows: [], notices: [] });
  });
});
