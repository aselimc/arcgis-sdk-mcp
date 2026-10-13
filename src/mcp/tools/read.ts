/**
 * `arcgis_docs_read` (design section 3.5): one document as budgeted Markdown. Text only;
 * the facts a host may want without parsing the text travel in the result `_meta`.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { RESOURCE_SCHEME, TOOLS } from '../../core/names.js';
import { LARGE_RESULT_META } from '../annotations.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { bodyBudget, textResult } from '../envelope.js';
import { pageNotes, pageProduct, pageStatus, pageVersion } from '../presenters/page.js';
import { cursorArg, maxTokensArg } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  'Reads one documentation page, API reference page, sample, release-notes page, GitHub file or curated brief and returns clean Markdown with code fences and absolute links. `ref` is a URL from another tool or any URL on Esri\'s documentation hosts; a "#fragment" selects that section. By default (`view: "auto"`) a document that fits `max_tokens` is returned whole; a larger one returns its opening section plus an outline listing every section id with its size, so the next call can ask for one `section`. `view: "outline"` returns only the outline; `view: "full"` pages through the whole document with `cursor`. On API pages `section` may be a member name; on samples `section: "source"` returns only the code. States the product, version and retrieval date. Does not search: use arcgis_docs_search or arcgis_docs_lookup_symbol to find a ref.';

/** Default of `max_tokens` in the published schema (design section 3.5). */
const DEFAULT_MAX_TOKENS = 6000;

const Input = z.object({
  ref: z
    .string()
    .min(3)
    .max(600)
    .describe(
      'Doc URL (or brief:<slug>) returned by another tool, or any URL on an Esri documentation host. May include "#section".',
    ),
  section: z
    .string()
    .max(200)
    .optional()
    .describe(
      'One part of the document: a section id or heading text from the outline, a member name on an API page, or "source" on a sample.',
    ),
  view: z
    .enum(['auto', 'outline', 'full'])
    .default('auto')
    .describe(
      'auto: whole doc if it fits, else opening + outline. outline: structure only. full: sequential pages via cursor.',
    ),
  max_tokens: maxTokensArg(500, DEFAULT_MAX_TOKENS),
  cursor: cursorArg('Opaque cursor from a truncated response to continue it.'),
});

/** Prefix of the `_meta` keys of a read result: `arcgis-docs/ref`, `arcgis-docs/product`, ... */
export const READ_META_PREFIX = `${RESOURCE_SCHEME}/`;

/** Name, texts and schema of `arcgis_docs_read`. */
export const readTool = {
  name: TOOLS.read,
  title: 'Read an ArcGIS documentation page',
  description: DESCRIPTION,
  inputSchema: Input,
  meta: LARGE_RESULT_META,
} satisfies ToolDefinition<typeof Input>;

const handle: ToolHandler<typeof Input> = async (args, call, container) => {
  // The schema is the same in every configuration, so its default cannot follow
  // ARCGIS_DOCS_MAX_TOKENS: a call at the schema default takes the configured size instead.
  const defaulted = args.max_tokens === DEFAULT_MAX_TOKENS;
  const maxTokens = defaulted ? container.ctx.config.defaultMaxTokens : args.max_tokens;
  const response = await container.services.docs.read(
    compact({
      ref: args.ref,
      section: args.section,
      view: args.view,
      maxTokens: bodyBudget(maxTokens),
      callerMaxTokens: defaulted ? undefined : args.max_tokens,
      cursor: args.cursor,
    }),
    call,
  );
  const { page } = response;
  const version = await pageVersion(page, container);
  // A truncated response must end with the call that returns the rest (design section 3.1).
  const next =
    response.next ??
    (response.nextCursor === undefined
      ? undefined
      : formatCall(
          TOOLS.read,
          compact({
            ref: args.ref,
            section: args.section,
            view: args.view === 'auto' ? undefined : args.view,
            max_tokens: defaulted ? undefined : args.max_tokens,
            cursor: response.nextCursor,
          }),
        ));
  return textResult(
    {
      status: pageStatus(page.title, page, pageProduct(page, container), version),
      notes: pageNotes(page),
      body: response.text,
      next,
      attribution: { kind: 'page', line: page.attribution },
    },
    compact({
      [`${READ_META_PREFIX}ref`]: page.ref,
      [`${READ_META_PREFIX}product`]: page.product,
      [`${READ_META_PREFIX}kind`]: page.kind,
      [`${READ_META_PREFIX}version`]: version,
      [`${READ_META_PREFIX}truncated`]: response.truncated,
      [`${READ_META_PREFIX}nextCursor`]: response.nextCursor,
    }),
  );
};

/** Registers `arcgis_docs_read`. */
export function registerRead(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, readTool, handle);
}
