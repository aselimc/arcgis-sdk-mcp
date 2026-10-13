/**
 * Registry data: the Esri Support knowledge base (design section 4.5).
 *
 * The knowledge base publishes no index beyond its article sitemap, so titles come from the
 * URL slugs. Deprecation notices are articles whose slug starts with `deprecation-`; the
 * version service reads them from the same sitemap.
 */
import type { Product } from '../../core/types.js';

const ARTICLES_SITEMAP = 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml';
/** English articles listed on 2026-10-13. */
const ARTICLES = 7888;

const supportKb: Product = {
  id: 'support-kb',
  name: 'Esri Support knowledge base',
  aliases: ['knowledge-base', 'esri-support', 'technical-articles', 'deprecation-notices'],
  category: 'support',
  tier: 'developer',
  status: 'active',
  summary:
    'Esri Support technical articles: error messages, how-to answers, known bugs with workarounds and product deprecation notices.',
  keywords: [
    'error',
    'error message',
    'bug',
    'workaround',
    'how to',
    'problem',
    'troubleshoot',
    'deprecation',
    'retirement',
    'faq',
  ],
  languages: [],
  homepage: 'https://support.esri.com/en-us/knowledge-base/',
  packages: [],
  repos: [],
  lines: [{ id: 'latest', label: 'Current', current: true, access: 'live', vars: {} }],
  sources: [
    {
      id: 'articles',
      title: 'Knowledge base articles',
      kinds: ['troubleshooting'],
      adapter: 'sitemap',
      config: { url: ARTICLES_SITEMAP, titleFrom: 'slug', kind: 'troubleshooting' },
      capability: 'website',
      floor: true,
      pagesApprox: ARTICLES,
      probe: {
        url: ARTICLES_SITEMAP,
        expect: 'xml',
        minRecords: Math.floor(ARTICLES / 2),
        family: 'support-kb',
      },
    },
  ],
  oracles: [],
  esearch: { index: 'en_support_technical_articles_v1' },
  startHere: [
    { title: 'Knowledge base', ref: 'https://support.esri.com/en-us/knowledge-base/' },
    { title: 'Products and APIs not to start new work on', ref: 'brief:legacy/do-not-use' },
  ],
  pitfalls: [
    'Article titles are derived from URL slugs, so search with the words of the error message rather than an error number alone.',
    'An article describes the product version it was written for: check its "last published" date and the version it names.',
    'Deprecation notices are articles whose slug starts with "deprecation-"; arcgis_docs_get_versions reports them per product.',
  ],
  related: ['developer-support'],
  licenseTier: 'esri-website-terms',
  verifiedOn: '2026-10-13',
};

/** The support product (design section 4.5), one id. */
export const supportProducts: readonly Product[] = [supportKb];
