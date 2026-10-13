/**
 * Resource template `arcgis-docs://brief/{+slug}`: the curated briefs, this project's own
 * short guides that link every claim to its Esri page.
 */
import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import { BRIEF_PREFIX, RESOURCE_SCHEME } from '../../core/names.js';
import { STATIC_RESOURCE_CACHE } from '../annotations.js';
import type { McpContainer } from '../container.js';

const BRIEF_URI_PREFIX = `${RESOURCE_SCHEME}://brief/`;

/** URI template of the brief resource; `{+slug}` keeps the slashes of `ai/overview`. */
export const BRIEF_URI_TEMPLATE = `${BRIEF_URI_PREFIX}{+slug}`;

/** The resource URI of one brief. */
export function briefUri(slug: string): string {
  return `${BRIEF_URI_PREFIX}${slug}`;
}

/** Registers the brief resources. Briefs are embedded in the registry: no I/O. */
export function registerBriefResource(server: McpServer, { ctx }: McpContainer): void {
  const template = new ResourceTemplate(BRIEF_URI_TEMPLATE, {
    list: () => ({
      resources: ctx.registry.briefs().map((brief) => ({
        uri: briefUri(brief.slug),
        name: `${BRIEF_PREFIX}${brief.slug}`,
        title: brief.title,
        description: `Curated brief, verified on ${brief.verifiedOn}.`,
        mimeType: 'text/markdown',
      })),
    }),
    complete: {
      slug: (value) =>
        ctx.registry
          .briefs()
          .map((brief) => brief.slug)
          .filter((slug) => slug.startsWith(value.toLowerCase())),
    },
  });
  server.registerResource(
    'brief',
    template,
    {
      title: 'Curated ArcGIS brief',
      description:
        'A short orientation written by this project (not Esri text), with links to the Esri pages each statement rests on. The same content as arcgis_docs_read with ref "brief:<slug>".',
      mimeType: 'text/markdown',
      cacheHint: STATIC_RESOURCE_CACHE,
    },
    (uri, variables) => {
      const slug = decodeURIComponent([variables.slug].flat().join('/'))
        .split('/')
        .filter((segment) => segment.length > 0)
        .join('/');
      const brief = ctx.registry.briefs().find((candidate) => candidate.slug === slug);
      if (brief === undefined) {
        throw new ResourceNotFoundError(uri.href, `Unknown brief "${slug}"`);
      }
      const sources = brief.sources.map((source) => `- ${source}`);
      const text = [
        brief.markdown.trim(),
        '',
        `Verified on ${brief.verifiedOn}.${sources.length > 0 ? ' Sources:' : ''}`,
        ...sources,
      ].join('\n');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );
}
