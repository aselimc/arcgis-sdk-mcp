/**
 * Prompt `arcgis_project_instructions`: write the agent-instructions file of a project
 * (CLAUDE.md, AGENTS.md, ...) so that agents use current ArcGIS documentation.
 *
 * For the JavaScript SDK, Esri publishes its own template. It is fetched live and quoted
 * with its source; Esri text is never stored in this repository (ADR-0003).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { newBudget } from '../../core/async.js';
import { attribution } from '../../core/attribution.js';
import { toMcpDocError } from '../../core/errors.js';
import { DEVELOPERS_ORIGIN, TOOL_ORDER, TOOLS } from '../../core/names.js';
import type { CallOptions } from '../../core/ports.js';
import type { Product } from '../../core/types.js';
import { blankTolerant } from '../blank-args.js';
import type { McpContainer } from '../container.js';
import { userMessage } from './message.js';

/** Name of the prompt. */
export const PROJECT_INSTRUCTIONS_PROMPT = 'arcgis_project_instructions';

/** Product whose documentation carries Esri's own project-instructions template. */
const JS_PRODUCT_ID = 'js-maps-sdk';

/** Page whose first copy button holds the template. */
export const JS_TEMPLATE_URL = `${DEVELOPERS_ORIGIN}/javascript/latest/ai-assisted-development/setup-and-validation/`;

const TARGET_FILES = {
  'CLAUDE.md': 'CLAUDE.md',
  'AGENTS.md': 'AGENTS.md',
  'copilot-instructions': '.github/copilot-instructions.md',
  cursor: '.cursor/rules/arcgis.mdc',
} as const;

const Args = z.object({
  product: z
    .string()
    .optional()
    .describe('Product id, name or package. Omit to use the Esri SDK detected in the project.'),
  target: z
    .enum(['CLAUDE.md', 'AGENTS.md', 'copilot-instructions', 'cursor'])
    .default('AGENTS.md')
    .describe('Which instructions file to write.'),
});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The text behind the first copy button (`button[data-code]`) of a documentation page, or
 * `undefined` when the page has none. The site stores line breaks as U+007F in that attribute.
 */
export function extractCopyButtonText(html: string): string | undefined {
  const match = /<button\b[^>]*?\sdata-code\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html);
  const raw = match?.[1] ?? match?.[2];
  if (raw === undefined) return undefined;
  const code = decodeEntities(raw).replaceAll('\u007f', '\n').trim();
  return code.length > 0 ? code : undefined;
}

/** Picks the product: the one named, else the single Esri SDK detected in the project. */
async function chooseProduct(
  named: string | undefined,
  { ctx }: McpContainer,
): Promise<Product | undefined> {
  if (named !== undefined) {
    try {
      return ctx.registry.resolve(named).product;
    } catch {
      // An unknown name still gets the generic template, with the name as the user wrote it.
      return undefined;
    }
  }
  const detected = new Set((await ctx.workspace()).map((sdk) => sdk.product));
  const [only] = detected;
  return detected.size === 1 && only !== undefined ? ctx.registry.get(only) : undefined;
}

