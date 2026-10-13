/**
 * Jupyter notebooks (`.ipynb`, nbformat 4) to pages: Markdown cells as written, code cells
 * as fenced code, outputs dropped unless they are short text.
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import { sectionsFromMarkdown } from '../core/sections.js';
import type { DocPage } from '../core/types.js';
import { asRecord, isRecord, list, records, str, type Json } from './json.js';
import { absolutizeLinks } from './links.js';
import { isVerbatim, titleOf } from './markdown.js';
import { blocks, fence } from './md.js';
import { finishPage, invalidInput } from './page.js';

/** Outputs longer than this are results to look at, not documentation to read. */
const MAX_OUTPUT_CHARS = 600;
const MAX_OUTPUT_LINES = 12;

/** Cell text: nbformat stores it as one string or as a list of lines. */
function sourceOf(value: unknown): string {
  const text = Array.isArray(value)
    ? list(value)
        .filter((line) => typeof line === 'string')
        .join('')
    : typeof value === 'string'
      ? value
      : '';
  return text.replace(/\r\n?/g, '\n');
}

/** Removes terminal colour codes, which tracebacks and progress bars are full of. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex -- the escape character is what is being removed
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** The text of one output when it is short plain text, otherwise `undefined`. */
function shortText(output: Json): string | undefined {
  let text: string;
  if (output.output_type === 'stream') text = sourceOf(output.text);
  else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const data = asRecord(output.data);
    // Rich results (tables, images, widgets) have no useful text form.
    if (Object.keys(data).some((mime) => mime !== 'text/plain')) return undefined;
    text = sourceOf(data['text/plain']);
  } else return undefined;
  const trimmed = plain(text).replace(/\s+$/, '');
  if (trimmed.trim() === '') return undefined;
  if (trimmed.length > MAX_OUTPUT_CHARS || trimmed.split('\n').length > MAX_OUTPUT_LINES) {
    return undefined;
  }
  return trimmed;
}

function codeCell(cell: Json, language: string): string {
  const code = sourceOf(cell.source);
  if (code.trim() === '') return '';
  const outputs = records(cell.outputs).flatMap((output) => shortText(output) ?? []);
  return blocks(
    fence(code, language),
    outputs.length === 0 ? undefined : blocks('Output:', fence(outputs.join('\n'), 'text')),
  );
}

/**
 * Renders a notebook. Markdown cells are kept verbatim (relative links made absolute unless
 * the document is verbatim), code cells are fenced with the kernel's language, raw cells and
 * long or rich outputs are dropped.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the input has no `cells` array.
 */
export function renderNotebook(
  input: RendererInputs['notebook'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const notebook = input.ipynb;
  if (!isRecord(notebook) || !Array.isArray(notebook.cells)) {
    throw invalidInput('notebook', meta, 'the file is not a notebook: it has no cells');
  }
  const metadata = asRecord(notebook.metadata);
  const language =
    str(asRecord(metadata.language_info).name) ??
    str(asRecord(metadata.kernelspec).language) ??
    'python';
  const verbatim = isVerbatim(meta, opts);
  const parts = records(notebook.cells).map((cell) => {
    if (cell.cell_type === 'markdown') {
      const text = sourceOf(cell.source);
      return verbatim ? text : absolutizeLinks(text, meta.url);
    }
    return cell.cell_type === 'code' ? codeCell(cell, language) : '';
  });
  const sections = sectionsFromMarkdown(blocks(...parts));
  const title = titleOf(sections) ?? humanizeSlug(meta.url);
  return finishPage('notebook', meta, { title, sections }, opts);
}
