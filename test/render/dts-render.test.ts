import { describe, expect, it } from 'vitest';
import { renderDts } from '../../src/render/dts/render.js';
import { readFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured } from './helpers.js';

const coreMeta = makeMeta({
  url: 'https://developers.arcgis.com/tides-js/references/core/Lighthouse/',
  license: 'esri-ma',
  packageName: '@example/core',
  version: '4.33.2',
});
const lighthouse = {
  source: readFixture(...structured('dts', 'Lighthouse.d.ts')),
  modulePath: 'Lighthouse.d.ts',
  packageName: '@example/core',
};

describe('renderDts: the @arcgis/core class shape (synthetic)', () => {
  const page = renderDts(lighthouse, coreMeta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('dts', 'Lighthouse.expected.md'));
  });

  it('builds the import line from package and module path', () => {
    expect(page.title).toBe('Lighthouse');
    expect(page.header).toBe(
      '_Class_ · `@example/core/Lighthouse`\n\n```js\nimport Lighthouse from "@example/core/Lighthouse.js";\n```',
    );
    expect(page.version).toBe('4.33.2');
    expect(page.attribution).toContain('@example/core 4.33.2');
  });

  it('lists the bases from the Superclass constant and says inherited members are elsewhere', () => {
    const lead = page.sections[0]?.markdown ?? '';
    expect(lead).toContain(
      '**Extends:** `EventedAccessor`, `LampMixin`. Inherited members are not listed here: look up the base class.',
    );
    expect(lead).toContain('**Constructor options also come from:** `LampMixinProperties`');
    expect(lead).toContain('**Events also come from:** `LampMixinEvents`');
    expect(lead).not.toContain('__LighthouseSansType');
    expect(lead).not.toContain('LighthouseSuperclass');
  });

  it('merges both halves of the class and groups own members', () => {
    expect(page.members?.map((member) => `${member.kind}:${member.id}`)).toEqual([
      'constructor:constructor',
      'property:type',
      'property:beam',
      'property:height',
      'property:keepers',
      'property:name',
      'property:areas',
      'property:count',
      'method:addKeeper',
      'method:measureRange',
      'method:extinguish',
      'property:profileId',
      'event:event-lamp-change',
    ]);
    expect(
      sectionIds(page).filter((id) => !page.members?.some((member) => member.id === id)),
    ).toEqual([
      'lighthouse',
      'choosing-a-height',
      'constructors',
      'properties',
      'methods',
      'constructor-only-options',
      'events',
    ]);
  });

  it('hides private, internal and helper members', () => {
    const text = pageText(page);
    expect(text).not.toContain('_lamp');
    expect(text).not.toContain('_rebuild');
    expect(text).not.toContain('@eventTypes');
  });

  it('merges a get/set pair and states what the constructor accepts', () => {
    const beam = page.sections.find((section) => section.id === 'beam')?.markdown ?? '';
    expect(beam).toBe(
      [
        '### beam',
        '```ts\nget beam(): Beam | null | undefined;\nset beam(value: BeamProperties | null | undefined);\n```',
        '_constructor option · since 1.2_',
        'Constructor accepts: `BeamProperties | null`',
        'The beam the lighthouse shows.',
      ].join('\n\n'),
    );
    expect(page.members?.find((member) => member.name === 'beam')?.readonly).toBeUndefined();
  });

  it('marks getter-only properties readonly and Pick-ed members as constructor options', () => {
    const section = (id: string): string =>
      page.sections.find((item) => item.id === id)?.markdown ?? '';
    expect(section('keepers')).toContain('_readonly_');
    expect(page.members?.find((member) => member.name === 'keepers')?.readonly).toBe(true);
    expect(section('height')).toContain('_constructor option · default `20`_');
    expect(section('name')).toContain('_constructor option_');
    expect(section('areas')).toContain('_since 1.3_');
    expect(section('profileId')).toContain('It is read once and is\nnot available afterwards.');
  });

  it('keeps multi-line declarations verbatim and renders the JSDoc tags', () => {
    const range = page.sections.find((section) => section.id === 'measureRange')?.markdown ?? '';
    expect(range).toContain(
      '```ts\nmeasureRange(weather?: "clear" | "fog"): Promise<{\n    range: number;\n    height: number | null;\n}>;\n```',
    );
    expect(range).toContain(
      '**Parameters**\n\n- `weather`: Sky condition at the time of measurement.',
    );
    expect(range).toContain('**Returns:** Range and the height it was measured at.');
    expect(range).toContain('**Throws**\n\n- When the lamp is off.');
    expect(range).toContain('**See also**\n\n- [Range tables](https://example.com/range/)');
    const keeper = page.sections.find((section) => section.id === 'addKeeper')?.markdown ?? '';
    // An unfenced example is JavaScript; a fenced one keeps its own language.
    expect(keeper).toContain(
      '```js\ntower.addKeeper(keeper);\n```\n\n```ts\ntower.addKeeper(keeper, { silent: true });\n```',
    );
    expect(keeper).toContain('Adds a keeper to the list.');
    expect(page.sections.find((section) => section.id === 'extinguish')?.markdown).toContain(
      '> **Deprecated:** since 1.4. Use `Lighthouse.beam` instead.',
    );
  });

  it('keeps the headings of the class description as sections below the title', () => {
    const height = page.sections.find((section) => section.id === 'choosing-a-height');
    expect(height).toMatchObject({ level: 2, parent: 'lighthouse' });
    expect(height?.markdown).toContain('> [!WARNING]');
  });

  it('returns one member, by input or by selector', () => {
    const viaInput = renderDts({ ...lighthouse, member: 'addKeeper' }, coreMeta);
    const viaSelect = renderDts(lighthouse, coreMeta, { select: { member: 'addKeeper' } });
    expect(sectionIds(viaInput)).toEqual(['addKeeper']);
    expect(viaSelect.sections).toEqual(viaInput.sections);
    expect(viaInput.members).toHaveLength(13);
    expect(viaInput.header).toContain('import Lighthouse from');
  });

  it('finds an event by name and applies the detail level', () => {
    const event = renderDts({ ...lighthouse, member: 'lamp-change' }, coreMeta, {
      detail: 'signature',
    });
    expect(event.sections[0]?.markdown).toBe(
      '### lamp-change\n\n```ts\n"lamp-change": { lit: boolean };\n```\n\nFires when the lamp is switched on or off.',
    );
    const summary = renderDts(lighthouse, coreMeta, { detail: 'summary' });
    expect(summary.sections.find((section) => section.id === 'properties')?.markdown).toBe(
      [
        '## Properties',
        '',
        '- `type` _(readonly)_: The kind of structure, for checks that need no import.',
        '- `beam`: The beam the lighthouse shows.',
        '- `height`: Height of the tower above ground, in metres.',
        '- `keepers` _(readonly)_: Everyone who has kept this lighthouse.',
        '- `name`: Display name.',
        '- `areas` _(readonly)_: Names of the sea areas the light covers.',
        '- `count`: How many lighthouses exist.',
      ].join('\n'),
    );
    expect(summary.sections.find((section) => section.id === 'methods')?.markdown).toContain(
      '- `extinguish` _(deprecated)_: Switches the lamp off.',
    );
  });
});

