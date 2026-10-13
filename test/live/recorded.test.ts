/**
 * Invariants on live-recorded upstream responses (design section 10, "Live recorded").
 *
 * `scripts/record-fixtures.ts` downloads the URLs of `test/fixtures/fixtures.manifest.json`
 * into the git-ignored `test/fixtures/recorded`. These tests read those files and make no
 * request themselves. They check properties that must hold whatever the page says today
 * (the family, clean Markdown, closed fences, a usable outline), never exact output. An
 * entry that was not recorded is skipped, so the suite passes on a machine without
 * recordings; a failure means a site changed and a synthetic fixture needs updating.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bodyVariantOf } from '../../src/adapters/site/gatsby/body.js';
import { joinSections } from '../../src/core/budget.js';
import type { RenderMeta } from '../../src/core/ports.js';
import { parseSitemap } from '../../src/core/sitemap.js';
import type { DocKind, DocPage } from '../../src/core/types.js';
import { measureMarkdown } from '../../src/extract/diagnostics.js';
import { createHtmlExtractor } from '../../src/extract/index.js';
import { scanDts } from '../../src/render/dts/scanner.js';
import { createRenderer } from '../../src/render/index.js';
import {
  fileNameFor,
  parseManifest,
  type ManifestEntry,
  type RecordedFile,
} from '../../scripts/record-fixtures.js';

const FIXTURES = resolve(fileURLToPath(import.meta.url), '..', '..', 'fixtures');
const RECORDED = resolve(FIXTURES, 'recorded');

const manifest = parseManifest(readFileSync(resolve(FIXTURES, 'fixtures.manifest.json'), 'utf8'));
const provenance = new Map<string, RecordedFile>(
  existsSync(resolve(RECORDED, 'index.json'))
    ? (JSON.parse(readFileSync(resolve(RECORDED, 'index.json'), 'utf8')) as RecordedFile[]).map(
        (file) => [file.id, file],
      )
    : [],
);

const isRecorded = (entry: ManifestEntry): boolean =>
  provenance.has(entry.id) && existsSync(resolve(RECORDED, fileNameFor(entry)));
const body = (entry: ManifestEntry): string =>
  readFileSync(resolve(RECORDED, fileNameFor(entry)), 'utf8');
const entryOf = (id: string): ManifestEntry => {
  const entry = manifest.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`No fixture "${id}" in the manifest`);
  return entry;
};

const extractor = createHtmlExtractor();

function convert(entry: ManifestEntry, member?: string): DocPage {
  const file = provenance.get(entry.id);
  const kind: DocKind = /api-reference|\/references\/|tool-reference/.test(entry.url)
    ? 'api'
    : 'guide';
  return extractor.extract(
    { html: body(entry) },
    {
      url: file?.finalUrl ?? entry.url,
      kind,
      license: 'esri-website-terms',
      retrievedAt: file?.fetchedAt ?? new Date(0).toISOString(),
    },
    member === undefined ? undefined : { select: { member } },
  );
}

const markdownOf = (page: DocPage): string =>
  [page.header ?? '', joinSections(page.sections)].filter((part) => part !== '').join('\n\n');

const pages = manifest.entries.filter(
  (entry) => entry.expect === 'html' && entry.family !== undefined,
);

describe('recorded pages convert cleanly', () => {
  describe.each(pages)('$id', (entry) => {
    it.skipIf(!isRecorded(entry))('is detected as its family and is not degraded', () => {
      const page = convert(entry);
      expect(extractor.detectFamily(body(entry))).toBe(entry.family);
      expect(page.diagnostics.family).toBe(entry.family);
      expect(page.degraded).toBeUndefined();
    });

    it.skipIf(!isRecorded(entry))('leaves no HTML and closes every fence', () => {
      const page = convert(entry);
      const markdown = markdownOf(page);
      const metrics = measureMarkdown(markdown);
      expect(metrics.leftoverHtmlTags).toBe(0);
      expect(metrics.unclosedFence).toBe(false);
      // Sites mark some blocks as "other" (request syntax, plain text); those stay untagged
      // by design. Losing the language of most blocks would mean the code pass stopped
      // recognising the markup.
      expect(metrics.fencesWithLanguage * 2).toBeGreaterThanOrEqual(metrics.fences);
      expect(markdown).not.toContain('\x7f');
      expect(markdown).not.toContain('[](#');
      // Private-use characters are internal markers and must not survive.
      expect(markdown).not.toMatch(/[\ue000-\uf8ff]/);
    });

    it.skipIf(!isRecorded(entry))('has a title, text and unique section ids', () => {
      const page = convert(entry);
      expect(page.title.trim()).not.toBe('');
      expect(markdownOf(page).length).toBeGreaterThan(200);
      const ids = page.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe('member slices', () => {
  const featureLayer = entryOf('astro-js-ref-featurelayer');

  it.skipIf(!isRecorded(featureLayer))(
    'FeatureLayer.queryFeatures is one member of 2 to 8 KB',
    () => {
      const page = convert(featureLayer, 'queryFeatures');
      const markdown = joinSections(page.sections);
      expect(markdown).toContain('queryFeatures');
      expect(markdown.length).toBeGreaterThan(2000);
      expect(markdown.length).toBeLessThan(8000);
      // The page documents hundreds of members; the slice must not carry the others.
      expect(markdown).not.toContain('### applyEdits');
      expect(page.members?.length ?? 0).toBeGreaterThan(100);
    },
  );
});

describe('meta-refresh stubs', () => {
  const stubs = manifest.entries.filter((entry) => entry.id.startsWith('meta-refresh-'));

  it.each(stubs)('$id was followed to a real page by the gateway', (entry) => {
    const file = provenance.get(entry.id);
    if (file === undefined) return;
    expect(file.aliasChain.length).toBeGreaterThan(0);
    expect(file.finalUrl).not.toBe(entry.url);
    // The body recorded is the target's, not a stub that still asks to be followed.
    expect(extractor.detectMetaRefresh(body(entry), file.finalUrl)).toBeUndefined();
  });
});

describe('sitemaps', () => {
  const sitemaps = manifest.entries.filter((entry) => entry.expect === 'xml');

  it.each(sitemaps)('$id lists page URLs', (entry) => {
    if (!isRecorded(entry)) return;
    const parsed = parseSitemap(body(entry));
    expect(parsed.entries.length).toBeGreaterThan(50);
    expect(parsed.entries.every((item) => item.loc.startsWith('https://'))).toBe(true);
  });
});

/** Named members per class and interface of a declaration file, by the TypeScript compiler. */
function compilerMembers(source: string): Map<string, Set<string>> {
  const file = ts.createSourceFile('recorded.d.ts', source, ts.ScriptTarget.Latest, true);
  const byDeclaration = new Map<string, Set<string>>();
  for (const statement of file.statements) {
    if (!ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue;
    if (statement.name === undefined) continue;
    const names = byDeclaration.get(statement.name.text) ?? new Set<string>();
    for (const member of statement.members) {
      if (ts.isConstructorDeclaration(member)) names.add('constructor');
      else if (
        member.name !== undefined &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
      ) {
        names.add(member.name.text);
      }
    }
    byDeclaration.set(statement.name.text, names);
  }
  return byDeclaration;
}

describe('the .d.ts scanner agrees with the TypeScript compiler', () => {
  const files = ['dts-featurelayer', 'dts-map'].map(entryOf);

  it.each(files)('$id: same classes, interfaces and member names', (entry) => {
    if (!isRecorded(entry)) return;
    const source = body(entry);
    const expected = compilerMembers(source);
    expect(expected.size).toBeGreaterThan(0);

    const scanned = new Map<string, Set<string>>();
    for (const declaration of scanDts(source).declarations) {
      if (declaration.kind !== 'class' && declaration.kind !== 'interface') continue;
      expect(declaration.bodyParsed, declaration.name).toBe(true);
      const names = scanned.get(declaration.name) ?? new Set<string>();
      for (const member of declaration.members) {
        if (member.kind === 'constructor') names.add('constructor');
        else if (member.name !== '' && !member.name.startsWith('[')) names.add(member.name);
      }
      scanned.set(declaration.name, names);
    }

    expect([...scanned.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, members] of expected) {
      expect([...(scanned.get(name) ?? [])].sort(), name).toEqual([...members].sort());
    }
  });
});

/**
 * Structured sources: the recorded JSON is handed to the renderer in the shape the adapter
 * hands it over (the selection of a page-data body is the adapter's own function), so a
 * renamed field upstream or a mismatch between adapter and renderer fails here.
 */
describe('recorded structured sources render', () => {
  const renderer = createRenderer(extractor);
  const json = (entry: ManifestEntry): unknown => JSON.parse(body(entry)) as unknown;
  const metaOf = (entry: ManifestEntry): RenderMeta => ({
    url: provenance.get(entry.id)?.finalUrl ?? entry.url,
    kind: 'api',
    license: 'esri-website-terms',
    retrievedAt: provenance.get(entry.id)?.fetchedAt ?? new Date(0).toISOString(),
  });
  const expectClean = (page: DocPage, minChars = 200): void => {
    const markdown = markdownOf(page);
    const metrics = measureMarkdown(markdown);
    expect(page.title.trim()).not.toBe('');
    expect(page.diagnostics.family).toBe('structured');
    expect(markdown.length).toBeGreaterThan(minChars);
    expect(metrics.leftoverHtmlTags).toBe(0);
    expect(metrics.unclosedFence).toBe(false);
    const ids = page.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  };

  const pageData = [
    ['openapi-operation-page-data', 'openapi'],
    ['openapi-schemas-page-data', 'openapi'],
    ['typedoc-rest-js-page-data', 'typedoc'],
    ['typedoc-experience-builder-page-data', 'typedoc'],
  ] as const;

  it.each(pageData)('%s: the page-data body is found and rendered by %s', (id, kind) => {
    const entry = entryOf(id);
    if (!isRecorded(entry)) return;
    const data = (json(entry) as { result?: { data?: Record<string, unknown> } }).result?.data;
    expect(data).toBeDefined();
    const variant = bodyVariantOf(data ?? {}, 'auto');
    expect(variant?.renderer).toBe(kind);
    if (variant?.renderer === 'openapi') {
      const { operation, schemas } = variant;
      expectClean(
        renderer.render(
          'openapi',
          {
            ...(operation === undefined ? {} : { operation }),
            ...(schemas === undefined ? {} : { schemas }),
          },
          metaOf(entry),
        ),
      );
    } else if (variant?.renderer === 'typedoc') {
      const page = renderer.render('typedoc', { raw: variant.raw }, metaOf(entry));
      expectClean(page);
      expect(page.members?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('openapi-document: every operation and schema of a published document renders', () => {
    const entry = entryOf('openapi-document');
    if (!isRecorded(entry)) return;
    const spec = json(entry);
    const overview = renderer.render('openapi', { spec }, metaOf(entry));
    const operations = (overview.members ?? []).filter((member) => member.kind === 'operation');
    const others = (overview.members ?? []).filter((member) => member.kind !== 'operation');
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      // `METHOD path` is how the adapter names an operation to the renderer.
      const page = renderer.render('openapi', { spec, target: operation.name }, metaOf(entry));
      expect(page.title).toBe(operation.name);
      expectClean(page, operation.name.length + 20);
    }
    for (const schema of others) {
      const page = renderer.render('openapi', { spec, target: schema.name }, metaOf(entry));
      expect(markdownOf(page)).toContain(schema.name);
      expect(page.sections).toHaveLength(1);
    }
  });

  it('cem-api: a component of the manifest renders with its members', () => {
    const entry = entryOf('cem-api');
    if (!isRecorded(entry)) return;
    const input = {
      manifest: json(entry),
      tag: 'arcgis-map',
      packageName: '@arcgis/map-components',
    };
    const page = renderer.render('cem', input, metaOf(entry));
    expectClean(page);
    expect(page.members?.some((member) => member.name === 'goTo')).toBe(true);
    const member = renderer.render('cem', { ...input, member: 'goTo' }, metaOf(entry));
    expect(markdownOf(member)).toContain('goTo(');
    expect(member.sections.length).toBeLessThan(page.sections.length);
  });

  it('docc-map: a class of the Swift reference renders with its declaration', () => {
    const entry = entryOf('docc-map');
    if (!isRecorded(entry)) return;
    const page = renderer.render('docc', { json: json(entry) }, metaOf(entry));
    expectClean(page);
    expect(page.title).toBe('Map');
    expect(markdownOf(page)).toContain('```swift');
  });
});
