import { describe, expect, it } from 'vitest';
import { withPythonMembers } from '../../../../src/adapters/site/python-members.js';
import { sectionSubtree } from '../../../../src/core/sections.js';
import { makeDocPage } from '../../../support/builders.js';

/** A class page as the doc.esri.com profile converts it. Invented API, real page shape. */
const CURRENT = [
  '# Gadget',
  '',
  '## Summary',
  '',
  'A gadget of a widget project.',
  '',
  '## Properties',
  '',
  '**`colorModel`** — _String_, required',
  '',
  'The colour model of the gadget, `CMYK` or `RGB`.',
  '',
  '**`frame`** — _[Frame](https://doc.esri.com/en/widgets-pro/latest/arcpy/mapping/frame-class.html)_, required',
  '',
  'The frame the gadget is drawn in.',
  '',
  '> **Note:**',
  '>',
  '> Read-only while the project is open elsewhere.',
  '',
  '## Methods',
  '',
  // The profile takes the ids of method headings from the page: `method-<name>`.
  '### `exportToPDF(out_pdf, {resolution})` {#method-exportToPDF}',
  '',
  'Exports the gadget to PDF.',
  '',
  '**out\\_pdf**',
  '',
  '- **Data type:** String',
  '',
  '### `listParts({wildcard})` {#method-listParts}',
  '',
  '| Data Type | Explanation |',
  '| --- | --- |',
  '| List | The parts. |',
  '',
  'Lists the parts of the gadget.',
  '',
  '## Code sample',
  '',
  '```python',
  'gadget.exportToPDF("out.pdf")',
  '```',
].join('\n');

/** The same class as the profile of the earlier layout converts it. */
const EARLIER = [
  '# Gadget',
  '',
  '## Properties',
  '',
  '**colorModel (Read and Write)**',
  '',
  '- **Explanation:**',
  '',
  '  The colour model of the gadget.',
  '- **Data Type:** String',
  '',
  '**frame (Read Only)**',
  '',
  '- **Explanation:**',
  '',
  '  The frame the gadget is drawn in.',
  '- **Data Type:** [Frame](https://pro.arcgis.com/en/pro-app/3.5/arcpy/mapping/frame-class.htm)',
  '',
  '## Method Overview',
  '',
  '| Method | Explanation |',
  '| --- | --- |',
  '| exportToPDF (out\\_pdf, {resolution}) | Exports the gadget to PDF. |',
  '',
  '## Methods',
  '',
  '```',
  'exportToPDF (out_pdf, {resolution})',
  '```',
  '',
  '| Parameter | Explanation | Data Type |',
  '| --- | --- | --- |',
  '| out\\_pdf | The file to write. | String |',
  '',
  'Exports the gadget to PDF.',
  '',
  '```python',
  'gadget.exportToPDF("out.pdf")',
  'print("done")',
  '```',
  '',
  '```',
  'listParts ({wildcard})',
  '```',
  '',
  'Lists the parts of the gadget.',
  '',
  '## Code sample',
  '',
  '```python',
  'listParts ("*")',
  '```',
].join('\n');

