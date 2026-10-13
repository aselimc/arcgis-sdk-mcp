import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as cheerio from 'cheerio';
import { expect } from 'vitest';
import { joinSections } from '../../src/core/budget.js';
import { isMcpDocError } from '../../src/core/errors.js';
import type { HtmlExtractor, RenderMeta, Renderer } from '../../src/core/ports.js';
import { pageProvenance } from '../../src/core/provenance.js';
import { sectionsFromMarkdown } from '../../src/core/sections.js';
import type { DocPage } from '../../src/core/types.js';
import { isElement, isText, type AnyNode } from '../../src/render/dom.js';
import { createRenderer } from '../../src/render/index.js';
import { FAKE_NOW_ISO } from '../support/builders.js';
import { fixturePath, hasFixture, readFixture } from '../support/fixtures.js';

/** A `RenderMeta` for an API page on an invented documentation URL. */
export function makeMeta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    url: 'https://developers.arcgis.com/tides/api-reference/tide-clock/',
    kind: 'api',
    license: 'esri-website-terms',
    retrievedAt: FAKE_NOW_ISO,
    ...overrides,
  };
}

/** The text a golden file holds: the header, then every section, then the file list. */
export function pageText(page: DocPage): string {
  const files = (page.files ?? []).map(
    (file) => `<!-- file: ${file.name} (${file.language}, ${file.bytes} bytes) -->`,
  );
  return `${[page.header ?? '', joinSections(page.sections), ...files]
    .filter((part) => part !== '')
    .join('\n\n')}\n`;
}

/**
 * Compares a page with its golden file byte for byte. Run the tests with `UPDATE_GOLDEN=1`
 * to (re)write the golden files after an intended change, then review the diff.
 */
export function expectGolden(page: DocPage, ...segments: string[]): void {
  const actual = pageText(page);
  if (process.env.UPDATE_GOLDEN === '1') {
    const file = fixturePath(...segments);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  expect(hasFixture(...segments), `golden file ${segments.join('/')} is missing`).toBe(true);
  expect(actual).toBe(readFixture(...segments));
}

/** Path segments of a synthetic fixture of one structured renderer. */
export function structured(renderer: string, file: string): string[] {
  return ['synthetic', 'structured', renderer, file];
}

function inlineMarkdown($: cheerio.CheerioAPI, element: cheerio.Cheerio<AnyNode>): string {
  return element
    .contents()
    .toArray()
    .map((node) => {
      const $node = $(node);
      if (isText(node)) return node.data.replace(/\s+/g, ' ');
      if (!isElement(node)) return '';
      const { name } = node;
      const inner = inlineMarkdown($, $node);
      if (name === 'code') return `\`${$node.text()}\``;
      if (name === 'a') return `[${inner}](${$node.attr('href') ?? ''})`;
      if (name === 'strong' || name === 'b') return `**${inner}**`;
      if (name === 'em' || name === 'i' || name === 'cite') return `_${inner}_`;
      return inner;
    })
    .join('')
    .trim();
}

function blockMarkdown($: cheerio.CheerioAPI, parent: cheerio.Cheerio<AnyNode>): string {
  return parent
    .children()
    .toArray()
    .map((node) => {
      const $node = $(node);
      const { name } = node;
      if (name === 'pre') {
        const language = $node.attr('data-language') ?? '';
        return `\`\`\`${language}\n${$node.text()}\n\`\`\``;
      }
      if (name === 'div' && $node.hasClass('admonition')) {
        const title = $node.children('.admonition-title').text().trim();
        $node.children('.admonition-title').remove();
        return `> **${title}:** ${blockMarkdown($, $node).replace(/\n+/g, ' ')}`;
      }
      if (name === 'table') {
        return $node
          .find('tr')
          .toArray()
          .map(
            (row) =>
              `- ${$(row)
                .children()
                .toArray()
                .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim())
                .join(': ')}`,
          )
          .join('\n');
      }
      if (name === 'dl') {
        return $node
          .children('dt')
          .toArray()
          .map((term) => `**${$(term).text().trim()}** ${$(term).next('dd').text().trim()}`)
          .join('\n\n');
      }
      if (/^h[1-6]$/.test(name))
        return `${'#'.repeat(Number(name.slice(1)))} ${$node.text().trim()}`;
      if (name === 'p') return inlineMarkdown($, $node);
      return blockMarkdown($, $node);
    })
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

/**
 * A stand-in for the HTML extractor (WP3), which this package may not import. It converts
 * the small HTML subset the Sphinx fixture uses: paragraphs, inline code, links, emphasis,
 * `pre[data-language]`, admonitions, simple tables, definition lists and headings. `calls`
 * records every fragment it was handed.
 */
export class TinyHtmlExtractor implements HtmlExtractor {
  readonly calls: Array<{ html: string; familyHint?: string }> = [];

  extract: HtmlExtractor['extract'] = (input, meta) => {
    this.calls.push(input);
    const $ = cheerio.load(input.html);
    const root = $('main').first();
    const markdown = blockMarkdown($, root.length > 0 ? root : $('body'));
    const sections = sectionsFromMarkdown(markdown);
    return {
      ...pageProvenance(meta),
      title: sections[0]?.title ?? '',
      sections,
      diagnostics: {
        family: 'generic',
        fences: 0,
        fencesWithLanguage: 0,
        tablesByStrategy: {},
        unknownIslands: [],
        leftoverHtmlTags: 0,
        redirectHops: 0,
        ms: 0,
      },
      notices: [],
    };
  };

  detectFamily: HtmlExtractor['detectFamily'] = () => 'generic';

  detectMetaRefresh: HtmlExtractor['detectMetaRefresh'] = (html, baseUrl) => {
    const target = /http-equiv="refresh" content="0; url=([^"]+)"/.exec(html)?.[1];
    return target === undefined ? undefined : new URL(target, baseUrl).href;
  };
}

/** The real renderer over a {@link TinyHtmlExtractor}. */
export function makeRenderer(): { renderer: Renderer; html: TinyHtmlExtractor } {
  const html = new TinyHtmlExtractor();
  return { renderer: createRenderer(html), html };
}

/**
 * Runs `render` and returns the `McpDocError` it throws, as `{ code, why, url }`. Fails the
 * test when nothing is thrown or the error is of another type.
 */
export function thrownBy(render: () => unknown): { code: string; why?: string; url?: string } {
  try {
    render();
  } catch (error) {
    if (!isMcpDocError(error)) throw error;
    return {
      code: error.code,
      ...(error.details?.why === undefined ? {} : { why: error.details.why }),
      ...(error.details?.url === undefined ? {} : { url: error.details.url }),
    };
  }
  throw new Error('expected the renderer to throw');
}

/** Ids of a page's sections, in order. */
export function sectionIds(page: DocPage): string[] {
  return page.sections.map((section) => section.id);
}
