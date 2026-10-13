/**
 * `arcgis_docs_list_products` (design section 3.2): the product list, one product's profile,
 * or one source's table of contents.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { statusLine, structuredResult } from '../envelope.js';
import {
  productRow,
  profileOf,
  renderProductList,
  renderProfile,
  renderToc,
  tocRow,
} from '../presenters/product.js';
import { CategoryFilter, cursorArg, Notes, productArg } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  'Lists Esri ArcGIS products that have developer documentation here, or describes one. With no arguments: developer products grouped by category with id, current version line and status. With `product`: its profile (what it is, packages, version lines, documentation sources with page counts, which lookups work, start-here links, known pitfalls, successor if retired). With `product` and `section`: that source\'s table of contents with refs for arcgis_docs_read. `query` or `category` filter the list; end-user product help (ArcGIS Online, Enterprise, Pro, Survey123, ...) is category "product-help". Does not return page content.';

const Input = z.object({
  product: productArg(
    'Product id, name, package or alias, e.g. "js-maps-sdk", "javascript", "@arcgis/core", "arcpy". Omit to list products.',
  ),
  section: z
    .string()
    .max(120)
    .optional()
    .describe(
      'With product: a source id from its profile (e.g. "tutorials", "portal", "tools") to get that source\'s table of contents.',
    ),
  query: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Words to filter the product list, e.g. "offline mobile", "webhooks", "3D game engine".',
    ),
  category: CategoryFilter.optional().describe(
    'Limit the list to one category. Default: all developer categories (not product-help).',
  ),
  include_legacy: z
    .boolean()
    .default(false)
    .describe('Include retired and deprecated products (shown with their successor).'),
  limit: z.number().int().min(1).max(200).default(80),
  cursor: cursorArg('Opaque cursor from a previous call.'),
});

const Row = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  status: z.enum(['active', 'beta', 'deprecated', 'retired']),
  tier: z.enum(['developer', 'help', 'link']),
  currentLine: z.string().optional(),
  summary: z.string(),
  successor: z.string().optional(),
});

const Profile = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  summary: z.string(),
  aliases: z.array(z.string()),
  languages: z.array(z.string()),
  homepage: z.string(),
  packages: z.array(z.object({ registry: z.string(), name: z.string() })),
  repos: z.array(z.object({ repo: z.string(), role: z.string(), license: z.string() })),
  lines: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      current: z.boolean(),
      access: z.enum(['live', 'link-only']),
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kinds: z.array(z.string()),
      pages: z.number().int().optional(),
      ref: z.string(),
      enabled: z.boolean(),
      health: z.enum(['ok', 'degraded', 'failing', 'unknown']),
    }),
  ),
  capabilities: z.object({
    symbols: z.boolean(),
    samples: z.boolean(),
    releaseNotes: z.boolean(),
    search: z.enum(['local', 'local+site']),
  }),
  startHere: z.array(z.object({ title: z.string(), ref: z.string() })),
  pitfalls: z.array(z.string()),
  related: z.array(z.string()),
  successor: z.string().optional(),
  licenseTier: z.string(),
  verifiedOn: z.string(),
});

const TocEntry = z.object({
  title: z.string(),
  ref: z.string().optional(),
  depth: z.number().int(),
  kind: z.string().optional(),
});

const Output = z.object({
  mode: z.enum(['list', 'profile', 'toc']),
  products: z.array(Row).optional(),
  product: Profile.optional(),
  toc: z.array(TocEntry).optional(),
  total: z.number().int(),
  nextCursor: z.string().optional(),
  notes: Notes,
});

/** One product in list mode. */
export type ProductRow = z.infer<typeof Row>;
/** One product in profile mode. */
export type ProductProfile = z.infer<typeof Profile>;
/** One table-of-contents entry. */
export type TocRow = z.infer<typeof TocEntry>;
type Result = z.infer<typeof Output>;