describe('renderDts: raw-declaration fallback', () => {
  const broken = {
    source: readFixture(...structured('dts', 'Broken.d.ts')),
    modulePath: 'Buoy.d.ts',
    packageName: '@example/core',
  };

  it('shows a declaration it cannot parse as written, with a notice and a diagnostic', () => {
    const page = renderDts(broken, coreMeta);
    expectGolden(page, ...structured('dts', 'Broken.expected.md'));
    expect(page.notices).toEqual([
      'Part of this declaration file could not be parsed; the affected declarations are shown as written.',
    ]);
    expect(page.diagnostics.unknownIslands).toEqual(['dts:raw']);
    const mooring = page.sections.find((section) => section.id === 'mooring')?.markdown ?? '';
    expect(mooring).toBe(
      [
        '### mooring',
        '```ts\nmooring(options: { depth: number; ): Promise<void>;\n```',
        '_unparsed declaration_',
        'Where the buoy is moored. The declaration below lost its closing bracket.',
      ].join('\n\n'),
    );
    expect(page.sections.find((section) => section.id === 'mooring')?.parent).toBe(
      'unparsed-declarations',
    );
  });

  it('still parses the members after the broken one', () => {
    const page = renderDts({ ...broken, member: 'ring' }, coreMeta);
    expect(page.sections[0]?.markdown).toContain('```ts\nring(times: number): void;\n```');
    expect(page.sections[0]?.markdown).toContain('- `times`: How often to ring.');
    expect(page.members?.map((member) => member.name)).toEqual([
      'colour',
      'lit',
      'ring',
      'mooring',
    ]);
  });

  it('cuts a member out of the raw text when the scanner lost it', () => {
    // Without doc comments there is no recovery point: `drift` is swallowed by `mooring`.
    const source = [
      'export default class Buoy {',
      '  mooring(options: { depth: number; ): Promise<void>;',
      '  /**',
      '   * Lets the buoy drift.',
      '   * @since 2.1',
      '   */',
      '  drift(metres: number): void;',
      '  sink(): void;',
    ].join('\n');
    const lost = [
      'export default class Buoy {',
      '  mooring(options: { depth: number; ): Promise<void>;',
      '  drift(metres: number): void;',
      '  /** Sinks it. */',
      '  sink(): void;',
    ].join('\n');
    const recovered = renderDts({ ...broken, source, member: 'drift' }, coreMeta);
    expect(recovered.sections[0]?.markdown).toContain('```ts\ndrift(metres: number): void;\n```');
    expect(recovered.sections[0]?.markdown).toContain('_since 2.1_');

    const raw = renderDts({ ...broken, source: lost, member: 'drift' }, coreMeta);
    expect(sectionIds(raw)).toEqual(['drift']);
    expect(raw.sections[0]?.markdown).toBe(
      '### drift\n\n```ts\ndrift(metres: number): void;\n```\n\n_unparsed declaration_',
    );
    expect(raw.notices).toHaveLength(1);
    expect(raw.members?.at(-1)).toMatchObject({ id: 'drift', kind: 'member' });
  });

  it('returns the whole page when the member exists nowhere', () => {
    const page = renderDts({ ...broken, member: 'nope' }, coreMeta);
    expect(page.sections.length).toBeGreaterThan(1);
  });
});

