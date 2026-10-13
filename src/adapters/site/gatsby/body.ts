/**
 * Body variants. A prose page keeps its body in the HTML only, but generated pages carry it
 * in page-data, structured or pre-rendered:
 *
 * | page-data field | Content | Renderer |
 * |---|---|---|
 * | `openApiOperationPage.operation`, `openApiSchemasPage.schemas` | one OpenAPI operation, or the schemas of a service | `openapi` |
 * | `typedocPage.raw` | a TypeDoc reflection | `typedoc` |
 * | `sphinxJson.html` | a Sphinx module page | `sphinx` |
 * | `jupyterNotebook.html` | a rendered notebook | `html` |
 * | `apiRef.html` | a .NET type page | `html` |
 * | `mdxPage.childMarkdownRemark.html` | a specification page | `html` |
 *
 * `bodyFrom` in the source config names the field to use, or `auto` for whichever is there.
 */
import type { Ctx, RenderMeta, RenderOptions } from '../../../core/ports.js';
import type { DocPage } from '../../../core/types.js';
import { isObject, textOf } from './shape.js';
import type { GatsbyConfig } from './symbols.js';

/** Where the body of a page is taken from. */
export type BodyMode = NonNullable<GatsbyConfig['bodyFrom']>;

/** A body found in page-data, ready for its renderer. */
export type BodyVariant =
  | { renderer: 'openapi'; operation?: unknown; schemas?: unknown; title: string }
  | { renderer: 'typedoc'; raw: unknown; title: string }
  | { renderer: 'sphinx'; html: string; title: string }
  | { renderer: 'html'; html: string; title: string };

/** `symbols` modes whose pages are generated, so that their body is in page-data. */
const STRUCTURED_SYMBOLS: ReadonlySet<GatsbyConfig['symbols']> = new Set([
  'typedoc',
  'openapi',
  'apiref-nav',
  'sphinx-pagination',
] as const);

/**
 * The body mode of a source: its `bodyFrom`, else `auto` when its `symbols` mode implies
 * generated pages, else `html`, which spares prose sites a page-data request per read.
 */
export function bodyModeOf(config: GatsbyConfig): BodyMode {
  return config.bodyFrom ?? (STRUCTURED_SYMBOLS.has(config.symbols) ? 'auto' : 'html');
}

function htmlOf(holder: unknown): string | undefined {
  const html = isObject(holder) ? holder.html : undefined;
  return typeof html === 'string' && html.trim() !== '' ? html : undefined;
}

/**
 * The body a page-data `result.data` object carries for the given mode, or `undefined` when
 * it has none (a prose page, or a renamed field): the caller then reads the HTML page.
 */
export function bodyVariantOf(
  data: Record<string, unknown>,
  mode: BodyMode,
): BodyVariant | undefined {
  const auto = mode === 'auto';
  const mdxPage = isObject(data.mdxPage) ? data.mdxPage : {};
  if (auto) {
    const operationPage = isObject(data.openApiOperationPage) ? data.openApiOperationPage : {};
    const schemasPage = isObject(data.openApiSchemasPage) ? data.openApiSchemasPage : {};
    if (isObject(operationPage.operation)) {
      return {
        renderer: 'openapi',
        operation: operationPage.operation,
        title: textOf(operationPage.title),
      };
    }
    if (schemasPage.schemas !== undefined && schemasPage.schemas !== null) {
      return {
        renderer: 'openapi',
        schemas: schemasPage.schemas,
        title: textOf(schemasPage.title),
      };
    }
    const typedocPage = isObject(data.typedocPage) ? data.typedocPage : {};
    if (isObject(typedocPage.raw)) {
      return { renderer: 'typedoc', raw: typedocPage.raw, title: textOf(typedocPage.title) };
    }
  }
  if (auto || mode === 'sphinxJson') {
    const html = htmlOf(data.sphinxJson);
    if (html !== undefined) {
      const title = textOf(isObject(data.sphinxJson) ? data.sphinxJson.title : undefined);
      return { renderer: 'sphinx', html, title };
    }
  }
  for (const field of ['jupyterNotebook', 'apiRef'] as const) {
    if (!auto && mode !== field) continue;
    const html = htmlOf(data[field]);
    if (html !== undefined) {
      const holder = data[field];
      return { renderer: 'html', html, title: textOf(isObject(holder) ? holder.title : undefined) };
    }
  }
  if (auto || mode === 'childMarkdownRemark') {
    const html = htmlOf(mdxPage.childMarkdownRemark);
    if (html !== undefined) return { renderer: 'html', html, title: textOf(mdxPage.title) };
  }
  return undefined;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wraps a body fragment from page-data into a document, so that the HTML extractor finds a
 * title and a main element like on a fetched page. A fragment that brings its own `h1`
 * keeps it.
 */
export function documentOf(title: string, fragment: string): string {
  const safe = escapeHtml(title);
  const heading = title === '' || /<h1[\s>]/i.test(fragment) ? '' : `<h1>${safe}</h1>`;
  return `<!doctype html><html><head><title>${safe}</title></head><body><main>${heading}${fragment}</main></body></html>`;
}

/** What the renderers need besides the body itself. */
export interface RenderRequest {
  meta: RenderMeta;
  opts: RenderOptions | undefined;
  /** Decoded fragment of the requested URL, when it has one. */
  fragment: string | undefined;
  /** The site prefix as a path (`/rest`), for site-relative links in OpenAPI data. */
  sitePrefix: string;
}

/** Converts a body variant with the renderer it belongs to. */
export function renderVariant(ctx: Ctx, variant: BodyVariant, request: RenderRequest): DocPage {
  const { meta, opts, fragment, sitePrefix } = request;
  const select = opts?.select;
  switch (variant.renderer) {
    case 'openapi':
      return ctx.render.render(
        'openapi',
        {
          ...(variant.operation === undefined ? {} : { operation: variant.operation }),
          ...(variant.schemas === undefined ? {} : { schemas: variant.schemas }),
          ...(fragment === undefined ? {} : { target: fragment }),
          sitePrefix,
        },
        meta,
        opts,
      );
    case 'typedoc': {
      const member = select?.member;
      return ctx.render.render(
        'typedoc',
        { raw: variant.raw, ...(member === undefined ? {} : { member }) },
        meta,
        opts,
      );
    }
    case 'sphinx': {
      // The anchor of a Sphinx object is its qualified name; the renderer slices to it.
      const anchor = select?.member ?? select?.section ?? fragment;
      return ctx.render.render(
        'sphinx',
        { html: variant.html, ...(anchor === undefined ? {} : { anchor }) },
        meta,
        opts,
      );
    }
    case 'html':
      // The fragment is the page's own body as its build stored it, without the site chrome
      // a family profile looks for: the generic profile is the right one, not a fallback.
      return ctx.render.render(
        'html',
        { html: documentOf(variant.title, variant.html), familyHint: 'generic' },
        meta,
        opts,
      );
  }
}
