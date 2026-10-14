/**
 * Markdown documents (GitHub files, wiki pages, pkgdown `.md`, bundled briefs) to pages.
 * The text is already what an agent should read, so the work is slicing it into sections and
 * making its relative links usable.
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, DocSection } from '../core/types.js';
import { sectionsFromMarkdown } from '../core/sections.js';
import { absolutizeLinks } from './links.js';
import { closeFences } from './md.js';
import { finishPage } from './page.js';
import { inlineHtmlToMarkdown, stripUnseen } from './unseen.js';

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/** YAML front matter split from the body; only its `title` is read. */
export function splitFrontMatter(markdown: string): { title?: string; body: string } {
  const match = FRONT_MATTER.exec(markdown);
  if (match === null) return { body: markdown };
  const title = /^title:\s*(.+?)\s*$/m.exec(match[1] ?? '')?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  const body = markdown.slice(match[0].length);
  return title === undefined || title === '' ? { body } : { title, body };
}

/** Title of a document: its first level-1 heading, else its first heading. */
export function titleOf(sections: readonly DocSection[]): string | undefined {
  const heading =
    sections.find((section) => section.level === 1) ??
    sections.find((section) => section.level > 0);
  return heading === undefined || heading.title === '' ? undefined : heading.title;
}

/**
 * Most characters of a Markdown document that are rendered. The transport lets a text file
 * be tens of megabytes (package indexes are), and rendering is synchronous: every line is
 * scanned for links and every link resolved, about a second per megabyte of dense text.
 * No README, wiki page or changelog worth reading in one piece comes near this size.
 */
export const MAX_MARKDOWN_CHARS = 2_000_000;

/**
 * Cuts a Markdown text at the last line that fits {@link MAX_MARKDOWN_CHARS}, closes a code
 * fence the cut leaves open, and says so in a notice.
 */
export function capMarkdown(markdown: string): { text: string; notices: string[] } {
  if (markdown.length <= MAX_MARKDOWN_CHARS) return { text: markdown, notices: [] };
  const end = markdown.lastIndexOf('\n', MAX_MARKDOWN_CHARS);
  const megabytes = (markdown.length / 1_000_000).toFixed(1);
  return {
    text: closeFences(markdown.slice(0, end === -1 ? MAX_MARKDOWN_CHARS : end)),
    notices: [
      `The document has ${megabytes} million characters; only the first ${MAX_MARKDOWN_CHARS / 1_000_000} million are shown.`,
    ],
  };
}

/**
 * A Markdown text as an agent should read it: without what a reader of the rendered page
 * does not see (see `unseen.ts`), with its plain HTML links written as Markdown links and
 * its relative links made absolute against `baseUrl`.
 */
export function readableMarkdown(markdown: string, baseUrl: string): string {
  return absolutizeLinks(inlineHtmlToMarkdown(stripUnseen(markdown)), baseUrl);
}

/**
 * Whether a document must be returned exactly as published. `cc-by-nd` content may be
 * quoted but not adapted, so no link is rewritten and no front matter removed.
 */
export function isVerbatim(meta: RenderMeta, opts: RenderOptions | undefined): boolean {
  return opts?.verbatim === true || meta.license === 'cc-by-nd';
}

/**
 * Renders a Markdown document.
 *
 * Sections are cut at ATX headings; `opts.select.section` returns one of them with its
 * descendants. Relative links become absolute (blob URLs for GitHub files, raw URLs for
 * their images), HTML comments, hidden HTML and invisible characters are removed and YAML
 * front matter is dropped after its `title` is read, unless the document is verbatim (`opts.verbatim` or licence `cc-by-nd`).
 */
export function renderMarkdown(
  input: RendererInputs['markdown'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const capped = capMarkdown(input.markdown.replace(/\r\n?/g, '\n'));
  const verbatim = isVerbatim(meta, opts);
  const front = splitFrontMatter(capped.text);
  const body = verbatim ? capped.text : readableMarkdown(front.body, meta.url);
  const sections = sectionsFromMarkdown(body);
  const title = front.title ?? titleOf(sections) ?? humanizeSlug(meta.url);
  return finishPage('markdown', meta, { title, sections, notices: capped.notices }, opts);
}
