/**
 * Prompt `arcgis_app_kickoff`: plan a new ArcGIS app from current documentation.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import { GROUND_RULES, userMessage } from './message.js';

/** Name of the prompt. */
export const APP_KICKOFF_PROMPT = 'arcgis_app_kickoff';

const Args = z.object({
  goal: z.string().describe('What the app should do, in a sentence or two.'),
  product: z
    .string()
    .optional()
    .describe('Product id, name or package to build with, e.g. "js-maps-sdk". Omit to choose.'),
});

/** The message of the prompt for the given arguments. */
export function appKickoffMessage(args: z.output<typeof Args>): string[] {
  const { goal, product } = args;
  const scope = product === undefined ? {} : { product };
  const choose =
    product === undefined
      ? [
          `2. Choose the product: call ${formatCall(TOOLS.listProducts, { query: goal })}, pick the best fit and say why. Then call ${TOOLS.listProducts} with that product id and read its profile: documentation sources, start-here links, pitfalls.`,
        ]
      : [
          `2. Call ${formatCall(TOOLS.listProducts, { product })} and read the profile: documentation sources, start-here links, pitfalls.`,
        ];
  return [
    `I want to build this with ArcGIS: ${goal}`,
    product === undefined ? 'Product: not chosen yet.' : `Product: ${product}`,
    '',
    'Produce a plan before writing any code. Work through these steps with the documentation tools:',
    `1. Call ${formatCall(TOOLS.getVersions, scope)} to learn the current version and the version installed in this project. Plan for the installed version if there is one.`,
    ...choose,
    `3. Call ${formatCall(TOOLS.findSamples, { query: goal, ...scope })} and open the two closest samples with ${TOOLS.read} (section "source" returns only the code).`,
    `4. List every API symbol the plan depends on (classes, components, methods, REST operations) and verify each one with ${TOOLS.lookupSymbol}.`,
    '5. Propose a file plan: each file, what it contains, and for every API choice the ref that supports it. State the SDK version the plan targets and anything you could not verify.',
    '',
    GROUND_RULES,
  ];
}

/** Registers the prompt. */
export function registerAppKickoffPrompt(server: McpServer): void {
  server.registerPrompt(
    APP_KICKOFF_PROMPT,
    {
      title: 'Plan a new ArcGIS app',
      description:
        'Plans an ArcGIS app from current documentation: versions, product profile, two samples, verified API symbols and a file plan with cited refs.',
      argsSchema: Args,
    },
    (args) => userMessage(`Plan an ArcGIS app: ${args.goal}`, appKickoffMessage(args)),
  );
}