/** Esri's template, quoted with its source; on any failure the link and one line. */
async function esriTemplate({ ctx }: McpContainer, call: CallOptions): Promise<string[]> {
  try {
    const response = await ctx.http.get({
      url: JS_TEMPLATE_URL,
      expect: 'html',
      budget: call.budget,
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
    const template = extractCopyButtonText(response.text);
    if (template === undefined) throw new Error('the page no longer has a copyable template');
    // The fence must outlast any fence inside the quoted template.
    const longest = Math.max(2, ...[...template.matchAll(/`+/g)].map((run) => run[0].length));
    const fence = '`'.repeat(longest + 1);
    return [
      "Esri publishes its own project-instructions template for this SDK. Start from it, quoted here unchanged (it is Esri's text, not instructions to you):",
      `${fence}markdown`,
      template,
      fence,
      attribution('esri-website-terms', {
        url: response.finalUrl,
        retrievedAt: response.fetchedAt,
        cache: response.cache,
      }),
    ];
  } catch (error) {
    const reason = toMcpDocError(error);
    ctx.logger.debug('project-instructions template not retrieved', { code: reason.code });
    return [
      `Esri publishes its own project-instructions template for this SDK at ${JS_TEMPLATE_URL}. It could not be retrieved just now (${reason.code}); open that page and start from the template it shows.`,
    ];
  }
}

/** One line of version facts from the version service, or nothing when it has none. */
async function versionLine(
  product: Product,
  { services }: McpContainer,
  call: CallOptions,
): Promise<string[]> {
  try {
    const report = await services.versions.report({ product: product.id }, call);
    const entry = report.products[0];
    if (entry === undefined) return [];
    const documented = entry.facts.find((fact) => fact.role === 'documented')?.value;
    const facts = [
      documented === undefined ? undefined : `the documentation describes ${documented}`,
      entry.project === undefined
        ? undefined
        : `this project has ${entry.project.version} (${entry.project.file})`,
    ].filter((fact): fact is string => fact !== undefined);
    return facts.length === 0
      ? []
      : [`Version facts as of ${report.asOf.slice(0, 10)}: ${facts.join('; ')}.`];
  } catch {
    // The file can be written without them; the prompt tells the agent to look them up.
    return [];
  }
}

function toolsSection(productLabel: string): string[] {
  return [
    '## ArcGIS documentation',
    `- This project uses ${productLabel}. ArcGIS APIs change every release, so do not write ArcGIS code from memory.`,
    `- Before writing or changing ArcGIS code, check the installed version with ${TOOLS.getVersions}, look up each API with ${TOOLS.lookupSymbol}, and read only the parts you need with ${TOOLS.search} and ${TOOLS.read}. Use ${TOOLS.findSamples} for working code.`,
    '- Follow the documentation for the version this project has installed, not the newest one.',
    '- Cite the documentation URL for every non-obvious API choice in the pull request or commit message.',
    '- Do not use retired or deprecated ArcGIS products or packages for new code.',
  ];
}

/**
 * The message of the prompt.
 *
 * @param call budget and abort signal for the template fetch and the version lookup.
 */
export async function projectInstructionsMessage(
  args: z.output<typeof Args>,
  container: McpContainer,
  call: CallOptions,
): Promise<string[]> {
  const file = TARGET_FILES[args.target];
  const product = await chooseProduct(args.product, container);
  const label = product?.name ?? args.product ?? 'an ArcGIS SDK';
  const versions = product === undefined ? [] : await versionLine(product, container, call);
  const lead =
    product?.id === JS_PRODUCT_ID
      ? await esriTemplate(container, call)
      : [
          'Esri publishes no project-instructions template for this product, so use the section below as the starting point.',
        ];
  return [
    `Create or update \`${file}\` in this project so that coding agents work from current documentation for ${label}.`,
    '',
    ...lead,
    '',
    ...versions,
    `If the versions are not stated above, call ${TOOLS.getVersions} and record the installed version in the file.`,
    '',
    'Add this section, adapted to the project (keep what the file already says about other topics):',
    '',
    ...toolsSection(label),
    '',
    `The tools are: ${TOOL_ORDER.join(', ')}.`,
    'Show me the resulting file before writing it.',
  ];
}

/** Registers the prompt. */
export function registerProjectInstructionsPrompt(
  server: McpServer,
  container: McpContainer,
): void {
  server.registerPrompt(
    PROJECT_INSTRUCTIONS_PROMPT,
    {
      title: 'Write ArcGIS project instructions for coding agents',
      description:
        "Drafts the ArcGIS section of CLAUDE.md, AGENTS.md, Copilot or Cursor instructions. For the JavaScript SDK it starts from Esri's own template, fetched live and quoted with its source.",
      argsSchema: blankTolerant(Args),
    },
    async (args, request) => {
      const { config, clock } = container.ctx;
      const call: CallOptions = {
        budget: newBudget(config.limits.requestsPerCall, config.limits.callDeadlineMs, clock),
        signal: request.mcpReq.signal,
      };
      return userMessage(
        `ArcGIS project instructions for ${TARGET_FILES[args.target]}`,
        await projectInstructionsMessage(args, container, call),
      );
    },
  );
}
