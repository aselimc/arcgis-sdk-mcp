import { describe, expect, it } from 'vitest';

import { estimateTokens } from '../../../src/core/budget.js';
import { BRIEF_PREFIX, TOOL_ORDER } from '../../../src/core/names.js';
import { BRIEFS } from '../../../src/registry/data/briefs.generated.js';
import { HOSTS } from '../../../src/registry/hosts.js';

/** The ten briefs of design section 3.8. */
const EXPECTED_SLUGS = [
  'ai/js-ai-components-constraints',
  'ai/mcp-enterprise-beta',
  'ai/mcp-location-services',
  'ai/overview',
  'auth/choosing-authentication',
  'js/4x-to-5x',
  'legacy/do-not-use',
  'native/200-vs-300',
  'products/which-sdk',
  'rest/deployment-variants',
];

/** The day of the test run: a brief cannot have been verified in the future. */
const TODAY = new Date().toISOString().slice(0, 10);

/** GitHub accounts whose repositories the server reads (invariant INV-2). */
const GITHUB_OWNERS = ['Esri', 'R-ArcGIS', 'koopjs'];

/**
 * Hosts a brief may point at although the server never reads them, with the one brief that
 * needs each: the sign-up page and the sandbox documentation of the Enterprise MCP beta.
 */
const POINTER_ONLY: Record<string, string> = {
  'earlyadopter.esri.com': 'ai/mcp-enterprise-beta',
  'mcpbeta.webgistesting.net': 'ai/mcp-enterprise-beta',
};

/** Whether the server itself could read the URL: an allow-listed host and path. */
function isReadable(raw: string): boolean {
  const url = new URL(raw);
  if (url.protocol !== 'https:') return false;
  if (url.host === 'github.com') {
    return GITHUB_OWNERS.includes(url.pathname.split('/')[1] ?? '');
  }
  const policy = HOSTS.find((candidate) => candidate.host === url.host);
  if (policy === undefined || policy.capability === null) return false;
  return (
    policy.allowPaths === undefined ||
    policy.allowPaths.some((pattern) => new RegExp(pattern).test(url.pathname))
  );
}

/** Link targets of inline links and autolinks, outside code spans. */
function linksOf(markdown: string): string[] {
  const prose = markdown.replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\]\(([^)\s]+)\)|<(https?:[^>\s]+)>/g)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
}