// Regression: `identity/IdentityManager` (a module whose default export is an instance)
// rendered as an empty module page, and named exports were imported from the package root.
describe('renderDts: module pages of a package of entry-point modules (synthetic)', () => {
  const meta = makeMeta({ url: 'https://developers.arcgis.com/tides-js/references/core/x/' });

  it('lists a default-exported constant and imports it from the module', () => {
    const source = [
      'import type { KeeperBase } from "./KeeperBase.js";',
      '',
      '/**',
      ' * The keeper instance shared by the application.',
      ' */',
      'declare const keeper: KeeperBase;',
      'export default keeper;',
      '',
    ].join('\n');
    const page = renderDts(
      { source, modulePath: 'identity/Keeper.d.ts', packageName: '@example/core' },
      meta,
    );
    expect(page.header).toBe(
      '_Module_ · `@example/core/identity/Keeper`\n\n```js\nimport keeper from "@example/core/identity/Keeper.js";\n```',
    );
    expect(pageText(page)).toContain('const keeper: KeeperBase;');
    expect(pageText(page)).toContain('The keeper instance shared by the application.');
  });

  it('imports named exports from the module, not the package root', () => {
    const source = 'export declare function measure(value: number): number;\n';
    const page = renderDts(
      { source, modulePath: 'core/measureUtils.d.ts', packageName: '@example/core' },
      meta,
    );
    expect(page.header).toContain('import { measure } from "@example/core/core/measureUtils.js";');
  });
});

