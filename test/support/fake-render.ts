import { attribution } from '../../src/core/attribution.js';
import type { RenderMeta, RenderOptions, Renderer, RendererInputs } from '../../src/core/ports.js';
import { sectionsFromMarkdown } from '../../src/core/sections.js';
import type { DocPage, HtmlFamily } from '../../src/core/types.js';
import { FAKE_NOW_ISO } from './builders.js';

/** One `render` call seen by the fake. */
export interface RenderCall {
  kind: keyof RendererInputs;
  input: RendererInputs[keyof RendererInputs];
  meta: RenderMeta;
  opts?: RenderOptions;
}

type Handler = (call: RenderCall) => DocPage;

/**
 * A {@link Renderer} for adapter and service tests. It does not convert anything for real:
 *
 * - `markdown` input becomes sections through `sectionsFromMarkdown`;
 * - `html` input becomes one section holding the text between tags;
 * - every other kind becomes one section naming the kind, so a test can tell that the
 *   adapter chose the intended renderer.
 *
 * Page metadata (`url`, `product`, `kind`, `license`, cache state, redirects) is copied from
 * `meta` exactly as the real renderers do. Use `returns()` or `when()` for canned pages, and
 * `calls` to assert what the adapter passed in.
 */
export class FakeRenderer implements Renderer {
  readonly calls: RenderCall[] = [];
  /** What `detectFamily` answers. */
  family: HtmlFamily = 'generic';

  private readonly handlers = new Map<keyof RendererInputs, Handler>();
  private canned: DocPage | undefined;

  /** Makes every `render` call return this page. */
  returns(page: DocPage): this {
    this.canned = page;
    return this;
  }

  /** Overrides the conversion for one input kind. */
  when(kind: keyof RendererInputs, handler: Handler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  render<K extends keyof RendererInputs>(
    kind: K,
    input: RendererInputs[K],
    meta: RenderMeta,
    opts?: RenderOptions,
  ): DocPage {
    const call: RenderCall =
      opts === undefined ? { kind, input, meta } : { kind, input, meta, opts };
    this.calls.push(call);
    if (this.canned !== undefined) return this.canned;
    return this.handlers.get(kind)?.(call) ?? this.defaultPage(call);
  }

  detectFamily(): HtmlFamily {
    return this.family;
  }

  detectMetaRefresh(html: string, baseUrl: string): string | undefined {
    const target =
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i.exec(
        html,
      )?.[1];
    return target === undefined ? undefined : new URL(target, baseUrl).href;
  }

  private defaultPage({ kind, input, meta }: RenderCall): DocPage {
    let markdown: string;
    if (kind === 'markdown') markdown = (input as RendererInputs['markdown']).markdown;
    else if (kind === 'html') {
      markdown = (input as RendererInputs['html']).html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else markdown = `# Rendered by ${kind}`;

    const sections = sectionsFromMarkdown(markdown);
    const retrievedAt = meta.res?.fetchedAt ?? FAKE_NOW_ISO;
    const cache = meta.res?.cache ?? 'miss';
    return {
      ref: meta.url,
      url: meta.url,
      title: sections[0]?.title ?? '',
      ...(meta.product === undefined ? {} : { product: meta.product }),
      ...(meta.source === undefined ? {} : { source: meta.source }),
      ...(meta.line === undefined ? {} : { line: meta.line }),
      ...(meta.version === undefined ? {} : { version: meta.version }),
      kind: meta.kind,
      sections,
      license: meta.license,
      attribution: attribution(meta.license, { url: meta.url, retrievedAt, cache }),
      retrievedAt,
      cache,
      redirectedFrom: meta.res?.aliasChain ?? [],
      diagnostics: {
        family: kind === 'html' ? this.family : 'structured',
        renderer: kind,
        fences: 0,
        fencesWithLanguage: 0,
        tablesByStrategy: {},
        unknownIslands: [],
        leftoverHtmlTags: 0,
        redirectHops: meta.res?.aliasChain.length ?? 0,
        ms: 0,
      },
      notices: [],
    };
  }
}
