/**
 * Sample bundles (README, `README.metadata.json`, source files) to pages. The README is the
 * description; the code goes to `DocPage.files`, so the doc service decides how much of it a
 * view shows.
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import { sectionsFromMarkdown } from '../core/sections.js';
import type { DocPage, SourceFile } from '../core/types.js';
import { asRecord, str, strings } from './json.js';
import { isVerbatim, readableMarkdown, splitFrontMatter, titleOf } from './markdown.js';
import { blocks, inlineCode } from './md.js';
import { buildSections, finishPage } from './page.js';

/** Fence language by file extension; unknown extensions use the extension itself. */
const LANGUAGES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  html: 'html',
  htm: 'html',
  css: 'css',
  json: 'json',
  py: 'python',
  ipynb: 'json',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  cs: 'csharp',
  xaml: 'xml',
  xml: 'xml',
  daml: 'xml',
  csproj: 'xml',
  cpp: 'cpp',
  h: 'cpp',
  qml: 'qml',
  dart: 'dart',
  r: 'r',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sh: 'bash',
  sql: 'sql',
  gradle: 'groovy',
  proto: 'protobuf',
};

/** The fence language for a file name. */
export function languageOf(name: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return LANGUAGES[extension] ?? extension;
}

function baseName(name: string): string {
  return name.split('/').at(-1) ?? name;
}

/**
 * Renders a sample.
 *
 * - `sections` come from the README (links made absolute against `meta.url`; HTML comments,
 *   hidden HTML and invisible characters removed, as for any Markdown document); without
 *   one, from the metadata's title and description.
 * - `files` keep the order given, except that the files the metadata names as `snippets`
 *   (the sample's main sources) come first. Their text is not repeated in the sections.
 * - `title`, `relevantApis` and the category and keyword line of `header` come from
 *   `README.metadata.json` when it is present.
 */
export function renderSource(
  input: RendererInputs['source'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const metadata = asRecord(input.metadata);
  const readme = splitFrontMatter((input.readme ?? '').replace(/\r\n?/g, '\n'));
  const body = isVerbatim(meta, opts) ? readme.body : readableMarkdown(readme.body, meta.url);
  const description = str(metadata.description);
  const metadataTitle = str(metadata.title);

  let sections = sectionsFromMarkdown(body);
  if (sections.length === 0) {
    const title = metadataTitle ?? readme.title ?? humanizeSlug(meta.url);
    sections = buildSections([{ level: 1, title, body: description ?? '' }]);
  }
  const title = metadataTitle ?? readme.title ?? titleOf(sections) ?? humanizeSlug(meta.url);

  const main = strings(metadata.snippets).map(baseName);
  const rank = (name: string): number => {
    const index = main.indexOf(baseName(name));
    return index === -1 ? main.length : index;
  };
  const files: SourceFile[] = input.files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => rank(a.file.name) - rank(b.file.name) || a.index - b.index)
    .map(({ file }) => ({
      name: file.name,
      language: languageOf(file.name),
      // A byte order mark is not part of the code: pasted, it would precede the first token.
      text: file.text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n'),
      ref: file.ref,
      bytes: Buffer.byteLength(file.text, 'utf8'),
    }));

  const category = str(metadata.category);
  const keywords = strings(metadata.keywords);
  const relevantApis = strings(metadata.relevant_apis);
  const header = blocks(
    [
      category === undefined ? undefined : `**Category:** ${category}`,
      keywords.length === 0 ? undefined : `**Keywords:** ${keywords.join(', ')}`,
    ]
      .filter((part) => part !== undefined)
      .join(' · '),
    files.length === 0
      ? undefined
      : `**Files:** ${files.map((file) => inlineCode(file.name)).join(', ')}`,
  );
  return finishPage(
    'source',
    meta,
    {
      title,
      ...(header === '' ? {} : { header }),
      sections,
      files,
      ...(relevantApis.length === 0 ? {} : { relevantApis }),
    },
    opts,
  );
}
