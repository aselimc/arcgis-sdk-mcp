/**
 * Registry data: AI, agents and MCP across ArcGIS (design section 4.5, decision 27).
 *
 * `ai-agents` owns only what has no other home: this project's `ai/*` briefs, Esri's
 * documentation of its MCP server for location services, and the Location Platform page on
 * agentic AI. The JavaScript AI components stay with `js-maps-sdk`; this product points at
 * them through `related` and `startHere`.
 */
import type { Product } from '../../core/types.js';
import { D } from './builders.js';

const MCP_DOCS = `${D}/ai/mcp-arcgis-location-services/`;
const AGENTIC_AI_HELP = 'https://location.arcgis.com/help/agentic-ai/';

const aiAgents: Product = {
  id: 'ai-agents',
  name: 'AI, agents and MCP across ArcGIS',
  // `ai-components` and `arcgis-assistant` are aliases of `js-maps-sdk`; the router adds this
  // product as a second candidate for queries that contain them.
  aliases: ['mcp', 'mcp-location-services', 'agentic-ai', 'esri-mcp'],
  category: 'ai',
  tier: 'developer',
  status: 'beta',
  statusNote: 'Most of this surface is beta or early adopter; check the status of each item.',
  summary:
    "Map of Esri's AI surface for developers: AI components in web apps, Esri's MCP servers, agent access to location services and AI-assisted coding.",
  keywords: [
    'ai',
    'agent',
    'agentic',
    'mcp',
    'model context protocol',
    'llm',
    'assistant',
    'ai components',
    'embeddings',
    'tool calling',
    'copilot',
  ],
  languages: ['javascript', 'typescript', 'python'],
  homepage: MCP_DOCS,
  packages: [],
  repos: [
    // The `templates/ai-components-*` directories are read through `js-maps-sdk/templates`.
    {
      repo: 'Esri/jsapi-resources',
      role: 'templates',
      license: 'apache-2.0',
      defaultBranch: 'main',
    },
  ],
  lines: [{ id: 'latest', label: 'Current', current: true, access: 'live', vars: {} }],
  sources: [
    {
      id: 'briefs',
      title: 'Curated briefs on AI and agents',
      kinds: ['brief'],
      adapter: 'brief',
      config: { slugs: ['ai/*'] },
      license: 'project',
      floor: true,
      pagesApprox: 4,
      // Briefs are bundled, so the adapter's probe checks the embedded text and requests
      // nothing. A probe needs an https URL: this is the page the briefs start from.
      probe: { url: MCP_DOCS, expect: 'text', minChars: 200 },
    },
    {
      // Absent from the global sitemap index and from the site search; its own sitemap exists.
      id: 'mcp-location-services',
      title: 'MCP for ArcGIS Location Services (Esri documentation)',
      kinds: ['guide', 'release-notes'],
      adapter: 'astro',
      config: {
        base: '/ai/mcp-arcgis-location-services/',
        sitemap: 'sitemap-0.xml',
        searchIndexes: [{ url: '__starship-mdx/search/mdxPages.json', role: 'guide' }],
        // A placeholder URL that the sitemap lists.
        exclude: ['^old/path/url/'],
        classify: [['^release-notes/', 'release-notes']],
      },
      capability: 'website',
      pagesApprox: 15,
      probe: { url: `${MCP_DOCS}sitemap-0.xml`, expect: 'xml', minRecords: 7, family: 'astro' },
    },
    {
      id: 'location-platform-agentic',
      title: 'Agentic AI with ArcGIS Location Platform',
      kinds: ['guide'],
      adapter: 'static',
      config: {
        entries: [
          {
            url: AGENTIC_AI_HELP,
            title: 'Agentic AI with ArcGIS Location Platform',
            kind: 'guide',
          },
        ],
      },
      capability: 'website',
      pagesApprox: 1,
      probe: { url: AGENTIC_AI_HELP, expect: 'html', family: 'gatsby', minChars: 500 },
    },
  ],
  oracles: [],
  startHere: [
    { title: "Overview of Esri's AI surface", ref: 'brief:ai/overview' },
    { title: 'MCP for ArcGIS Location Services', ref: MCP_DOCS },
    {
      title: 'Agentic apps (Maps SDK for JavaScript)',
      // The section has no index page: its first page is the entry.
      ref: `${D}/javascript/latest/agentic-apps/ai-introduction/`,
    },
    {
      title: 'AI-assisted development (Maps SDK for JavaScript)',
      ref: `${D}/javascript/latest/ai-assisted-development/`,
    },
  ],
  pitfalls: [
    'The JavaScript AI components need named ArcGIS Online users: no API keys and no ArcGIS Enterprise. Read brief:ai/js-ai-components-constraints before designing.',
    'Esri has two MCP servers with different status and access: location services (documented here) and an ArcGIS Enterprise early adopter programme (brief:ai/mcp-enterprise-beta).',
    'Package names and contracts in this area change between releases: verify every symbol with arcgis_docs_lookup_symbol.',
  ],
  related: ['js-maps-sdk', 'python-api', 'arcgis-pro-sdk', 'experience-builder'],
  licenseTier: 'esri-website-terms',
  verifiedOn: '2026-10-13',
};

/** The AI product (design section 4.5), one id. */
export const aiProducts: readonly Product[] = [aiAgents];