describe('renderDts: @esri/arcgis-rest-request typings (Apache-2.0)', () => {
  const dir = ['oss', 'arcgis-rest-request'];
  const packageName = '@esri/arcgis-rest-request';
  const meta = makeMeta({
    url: 'https://github.com/Esri/arcgis-rest-js/blob/6b32d2da8302c79837c94361548466f1bd4406f9/packages/arcgis-rest-request/src/request.ts',
    license: 'apache-2.0',
  });
  const input = (file: string): { source: string; modulePath: string; packageName: string } => ({
    source: readFixture(...dir, file),
    modulePath: `dist/esm/${file}`,
    packageName,
  });

  it('renders a module of functions and a class', () => {
    const page = renderDts(input('request.d.ts'), meta);
    expectGolden(page, ...dir, 'request.expected.md');
    expect(page.title).toBe('request');
    expect(page.header).toContain('_Module_ · `@esri/arcgis-rest-request/dist/esm/request`');
    expect(page.members?.map((member) => `${member.kind} ${member.name}`)).toEqual([
      'variable NODEJS_DEFAULT_REFERER_HEADER',
      'function setDefaultRequestOptions',
      'function getDefaultRequestOptions',
      'class ArcGISAuthError',
      'function checkForErrors',
      // internalRequest is marked @internal and left out.
      'function request',
    ]);
    expect(page.notices).toEqual([]);
    expect(page.diagnostics).toMatchObject({ unknownIslands: [], leftoverHtmlTags: 0 });
    expect(page.diagnostics.fences).toBe(page.diagnostics.fencesWithLanguage);
  });

  it('returns one function with parameters, return text and deprecation', () => {
    const request = renderDts({ ...input('request.d.ts'), member: 'request' }, meta);
    expect(sectionIds(request)).toEqual(['request']);
    const text = request.sections[0]?.markdown ?? '';
    expect(text).toContain(
      '```ts\nfunction request(url: string, requestOptions?: IRequestOptions): Promise<any>;\n```',
    );
    expect(text).toContain('- `url`: The URL of the ArcGIS REST API endpoint.');
    expect(text).toContain(
      '**Returns:** A Promise that will resolve with the data from the response.',
    );

    const deprecated = renderDts(
      { ...input('request.d.ts'), member: 'setDefaultRequestOptions' },
      meta,
      {
        detail: 'signature',
      },
    );
    expect(deprecated.sections[0]?.markdown).toBe(
      '### setDefaultRequestOptions\n\n```ts\nfunction setDefaultRequestOptions(options: IRequestOptions, hideWarnings?: boolean): void;\n```\n\nSets the default options that will be passed in **all requests across all `@esri/arcgis-rest-js` modules**.',
    );
    expect(
      request.members?.find((member) => member.name === 'setDefaultRequestOptions')?.deprecated,
    ).toBe(true);
  });

  it('indexes the members of an exported class on the module page', () => {
    const page = renderDts({ ...input('request.d.ts'), member: 'ArcGISAuthError' }, meta);
    const text = page.sections[0]?.markdown ?? '';
    expect(text).toContain('```ts\nclass ArcGISAuthError extends ArcGISRequestError { ... }\n```');
    expect(text).toContain(
      '**Members**\n\n- `constructor`: Create a new `ArcGISAuthError` object.\n- `retry`',
    );
  });

  it('opens an exported class through Export.member', () => {
    const page = renderDts({ ...input('request.d.ts'), member: 'ArcGISAuthError.retry' }, meta);
    expect(page.title).toBe('ArcGISAuthError');
    expect(page.header).toContain('import { ArcGISAuthError } from "@esri/arcgis-rest-request";');
    expect(sectionIds(page)).toEqual(['retry']);
    expect(page.sections[0]?.markdown).toContain(
      'retry(getSession: IRetryAuthError, retryLimit?: number): Promise<unknown>;',
    );
  });

  it('renders a class with static members, hiding private ones', () => {
    const page = renderDts(
      { ...input('ApplicationCredentialsManager.d.ts'), member: 'ApplicationCredentialsManager.x' },
      meta,
    );
    expectGolden(page, ...dir, 'ApplicationCredentialsManager.expected.md');
    expect(page.sections[0]?.markdown).toContain(
      '**Extends:** `AuthenticationManagerBase`. Inherited members are not listed here: look up the base class.',
    );
    expect(page.sections[0]?.markdown).toContain('**Implements:** `IAuthenticationManager`');
    const names = page.members?.map((member) => member.name) ?? [];
    expect(names).toContain('fromCredentials');
    expect(names).toContain('toJSON');
    expect(names).not.toContain('_pendingTokenRequest');
    expect(names).not.toContain('setToken');
  });

  it('renders an interface module and an enum module', () => {
    const options = renderDts(
      { ...input('IRequestOptions.d.ts'), member: 'IRequestOptions.rawResponse' },
      meta,
    );
    expect(options.header).toContain('_Interface_');
    expect(options.sections[0]?.markdown).toContain('> **Deprecated:** since v4.0.0.');
    expect(options.members?.every((member) => member.kind === 'property')).toBe(true);

    const errors = renderDts(input('ErrorTypes.d.ts'), meta);
    expect(errors.members).toHaveLength(1);
    expect(pageText(errors)).toContain(
      '**Members**\n\n- `ArcGISRequestError`\n- `ArcGISAuthError`\n- `ArcGISAccessDeniedError`\n- `ArcGISTokenRequestError`',
    );
  });
});
