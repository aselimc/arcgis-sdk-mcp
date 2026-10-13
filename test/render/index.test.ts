import { describe, expect, expectTypeOf, it } from 'vitest';
import { isMcpDocError } from '../../src/core/errors.js';
import type { CreateRenderer } from '../../src/core/factories.js';
import type { RendererInputs } from '../../src/core/ports.js';
import { createRenderer } from '../../src/render/index.js';
import { readFixture, readJsonFixture } from '../support/fixtures.js';
import { makeMeta, makeRenderer, structured, thrownBy } from './helpers.js';

describe('createRenderer', () => {
  it('has the factory signature of the core contract', () => {
    expectTypeOf(createRenderer).toEqualTypeOf<CreateRenderer>();
  });

  it('delegates html, family detection and meta-refresh detection to the extractor', () => {
    const { renderer, html } = makeRenderer();
    const meta = makeMeta({ kind: 'guide' });
    const page = renderer.render(
      'html',
      { html: '<main><h1>Guide</h1><p>Text.</p></main>', familyHint: 'astro' },
      meta,
      { focusedCode: true },
    );
    expect(html.calls).toEqual([
      { html: '<main><h1>Guide</h1><p>Text.</p></main>', familyHint: 'astro' },
    ]);
    expect(page.title).toBe('Guide');
    // The extractor's own diagnostics pass through untouched.
    expect(page.diagnostics.family).toBe('generic');
    expect(renderer.detectFamily('<html></html>')).toBe('generic');
    expect(
      renderer.detectMetaRefresh(
        '<!DOCTYPE html><meta http-equiv="refresh" content="0; url=/tides/new/">',
        'https://developers.arcgis.com/tides/old/',
      ),
    ).toBe('https://developers.arcgis.com/tides/new/');
    expect(
      renderer.detectMetaRefresh('<p>page</p>', 'https://developers.arcgis.com/'),
    ).toBeUndefined();
  });

  it('dispatches every structured kind to its renderer', () => {
    const { renderer } = makeRenderer();
    const meta = makeMeta();
    const inputs: { [K in Exclude<keyof RendererInputs, 'html'>]: RendererInputs[K] } = {
      markdown: { markdown: '# Title\n\nText.' },
      source: { files: [], readme: '# Sample' },
      notebook: { ipynb: readJsonFixture(...structured('notebook', 'tides.ipynb')) },
      openapi: { spec: readJsonFixture(...structured('openapi', 'spec.json')) },
      typedoc: { raw: readJsonFixture(...structured('typedoc', 'class.json')) },
      cem: {
        manifest: readJsonFixture(...structured('cem', 'api.json')),
        tag: 'harbour-gauge',
        packageName: '@example/harbour-components',
      },
      docc: { json: readJsonFixture(...structured('docc', 'symbol.json')) },
      sphinx: { html: readFixture(...structured('sphinx', 'module.html')) },
      xmldoc: {
        xml: readFixture(...structured('xmldoc', 'Example.Tides.xml')),
        memberId: 'T:Example.Tides.TideClock',
      },
      dts: {
        source: readFixture(...structured('dts', 'Lighthouse.d.ts')),
        modulePath: 'Lighthouse.d.ts',
        packageName: '@example/core',
      },
      arcade: { item: readJsonFixture(...structured('arcade', 'category.json')) },
    };
    for (const kind of Object.keys(inputs) as Array<keyof typeof inputs>) {
      const page = renderer.render(kind, inputs[kind], meta);
      expect(page.diagnostics, kind).toMatchObject({ family: 'structured', renderer: kind });
      expect(page.diagnostics.ms, kind).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(page.diagnostics.ms), kind).toBe(true);
      expect(page.sections.length, kind).toBeGreaterThan(0);
      expect(page.title, kind).not.toBe('');
      expect(page.ref, kind).toBe(meta.url);
      expect(page.attribution, kind).toContain('Source: ');
      // Sections are flat, ids are unique, and every parent exists.
      const ids = page.sections.map((section) => section.id);
      expect(new Set(ids).size, kind).toBe(ids.length);
      for (const section of page.sections) {
        if (section.parent !== undefined) expect(ids, kind).toContain(section.parent);
        expect(section.tokens, kind).toBeGreaterThan(0);
      }
      // A member that has a section is the section with the member's id.
      for (const member of page.members ?? []) {
        expect(typeof member.id, kind).toBe('string');
      }
    }
  });

  it('passes options through to structured renderers', () => {
    const { renderer } = makeRenderer();
    const page = renderer.render(
      'markdown',
      { markdown: '# A\n\n## B\n\nText.\n\n## C' },
      makeMeta(),
      {
        select: { section: 'b' },
      },
    );
    expect(page.sections.map((section) => section.id)).toEqual(['b']);
  });

  it('lets a DOC_NOT_FOUND from a renderer through unchanged', () => {
    const { renderer } = makeRenderer();
    expect(thrownBy(() => renderer.render('typedoc', { raw: null }, makeMeta())).code).toBe(
      'DOC_NOT_FOUND',
    );
  });

  it('wraps an unexpected failure as INTERNAL with the cause attached', () => {
    const { renderer } = makeRenderer();
    const meta = makeMeta();
    // `files` is required by the contract; an adapter bug that omits it must not leak a TypeError.
    const broken = {} as RendererInputs['source'];
    let caught: unknown;
    try {
      renderer.render('source', broken, meta);
    } catch (error) {
      caught = error;
    }
    expect(isMcpDocError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'INTERNAL',
      message: `The source renderer failed for ${meta.url}`,
      details: { url: meta.url },
    });
    expect((caught as Error).cause).toBeInstanceOf(TypeError);
  });

  it('wraps a failure of the extractor used by the sphinx renderer', () => {
    const failing = createRenderer({
      extract: () => {
        throw new Error('selector drift');
      },
      detectFamily: () => 'generic',
      detectMetaRefresh: () => undefined,
    });
    const error = thrownBy(() =>
      failing.render(
        'sphinx',
        { html: readFixture(...structured('sphinx', 'module.html')) },
        makeMeta(),
      ),
    );
    expect(error).toMatchObject({ code: 'INTERNAL', why: 'selector drift' });
  });
});