/** Name, texts and schemas of `arcgis_docs_list_products`. */
export const listProductsTool = {
  name: TOOLS.listProducts,
  title: 'List ArcGIS products and documentation sections',
  description: DESCRIPTION,
  inputSchema: Input,
  outputSchema: Output,
} satisfies ToolDefinition<typeof Input, typeof Output>;

const handle: ToolHandler<typeof Input> = async (args, call, { ctx, services }) => {
  const again = (extra: Record<string, unknown>): string =>
    formatCall(
      TOOLS.listProducts,
      compact({
        product: args.product,
        section: args.section,
        query: args.query,
        category: args.category,
        include_legacy: args.include_legacy ? true : undefined,
        ...extra,
      }),
    );

  if (args.product === undefined) {
    const listed = services.catalog.list({
      includeLegacy: args.include_legacy,
      limit: args.limit,
      ...compact({ query: args.query, category: args.category, cursor: args.cursor }),
    });
    const rows = listed.products.map(productRow);
    const notes: string[] = [];
    if (args.section !== undefined) notes.push('`section` needs `product`; it was ignored.');
    if (rows.length === 0) {
      notes.push(
        'No product matched. Try fewer words, category "all", or include_legacy: true for retired products.',
      );
    }
    const first = rows[0];
    const result: Result = compact({
      mode: 'list' as const,
      products: rows,
      total: listed.total,
      nextCursor: listed.nextCursor,
      notes,
    });
    return structuredResult(
      {
        status: statusLine([
          'ArcGIS products',
          `category: ${args.category ?? 'developer categories'}`,
          args.query === undefined ? undefined : `filter: "${args.query}"`,
          `${rows.length} of ${listed.total}`,
        ]),
        notes,
        body: renderProductList(rows),
        next:
          listed.nextCursor !== undefined
            ? again({ cursor: listed.nextCursor })
            : first && formatCall(TOOLS.listProducts, { product: first.id }),
        attribution: { kind: 'project' },
      },
      result,
    );
  }

  const { resolution, health } = services.catalog.profile(args.product);
  const { product } = resolution;
  const echo =
    resolution.how === 'id'
      ? `${product.name} (${product.id})`
      : `${product.name} (${product.id}), resolved from "${resolution.resolvedFrom}"`;
  // The scope form "product/source" names the section as well as the product.
  const section = args.section ?? resolution.source?.id;

  if (section !== undefined) {
    const toc = await services.catalog.toc(args.product, section, args.cursor, call);
    const rows = toc.entries.map(tocRow);
    const notes =
      rows.length === 0 ? ['This source has no table of contents yet; try again shortly.'] : [];
    const result: Result = compact({
      mode: 'toc' as const,
      toc: rows,
      total: toc.total,
      nextCursor: toc.nextCursor,
      notes,
    });
    const firstRef = rows.find((row) => row.ref !== undefined)?.ref;
    return structuredResult(
      {
        status: statusLine([echo, `section: ${section}`, `${rows.length} of ${toc.total} entries`]),
        notes,
        body: renderToc(rows),
        next:
          toc.nextCursor !== undefined
            ? again({ section, cursor: toc.nextCursor })
            : firstRef && formatCall(TOOLS.read, { ref: firstRef }),
        attribution: { kind: 'project' },
      },
      result,
    );
  }

  const profile = profileOf(product, health, ctx.policy);
  const notes = product.statusNote === undefined ? [] : [product.statusNote];
  const firstSource = profile.sources.find((source) => source.enabled);
  const result: Result = { mode: 'profile', product: profile, total: 1, notes };
  return structuredResult(
    {
      status: statusLine([echo, product.category, `status: ${product.status}`]),
      notes,
      body: renderProfile(profile),
      next:
        firstSource &&
        formatCall(TOOLS.listProducts, { product: product.id, section: firstSource.id }),
      attribution: { kind: 'project' },
    },
    result,
  );
};

/** Registers `arcgis_docs_list_products`. */
export function registerListProducts(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, listProductsTool, handle);
}
