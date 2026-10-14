/**
 * `arcgis_docs_find_samples`: runnable samples, optionally with the
 * main source file of the best hit.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { attribution } from '../../core/attribution.js';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import type { SampleHit, SamplesResponse } from '../../core/ports.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { type Attribution, bodyBudget, statusLine, structuredResult } from '../envelope.js';
import { countField, maxTokensArg, Notes, productArg, rankField } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  'Finds runnable ArcGIS samples and templates and returns title, ref, product, platform, language, a one-line summary, the APIs each sample demonstrates when known, and the list of source files. Sources are Esri\'s sample pages and Esri\'s Apache-2.0 sample repositories on GitHub (pinned to the release tag where tags are reliable). `uses_api` finds samples that demonstrate a given class or method; `platform` narrows multi-platform SDKs ("maui", "wpf", "winui"); `with_code: true` also returns the main source file of the best hit, within `max_tokens`. Open any hit with arcgis_docs_read (section "source" for code only). Does not return conceptual guides or tutorials: use arcgis_docs_search for those.';

const Input = z.object({
  query: z
    .string()
    .min(2)
    .max(300)
    .describe(
      'The task the sample should show, e.g. "offline map download", "3D tiles layer", "custom agent with tools".',
    ),
  product: productArg('Product id, name or package. Omit to use the SDKs detected in the project.'),
  uses_api: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Class, method or component the sample must use, e.g. "OGC3DTilesLayer", "FeatureLayer.applyEdits".',
    ),
  platform: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Platform or framework variant when the product has several, e.g. "maui", "wpf", "winui", "react".',
    ),
  with_code: z
    .boolean()
    .default(false)
    .describe('Also return the main source file of the top hit.'),
  limit: z.number().int().min(1).max(10).default(5).describe('Number of hits.'),
  max_tokens: maxTokensArg(500, 4000),
});

const Sample = z.object({
  rank: rankField(),
  title: z.string(),
  ref: z.string(),
  product: z.string(),
  platform: z.string().optional(),
  language: z.string(),
  summary: z.string(),
  relevantApis: z.array(z.string()).optional(),
  category: z.string().optional(),
  files: z
    .array(z.object({ name: z.string(), ref: z.string(), bytes: countField().optional() }))
    .optional(),
  origin: z.enum(['esri-site', 'github']),
  license: z.string(),
  apiConfirmed: z.boolean().optional(),
  legacyPattern: z.boolean().optional(),
});

const Output = z.object({
  scope: z.object({
    product: z.string(),
    line: z.string(),
    platform: z.string().optional(),
    pinnedTo: z.string().optional(),
  }),
  total: countField(),
  results: z.array(Sample),
  code: z
    .object({
      ref: z.string(),
      file: z.string(),
      language: z.string(),
      text: z.string(),
      truncated: z.boolean(),
    })
    .optional(),
  notes: Notes,
});

type Result = z.infer<typeof Output>;
type ResultSample = z.infer<typeof Sample>;

/** Name, texts and schemas of `arcgis_docs_find_samples`. */
export const findSamplesTool = {
  name: TOOLS.findSamples,
  title: 'Find ArcGIS samples',
  description: DESCRIPTION,
  inputSchema: Input,
  outputSchema: Output,
} satisfies ToolDefinition<typeof Input, typeof Output>;

/**
 * @param fallbackLanguage the main language of the sample's product, for sample pages whose
 *   index does not state a language (every sample of a single-language SDK is in it).
 */
function resultSample(
  hit: SampleHit,
  rank: number,
  fallbackLanguage: string | undefined,
): ResultSample {
  const { record } = hit;
  return compact({
    rank,
    title: record.title,
    ref: record.ref,
    product: record.product,
    platform: record.platform,
    language: record.language ?? fallbackLanguage ?? 'unknown',
    summary: hit.summary,
    relevantApis: hit.relevantApis,
    category: record.breadcrumb,
    files: hit.files?.map((file) => compact({ ...file })),
    origin: hit.origin,
    license: record.license,
    apiConfirmed: hit.apiConfirmed,
    legacyPattern: hit.legacyPattern,
  });
}

