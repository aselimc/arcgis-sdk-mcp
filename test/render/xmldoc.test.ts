import { describe, expect, it } from 'vitest';
import { parseMemberId } from '../../src/render/xmldoc-id.js';
import { renderXmldoc } from '../../src/render/xmldoc.js';
import { readFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

const xml = readFixture(...structured('xmldoc', 'Example.Tides.xml'));
const meta = makeMeta({
  url: 'https://github.com/example/tides/blob/main/docs/Example.Tides.xml',
  license: 'apache-2.0',
});
const SAMPLE =
  'M:Example.Tides.TideClock.Sample``1(System.Collections.Generic.IEnumerable{``0},System.Nullable{System.Int32},System.Double[]@)';

describe('parseMemberId', () => {
  it('reads types, with generic arity', () => {
    expect(parseMemberId('T:Example.Tides.Series`2')).toMatchObject({
      prefix: 'T',
      owner: 'Example.Tides',
      name: 'Series<T0, T1>',
      signature: 'Example.Tides.Series<T0, T1>',
      constructor: false,
    });
  });

  it('spells parameter types the C# way', () => {
    const id = parseMemberId(SAMPLE);
    expect(id?.parameters).toEqual(['IEnumerable<M0>', 'int?', 'ref double[]']);
    expect(id).toMatchObject({
      owner: 'Example.Tides.TideClock',
      name: 'Sample<M0>',
      signature: 'TideClock.Sample<M0>(IEnumerable<M0>, int?, ref double[])',
    });
  });

  it('names constructors after their type and prints indexers', () => {
    expect(parseMemberId('M:Example.Tides.TideClock.#ctor(System.String)')).toMatchObject({
      constructor: true,
      name: 'TideClock',
      signature: 'TideClock(string)',
    });
    expect(parseMemberId('P:Example.Tides.TideClock.Item(System.Int32)')?.signature).toBe(
      'TideClock.this[int]',
    );
  });

  it('handles nested generics, arrays, type parameters, conversions and explicit implementations', () => {
    expect(
      parseMemberId(
        'M:N.T`1.M(System.Collections.Generic.Dictionary{System.String,System.Collections.Generic.List{`0}},System.Int32[0:,0:],System.Byte*)',
      )?.parameters,
    ).toEqual(['Dictionary<string, List<T0>>', 'int[,]', 'byte*']);
    expect(parseMemberId('M:N.T.op_Implicit(N.T)~System.Double')?.signature).toBe(
      'T.op_Implicit(T): double',
    );
    expect(parseMemberId('M:N.T.System#IDisposable#Dispose')?.name).toBe(
      'System.IDisposable.Dispose',
    );
    expect(parseMemberId('F:N.T.Field')).toMatchObject({ prefix: 'F', signature: 'T.Field' });
  });

  it('rejects text that is not an id', () => {
    expect(parseMemberId('Example.Tides.TideClock')).toBeUndefined();
    expect(parseMemberId('X:Example')).toBeUndefined();
  });
});

describe('renderXmldoc: synthetic file', () => {
  const page = renderXmldoc({ xml, memberId: 'T:Example.Tides.TideClock' }, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('xmldoc', 'type.expected.md'));
  });

  it('renders a type with its direct members only', () => {
    expect(page.title).toBe('TideClock');
    expect(page.header).toBe('_Type_ · namespace `Example.Tides` · assembly `Example.Tides`');
    expect(page.members?.map((member) => `${member.kind} ${member.name}`)).toEqual([
      'constructor TideClock',
      'property NextHighTide',
      'property Item',
      'method Sample<T>',
      'event Turned',
      'field DefaultUnits',
    ]);
    // The nested type and its property belong to the nested type's own page.
    expect(pageText(page)).not.toContain('Water height.');
  });

  it('drops members marked exclude', () => {
    expect(pageText(page)).not.toContain('Reset');
    expect(
      thrownBy(() => renderXmldoc({ xml, memberId: 'M:Example.Tides.TideClock.Reset' }, meta)).code,
    ).toBe('DOC_NOT_FOUND');
  });

  it('uses the documentation ids as section ids', () => {
    expect(sectionIds(page)).toContain(SAMPLE);
    expect(sectionIds(page).slice(0, 3)).toEqual([
      'tideclock',
      'constructors',
      'M:Example.Tides.TideClock.#ctor(System.String)',
    ]);
  });

  it('converts doc tags to Markdown', () => {
    const lead = page.sections[0]?.markdown ?? '';
    expect(lead).toContain('Create it with `TideClock(string)`.');
    expect(lead).toContain('Readings come from a `Gauge`.');
    expect(lead).toContain('- `m` for metres\n- **ft**: for feet');
    // Blank lines inside a code block survive paragraph re-flowing.
    expect(lead).toContain(
      '```csharp\nvar clock = new TideClock("brest");\n\nConsole.WriteLine(clock.NextHighTide);\n```',
    );
    expect(lead).toContain('- [Tide primer](https://example.com/tides)');
  });

  it('adds parameter names to the types of the id', () => {
    const sample = page.sections.find((section) => section.id === SAMPLE)?.markdown ?? '';
    expect(sample).toContain(
      'TideClock.Sample<T>(IEnumerable<T> moments, int? precision, ref double[] heights)',
    );
    expect(sample).toContain(
      'Uses `precision` digits and returns `null` for moments outside the record.',
    );
    expect(sample).toContain('**Type parameters**\n\n- `T`: The moment type.');
    expect(sample).toContain('- `precision` (`int?`): Digits after the decimal point.');
    expect(sample).toContain('**Returns:** **true** when every moment was found.');
  });

  it('renders one member under the title of its type', () => {
    const member = renderXmldoc(
      { xml, memberId: 'M:Example.Tides.TideClock.#ctor(System.String)' },
      meta,
    );
    expect(member.title).toBe('TideClock');
    expect(sectionIds(member)).toEqual(['M:Example.Tides.TideClock.#ctor(System.String)']);
    expect(member.sections[0]?.markdown).toBe(
      [
        '### TideClock',
        '```csharp\nTideClock(string harbour)\n```',
        'Creates a clock for a harbour.',
        '**Parameters**',
        '- `harbour` (`string`): Identifier of the harbour.',
        '**Throws**',
        '- `ArgumentException`: The harbour is unknown.',
      ].join('\n\n'),
    );
    expect(member.members).toHaveLength(6);
  });

  it('renders a value element and an indexer', () => {
    const property = renderXmldoc(
      { xml, memberId: 'P:Example.Tides.TideClock.NextHighTide' },
      meta,
    );
    expect(property.sections[0]?.markdown).toContain(
      'Time of the next high tide.\n\n**Value:** A UTC time.',
    );
    const indexer = renderXmldoc(
      { xml, memberId: 'P:Example.Tides.TideClock.Item(System.Int32)' },
      meta,
      {
        detail: 'signature',
      },
    );
    expect(indexer.sections[0]?.markdown).toBe(
      '### Item\n\n```csharp\nTideClock.this[int]\n```\n\nThe reading at an index.',
    );
  });

  it('throws DOC_NOT_FOUND for an unknown member', () => {
    expect(thrownBy(() => renderXmldoc({ xml, memberId: 'T:Example.Tides.Nope' }, meta))).toEqual({
      code: 'DOC_NOT_FOUND',
      why: 'the documentation file has no member T:Example.Tides.Nope',
      url: meta.url,
    });
  });

  it('renders lists of type number and table', () => {
    const doc = `<doc><members>
      <member name="T:N.T"><summary>Steps:<list type="number"><item><description>One</description></item><item><description>Two</description></item></list>
      <list type="table"><listheader><term>Unit</term><description>Meaning</description></listheader><item><term>m</term><description>Metres</description></item></list>
      <note>Mind the <i>tide</i>.</note> See <a href="https://example.com">here</a><br/>and <see cref="P:N.T.Level">the level</see>.</summary></member>
    </members></doc>`;
    const text = pageText(renderXmldoc({ xml: doc, memberId: 'T:N.T' }, meta));
    expect(text).toContain('1. One\n2. Two');
    expect(text).toContain('| Unit | Meaning |\n| --- | --- |\n| m | Metres |');
    expect(text).toContain('> **Note:** Mind the _tide_.');
    expect(text).toContain('See [here](https://example.com)\n\nand `the level`.');
  });
});

