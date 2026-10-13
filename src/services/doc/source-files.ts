/**
 * The "source" of a GitHub page that holds no code itself. Many samples are a folder whose
 * README describes them while the code sits in files next to it or below it
 * (`src/main/java/...`, `src/runtime/widget.tsx`). Asked for the source of such a README,
 * the doc service answers with the list of those files, each a ref that can be read.
 */
import { estimateTokens } from '../../core/budget.js';
import type { CallOptions, Ctx } from '../../core/ports.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { parseGithubUrl } from '../../core/url.js';
import { SOURCE_SECTION_ID } from './display.js';

/** Files listed at most; a sample folder rarely has more that matter. */
const MAX_LISTED = 40;

/** Directory levels below the page that are searched. */
const MAX_DEPTH = 6;

/** Extensions of files that are code or declare an application. */
const CODE =
  /\.(?:c|cc|cpp|cs|css|dart|go|h|hpp|html?|ipynb|java|js|jsx|json|kt|kts|m|mjs|mm|py|qml|r|rb|rs|sql|swift|ts|tsx|vb|vue|xaml|xml|ya?ml)$/i;

/** Folders that hold dependencies or build output, not the sample. */
const GENERATED = /(?:^|\/)(?:node_modules|dist|build|bin|obj|out|target|\.[^/]+)\//;

/** Lock files and manifests of tools are listed in no sample's source. */
const NOISE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json)$/i;

function encoded(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * The section that lists the source files next to and below a GitHub file, shallowest
 * first. `undefined` when the page is not a file of a repository, when the folder has no
 * code, or when the repository listing cannot be had (the caller then reports that the page
 * has no such section). One API request, cached for a day by the GitHub client.
 */
export async function sourceFilesSection(
  ctx: Ctx,
  page: DocPage,
  call: CallOptions,
): Promise<DocSection | undefined> {
  const location = parseGithubUrl(page.url);
  if (location?.ref === undefined || location.path === undefined) return undefined;
  const { repo, ref, path } = location;
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

  let tree: Awaited<ReturnType<Ctx['github']['tree']>>;
  try {
    tree = await ctx.github.tree(repo, ref, {
      budget: call.budget,
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
  } catch (error) {
    ctx.logger.debug('repository listing unavailable', { repo, error });
    return undefined;
  }

  const files = tree
    .filter((file) => file.path.startsWith(folder) && file.path !== path)
    .map((file) => ({ ...file, relative: file.path.slice(folder.length) }))
    .filter(
      (file) =>
        CODE.test(file.relative) &&
        !GENERATED.test(file.relative) &&
        !NOISE.test(file.relative) &&
        file.relative.split('/').length <= MAX_DEPTH,
    )
    .sort(
      (a, b) =>
        a.relative.split('/').length - b.relative.split('/').length ||
        a.relative.localeCompare(b.relative, 'en'),
    );
  if (files.length === 0) return undefined;

  const rows = files.slice(0, MAX_LISTED).map((file) => {
    const size = file.size === undefined ? '' : ` (${file.size} bytes)`;
    return `- ${file.relative}${size}: https://github.com/${repo}/blob/${encodeURIComponent(ref)}/${encoded(file.path)}`;
  });
  const more = files.length > MAX_LISTED ? [`- ... and ${files.length - MAX_LISTED} more`] : [];
  const markdown = [
    '## Source files',
    'This page describes the sample; its code is in these files. Read one by passing its URL as `ref`.',
    [...rows, ...more].join('\n'),
  ].join('\n\n');
  return {
    id: SOURCE_SECTION_ID,
    level: 2,
    title: 'Source files',
    markdown,
    tokens: estimateTokens(markdown),
  };
}
