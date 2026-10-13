/**
 * Prompt `arcgis_agentic_app_design`: design an app that combines ArcGIS with an AI agent,
 * starting from the curated `ai/*` briefs.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { BRIEF_PREFIX, TOOLS } from '../../core/names.js';
import { GROUND_RULES, userMessage } from './message.js';

/** Name of the prompt. */
export const AGENTIC_APP_DESIGN_PROMPT = 'arcgis_agentic_app_design';

const RUNTIMES = ['js-ai-components', 'mcp-location-services', 'mcp-enterprise', 'custom'] as const;
type Runtime = (typeof RUNTIMES)[number];

const Args = z.object({
  runtime: z
    .enum(RUNTIMES)
    .describe(
      'Where the agent runs: Esri AI components in a JavaScript app, the ArcGIS Location Services MCP server, the ArcGIS Enterprise MCP server, or your own agent calling ArcGIS REST APIs.',
    ),
});

/** Repository directory that holds Esri's AI component app templates (Apache-2.0). */
const AI_TEMPLATES_URL = 'https://github.com/Esri/jsapi-resources/tree/main/templates';

interface Plan {
  label: string;
  /** Brief slugs to read first, in order. */
  briefs: readonly string[];
  /** Further retrieval steps specific to the runtime. */
  steps: readonly string[];
}

const PLANS: Record<Runtime, Plan> = {
  'js-ai-components': {
    label: 'Esri AI components in an ArcGIS Maps SDK for JavaScript app',
    briefs: ['ai/overview', 'ai/js-ai-components-constraints', 'js/4x-to-5x'],
    steps: [
      `Open Esri's templates in ${AI_TEMPLATES_URL} (directories named ai-components-*): find them with ${formatCall(TOOLS.findSamples, { query: 'AI components template', product: 'js-maps-sdk' })} and read the closest one with ${TOOLS.read}.`,
      `Verify each component you plan to use with ${formatCall(TOOLS.lookupSymbol, { symbol: '<component tag>', product: 'js-maps-sdk' })}.`,
    ],
  },
  'mcp-location-services': {
    label: "an agent using Esri's ArcGIS Location Services MCP server",
    briefs: ['ai/overview', 'ai/mcp-location-services', 'auth/choosing-authentication'],
    steps: [
      `Find the current server documentation with ${formatCall(TOOLS.search, { query: 'Location Services MCP server', product: 'ai-agents' })} and read the tool list and the privileges each tool needs.`,
    ],
  },
  'mcp-enterprise': {
    label: "an agent using Esri's ArcGIS Enterprise MCP server",
    briefs: ['ai/overview', 'ai/mcp-enterprise-beta', 'rest/deployment-variants'],
    steps: [
      `Find the current server documentation with ${formatCall(TOOLS.search, { query: 'ArcGIS Enterprise MCP server', product: 'ai-agents' })} and read its tool catalogue and its release status.`,
    ],
  },
  custom: {
    label: 'your own agent calling ArcGIS REST APIs',
    briefs: ['ai/overview', 'auth/choosing-authentication', 'rest/deployment-variants'],
    steps: [
      `For each capability the agent needs, find the REST operation with ${formatCall(TOOLS.lookupSymbol, { symbol: '<operation>', product: 'rest-api' })} and note its parameters, privileges and whether it costs credits.`,
      `Check for an existing client library with ${formatCall(TOOLS.listProducts, { query: 'REST client library' })}.`,
    ],
  },
};

/** The message of the prompt for the given arguments. */
export function agenticAppDesignMessage(args: z.output<typeof Args>): string[] {
  const plan = PLANS[args.runtime];
  const steps = [
    ...plan.briefs.map(
      (slug) => `Read ${formatCall(TOOLS.read, { ref: `${BRIEF_PREFIX}${slug}` })}.`,
    ),
    ...plan.steps,
  ];
  return [
    `Design an agentic ArcGIS app: ${plan.label}.`,
    '',
    'First gather the facts, in this order:',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Then write the design. It must state:',
    '- Authentication: which kind (API key, user, app), why, and the ref that allows it for this runtime.',
    '- Organisation prerequisites: account type, licences, privileges, settings an administrator must enable.',
    '- Release status of every Esri piece used (beta, early adopter, generally available) and the risk that follows.',
    '- The data flow: what the model sees, which tools it may call, and what runs with whose credentials.',
    '- What you could not verify in the documentation.',
    '',
    GROUND_RULES,
  ];
}

/** Registers the prompt. */
export function registerAgenticAppDesignPrompt(server: McpServer): void {
  server.registerPrompt(
    AGENTIC_APP_DESIGN_PROMPT,
    {
      title: 'Design an agentic ArcGIS app',
      description:
        'Loads the curated AI briefs for the chosen runtime and asks for a design that states authentication, organisation prerequisites and beta risks.',
      argsSchema: Args,
    },
    (args) =>
      userMessage(
        `Agentic ArcGIS app design (${args.runtime})`,
        agenticAppDesignMessage(args),
      ),
  );
}
