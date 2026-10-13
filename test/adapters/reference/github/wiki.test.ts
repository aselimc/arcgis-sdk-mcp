import { describe, expect, it } from 'vitest';
import { githubRepoAdapter } from '../../../../src/adapters/reference/github/adapter.js';
import { parseSidebar } from '../../../../src/adapters/reference/github/wiki.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { makeRecord } from '../../../support/builders.js';
import { bound, githubCtx, githubProduct, wikiPages, type GithubConfig } from './support.js';

const REPO = 'Esri/desktop-sdk';
const WIKI = `https://github.com/${REPO}/wiki`;
const pages = wikiPages();

function setup(config: Partial<GithubConfig> = {}, wiki: Record<string, string> = pages) {
  const { product, source } = githubProduct(
    { repo: REPO, preset: 'wiki', ...config },
    { id: 'wiki', kinds: ['guide'] },
  );
  const ctx = githubCtx({ [REPO]: { defaultBranch: 'master', wiki } });
  return { ctx, src: bound(ctx, product, source) };
}

describe('parseSidebar', () => {
  it('collects the internal links of every form, once each, with their groups', () => {
    expect(parseSidebar(pages._Sidebar ?? '', REPO)).toEqual([
      { page: 'Home', title: 'Home', trail: [] },
      { page: 'Release-notes', title: 'Release notes', trail: ['Developing add-ins'] },
      {
        page: 'ProConcepts-3.0-Migration-Guide',
        title: 'ProConcepts: 3.0 Migration Guide',
        trail: ['Developing add-ins', 'Migration'],
      },
      { page: 'ProConcepts-Editing', title: 'ProConcepts: Editing', trail: ['Editing'] },
      { page: 'ProGuide-Sketch-tool', title: 'ProGuide: Sketch tool', trail: ['Editing'] },
      { page: 'ProSnippets-Editing', title: 'ProSnippets: Editing', trail: ['Editing'] },
      { page: 'Editing-FAQ', title: 'Editing FAQ', trail: ['Editing'] },
      { page: 'ProConcepts-Annotation', title: 'Annotation basics', trail: ['Editing'] },
    ]);
  });

  it('skips links that leave the wiki', () => {
    const markdown = [
      '* [Other repository wiki](https://github.com/Esri/other/wiki/Page)',
      '* [Sibling wiki](../../other/wiki/Page)',
      '* [Repository file](https://github.com/Esri/desktop-sdk/blob/master/README.md)',
      '* [Site root](/Esri/desktop-sdk)',
      '* [Mail](mailto:someone@example.com)',
      '* [Anchor](#top)',
      '* [Image](diagram.png)',
      '* [Empty]()',
      '* [**Bold** `page`](Styled-Page.md "tooltip")',
      '* [Encoded](Page%20with%20spaces)',
      '* [Bad escape](100%-coverage)',
    ].join('\n');
    expect(parseSidebar(markdown, REPO).map((link) => [link.page, link.title])).toEqual([
      ['Styled-Page', 'Bold page'],
      ['Page with spaces', 'Encoded'],
      ['100%-coverage', 'Bad escape'],
    ]);
  });

  it('treats headings and bold lines as groups and a rule as their end', () => {
    const markdown = [
      '## Group A ##',
      '__Sub__',
      '* [One](One)',
      '***',
      '* [Two](Two)',
      '# [Linked heading](Three)',
      '* [Four](Four)',
      '**[Bold link](Five)**',
    ].join('\r\n');
    expect(parseSidebar(markdown, REPO)).toEqual([
      { page: 'One', title: 'One', trail: ['Group A', 'Sub'] },
      { page: 'Two', title: 'Two', trail: [] },
      { page: 'Three', title: 'Linked heading', trail: [] },
      { page: 'Four', title: 'Four', trail: [] },
      { page: 'Five', title: 'Bold link', trail: [] },
    ]);
  });
});