function renderSample(sample: ResultSample): string {
  const platform = sample.platform === undefined ? '' : `, ${sample.platform}`;
  const flags = [
    sample.apiConfirmed === false ? 'API use not confirmed' : undefined,
    sample.legacyPattern ? 'uses a legacy pattern' : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return [
    `${sample.rank}. ${sample.title} [${sample.product}${platform}, ${sample.language}, ${sample.origin}, ${sample.license}]`,
    `   ${sample.ref}`,
    `   ${sample.summary.replace(/\s+/g, ' ').trim()}`,
    sample.category === undefined ? undefined : `   In: ${sample.category}`,
    sample.relevantApis === undefined || sample.relevantApis.length === 0
      ? undefined
      : `   APIs: ${sample.relevantApis.join(', ')}`,
    ...(sample.files ?? []).map((file) => `   File: ${file.name} ${file.ref}`),
    flags.length === 0 ? undefined : `   Note: ${flags.join('; ')}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

function renderCode(code: NonNullable<SamplesResponse['code']>): string {
  // A fence longer than any run of backticks in the file keeps the block intact.
  const longest = Math.max(2, ...[...code.text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return [
    `Main source file of the top hit: ${code.file} (${code.ref})${code.truncated ? ', truncated to fit max_tokens' : ''}`,
    `${fence}${code.language}`,
    code.text.replace(/\n+$/, ''),
    fence,
  ].join('\n');
}

const handle: ToolHandler<typeof Input> = async (args, call, { ctx, services }) => {
  const response = await services.samples.find(
    compact({
      query: args.query,
      product: args.product,
      usesApi: args.uses_api,
      platform: args.platform,
      withCode: args.with_code,
      limit: args.limit,
      maxTokens: bodyBudget(args.max_tokens),
    }),
    call,
  );
  const results = response.hits.map((hit, index) =>
    resultSample(hit, index + 1, ctx.registry.get(hit.record.product)?.languages[0]),
  );
  const result: Result = compact({
    scope: compact({ ...response.scope }),
    total: response.total,
    results,
    code: response.code,
    notes: response.notes,
  });
  const top = results[0];
  const topLicense = response.hits[0]?.record.license;
  const { scope, code } = response;
  // Returned code is content of one document, so it carries that document's own notice.
  const source: Attribution =
    code !== undefined && topLicense !== undefined
      ? {
          kind: 'page',
          line: attribution(topLicense, {
            url: code.ref,
            retrievedAt: ctx.clock.iso(),
            cache: 'miss',
          }),
        }
      : {
          kind: 'listing',
          licenses: response.hits.map((hit) => hit.record.license),
          retrievedOn: ctx.clock.iso(),
        };
  let next: string | undefined;
  if (top === undefined) {
    next = formatCall(TOOLS.search, compact({ query: args.query, product: args.product }));
  } else if (code === undefined) {
    next = formatCall(TOOLS.read, { ref: top.ref, section: 'source' });
  } else if (code.truncated) {
    next = formatCall(TOOLS.read, { ref: code.ref, view: 'full' });
  } else {
    next = formatCall(TOOLS.read, { ref: top.ref });
  }
  return structuredResult(
    {
      status: statusLine([
        `Samples for "${args.query}"`,
        `product: ${scope.product}`,
        `line: ${scope.line}`,
        scope.platform === undefined ? undefined : `platform: ${scope.platform}`,
        scope.pinnedTo === undefined ? undefined : `pinned to ${scope.pinnedTo}`,
        args.uses_api === undefined ? undefined : `uses: ${args.uses_api}`,
        `${results.length} of ${response.total}`,
      ]),
      notes: response.notes,
      body: [results.map(renderSample).join('\n'), code === undefined ? '' : renderCode(code)]
        .filter((block) => block.length > 0)
        .join('\n\n'),
      next,
      attribution: source,
    },
    result,
  );
};

/** Registers `arcgis_docs_find_samples`. */
export function registerFindSamples(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, findSamplesTool, handle);
}
