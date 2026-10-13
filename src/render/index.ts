/**
 * The renderer: one entry point that turns fetched content of any supported shape into a
 * `DocPage`. HTML goes to the injected extractor; every structured kind has its own module.
 */
import { McpDocError, isMcpDocError } from '../core/errors.js';
import type { CreateRenderer } from '../core/factories.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage } from '../core/types.js';
import { renderArcade } from './arcade.js';
import { renderCem } from './cem.js';
import { renderDocc } from './docc.js';
import { renderDts } from './dts/render.js';
import { renderMarkdown } from './markdown.js';
import { renderNotebook } from './notebook.js';
import { renderOpenapi } from './openapi.js';
import { renderSource } from './source.js';
import { createSphinxRenderer } from './sphinx.js';
import { renderTypedoc } from './typedoc.js';
import { renderXmldoc } from './xmldoc.js';

/** One renderer per input kind, each with the signature of `Renderer.render` minus the kind. */
type Renderers = {
  [K in keyof RendererInputs]: (
    input: RendererInputs[K],
    meta: RenderMeta,
    opts?: RenderOptions,
  ) => DocPage;
};

/**
 * Creates the renderer (design section 5.3).
 *
 * - `render('html', ...)`, `detectFamily` and `detectMetaRefresh` delegate to the HTML
 *   extractor; the Sphinx renderer also uses it for docstring bodies.
 * - Structured kinds are pure functions of their input. Their pages report
 *   `diagnostics.family: 'structured'`, the renderer's name and the conversion time.
 * - A renderer throws only `McpDocError`: `DOC_NOT_FOUND` for input of the wrong shape (the
 *   caller can fall back to the HTML page), `INTERNAL` for anything unforeseen.
 */
export const createRenderer: CreateRenderer = (html) => {
  const renderers: Renderers = {
    html: (input, meta, opts) => html.extract(input, meta, opts),
    markdown: renderMarkdown,
    source: renderSource,
    notebook: renderNotebook,
    openapi: renderOpenapi,
    typedoc: renderTypedoc,
    cem: renderCem,
    docc: renderDocc,
    sphinx: createSphinxRenderer(html),
    xmldoc: renderXmldoc,
    dts: renderDts,
    arcade: renderArcade,
  };

  return {
    render(kind, input, meta, opts) {
      if (kind === 'html') return renderers.html(input as RendererInputs['html'], meta, opts);
      const started = performance.now();
      try {
        const page = renderers[kind](input, meta, opts);
        page.diagnostics.ms = Math.round(performance.now() - started);
        return page;
      } catch (error) {
        if (isMcpDocError(error)) throw error;
        // A renderer bug must not surface as a raw exception: the caller falls back to HTML.
        const wrapped = new McpDocError('INTERNAL', `The ${kind} renderer failed for ${meta.url}`, {
          why: error instanceof Error ? error.message : String(error),
          url: meta.url,
        });
        wrapped.cause = error;
        throw wrapped;
      }
    },
    detectFamily: (source) => html.detectFamily(source),
    detectMetaRefresh: (source, baseUrl) => html.detectMetaRefresh(source, baseUrl),
  };
};