// Regression: the catalogue keeps one record per method name, so a lookup of `Type.Method`
// read whichever overload was listed last and said nothing of the others.
describe('renderXmldoc: overloads', () => {
  const doc = `<doc><assembly><name>Example.Queue</name></assembly><members>
    <member name="T:Example.Queue.Dock"><summary>Schedules work on the dock.</summary></member>
    <member name="M:Example.Queue.Dock.Run(System.Action)"><summary>Runs a job.</summary><param name="job">The job.</param></member>
    <member name="M:Example.Queue.Dock.Run(System.Action,System.Int32)"><summary>Runs a job after a delay.</summary><param name="job">The job.</param><param name="delay">Seconds to wait.</param></member>
    <member name="M:Example.Queue.Dock.Run\`\`1(System.Func{\`\`0})"><typeparam name="TResult">What the job returns.</typeparam><summary>Runs a job that returns a value.</summary><param name="job">The job.</param></member>
    <member name="M:Example.Queue.Dock.RunLater(System.Action)"><summary>Runs a job at night.</summary></member>
    <member name="P:Example.Queue.Dock.Run"><summary>Not an overload: a property.</summary></member>
  </members></doc>`;
  const GENERIC = 'M:Example.Queue.Dock.Run``1(System.Func{``0})';

  it('shows every overload of the selected method, the selected one first', () => {
    const page = renderXmldoc({ xml: doc, memberId: GENERIC }, meta);
    expect(sectionIds(page)).toEqual([
      GENERIC,
      'M:Example.Queue.Dock.Run(System.Action)',
      'M:Example.Queue.Dock.Run(System.Action,System.Int32)',
    ]);
    expect(pageText(page)).toContain('Dock.Run(Action job, int delay)');
    expect(pageText(page)).not.toContain('Runs a job at night.');
    expect(pageText(page)).not.toContain('Not an overload');
  });

  it('names the type parameters of a generic method as its comment does', () => {
    const page = renderXmldoc({ xml: doc, memberId: GENERIC }, meta, { detail: 'signature' });
    expect(page.sections[0]?.markdown).toBe(
      '### `Run<TResult>`\n\n```csharp\nDock.Run<TResult>(Func<TResult> job)\n```\n\nRuns a job that returns a value.',
    );
    expect(page.members?.find((member) => member.id === GENERIC)?.name).toBe('Run<TResult>');
  });

  // Regression: the Pro SDK comments name no type parameters, and its generic methods were
  // printed with the placeholders of the documentation id (`Run<M0>(Func<M0>)`).
  it('names unnamed type parameters T, or T1 and T2 when there are several', () => {
    const unnamed = `<doc><assembly><name>Example.Queue</name></assembly><members>
      <member name="M:Example.Queue.Dock.Run\`\`1(System.Func{\`\`0})"><summary>Runs a job.</summary></member>
      <member name="M:Example.Queue.Dock.Pair\`\`2(\`\`0,\`\`1)"><summary>Pairs two.</summary></member>
    </members></doc>`;
    const one = renderXmldoc(
      { xml: unnamed, memberId: 'M:Example.Queue.Dock.Run``1(System.Func{``0})' },
      meta,
      { detail: 'signature' },
    );
    expect(one.sections[0]?.markdown).toContain(
      '### `Run<T>`\n\n```csharp\nDock.Run<T>(Func<T>)\n```',
    );
    const two = renderXmldoc(
      { xml: unnamed, memberId: 'M:Example.Queue.Dock.Pair``2(``0,``1)' },
      meta,
      { detail: 'signature' },
    );
    expect(two.sections[0]?.markdown).toContain('Dock.Pair<T1, T2>(T1, T2)');
  });

  it('shows a member that is not a method alone', () => {
    const page = renderXmldoc({ xml: doc, memberId: 'P:Example.Queue.Dock.Run' }, meta);
    expect(sectionIds(page)).toEqual(['P:Example.Queue.Dock.Run']);
  });
});