describe('curated briefs', () => {
  it('are exactly the ten briefs of the design, ordered by slug', () => {
    expect(BRIEFS.map((brief) => brief.slug)).toEqual(EXPECTED_SLUGS);
  });

  it('have unique titles', () => {
    expect(new Set(BRIEFS.map((brief) => brief.title)).size).toBe(BRIEFS.length);
  });

  describe.each(BRIEFS.map((brief) => [brief.slug, brief] as const))('%s', (slug, brief) => {
    it('has complete front matter', () => {
      expect(brief.title.trim()).toBe(brief.title);
      expect(brief.title.length).toBeGreaterThan(10);
      expect(brief.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${brief.verifiedOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
        brief.verifiedOn,
      );
      expect(brief.verifiedOn <= TODAY).toBe(true);
      expect(brief.sources.length).toBeGreaterThanOrEqual(3);
      expect(new Set(brief.sources).size).toBe(brief.sources.length);
    });

    it('lists only sources on allow-listed hosts', () => {
      expect(brief.sources.filter((source) => !isReadable(source))).toEqual([]);
    });

    it('links only to allow-listed hosts or to its declared pointer-only hosts', () => {
      const links = linksOf(brief.markdown);
      expect(links.length).toBeGreaterThan(0);
      const refused = links.filter(
        (link) => !isReadable(link) && POINTER_ONLY[new URL(link).host] !== slug,
      );
      expect(refused).toEqual([]);
    });

    it('backs its links with the listed sources', () => {
      // A pointer-only link cannot be a source, and an anchor inside a source page is fine.
      const unlisted = linksOf(brief.markdown)
        .filter(isReadable)
        .filter((link) => !brief.sources.includes(link.split('#')[0] ?? link));
      expect(unlisted).toEqual([]);
    });

    it('opens with its title and stays within 300 to 700 tokens', () => {
      expect(brief.markdown.startsWith(`# ${brief.title}\n`)).toBe(true);
      expect(brief.markdown).toBe(brief.markdown.trim());
      const tokens = estimateTokens(brief.markdown);
      expect(tokens).toBeGreaterThanOrEqual(300);
      expect(tokens).toBeLessThanOrEqual(700);
    });

    it('carries no padding, raw HTML or trailing whitespace', () => {
      expect(brief.markdown).not.toMatch(/[ \t]+$/m);
      expect(brief.markdown).not.toMatch(/\r/);
      expect(brief.markdown).not.toMatch(/ {2,}\||\| {2,}|-{4,}/);
      expect(brief.markdown).not.toMatch(/<\/?(?:div|span|br|img|table|details|a)\b/i);
    });

    it('refers only to briefs and tools that exist', () => {
      const slugs = new Set(BRIEFS.map((other) => other.slug));
      const briefRefs = [...brief.markdown.matchAll(/brief:([a-z0-9/-]+)/g)].map((m) => m[1]);
      expect(briefRefs.filter((ref) => ref === undefined || !slugs.has(ref))).toEqual([]);
      expect(briefRefs).not.toContain(slug);

      const tools = [...brief.markdown.matchAll(/\barcgis_docs_[a-z_]+/g)].map((m) => m[0]);
      const known: readonly string[] = TOOL_ORDER;
      // `arcgis_docs_*` is the family name used in prose.
      expect(tools.filter((tool) => !known.includes(tool) && tool !== 'arcgis_docs_')).toEqual([]);
    });

    it('states no patch-level version, which a version oracle supplies', () => {
      // "5.0" or "200.x" name a line or a boundary; "5.1.27" or "300.1.0" would go stale.
      expect(brief.markdown.match(/\b\d+\.\d+\.\d+\b/g) ?? []).toEqual([]);
    });
  });

  it('uses the ref prefix of the read tool', () => {
    expect(BRIEF_PREFIX).toBe('brief:');
  });

  it('covers every subject the design assigns to the AI briefs', () => {
    const body = (slug: string): string =>
      BRIEFS.find((brief) => brief.slug === slug)?.markdown ?? '';

    expect(body('ai/overview')).toMatch(/brief:ai\/js-ai-components-constraints/);
    expect(body('ai/overview')).toMatch(/brief:ai\/mcp-location-services/);
    expect(body('ai/overview')).toMatch(/brief:ai\/mcp-enterprise-beta/);

    for (const fact of [/API keys cannot/, /ArcGIS Enterprise is not supported/, /beta/, /5\.1/]) {
      expect(body('ai/js-ai-components-constraints')).toMatch(fact);
    }
    expect(body('ai/js-ai-components-constraints')).toMatch(/embeddings/i);

    expect(body('ai/mcp-location-services')).toContain(
      'https://location-services-mcp.arcgis.com/beta/mcp',
    );
    for (const tool of ['find_address_candidates', 'solve_route', 'map_with_overlay', 'buffer']) {
      expect(body('ai/mcp-location-services')).toContain(`\`${tool}\``);
    }

    expect(body('ai/mcp-enterprise-beta')).toContain('https://earlyadopter.esri.com/key/MCP');
    expect(body('ai/mcp-enterprise-beta')).toMatch(/`describe_layer` before `query_data`/);
  });

  it('names every dead package and legacy product the design lists', () => {
    const legacy = BRIEFS.find((brief) => brief.slug === 'legacy/do-not-use')?.markdown ?? '';
    for (const name of [
      '@arcgis/ai-orchestrator',
      '@arcgis/ai-agents',
      'arcgis-js-api',
      'esri-loader',
      '@arcgis/cli',
      'ArcMap',
      'ArcObjects',
      'Runtime SDKs 100.x',
      'JavaScript 3.x',
      'AppStudio',
      'Web AppBuilder',
      'GeoEvent Server',
    ]) {
      expect(legacy).toContain(name);
    }
  });
});
