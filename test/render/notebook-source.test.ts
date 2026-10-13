import { describe, expect, it } from 'vitest';
import { renderNotebook } from '../../src/render/notebook.js';
import { languageOf, renderSource } from '../../src/render/source.js';
import { readFixture, readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

describe('renderNotebook', () => {
  const ipynb = readJsonFixture<{ cells: unknown[] }>(...structured('notebook', 'tides.ipynb'));
  const meta = makeMeta({
    url: 'https://github.com/example/tides/blob/main/samples/reading-a-gauge.ipynb',
    kind: 'sample',
    license: 'apache-2.0',
  });
  const page = renderNotebook({ ipynb }, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('notebook', 'tides.expected.md'));
  });

  it('keeps Markdown cells and fences code cells with the kernel language', () => {
    expect(page.title).toBe('Reading a tide gauge');
    expect(sectionIds(page)).toEqual(['reading-a-tide-gauge', 'next-high-tide']);
    expect(pageText(page)).toContain(
      '```python\nfrom tides import TideClock\n\nclock = TideClock("brest")\n```',
    );
    expect(page.diagnostics.fences).toBe(page.diagnostics.fencesWithLanguage);
  });

  it('keeps short text output and drops rich, long and error output', () => {
    const text = pageText(page);
    expect(text).toContain('Output:\n\n```text\ndatetime.datetime(2026, 10, 14, 5, 12)\n```');
    expect(text).toContain('```text\nloaded 96 readings\n```');
    expect(text).not.toContain('Figure size');
    expect(text).not.toContain('iVBORw0KGgo');
    expect(text).not.toContain('Traceback');
    expect(text).not.toContain('row 14');
  });

  it('drops raw cells and empty code cells', () => {
    expect(pageText(page)).not.toContain('raw cell');
    expect(page.diagnostics.fences).toBe(6);
  });

  it('makes the links of Markdown cells absolute', () => {
    expect(pageText(page)).toContain(
      '[data notes](https://github.com/example/tides/blob/main/samples/data/README.md)',
    );
  });

  it('uses the kernel language of the notebook and strips terminal colours', () => {
    const r = renderNotebook(
      {
        ipynb: {
          metadata: { kernelspec: { language: 'R' } },
          cells: [
            {
              cell_type: 'code',
              source: 'summary(x)',
              outputs: [{ output_type: 'stream', text: '\u001b[31mmean\u001b[0m 3\n' }],
            },
          ],
        },
      },
      meta,
    );
    expect(r.sections[0]?.markdown).toBe(
      '```R\nsummary(x)\n```\n\nOutput:\n\n```text\nmean 3\n```',
    );
    expect(r.title).toBe('Reading a gauge');
  });

  it('throws DOC_NOT_FOUND for a file that is not a notebook', () => {
    expect(thrownBy(() => renderNotebook({ ipynb: { nbformat: 4 } }, meta))).toEqual({
      code: 'DOC_NOT_FOUND',
      why: 'the file is not a notebook: it has no cells',
      url: meta.url,
    });
  });
});

describe('renderSource', () => {
  const dir = ['oss', 'arcgis-maps-sdk-swift-samples', 'display-map'];
  const base =
    'https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/main/Shared/Samples/Display%20map';
  const meta = makeMeta({ url: `${base}/README.md`, kind: 'sample', license: 'apache-2.0' });
  const swift = readFixture(...dir, 'DisplayMapView.swift');
  const input = {
    readme: readFixture(...dir, 'README.md'),
    metadata: readJsonFixture(...dir, 'README.metadata.json'),
    files: [
      { name: 'Helpers.swift', text: 'let helper = 1\n', ref: `${base}/Helpers.swift` },
      { name: 'DisplayMapView.swift', text: swift, ref: `${base}/DisplayMapView.swift` },
    ],
  };
  const page = renderSource(input, meta);

  it('matches the golden file (Apache-2.0 sample)', () => {
    expectGolden(page, ...dir, 'sample.expected.md');
  });

  it('takes title, relevant APIs and the header line from the metadata', () => {
    expect(page.title).toBe('Display map');
    expect(page.relevantApis).toEqual(['BasemapStyle', 'Map', 'MapView']);
    expect(page.header).toBe(
      '**Category:** Maps · **Keywords:** basemap style, map, BasemapStyle, Map, MapView\n\n**Files:** `DisplayMapView.swift`, `Helpers.swift`',
    );
  });

  it('puts the snippet file first and keeps code out of the sections', () => {
    expect(page.files?.map((file) => file.name)).toEqual(['DisplayMapView.swift', 'Helpers.swift']);
    expect(page.files?.[0]).toMatchObject({
      language: 'swift',
      ref: `${base}/DisplayMapView.swift`,
      bytes: Buffer.byteLength(swift, 'utf8'),
    });
    expect(page.files?.[0]?.text).toContain('MapView(map: map)');
    expect(pageText(page).replace(/<!-- file:.*-->/g, '')).not.toContain('MapView(map: map)');
    expect(page.diagnostics.fences).toBe(0);
  });

  it('describes the sample from its README, images pointing at raw files', () => {
    expect(sectionIds(page)).toEqual([
      'display-map',
      'use-case',
      'how-to-use-the-sample',
      'how-it-works',
      'relevant-api',
      'tags',
    ]);
    expect(page.sections[0]?.markdown).toContain(
      '![Image of display map](https://raw.githubusercontent.com/Esri/arcgis-maps-sdk-swift-samples/main/Shared/Samples/Display%20map/display-map.png)',
    );
  });

  it('builds a page from metadata alone', () => {
    const bare = renderSource(
      { files: [], metadata: { title: 'Find route', description: 'Routes between two stops.' } },
      meta,
    );
    expect(bare.title).toBe('Find route');
    expect(bare.sections.map((section) => section.markdown)).toEqual([
      '# Find route\n\nRoutes between two stops.',
    ]);
    expect(bare.header).toBeUndefined();
    expect(bare.files).toEqual([]);
  });

  it('builds a page from files alone, titled after the URL', () => {
    const bare = renderSource(
      {
        files: [
          {
            name: 'src/main.py',
            text: 'print(1)\r\n',
            ref: 'https://github.com/example/tides/blob/main/find-route/src/main.py',
          },
        ],
      },
      makeMeta({
        url: 'https://github.com/example/tides/tree/main/find-route',
        kind: 'sample',
        license: 'apache-2.0',
      }),
    );
    expect(bare.title).toBe('Find route');
    expect(bare.sections.map((section) => section.markdown)).toEqual(['# Find route']);
    expect(bare.files).toEqual([
      {
        name: 'src/main.py',
        language: 'python',
        text: 'print(1)\n',
        ref: 'https://github.com/example/tides/blob/main/find-route/src/main.py',
        bytes: 10,
      },
    ]);
  });

  it('uses the README title when there is no metadata', () => {
    const bare = renderSource(
      { files: [], readme: '---\ntitle: From front matter\n---\n# Heading\n\nText.' },
      meta,
    );
    expect(bare.title).toBe('From front matter');
    expect(renderSource({ files: [], readme: '# Heading\n\nText.' }, meta).title).toBe('Heading');
  });
});

describe('languageOf', () => {
  it('maps extensions to fence languages', () => {
    expect(languageOf('App.xaml')).toBe('xml');
    expect(languageOf('main.kt')).toBe('kotlin');
    expect(languageOf('Config.daml')).toBe('xml');
    expect(languageOf('index.HTML')).toBe('html');
    expect(languageOf('data.geojson')).toBe('geojson');
    expect(languageOf('Makefile')).toBe('');
  });
});