describe('withPythonMembers', () => {
  it('lists the properties and methods of a doc.esri.com class page as its members', () => {
    const page = withPythonMembers(makeDocPage({ markdown: CURRENT }));

    expect(page.members).toEqual([
      {
        id: 'property-colorModel',
        name: 'colorModel',
        kind: 'property',
        signature: 'colorModel: String',
        summary: 'The colour model of the gadget, CMYK or RGB.',
      },
      {
        id: 'property-frame',
        name: 'frame',
        kind: 'property',
        signature: 'frame: Frame',
        summary: 'The frame the gadget is drawn in.',
      },
      {
        id: 'method-exportToPDF',
        name: 'exportToPDF',
        kind: 'method',
        signature: 'exportToPDF(out_pdf, {resolution})',
        summary: 'Exports the gadget to PDF.',
      },
      {
        id: 'method-listParts',
        name: 'listParts',
        kind: 'method',
        signature: 'listParts({wildcard})',
        // A table is not a summary; the sentence below it is.
        summary: 'Lists the parts of the gadget.',
      },
    ]);
  });

  it('gives every property a section of its own, under the section that listed it', () => {
    const page = withPythonMembers(makeDocPage({ markdown: CURRENT }));
    const outline = page.sections.map((section) => [section.id, section.level, section.parent]);

    expect(outline.slice(0, 5)).toEqual([
      ['gadget', 1, undefined],
      ['summary', 2, 'gadget'],
      ['properties', 2, 'gadget'],
      ['property-colorModel', 3, 'properties'],
      ['property-frame', 3, 'properties'],
    ]);
    expect(page.sections.find((section) => section.id === 'properties')?.markdown).toBe(
      '## Properties',
    );
    expect(page.sections.find((section) => section.id === 'property-frame')?.markdown).toBe(
      [
        '### `frame`',
        '_[Frame](https://doc.esri.com/en/widgets-pro/latest/arcpy/mapping/frame-class.html)_, required',
        'The frame the gadget is drawn in.\n\n> **Note:**\n>\n> Read-only while the project is open elsewhere.',
      ].join('\n\n'),
    );
    // Nothing of the page is lost: only the property rows became headings.
    expect(page.sections.map((section) => section.title)).toContain('Code sample');
  });

  it('reads the earlier layout: access in the row, methods as one-line code blocks', () => {
    const page = withPythonMembers(makeDocPage({ markdown: EARLIER }));

    expect(page.members).toEqual([
      {
        id: 'property-colorModel',
        name: 'colorModel',
        kind: 'property',
        signature: 'colorModel: String',
        summary: 'The colour model of the gadget.',
      },
      {
        id: 'property-frame',
        name: 'frame',
        kind: 'property',
        signature: 'frame: Frame',
        summary: 'The frame the gadget is drawn in.',
        readonly: true,
      },
      {
        id: 'method-exportToPDF',
        name: 'exportToPDF',
        kind: 'method',
        signature: 'exportToPDF(out_pdf, {resolution})',
        summary: 'Exports the gadget to PDF.',
      },
      {
        id: 'method-listParts',
        name: 'listParts',
        kind: 'method',
        signature: 'listParts({wildcard})',
        summary: 'Lists the parts of the gadget.',
      },
    ]);
    const exported = page.sections.find((section) => section.id === 'method-exportToPDF');
    expect(exported).toMatchObject({ level: 3, parent: 'methods' });
    expect(exported?.markdown.split('\n')[0]).toBe('### `exportToPDF(out_pdf, {resolution})`');
    // The sample of a method stays with it; only a one-line call opens the next method.
    expect(exported?.markdown).toContain('print("done")');
    expect(page.sections.find((section) => section.id === 'property-frame')?.markdown).toContain(
      '_Read Only_',
    );
    // A call in the samples section is not a method of the class.
    expect(page.sections.find((section) => section.id === 'code-sample')?.markdown).toContain(
      'listParts ("*")',
    );
  });

  it('tells overloads apart by a counter', () => {
    const twice = [
      '# G',
      '',
      '## Methods',
      '',
      '```',
      'go (a)',
      '```',
      '',
      'One.',
      '',
      '```',
      'go (a, b)',
      '```',
      '',
      'Two.',
    ];
    const page = withPythonMembers(makeDocPage({ markdown: twice.join('\n') }));
    expect(page.members?.map((member) => [member.id, member.signature])).toEqual([
      ['method-go', 'go(a)'],
      ['method-go-1', 'go(a, b)'],
    ]);
  });

  it('leaves a page alone that has members already, is a slice, or is no class page', () => {
    const known = makeDocPage({
      markdown: CURRENT,
      members: [{ id: 'x', name: 'x', kind: 'method' }],
    });
    expect(withPythonMembers(known)).toBe(known);

    const whole = makeDocPage({ markdown: CURRENT });
    const slice = { ...whole, sections: sectionSubtree(whole.sections, 'properties') };
    expect(withPythonMembers(slice)).toBe(slice);

    const topic = makeDocPage({
      markdown: '# Topic\n\n## Properties\n\n**Note:** text.\n\n## Methods\n\nProse only.',
    });
    expect(withPythonMembers(topic)).toBe(topic);
  });
});

describe('withPythonMembers with a selector', () => {
  const REF = 'https://doc.esri.com/en/widgets-pro/latest/arcpy/mapping/gadget-class.html';
  const earlier = (ref = REF) => makeDocPage({ markdown: EARLIER, url: REF, ref });

  // The finding: `section: "exportToPDF"` and `Class.exportToPDF` named nothing on the page.
  it('cuts the page to the member a selector names by its bare name', () => {
    for (const select of [
      { member: 'exportToPDF' },
      { section: 'exportToPDF' },
      { member: 'exporttopdf' },
      { member: 'exportToPDF()' },
      { member: 'method-exportToPDF' },
    ]) {
      const cut = withPythonMembers(earlier(), select);
      expect(
        cut.sections.map((section) => section.id),
        JSON.stringify(select),
      ).toEqual(['method-exportToPDF']);
      // The member list still describes the whole class.
      expect(cut.members).toHaveLength(4);
    }
    expect(withPythonMembers(earlier(), { member: 'frame' }).sections[0]?.id).toBe(
      'property-frame',
    );
  });

  // `...#exportToPDF` is not an anchor of the page; the `Source:` line must not cite it.
  it('points the ref of a selected member at an anchor the published page has', () => {
    const asked = `${REF}#exportToPDF`;
    const rendered = makeDocPage({
      markdown: CURRENT,
      url: REF,
      ref: asked,
      attribution: `Source: Esri, ${asked} (retrieved today).`,
    });
    const method = withPythonMembers(rendered, { member: 'exportToPDF' });
    expect(method.ref).toBe(`${REF}#method-exportToPDF`);
    expect(method.attribution).toBe(`Source: Esri, ${REF}#method-exportToPDF (retrieved today).`);
    expect(method.url).toBe(REF);

    // A property row and a method line are no anchors: their section is the nearest one.
    expect(withPythonMembers(earlier(asked), { member: 'exportToPDF' }).ref).toBe(`${REF}#methods`);
    expect(withPythonMembers(earlier(`${REF}#frame`), { member: 'frame' }).ref).toBe(
      `${REF}#properties`,
    );
  });

  it('returns the whole page for a name that is no member', () => {
    const whole = withPythonMembers(earlier(), { member: 'nothing' });
    expect(whole.sections.length).toBeGreaterThan(5);
    expect(whole.ref).toBe(REF);
    expect(whole.members).toHaveLength(4);
  });

  it('keeps a slice the renderer made', () => {
    const page = earlier();
    const slice = { ...page, sections: sectionSubtree(page.sections, 'properties') };
    expect(withPythonMembers(slice, { section: 'properties' })).toBe(slice);
  });
});
