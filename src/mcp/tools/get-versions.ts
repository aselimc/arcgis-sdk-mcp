/**
 * `arcgis_docs_get_versions` (design section 3.3): version facts and release-notes refs.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { statusLine, structuredResult } from '../envelope.js';
import { renderVersionsProduct, versionsProduct } from '../presenters/versions.js';
import { Notes, productArg, versionArg } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  "Reports version facts for an ArcGIS product: the current released version and date, the version installed in the current project when it can be detected, pre-release tags, the documentation lines available, install coordinates, Esri's published compatibility pairings (for example JavaScript SDK with ArcGIS Enterprise, Calcite and Arcade), deprecation notices, and refs to the release notes and breaking-changes pages. With `version`, reports on that version. With no arguments, reports every Esri SDK detected in the project. Returns facts and refs, not release-note text.";

const Input = z.object({
  product: productArg(
    'Product id, name or package. Omit to report every Esri SDK detected in the current project.',
  ),
  version: versionArg('A specific version to check, e.g. "4.33", "200.8", "3.6", "11.5", "2.4.3".'),
});

const ProductVersions = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  documented: z
    .object({ version: z.string(), released: z.string().optional(), source: z.string() })
    .optional(),
  installable: z.array(
    z.object({
      registry: z.string(),
      package: z.string(),
      version: z.string(),
      tag: z.string().optional(),
      published: z.string().optional(),
      source: z.string(),
    }),
  ),
  project: z
    .object({ version: z.string(), file: z.string(), behind: z.string().optional() })
    .optional(),
  prerelease: z.array(z.object({ tag: z.string(), version: z.string() })),
  lines: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      docsUrl: z.string(),
      access: z.enum(['live', 'link-only']),
      symbols: z.enum(['live', 'npm-any-version', 'none']),
    }),
  ),
  install: z.array(z.string()),
  compatibility: z.array(
    z.object({
      with: z.string(),
      value: z.string(),
      unreleased: z.boolean(),
      source: z.string(),
    }),
  ),
  lifecycle: z
    .object({
      ga: z.string().optional(),
      mature: z.string().optional(),
      retirement: z.string().optional(),
      source: z.string(),
    })
    .optional(),
  releaseNotes: z.array(z.object({ version: z.string(), ref: z.string() })),
  notices: z.array(z.string()),
  mismatches: z.array(z.string()),
});

const Output = z.object({
  asOf: z.string(),
  products: z.array(ProductVersions),
  notes: Notes,
});

/** Version facts of one product, as returned in `structuredContent`. */
export type VersionsProduct = z.infer<typeof ProductVersions>;
type Result = z.infer<typeof Output>;

/** Name, texts and schemas of `arcgis_docs_get_versions`. */
export const getVersionsTool = {
  name: TOOLS.getVersions,
  title: 'Get ArcGIS product versions and compatibility',
  description: DESCRIPTION,
  inputSchema: Input,
  outputSchema: Output,
} satisfies ToolDefinition<typeof Input, typeof Output>;

const handle: ToolHandler<typeof Input> = async (args, call, { services }) => {
  const report = await services.versions.report(
    compact({ product: args.product, version: args.version }),
    call,
  );
  const products = report.products.map(versionsProduct);
  const notes = [...report.notes];
  if (products.length === 0 && args.product === undefined) {
    notes.push(
      'No Esri SDK was detected in the current project. Pass `product` to report on one.',
    );
  }
  const result: Result = { asOf: report.asOf, products, notes };
  const firstNotes = products.flatMap((product) => product.releaseNotes)[0];
  return structuredResult(
    {
      status: statusLine([
        `Versions as of ${report.asOf.slice(0, 10)}`,
        args.version === undefined ? undefined : `checked version: ${args.version}`,
        products.length === 0
          ? 'no product'
          : products.map((product) => product.id).join(', '),
      ]),
      notes,
      body: products.map(renderVersionsProduct).join('\n\n'),
      next:
        firstNotes === undefined
          ? products.length === 0
            ? formatCall(TOOLS.listProducts, {})
            : undefined
          : formatCall(TOOLS.read, { ref: firstNotes.ref }),
      attribution: {
        kind: 'listing',
        licenses: report.products.map((entry) => entry.product.licenseTier),
        retrievedOn: report.asOf,
      },
    },
    result,
  );
};

/** Registers `arcgis_docs_get_versions`. */
export function registerGetVersions(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, getVersionsTool, handle);
}