describe('renderXmldoc: Pro SDK excerpt (Apache-2.0)', () => {
  const real = readFixture('oss', 'arcgis-pro-sdk', 'ArcGIS.Desktop.GeoProcessing.excerpt.xml');
  const realMeta = makeMeta({
    url: 'https://github.com/Esri/arcgis-pro-sdk/blob/master/References/ArcGIS%20Pro%20API/ArcGIS.Desktop.GeoProcessing.XML',
    license: 'apache-2.0',
  });

  it('renders a type of the real file', () => {
    const page = renderXmldoc(
      { xml: real, memberId: 'T:ArcGIS.Desktop.GeoProcessing.GeoprocessingProjectItem' },
      realMeta,
    );
    expectGolden(page, 'oss', 'arcgis-pro-sdk', 'GeoprocessingProjectItem.expected.md');
    expect(page.header).toContain('assembly `ArcGIS.Desktop.GeoProcessing`');
    // 16 of the type's 23 members are marked <exclude/> in the source.
    expect(page.members).toHaveLength(10);
    expect(page.diagnostics.leftoverHtmlTags).toBe(0);
  });

  it('renders an enumeration with its fields', () => {
    const page = renderXmldoc(
      { xml: real, memberId: 'T:ArcGIS.Desktop.GeoProcessing.FontAlignemt' },
      realMeta,
    );
    expect(page.members?.map((member) => member.name)).toEqual(['Left', 'Center', 'Right']);
  });

  it('treats a wholly excluded type as absent', () => {
    expect(
      thrownBy(() =>
        renderXmldoc(
          { xml: real, memberId: 'T:ArcGIS.Desktop.GeoProcessing.TaskPropertyItem' },
          realMeta,
        ),
      ).code,
    ).toBe('DOC_NOT_FOUND');
  });
});