describe('wiki preset', () => {
  it('enumerates the home page and every page the sidebar links to with one request', async () => {
    const { ctx, src } = setup();
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.ref)).toEqual([
      `${WIKI}/Home`,
      `${WIKI}/Release-notes`,
      `${WIKI}/ProConcepts-3.0-Migration-Guide`,
      `${WIKI}/ProConcepts-Editing`,
      `${WIKI}/ProGuide-Sketch-tool`,
      `${WIKI}/ProSnippets-Editing`,
      `${WIKI}/Editing-FAQ`,
      `${WIKI}/ProConcepts-Annotation`,
    ]);
    expect(records[0]).toMatchObject({ title: 'Home', kind: 'guide', locator: { page: 'Home' } });
    expect(records[0]?.breadcrumb).toBeUndefined();
    expect(records[2]?.breadcrumb).toBe('Developing add-ins > Migration');
    expect(ctx.github.count('wikiRaw')).toBe(1);
    // A wiki has no tree and no releases: the API is asked for the repository only.
    expect(ctx.github.count('tree') + ctx.github.count('latestRelease')).toBe(0);
  });

  it('falls back to the links of the home page when there is no sidebar', async () => {
    const { _Sidebar: _dropped, ...withoutSidebar } = pages;
    const { ctx, src } = setup({ exclude: ['*-FAQ'] }, withoutSidebar);
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    // The FAQ link of the home page is excluded by the registry glob.
    expect(records.map((record) => record.title)).toEqual(['Home', 'ProConcepts: Editing']);
    expect(records[1]?.breadcrumb).toBe('Getting started');
    expect(ctx.github.count('wikiRaw')).toBe(2);
  });

  it('reads the home page too when the sidebar links to nothing in the wiki', async () => {
    const { ctx, src } = setup({}, { ...pages, _Sidebar: '* [Samples](https://example.com/)' });
    const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
    expect(records.map((record) => record.locator?.page)).toEqual([
      'Home',
      'ProConcepts-Editing',
      'Editing-FAQ',
    ]);
  });

  it('answers DOC_NOT_FOUND for a repository without a wiki', async () => {
    const { ctx, src } = setup({}, {});
    await expect(githubRepoAdapter.enumerate?.(ctx, src)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
    });
  });

  it('does not take an outage for a missing sidebar', async () => {
    const { ctx, src } = setup();
    ctx.github.outage();
    await expect(githubRepoAdapter.enumerate?.(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(ctx.github.count('wikiRaw')).toBe(1);
  });

  it('reads a page by its wiki URL, with or without a fragment', async () => {
    const { ctx, src } = setup();
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`${WIKI}/Release-notes#36`),
      select: { section: '36' },
    });
    const call = ctx.render.calls.at(-1);
    expect(call?.kind).toBe('markdown');
    expect((call?.input as RendererInputs['markdown']).markdown).toContain('## 3.7');
    expect(call?.opts).toEqual({ select: { section: '36' } });
    expect(page).toMatchObject({
      ref: `${WIKI}/Release-notes#36`,
      url: `${WIKI}/Release-notes`,
      kind: 'guide',
      license: 'apache-2.0',
    });
    expect(page.attribution).not.toBe('');
  });

  it('reads the wiki root as the home page and names a page that has no title of its own', async () => {
    const { ctx, src } = setup();
    const page = await githubRepoAdapter.read(ctx, src, { url: new URL(WIKI) });
    expect(page.ref).toBe(`${WIKI}/Home`);
    expect(page.title).toBe('Home');
    expect(ctx.github.calls.at(-1)).toMatchObject({ method: 'wikiRaw', path: 'Home' });
  });

  it('reads a page from its raw URL and from a URL that names its directory', async () => {
    const { ctx, src } = setup();
    const raw = await githubRepoAdapter.read(ctx, src, {
      url: new URL(
        `https://raw.githubusercontent.com/wiki/${REPO}/Features/Editing/ProConcepts-Editing.md`,
      ),
    });
    expect(raw.ref).toBe(`${WIKI}/Features/Editing/ProConcepts-Editing`);
    expect(raw.title).toBe('ProConcepts Editing');
    expect(ctx.github.count('wikiRaw')).toBe(1);
  });

  it('cannot find a page kept in a directory by name alone, and says why', async () => {
    const { ctx, src } = setup();
    const failure = githubRepoAdapter.read(ctx, src, {
      url: new URL(`${WIKI}/ProConcepts-Editing`),
    });
    await expect(failure).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { url: `${WIKI}/ProConcepts-Editing`, host: 'github.com' },
    });
    await expect(failure).rejects.toThrow(/no page "ProConcepts-Editing"/);
    expect(ctx.github.count('wikiRaw')).toBe(1);
  });

  it('finds such a page in the directories the registry lists and remembers the path', async () => {
    const { ctx, src } = setup({
      include: ['Reference', 'Features/Framework', 'Features/Geodatabase', 'Features/Editing'],
    });
    const target = {
      url: new URL(`${WIKI}/ProConcepts-Editing`),
      record: makeRecord({ kind: 'guide', breadcrumb: 'Editing' }),
    };
    const page = await githubRepoAdapter.read(ctx, src, target);
    // The public ref stays the page's github.com address.
    expect(page.ref).toBe(`${WIKI}/ProConcepts-Editing`);
    expect(
      ctx.github.calls.filter((call) => call.method === 'wikiRaw').map((call) => call.path),
    ).toEqual(['ProConcepts-Editing', 'Features/Editing/ProConcepts-Editing']);

    await githubRepoAdapter.read(ctx, src, target);
    expect(ctx.github.calls.at(-1)).toMatchObject({ path: 'Features/Editing/ProConcepts-Editing' });
    expect(ctx.github.count('wikiRaw')).toBe(3);
  });

  it('tries the best directory and two more for a page nothing is known about', async () => {
    const { ctx, src } = setup({ include: ['A', 'B', 'C', 'D', 'E'] });
    const failure = githubRepoAdapter.read(ctx, src, { url: new URL(`${WIKI}/Nowhere`) });
    await expect(failure).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
    // The failure says how the page can still be opened.
    await expect(failure).rejects.toMatchObject({
      details: { why: expect.stringContaining(`${WIKI}/Nowhere`) as unknown },
    });
    // The page by name, the sidebar (to learn its group), then three directories.
    expect(ctx.github.count('wikiRaw')).toBe(5);
  });

  describe('pages kept below a feature directory', () => {
    // The layout of a wiki that sorts its pages twice: by feature, and inside a feature by
    // sidebar subgroup or by kind of page. Links in the sidebar name none of these directories.
    const sidebar = [
      '### Framework',
      '',
      '* [ProConcepts: Framework](ProConcepts-Framework)',
      '* [ProSnippets: Framework](ProSnippets-Framework)',
      '',
      '&nbsp;&nbsp;&nbsp;&nbsp;**Customization**',
      '',
      '* [ProGuide: Buttons](ProGuide-Buttons)',
      '',
      '&nbsp;&nbsp;&nbsp;&nbsp;**Styling**',
      '',
      '* [ProGuide: Style Guide](proguide-style-guide)',
      '',
      '### Content',
      '',
      '* [ProSnippets: Content](ProSnippets-content)',
    ].join('\n');
    const nested: Record<string, string> = {
      Home: '# Desktop SDK',
      _Sidebar: sidebar,
      'Features/Framework/ProConcepts-Framework': '# Framework',
      'Features/Framework/ProSnippet/ProSnippets-Framework': '# Framework snippets',
      'Features/Framework/Customization/ProGuide-Buttons': '# Buttons',
      'Features/Framework/Styling/ProGuide-Style-Guide': '# Style guide',
      'Features/Content/ProSnippet/ProSnippets-Content': '# Content snippets',
    };
    const include = ['Features/Framework', 'Features/Editing', 'Features/Content', 'Reference'];
    const requested = (ctx: ReturnType<typeof setup>['ctx']): string[] =>
      ctx.github.calls.filter((call) => call.method === 'wikiRaw').map((call) => call.path ?? '');

    // Regression: every page the index lists must be readable. These were DOC_NOT_FOUND,
    // because only the feature directory itself was tried.
    it('reads every page its own index lists', async () => {
      const { ctx, src } = setup({ include }, nested);
      const records = (await githubRepoAdapter.enumerate?.(ctx, src)) ?? [];
      expect(records.map((record) => record.locator?.page)).toEqual([
        'Home',
        'ProConcepts-Framework',
        'ProSnippets-Framework',
        'ProGuide-Buttons',
        'proguide-style-guide',
        'ProSnippets-content',
      ]);
      for (const record of records) {
        const page = await githubRepoAdapter.read(ctx, src, { url: new URL(record.ref), record });
        expect(page.ref, record.ref).toBe(record.ref);
      }
    });

    it('finds a page in the directory of its sidebar subgroup', async () => {
      const { ctx, src } = setup({ include }, nested);
      await githubRepoAdapter.read(ctx, src, {
        url: new URL(`${WIKI}/ProGuide-Buttons`),
        record: makeRecord({ kind: 'guide', breadcrumb: 'Framework > Customization' }),
      });
      expect(requested(ctx)).toEqual([
        'ProGuide-Buttons',
        'Features/Framework/ProGuide-Buttons',
        'Features/Framework/Customization/ProGuide-Buttons',
      ]);
    });

    it('finds a snippets page in the directory of its kind, also when read by URL', async () => {
      const { ctx, src } = setup({ include }, nested);
      const page = await githubRepoAdapter.read(ctx, src, {
        url: new URL(`${WIKI}/ProSnippets-Framework`),
      });
      expect(page.title).toBe('Framework snippets');
      expect(requested(ctx)).toEqual([
        'ProSnippets-Framework',
        '_Sidebar',
        'Features/Framework/ProSnippets-Framework',
        'Features/Framework/ProSnippet/ProSnippets-Framework',
      ]);

      // The path is remembered: the next read asks for it first.
      await githubRepoAdapter.read(ctx, src, { url: new URL(`${WIKI}/ProSnippets-Framework`) });
      expect(requested(ctx).at(-1)).toBe('Features/Framework/ProSnippet/ProSnippets-Framework');
      expect(requested(ctx)).toHaveLength(5);
    });

    it('goes straight to a nested directory the registry lists', async () => {
      const { ctx, src } = setup({ include: [...include, 'Features/*/ProSnippet'] }, nested);
      await githubRepoAdapter.read(ctx, src, {
        url: new URL(`${WIKI}/ProSnippets-Framework`),
        record: makeRecord({ kind: 'guide', breadcrumb: 'Framework' }),
      });
      expect(requested(ctx)).toEqual([
        'ProSnippets-Framework',
        'Features/Framework/ProSnippet/ProSnippets-Framework',
      ]);
    });

    it('finds a page whose link is written in another letter case than its file', async () => {
      const { ctx, src } = setup({ include }, nested);
      const styled = await githubRepoAdapter.read(ctx, src, {
        url: new URL(`${WIKI}/proguide-style-guide`),
      });
      expect(styled.title).toBe('Style guide');
      // The public ref stays the address the wiki links the page by.
      expect(styled.ref).toBe(`${WIKI}/proguide-style-guide`);

      const snippets = await githubRepoAdapter.read(ctx, src, {
        url: new URL(`${WIKI}/ProSnippets-content`),
        record: makeRecord({
          kind: 'guide',
          title: 'ProSnippets: Content',
          breadcrumb: 'Content',
        }),
      });
      expect(snippets.title).toBe('Content snippets');
      expect(requested(ctx).at(-1)).toBe('Features/Content/ProSnippet/ProSnippets-Content');
    });

    it('stops after eight paths', async () => {
      const { ctx, src } = setup({ include }, nested);
      await expect(
        githubRepoAdapter.read(ctx, src, {
          url: new URL(`${WIKI}/ProSnippets-missing`),
          record: makeRecord({
            kind: 'guide',
            title: 'ProSnippets: Missing',
            breadcrumb: 'Framework > Customization',
          }),
        }),
      ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
      // The page by name and eight of the ten places it could be in.
      expect(requested(ctx)).toHaveLength(9);
    });
  });

  // Regression: a page opened by its URL comes without its catalogue record, so its sidebar
  // group was unknown and the first three directories of the registry were tried in vain.
  it('asks the sidebar for the group of a page that is read without its record', async () => {
    const { ctx, src } = setup({
      include: ['Reference', 'Features/Framework', 'Features/Geodatabase', 'Features/Editing'],
    });
    const page = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`${WIKI}/ProConcepts-Editing`),
    });
    expect(page.ref).toBe(`${WIKI}/ProConcepts-Editing`);
    expect(
      ctx.github.calls.filter((call) => call.method === 'wikiRaw').map((call) => call.path),
    ).toEqual(['ProConcepts-Editing', '_Sidebar', 'Features/Editing/ProConcepts-Editing']);
  });

  // Regression: a page without a level-1 heading was titled after its first sub-heading.
  it('titles a page without a title of its own as its record or its name says', async () => {
    const body = ['Intro text.', '', '## In this topic', '', '* [A](#a)', '', '## A', '', 'Text.'];
    const { ctx, src } = setup({}, { ...pages, 'Plain-Page': body.join('\n') });
    const byName = await githubRepoAdapter.read(ctx, src, { url: new URL(`${WIKI}/Plain-Page`) });
    expect(byName.title).toBe('Plain Page');
    const byRecord = await githubRepoAdapter.read(ctx, src, {
      url: new URL(`${WIKI}/Plain-Page`),
      record: makeRecord({ kind: 'guide', title: 'ProGuide: Plain page' }),
    });
    expect(byRecord.title).toBe('ProGuide: Plain page');
  });

  it('stops looking when GitHub fails for another reason', async () => {
    const { ctx, src } = setup({ include: ['A', 'B'] });
    ctx.github.outage();
    await expect(
      githubRepoAdapter.read(ctx, src, { url: new URL(`${WIKI}/Nowhere`) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(ctx.github.count('wikiRaw')).toBe(1);
  });
});
