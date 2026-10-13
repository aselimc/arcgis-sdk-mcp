import { describe, expect, it } from 'vitest';
import { githubRepoAdapter } from '../../../../src/adapters/reference/github/adapter.js';
import {
  extractRegions,
  snippetsMarkdown,
} from '../../../../src/adapters/reference/github/snippets-region.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { sectionsFromMarkdown } from '../../../../src/core/sections.js';
import { bound, githubCtx, githubProduct, repoFiles } from './support.js';

const REPO = 'Esri/desktop-sdk-snippets';
const FILE = 'SDKExamples/Content/ProSnippet/ProSnippets Content.cs';
const FILE_URL = `https://github.com/${REPO}/blob/main/SDKExamples/Content/ProSnippet/ProSnippets%20Content.cs`;
const fixture = repoFiles('snippets');

function setup(maxRequests?: number) {
  const { product, source } = githubProduct(
    { repo: REPO, preset: 'snippets-region' },
    { id: 'snippets' },
    { languages: ['csharp'] },
  );
  const ctx = githubCtx({ [REPO]: { files: { '*': fixture } } });
  return {
    ctx,
    src: bound(ctx, product, source, maxRequests === undefined ? {} : { maxRequests }),
  };
}

describe('extractRegions', () => {
  it('extracts titled regions with their cref lines, groups and de-indented code', () => {
    const regions = extractRegions(fixture[FILE] ?? '');
    expect(regions.map((region) => [region.group, region.title])).toEqual([
      ['Dialogs', 'Show an open dialog'],
      ['Dialogs', 'Show a save dialog'],
      ['Project items', 'Add a folder to List<Item>'],
    ]);
    expect(regions[0]).toMatchObject({
      apis: ['Desktop.Catalog.OpenItemDialog', 'Desktop.Catalog.ItemDialog.Title'],
      line: 23,
    });
    expect(regions[0]?.code).toBe(
      [
        '{',
        '  var dialog = new OpenItemDialog();',
        '  dialog.Title = "Pick a layer file";',
        '  bool? picked = dialog.ShowDialog();',
        '}',
      ].join('\n'),
    );
    expect(regions[2]?.apis).toEqual([
      'Desktop.Core.Project.GetItems``1',
      'Desktop.Core.Project.AddItem(Desktop.Core.Item)',
    ]);
  });

  it('drops set-up regions, group markers and empty regions', () => {
    const regions = extractRegions(
      [
        '#region ignore - set-up',
        'var hidden = 1;',
        '#endregion',
        '#region ProSnippet Group: Tools',
        'var alsoHidden = 2;',
        '#endregion',
        '#region Empty',
        '',
        '#endregion',
        '#region Kept',
        'var shown = 3;',
        '#endregion',
      ].join('\n'),
    );
    expect(regions).toEqual([
      { title: 'Kept', group: 'Tools', apis: [], code: 'var shown = 3;', line: 10 },
    ]);
  });

  it('returns nested regions on their own and inside the outer one, in file order', () => {
    const regions = extractRegions(
      [
        '#region Outer',
        'a();',
        '  // cref: Api.Inner',
        '  #region Inner',
        '  b();',
        '  #endregion',
        'c();',
        '#endregion',
      ].join('\r\n'),
    );
    expect(regions.map((region) => region.title)).toEqual(['Outer', 'Inner']);
    expect(regions[0]?.code).toBe('a();\n  b();\nc();');
    expect(regions[1]).toMatchObject({ code: 'b();', apis: ['Api.Inner'], line: 4 });
  });

  it('attaches cref lines only to the region directly below them', () => {
    const regions = extractRegions(
      [
        '// cref: Api.Stale',
        'var between = 1;',
        '',
        '// cref: Api.Fresh',
        '',
        '#region R',
        'x();',
        '#endregion',
      ].join('\n'),
    );
    expect(regions[0]?.apis).toEqual(['Api.Fresh']);
  });

  it('understands the directive forms of other languages and an unterminated region', () => {
    const regions = extractRegions(
      [
        '\uFEFF#pragma region Cpp snippet',
        'run();',
        '#pragma endregion',
        '//region Kotlin snippet',
        'run()',
        '//endregion',
        '// #region Script snippet',
        'run();',
        '// #endregion',
        '// region of interest is the visible extent',
        '#region',
        'untitled();',
        '#endregion',
        '#region Left open',
        'tail();',
      ].join('\n'),
    );
    expect(regions.map((region) => region.title)).toEqual([
      'Cpp snippet',
      'Kotlin snippet',
      'Script snippet',
      'Snippet at line 11',
      'Left open',
    ]);
    expect(regions.at(-1)?.code).toBe('tail();');
  });

  it('finds nothing in a file without regions', () => {
    expect(extractRegions(fixture['SDKExamples/Content/ProSnippet/Helpers.cs'] ?? '')).toEqual([]);
  });
});

describe('snippetsMarkdown', () => {
  it('writes one heading per group and region, with escaped titles and safe fences', () => {
    const { markdown, headings } = snippetsMarkdown(
      'Snippets',
      [
        { title: 'Plain', apis: [], code: 'a();', line: 1 },
        {
          title: 'Use List<T> *now*',
          group: 'G',
          apis: ['A.B', 'C'],
          code: 'var s = "```";',
          line: 5,
        },
      ],
      'csharp',
    );
    expect(markdown).toBe(
      [
        '# Snippets',
        '## Plain',
        '```csharp\na();\n```',
        '## G',
        '### Use List\\<T\\> \\*now\\*',
        'Relevant API: `A.B`, `C`',
        '````csharp\nvar s = "```";\n````',
      ].join('\n\n'),
    );
    expect(headings.map((heading) => heading.title)).toEqual([
      'Snippets',
      'Plain',
      'G',
      'Use List<T> *now*',
    ]);
    // The escaped heading reads back as the region title, so ids are derived from it.
    expect(sectionsFromMarkdown(markdown).map((section) => section.title)).toEqual([
      'Snippets',
      'Plain',
      'G',
      'Use List<T> *now*',
    ]);
  });
});

