import { describe, expect, it } from 'vitest';
import { legacyHelpAdapter } from '../../../../src/adapters/site/legacy-help.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeLine } from '../../../support/builders.js';
import { FakeRenderer } from '../../../support/fake-render.js';
import {
  API,
  API_SCRIPT,
  START,
  bound,
  ctxOf,
  help,
  product,
  withoutSiteIndex,
} from './legacy-setup.js';

describe('legacy-help: read and probe', () => {
  it('reads a topic as the kind of the source, with the family hint of its probe', async () => {
    const render = new FakeRenderer();
    const ctx = ctxOf(render);
    const page = await legacyHelpAdapter.read(ctx, bound(), {
      url: new URL(`${START}what-is-widget-earth.htm#ESRI_SECTION1_ABC`),
      select: { section: 'ESRI_SECTION1_ABC' },
    });
    expect(page).toMatchObject({
      kind: 'help',
      ref: `${START}what-is-widget-earth.htm#ESRI_SECTION1_ABC`,
      url: `${START}what-is-widget-earth.htm`,
      product: 'widget-earth',
      source: 'help',
      line: 'latest',
    });
    expect(render.calls[0]).toMatchObject({
      kind: 'html',
      input: { familyHint: 'legacy-help' },
      opts: { select: { section: 'ESRI_SECTION1_ABC' } },
    });
  });

  it('prefers the kind of the record that led to the read', async () => {
    const ctx = ctxOf();
    const [record] = await legacyHelpAdapter.enumerate!(ctx, bound());
    const page = await legacyHelpAdapter.read(ctx, bound(), {
      url: new URL(record!.ref),
      record: { ...record!, kind: 'api' },
    });
    expect(page.kind).toBe('api');
  });

  it('probes a sitemap canary by counting its entries', async () => {
    expect(await legacyHelpAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 4 });
  });

  it('probes a link-list canary by counting links, whatever page family the source declares', async () => {
    const listed = {
      ...help,
      probe: {
        url: `${API}flisting.htm`,
        expect: 'html' as const,
        family: 'legacy-help' as const,
        minRecords: 5,
        mustContain: '.htm',
      },
    };
    const ctx = ctxOf();
    expect(
      await legacyHelpAdapter.probe(ctx, bindSource(product, listed, makeLine())),
    ).toMatchObject({ ok: true, records: 9 });
    // The declared probe is left as it was.
    expect(listed.probe.family).toBe('legacy-help');
  });

  it('probes a script canary only while site-index is on', async () => {
    const scripted = {
      ...help,
      probe: { url: API_SCRIPT, expect: 'text' as const, minRecords: 5 },
    };
    const src = bindSource(product, scripted, makeLine());
    expect(await legacyHelpAdapter.probe(ctxOf(), src)).toMatchObject({ ok: true, records: 12 });

    const off = withoutSiteIndex(ctxOf());
    expect(await legacyHelpAdapter.probe(off, src)).toMatchObject({
      ok: false,
      error: 'Capability "site-index" is switched off',
    });
    expect(off.http.count()).toBe(0);
  });

  it('checks the page family of a topic canary', async () => {
    const topic = {
      ...help,
      probe: {
        url: `${START}install.htm`,
        expect: 'html' as const,
        family: 'legacy-help' as const,
        minChars: 100,
      },
    };
    const render = new FakeRenderer();
    const ctx = ctxOf(render);
    render.family = 'legacy-help';
    const src = bindSource(product, topic, makeLine());
    expect(await legacyHelpAdapter.probe(ctx, src)).toMatchObject({
      ok: true,
      family: 'legacy-help',
    });
    render.family = 'generic';
    expect((await legacyHelpAdapter.probe(ctx, src)).ok).toBe(false);
  });
});
