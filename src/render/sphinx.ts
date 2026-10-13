/**
 * Sphinx API pages (the ArcGIS API for Python) to pages. The input is the body HTML of a
 * Sphinx page, from the `fjson` build, from Gatsby page data or from the public page.
 *
 * Structure comes from the markup Sphinx's Python domain emits: every documented object is a
 * `dl.py.<role>` whose `dt[id]` holds the signature and whose `dd` holds the docstring and,
 * for a class, the nested `dl.py` of its members. This module slices and models that
 * structure; turning a docstring's HTML into Markdown is the HTML extractor's job.
 */
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import { humanizeSlug } from '../core/adapter-helpers.js';
import { joinSections } from '../core/budget.js';
import type { HtmlExtractor, RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, SymbolDetail } from '../core/types.js';
import {
  memberEntries,
  renderApiPage,
  typeBlocks,
  type ApiMember,
  type ApiType,
} from './api-page.js';
import { isElement, type AnyNode, type Element } from './dom.js';
import { inlineCode, oneLine } from './md.js';
import { buildSections, finishPage, type Block } from './page.js';

const GROUPS: Record<string, string> = {
  class: 'Classes',
  exception: 'Exceptions',
  function: 'Functions',
  method: 'Methods',
  property: 'Properties',
  attribute: 'Attributes',
  data: 'Data',
};

const CODE_LANGUAGES: Record<string, string> = {
  default: 'python',
  python: 'python',
  python3: 'python',
  ipython3: 'python',
  pycon: 'python',
  console: 'bash',
  shell: 'bash',
  bash: 'bash',
  json: 'json',
  none: '',
  text: '',
};

/** Converts a docstring's HTML to Markdown. */
type Convert = (html: string) => string;

/** How much of a docstring is needed: all of it, or only its first paragraph as text. */
type Depth = 'full' | 'brief';

/**
 * Rewrites the page in place into plain HTML any converter understands: links absolute,
 * highlighted code as `pre > code.language-x`, Sphinx's per-token `span.pre` wrappers gone.
 */
function normalise($: CheerioAPI, pageUrl: string): void {
  $('a.headerlink, a.viewcode-link, .viewcode-link').remove();
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    // The JSON build links to other pages directory-style: "../arcgis.gis.toc/#arcgis.gis.GIS".
    const sibling = /^\.\.\/([^/#?]+)\/(#.*)?$/.exec(href);
    const target = sibling === null ? href : `${sibling[1] ?? ''}.html${sibling[2] ?? ''}`;
    try {
      $(anchor).attr('href', new URL(target, pageUrl).href);
    } catch {
      // An unparsable href is left as the author wrote it.
    }
  });
  $('div[class*="highlight-"]').each((_, block) => {
    const name = /highlight-([\w+-]+)/.exec($(block).attr('class') ?? '')?.[1] ?? '';
    const language = CODE_LANGUAGES[name] ?? name;
    const code = $('<code></code>').text($(block).find('pre').first().text().replace(/\n$/, ''));
    if (language !== '') code.attr('class', `language-${language}`);
    $(block).replaceWith($('<pre></pre>').attr('data-language', language).append(code));
  });
  $('span.pre').each((_, span) => {
    $(span).replaceWith($(span).contents());
  });
}

function roleOf($dl: Cheerio<Element>): string {
  const classes = ($dl.attr('class') ?? '').split(/\s+/);
  return classes.find((name) => name !== 'py' && name !== '') ?? 'object';
}