describe('snippets-region preset', () => {
  it('enumerates one record per snippets file and per region', async () => {
    const { ctx, src } = setup();
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.ref)).toEqual([
      FILE_URL,
      `${FILE_URL}#show-an-open-dialog`,
      `${FILE_URL}#show-a-save-dialog`,
      `${FILE_URL}#add-a-folder-to-listitem`,
    ]);
    expect(records[0]).toMatchObject({
      title: 'ProSnippets Content',
      kind: 'sample',
      breadcrumb: 'SDK examples > Content > Pro snippet',
      language: 'csharp',
    });
    expect(records[1]).toMatchObject({
      title: 'Show an open dialog',
      breadcrumb: 'SDK examples > Content > Pro snippet > ProSnippets Content > Dialogs',
      keywords: [
        'Catalog.OpenItemDialog',
        'OpenItemDialog',
        'Desktop.Catalog.OpenItemDialog',
        'ItemDialog.Title',
        'Title',
        'Desktop.Catalog.ItemDialog.Title',
      ],
      locator: { path: FILE, section: 'show-an-open-dialog' },
    });
    // Generic arity and parameter lists are not part of a searchable API name.
    expect(records[3]?.keywords).toEqual([
      'Project.GetItems',
      'GetItems',
      'Desktop.Core.Project.GetItems',
      'Project.AddItem',
      'AddItem',
      'Desktop.Core.Project.AddItem',
    ]);
    // Helpers.cs was fetched, has no regions and is therefore not a snippets file.
    expect(records.some((record) => record.ref.includes('Helpers.cs'))).toBe(false);
    expect(ctx.github.count('raw')).toBe(2);
  });

  it('keeps file records for the files the request budget does not reach', async () => {
    // Repository metadata and the tree take two requests; one is left for a file body. It
    // goes to Helpers.cs (no regions, so no record); the other file is listed unscanned.
    const { ctx, src } = setup(3);
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(ctx.github.count('raw')).toBe(1);
    expect(records.map((record) => record.ref)).toEqual([FILE_URL]);
  });

  it('keeps the file record when a body cannot be fetched', async () => {
    const { ctx, src } = setup();
    const tree = ctx.github.tree.bind(ctx.github);
    ctx.github.tree = async (repo, ref, opts) => [
      ...(await tree(repo, ref, opts)),
      { path: 'SDKExamples/Gone.cs' },
    ];
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.find((record) => record.title === 'Gone')?.ref).toBe(
      `https://github.com/${REPO}/blob/main/SDKExamples/Gone.cs`,
    );
    expect(records).toHaveLength(5);
  });

  it('reports a defect instead of hiding it behind a partial catalogue', async () => {
    const { ctx, src } = setup();
    const raw = ctx.github.raw.bind(ctx.github);
    ctx.github.raw = (repo, ref, path, opts) =>
      path === FILE ? Promise.reject(new Error('socket hang up')) : raw(repo, ref, path, opts);
    await expect(githubRepoAdapter.enumerate?.(ctx, src)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('reads a snippets file as a Markdown page of regions', async () => {
    const { ctx, src } = setup();
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(FILE_URL) });
    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('markdown');
    const { markdown } = call?.input as RendererInputs['markdown'];
    expect(
      markdown.startsWith('# ProSnippets Content\n\n## Dialogs\n\n### Show an open dialog'),
    ).toBe(true);
    expect(markdown).toContain('Relevant API: `Desktop.Catalog.SaveItemDialog.ShowDialog`');
    // A name that contains backticks gets a longer code-span delimiter.
    expect(markdown).toContain(
      '``` Desktop.Core.Project.GetItems``1 ```, `Desktop.Core.Project.AddItem',
    );
    expect(markdown).not.toContain('Variable initialization');
    expect(markdown).not.toContain('#region');
    expect(page.sections.map((section) => section.id)).toEqual([
      'prosnippets-content',
      'dialogs',
      'show-an-open-dialog',
      'show-a-save-dialog',
      'project-items',
      'add-a-folder-to-listitem',
    ]);
    expect(page).toMatchObject({ ref: FILE_URL, kind: 'sample', license: 'apache-2.0' });
  });

  it('opens one snippet through its record, selecting the region section', async () => {
    const { ctx, src } = setup();
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    const record = records.find((candidate) => candidate.title === 'Show a save dialog');
    if (record === undefined) throw new Error('the region record is missing');
    const page = await githubRepoAdapter.sample?.(ctx, src, record);
    expect(ctx.render.calls.at(-1)?.opts).toEqual({ select: { section: 'show-a-save-dialog' } });
    expect(page?.ref).toBe(`${FILE_URL}#show-a-save-dialog`);
  });

  it('shows a source file without regions as plain source', async () => {
    const { ctx, src } = setup();
    await githubRepoAdapter.read(ctx, src, {
      url: new URL(
        `https://github.com/${REPO}/blob/main/SDKExamples/Content/ProSnippet/Helpers.cs`,
      ),
    });
    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('source');
    expect((call?.input as RendererInputs['source']).files.map((file) => file.name)).toEqual([
      'Helpers.cs',
    ]);
  });
});
