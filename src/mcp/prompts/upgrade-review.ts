/**
 * Prompt `arcgis_upgrade_review`: review a project for an upgrade between two SDK versions.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import { GROUND_RULES, userMessage } from './message.js';

/** Name of the prompt. */
export const UPGRADE_REVIEW_PROMPT = 'arcgis_upgrade_review';

const Args = z.object({
  product: z.string().describe('Product id, name or package, e.g. "js-maps-sdk", "@arcgis/core".'),
  from_version: z.string().describe('The version the project uses now, e.g. "4.31".'),
  to_version: z.string().describe('The version to upgrade to, e.g. "5.1".'),
});

/** The message of the prompt for the given arguments. */
export function upgradeReviewMessage(args: z.output<typeof Args>): string[] {
  const { product, from_version: from, to_version: to } = args;
  return [
    `Review this project for an upgrade of ${product} from ${from} to ${to}.`,
    '',
    'Steps:',
    `1. Call ${formatCall(TOOLS.getVersions, { product, version: to })} to confirm that ${to} exists, see its compatibility pairings and get the release-notes refs. Compare with ${formatCall(TOOLS.getVersions, { product })} for what the project has installed.`,
    `2. Read the release notes and the breaking-changes or migration pages of every version after ${from} up to and including ${to} with ${TOOLS.read}. If a version is missing from the refs, find it with ${formatCall(TOOLS.search, { query: `release notes ${to}`, product, kind: 'release-notes' })}.`,
    '3. From those pages, list each removed, renamed, deprecated or behaviour-changed API with the ref that states it.',
    '4. Search the project (grep) for every affected symbol, import path and package name. Report file and line for each use.',
    `5. For each affected use, verify the replacement with ${formatCall(TOOLS.lookupSymbol, { symbol: '<name>', product, version: to })} before proposing a change.`,
    '6. Report: a table of change, where it occurs in the project, the fix and the supporting ref; then changes that need a decision; then what could not be verified.',
    '',
    'Do not edit files until the report has been reviewed.',
    '',
    GROUND_RULES,
  ];
}

/** Registers the prompt. */
export function registerUpgradeReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    UPGRADE_REVIEW_PROMPT,
    {
      title: 'Review an ArcGIS SDK upgrade',
      description:
        'Reads the release notes and breaking changes between two versions, finds the affected symbols in the project and verifies each replacement.',
      argsSchema: Args,
    },
    (args) =>
      userMessage(
        `Upgrade review: ${args.product} ${args.from_version} to ${args.to_version}`,
        upgradeReviewMessage(args),
      ),
  );
}
