import { describe, expect, it } from 'vitest';
import {
  expandDirectories,
  pathCandidates,
  rankDirectories,
  respell,
} from '../../../../src/adapters/reference/github/wiki-paths.js';

describe('rankDirectories', () => {
  const directories = [
    'Reference/',
    'Features/MapAuthoring/**',
    '/Features/Editing',
    'Features/Framework',
    '',
  ];

  it('prefers the directory whose words occur in the page name', () => {
    expect(rankDirectories(directories, 'ProConcepts-Map-Authoring')[0]).toBe(
      'Features/MapAuthoring',
    );
    expect(rankDirectories(directories, 'ProConcepts-Editing')[0]).toBe('Features/Editing');
  });

  it('uses the sidebar group when the page name says nothing', () => {
    expect(rankDirectories(directories, 'FAQ', 'Reference')[0]).toBe('Reference');
    expect(rankDirectories(directories, 'ProGuide-Ribbon', 'Framework > Customization')[0]).toBe(
      'Features/Framework',
    );
  });

  // Regression: the sidebar group "Layout" did not lead to the directory "Layouts", nor
  // "Networks" to "UtilityNetwork".
  it('takes a singular and its plural for the same word', () => {
    const more = [...directories, 'Features/Layouts', 'Features/UtilityNetwork'];
    expect(rankDirectories(more, 'ProConcepts-Reports', 'Layout')[0]).toBe('Features/Layouts');
    expect(rankDirectories(more, 'ProSnippets-Tracing', 'Networks')[0]).toBe(
      'Features/UtilityNetwork',
    );
    // A short word is not a stem: "Go" does not match "Gone".
    expect(rankDirectories(['A/Go', 'B/Gone'], 'Page', 'Gone')[0]).toBe('B/Gone');
  });

  it('keeps the registry order between equal candidates and drops empty entries', () => {
    expect(rankDirectories(directories, 'Unrelated')).toEqual([
      'Reference',
      'Features/MapAuthoring',
      'Features/Editing',
      'Features/Framework',
    ]);
  });

  // Regression: with nested directories in the registry, the `Pro` of `ProSnippet` matched
  // every `ProGuide` page and tied a snippets directory with the right one.
  it('prefers a nested directory that names the sidebar subgroup or the kind of page', () => {
    const nested = [
      'Features/Framework',
      'Features/Framework/ProSnippet',
      'Features/Framework/Customization',
      'Features/Editing',
      'Features/Editing/ProSnippet',
    ];
    expect(rankDirectories(nested, 'ProGuide-Buttons', 'Framework > Customization')[0]).toBe(
      'Features/Framework/Customization',
    );
    expect(rankDirectories(nested, 'ProSnippets-Framework', 'Framework')[0]).toBe(
      'Features/Framework/ProSnippet',
    );
    expect(rankDirectories(nested, 'ProConcepts-Framework', 'Framework')[0]).toBe(
      'Features/Framework',
    );
    expect(rankDirectories(nested, 'ProSnippets-Editing', 'Editing')[0]).toBe(
      'Features/Editing/ProSnippet',
    );
  });
});

describe('expandDirectories', () => {
  it('writes a wildcard segment out for every name the other entries have there', () => {
    expect(
      expandDirectories([
        'Features/Framework',
        'Features/Editing/',
        'Features/*/ProSnippet',
        'Reference',
      ]),
    ).toEqual([
      'Features/Framework',
      'Features/Editing',
      'Features/Framework/ProSnippet',
      'Features/Editing/ProSnippet',
      'Reference',
    ]);
  });

  it('drops a wildcard entry that nothing gives names to', () => {
    expect(expandDirectories(['Other/*/Deep', 'Reference'])).toEqual(['Reference']);
  });
});

describe('respell', () => {
  it('takes the letter case of the link text for the words they share', () => {
    expect(respell('proguide-style-guide', 'ProGuide: Style Guide')).toBe('ProGuide-Style-Guide');
    expect(respell('ProSnippets-content', 'ProSnippets: Content')).toBe('ProSnippets-Content');
    expect(respell('proconcepts-CoreHost', 'ProConcepts: CoreHost')).toBe('ProConcepts-CoreHost');
  });

  it('leaves a name alone that the text spells the same way or not at all', () => {
    expect(respell('ProGuide-Buttons', 'ProGuide: Buttons')).toBe('ProGuide-Buttons');
    expect(respell('ProConcepts-Annotation', 'Annotation basics')).toBe('ProConcepts-Annotation');
  });
});

describe('pathCandidates', () => {
  const directories = ['Features/Framework', 'Features/Editing', 'Features/Content', 'Reference'];

  it('looks in the best directory, below it by sidebar subgroup and kind, then in the runners-up', () => {
    expect(
      pathCandidates(directories, 'ProGuide-Buttons', {
        title: 'ProGuide: Buttons',
        trail: ['Framework', 'Customization'],
      }),
    ).toEqual([
      'Features/Framework/ProGuide-Buttons',
      'Features/Framework/Customization/ProGuide-Buttons',
      'Features/Framework/ProGuide/ProGuide-Buttons',
      'Features/Editing/ProGuide-Buttons',
      'Features/Content/ProGuide-Buttons',
    ]);
  });

  it('looks for a page of a plural kind in the singular directory first', () => {
    expect(
      pathCandidates(directories, 'ProSnippets-Editing', { trail: ['Editing'] }).slice(0, 3),
    ).toEqual([
      'Features/Editing/ProSnippets-Editing',
      'Features/Editing/ProSnippet/ProSnippets-Editing',
      'Features/Editing/ProSnippets/ProSnippets-Editing',
    ]);
  });

  it('tries the spelling of the link text next to the name as linked', () => {
    expect(
      pathCandidates(directories, 'ProSnippets-content', {
        title: 'ProSnippets: Content',
        trail: ['Content'],
      }).slice(0, 4),
    ).toEqual([
      'Features/Content/ProSnippets-content',
      'Features/Content/ProSnippets-Content',
      'Features/Content/ProSnippet/ProSnippets-content',
      'Features/Content/ProSnippet/ProSnippets-Content',
    ]);
  });

  it('does not nest a directory under one of the same name that the registry lists', () => {
    const listed = [...directories, 'Features/Editing/ProSnippet'];
    expect(
      pathCandidates(listed, 'ProSnippets-Editing', { trail: ['Editing'] }).slice(0, 2),
    ).toEqual([
      'Features/Editing/ProSnippet/ProSnippets-Editing',
      'Features/Editing/ProSnippets-Editing',
    ]);
  });

  it('has nothing to offer without directories, and no subdirectory for a one-word page', () => {
    expect(pathCandidates([], 'ProGuide-Buttons')).toEqual([]);
    expect(pathCandidates(directories, 'FAQ', { trail: ['Reference'] })).toEqual([
      'Reference/FAQ',
      'Features/Framework/FAQ',
      'Features/Editing/FAQ',
    ]);
  });
});