/** Signature text of a `dt`, with the spacing an author would use. */
function signatureOf($dt: Cheerio<Element>): string {
  return oneLine($dt.text())
    .replace(/\s+([,)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1');
}

function isPythonObject($: CheerioAPI, node: AnyNode): node is Element {
  return isElement(node) && node.name === 'dl' && $(node).hasClass('py');
}

/** The nested `dl.py` of a description, in document order. */
function nestedObjects($: CheerioAPI, $dd: Cheerio<Element>): Element[] {
  return $dd
    .children()
    .toArray()
    .filter((child) => isPythonObject($, child));
}

interface Described {
  id: string;
  name: string;
  role: string;
  signature: string;
  description: string;
  children: Element[];
}

function describe($: CheerioAPI, dl: Element, convert: Convert, depth: Depth): Described {
  const $dl = $(dl);
  const $dts = $dl.children('dt');
  const $dd = $dl.children('dd').first();
  const children = nestedObjects($, $dd);
  const id = $dts.first().attr('id') ?? '';
  let description: string;
  if (depth === 'brief') {
    description = oneLine($dd.children('p').first().text());
  } else {
    const $body = $dd.clone();
    $body.children().each((_, child) => {
      if (isPythonObject($, child)) $(child).remove();
    });
    description = convert($body.html() ?? '');
  }
  return {
    id,
    name: oneLine($dts.first().find('.sig-name').first().text()) || (id.split('.').at(-1) ?? id),
    role: roleOf($dl),
    signature: $dts
      .toArray()
      .map((dt) => signatureOf($(dt)))
      .join('\n'),
    description,
    children,
  };
}

function toMember($: CheerioAPI, dl: Element, convert: Convert, depth: Depth): ApiMember {
  const object = describe($, dl, convert, depth);
  return {
    id: object.id,
    name: object.name,
    kind: object.role,
    group: GROUPS[object.role] ?? 'Members',
    signature: object.signature,
    ...(object.description === '' ? {} : { description: object.description }),
  };
}

/** A documented object with its nested members, as the common API model. */
function toType($: CheerioAPI, dl: Element, convert: Convert, detail: SymbolDetail): ApiType {
  const object = describe($, dl, convert, detail === 'signature' ? 'brief' : 'full');
  // A member's own page is titled with its owner, as in "GIS.map".
  const owner = $(dl).parents('dl.py').first().children('dt').first().find('.sig-name').first();
  const ownerName = oneLine(owner.text());
  const module = object.id
    .split('.')
    .slice(0, ownerName === '' ? -1 : -2)
    .join('.');
  return {
    title: ownerName === '' ? object.name : `${ownerName}.${object.name}`,
    ...(object.id === '' ? {} : { id: object.id }),
    header: `_${object.role}_${module === '' ? '' : ` · ${inlineCode(module)}`}`,
    language: 'python',
    signature: object.signature,
    ...(object.description === '' ? {} : { description: object.description }),
    members: object.children.map((child) =>
      toMember($, child, convert, detail === 'full' ? 'full' : 'brief'),
    ),
  };
}

/** The element with exactly this id. Ids are compared as strings, never built into selectors. */
function byId($: CheerioAPI, id: string): Cheerio<Element> {
  return $('[id]').filter((_, element) => $(element).attr('id') === id);
}

function wholePage(
  $: CheerioAPI,
  convert: Convert,
  meta: RenderMeta,
  opts: RenderOptions | undefined,
): DocPage {
  const detail = opts?.detail ?? 'full';
  const $root = $('[role="main"], div.body, article, main').first();
  const $scope: Cheerio<AnyNode> = $root.length > 0 ? $root : $.root();
  const top = $scope
    .find('dl.py')
    .toArray()
    .filter((dl) => $(dl).parents('dl.py').length === 0);
  const title = oneLine($scope.find('h1').first().text()) || humanizeSlug(meta.url);

  // Prose first, then the API entries: the page's own order interleaves them, but each entry
  // is addressable by id either way.
  const $prose = $scope.clone();
  $prose.find('dl.py').remove();
  $prose.find('h1').first().remove();
  const types = top.map((dl) => ({ dl, type: toType($, dl, convert, detail) }));
  const sectionBlocks: Block[] = [
    { level: 1, title, body: convert($prose.html() ?? '') },
    ...types.flatMap(({ dl, type }) =>
      typeBlocks(type, detail, 2, $(dl).children('dt').first().attr('id')),
    ),
  ];
  const members = types.flatMap(({ dl, type }) => [
    ...memberEntries([toMember($, dl, convert, 'brief')]),
    ...memberEntries(type.members),
  ]);
  return finishPage(
    'sphinx',
    meta,
    { title, sections: buildSections(sectionBlocks), members },
    opts,
  );
}

/**
 * Creates the Sphinx renderer. Docstring HTML is converted by the injected extractor, so
 * admonitions, field lists, tables and code blocks follow the same rules as every HTML page.
 *
 * - `input.anchor` names an object by its fully qualified id (`arcgis.gis.GIS`,
 *   `arcgis.gis.GIS.map`): the page is that object's `dl.py`. A class lists its members;
 *   detail `summary` gives the docstring plus a one-line member index.
 * - Without an anchor, or when the anchor is not on the page, the whole page is rendered:
 *   its prose, then every top-level object.
 */
export function createSphinxRenderer(
  html: HtmlExtractor,
): (input: RendererInputs['sphinx'], meta: RenderMeta, opts?: RenderOptions) => DocPage {
  return (input, meta, opts) => {
    const pageUrl = meta.url.replace(/#.*$/, '');
    const $ = cheerio.load(input.html);
    normalise($, pageUrl);
    const convert: Convert = (fragment) => {
      if (fragment.trim() === '') return '';
      const page = html.extract(
        {
          html: `<!DOCTYPE html><html><body><main>${fragment}</main></body></html>`,
          familyHint: 'generic',
        },
        meta,
      );
      return joinSections(page.sections);
    };

    const anchored = input.anchor === undefined ? undefined : byId($, input.anchor).first();
    const dl = anchored?.closest('dl.py').get(0);
    if (!isElement(dl)) return wholePage($, convert, meta, opts);
    return renderApiPage('sphinx', meta, toType($, dl, convert, opts?.detail ?? 'full'), opts);
  };
}
