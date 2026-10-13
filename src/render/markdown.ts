/**
 * Markdown documents (GitHub files, wiki pages, pkgdown `.md`, bundled briefs) to pages.
 * The text is already what an agent should read, so the work is slicing it into sections and
 * making its relative links usable.
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, DocSection } from '../core/types.js';
import { stepFence, type OpenFence } from '../core/fences.js';
import { sectionsFromMarkdown } from '../core/sections.js';
import { absolutizeLinks } from './links.js';
import { finishPage } from './page.js';

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/** YAML front matter split from the body; only its `title` is read. */
export function splitFrontMatter(markdown: string): { title?: string; body: string } {
  const match = FRONT_MATTER.exec(markdown);
  if (match === null) return { body: markdown };
  const title = /^title:\s*(.+?)\s*$/m.exec(match[1] ?? '')?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  const body = markdown.slice(match[0].length);
  return title === undefined || title === '' ? { body } : { title, body };
}

/** Two or more line breaks with only blanks between them. */
const BLANK_LINE_RUNS = /\n(?:[ \t]*\n)+/g;

/**
 * Removes HTML comments outside code fences. A reader of the rendered page never sees them,
 * so they are editor notes at best and text aimed at a model at worst; either way they are
 * not documentation. A comment may span lines; an unterminated one is left as it is.
 */
export function stripHtmlComments(markdown: string): string {
  if (!markdown.includes('<!--')) return markdown;
  const kept: string[] = [];
  let open: OpenFence;
  let prose: string[] = [];
  const flush = (): void => {
    if (prose.length === 0) return;
    const text = prose.join('\n');
    const cleaned = text.replace(/<!--[\s\S]*?-->/g, '');
    // Lines that held nothing but a comment disappear with it.
    kept.push(cleaned === text ? text : cleaned.replace(BLANK_LINE_RUNS, '\n\n'));
    prose = [];
  };
  for (const line of markdown.split('\n')) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.fenced) {
      flush();
      kept.push(line);
    } else prose.push(line);
  }
  flush();
  return kept.join('\n');
}

/** Title of a document: its first level-1 heading, else its first heading. */
export function titleOf(sections: readonly DocSection[]): string | undefined {
  const heading =
    sections.find((section) => section.level === 1) ??
    sections.find((section) => section.level > 0);
  return heading === undefined || heading.title === '' ? undefined : heading.title;
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
 * their images), HTML comments are removed and YAML front matter is dropped after its
 * `title` is read, unless the document is verbatim (`opts.verbatim` or licence `cc-by-nd`).
 */
export function renderMarkdown(
  input: RendererInputs['markdown'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const text = input.markdown.replace(/\r\n?/g, '\n');
  const verbatim = isVerbatim(meta, opts);
  const front = splitFrontMatter(text);
  const body = verbatim ? text : absolutizeLinks(stripHtmlComments(front.body), meta.url);
  const sections = sectionsFromMarkdown(body);
  const title = front.title ?? titleOf(sections) ?? humanizeSlug(meta.url);
  return finishPage('markdown', meta, { title, sections }, opts);
}
