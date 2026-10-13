import { describe, expect, it } from 'vitest';
import { ownedPrefix } from '../../../src/core/adapter-helpers.js';
import { helpProducts } from '../../../src/registry/data/help.generated.js';
import { validateProducts } from '../../../src/registry/schema.js';
import {
  OTHER_DEVELOPER_IDS,
  floorViolations,
  hostViolations,
  identityViolations,
  sourceViolations,
  wordingViolations,
} from '../data-rest/invariants.js';
import { helpProduct, idsOf, sourceOf } from './lookup.js';

/** Developer-tier ids defined next to the help products, which `related` may name. */
const DEVELOPER_IDS = new Set([
  ...OTHER_DEVELOPER_IDS,
  ...['rest-api', 'developer-guide', 'hub-dev', 'site-scan-api', 'urban-api'],
  ...['workflow-manager-dev', 'survey123-dev', 'velocity-grpc', 'knowledge-pbf', 'cim-spec'],
  ...['enterprise-devops', 'oss-libraries'],
]);

const live = helpProducts.filter((product) => product.status !== 'retired');
const onDocEsri = live.filter((product) => product.sources[0]?.adapter === 'docfx-esri');
const onDocArcgis = live.filter((product) => product.sources[0]?.adapter === 'legacy-help');

describe('generated help products', () => {
  it('are 67 products plus 9 tombstones, all in category product-help', () => {
    expect(live).toHaveLength(67);
    expect(helpProducts).toHaveLength(76);
    expect(new Set(helpProducts.map((product) => product.category))).toEqual(
      new Set(['product-help']),
    );
    expect(helpProducts.some((product) => product.tier === 'developer')).toBe(false);
  });

  it('pass the registry schema and the invariants INV-1 to INV-5', () => {
    expect(validateProducts(helpProducts)).toEqual([]);
    expect(floorViolations(helpProducts)).toEqual([]);
    expect(hostViolations(helpProducts)).toEqual([]);
    expect(sourceViolations(helpProducts)).toEqual([]);
    expect(identityViolations(helpProducts, DEVELOPER_IDS)).toEqual([]);
    expect(wordingViolations(helpProducts)).toEqual([]);
  });

  it('carry no version number in their wording that an oracle can supply', () => {
    for (const product of helpProducts) {
      expect(`${product.summary} ${product.statusNote ?? ''}`, product.id).not.toMatch(/\d+\.\d+/);
    }
  });
});

describe('doc.esri.com products', () => {
  it('are the 36 ids of the design, named after their URL slug', () => {
    expect(idsOf(onDocEsri).sort()).toEqual([
      'accessibility',
      'arcgis-allsource',
      'arcgis-autodesk-forma',
      'arcgis-data-interoperability',
      'arcgis-data-pipelines',
      'arcgis-data-reviewer',
      'arcgis-doc-center',
      'arcgis-drone2map',
      'arcgis-enterprise',
      'arcgis-enterprise-cloud-tools',
      'arcgis-enterprise-k8s',
      'arcgis-excalibur',
      'arcgis-flight',
      'arcgis-hub',
      'arcgis-image-server',
      'arcgis-indoors',
      'arcgis-knowledge',
      'arcgis-maps-microsoft-fabric',
      'arcgis-maritime',
      'arcgis-mission',
      'arcgis-monitor',
      'arcgis-notebooks',
      'arcgis-pipeline-referencing',
      'arcgis-pro',
      'arcgis-quickcapture',
      'arcgis-reality-server',
      'arcgis-reality-studio',
      'arcgis-roads-and-highways',
      'arcgis-server',
      'arcgis-storymaps',
      'arcgis-topographic-mapping',
      'arcgis-urban',
      'arcgis-velocity',
      'arcgis-video-server',
      'arcgis-workflow-manager',
      'deep-learning-studio',
    ]);
  });

  it('split into 23 help-tier and 13 link-tier products by research scope', () => {
    expect(onDocEsri.filter((product) => product.tier === 'help')).toHaveLength(23);
    expect(onDocEsri.filter((product) => product.tier === 'link')).toHaveLength(13);
  });

  it('have one floor source `help` on their slug, a sitemap probe and a sitemap oracle', () => {
    for (const product of onDocEsri) {
      const help = sourceOf(product, 'help');
      expect(help.floor, product.id).toBe(true);
      expect(help.adapter === 'docfx-esri' ? help.config.slug : '', product.id).toBe(product.id);
      expect(help.probe.url).toBe(`https://doc.esri.com/en/${product.id}/latest/sitemap.xml`);
      expect(product.homepage).toBe(`https://doc.esri.com/en/${product.id}/latest/`);
      expect(product.oracles).toEqual([
        { type: 'docesri-sitemap', options: { slug: product.id }, provides: ['documented'] },
      ]);
    }
  });

  it('take their site-search product ids from the research, where they often differ from the slug', () => {
    const search = (id: string): string[] | undefined => helpProduct(id).esearch?.products;
    expect(search('accessibility')).toEqual(['esri-a11y']);
    expect(search('arcgis-allsource')).toEqual(['allsource']);
    expect(search('arcgis-pipeline-referencing')).toEqual(['ext-server-pipeline']);
    expect(search('arcgis-hub')).toEqual(['arcgis-hub']);
    for (const product of onDocEsri) {
      expect(product.esearch?.index, product.id).toBe('esri_docs_main_v1');
      expect(product.esearch?.products?.length, product.id).toBeGreaterThan(0);
    }
    const differing = onDocEsri.filter((product) => !search(product.id)?.includes(product.id));
    expect(differing.length).toBeGreaterThanOrEqual(16);
  });

  it('scope the ArcGIS Pro help to the books that arcpy and arcgis-pro-sdk do not own', () => {
    const help = sourceOf(helpProduct('arcgis-pro'), 'help');
    expect(help.adapter === 'docfx-esri' ? help.config.sections : []).toEqual([
      'get-started',
      'help',
    ]);
    const [latest] = helpProduct('arcgis-pro').lines;
    const owns = (path: string): boolean =>
      latest !== undefined &&
      ownedPrefix(help, latest, `https://doc.esri.com/en/arcgis-pro/latest/${path}`) !== undefined;
    expect(owns('help/mapping/introduction/overview.html')).toBe(true);
    expect(owns('arcpy/functions/listfeatureclasses.html')).toBe(false);
    expect(owns('tool-reference/analysis/buffer.html')).toBe(false);
    expect(owns('sdk/api-reference/topic1.html')).toBe(false);
  });
});

describe('doc.arcgis.com products', () => {
  it('are 11 help-tier products with fixed ids', () => {
    expect(idsOf(onDocArcgis.filter((product) => product.tier === 'help')).sort()).toEqual([
      'arcgis-earth',
      'arcgis-for-autocad',
      'arcgis-online',
      'arcgis-solutions',
      'business-analyst',
      'dashboards',
      'experience-builder-help',
      'field-maps',
      'instant-apps',
      'survey123',
      'web-editor',
    ]);
  });

  it('are 20 link-tier products with the ids of the fixed map', () => {
    expect(idsOf(onDocArcgis.filter((product) => product.tier === 'link')).sort()).toEqual([
      '3d-workflows',
      'arcgis-for-excel',
      'arcgis-for-power-automate',
      'arcgis-for-power-bi',
      'arcgis-for-sharepoint',
      'arcgis-for-teams',
      'arcgis-ips',
      'data-appliance',
      'esri-demographics',
      'geobim',
      'geoplanner',
      'imagery-workflows',
      'maps-for-adobecc',
      'microsoft-planetary-computer',
      'navigator',
      'pretrained-models',
      'redistricting',
      'site-scan',
      'streetmap-premium',
      'workforce',
    ]);
  });

  it('read each book through the legacy help adapter, with its table-of-contents script', () => {
    const help = sourceOf(helpProduct('survey123'), 'help');
    expect(help.floor).toBe(true);
    expect(help.adapter === 'legacy-help' ? help.config : undefined).toMatchObject({
      host: 'doc.arcgis.com',
      base: '/en/survey123/',
    });
    const books = help.adapter === 'legacy-help' ? help.config.books : [];
    expect(books).toHaveLength(10);
    expect(books).toContainEqual({
      path: 'analyze',
      tocScript: '/en/survey123/analyze/1883.js',
    });
    expect(help.probe.url).toBe('https://doc.arcgis.com/en/survey123/analyze/flisting.htm');
    // Product roots on this host redirect to marketing pages, so the entry is a book.
    expect(helpProduct('survey123').homepage).toBe('https://doc.arcgis.com/en/survey123/analyze/');
  });

  it('leave the books of developer products to those products', () => {
    const paths = (id: string): string[] => {
      const help = sourceOf(helpProduct(id), 'help');
      return help.adapter === 'legacy-help' ? help.config.books.map((book) => book.path) : [];
    };
    expect(paths('arcgis-earth')).toHaveLength(5);
    expect(paths('arcgis-earth')).not.toContain('automation-api');
    expect(paths('arcgis-for-autocad')).toHaveLength(4);
    expect(paths('arcgis-for-autocad')).not.toContain('commands-api');
  });

  it('give ArcGIS Online its seven developer-facing start-here pages', () => {
    const refs = helpProduct('arcgis-online').startHere.map((link) => link.ref);
    const base = 'https://doc.arcgis.com/en/arcgis-online/';
    expect(refs).toEqual([
      `${base}get-started/`,
      `${base}reference/use-url-parameters.htm`,
      `${base}reference/webhooks-online.htm`,
      `${base}administer/configure-security.htm`,
      `${base}manage-data/add-app-url.htm`,
      `${base}reference/hosted-service-security.htm`,
      `${base}reference/sql-agol.htm`,
      `${base}reference/available-python-libraries.htm`,
    ]);
  });

  it('keep site-search hits to the /latest/ alias where numbered copies exist', () => {
    expect(helpProduct('dashboards').esearch).toEqual({
      site: 'arcgis_doc_col',
      products: ['ops-dashboard'],
      keepUrl: '/latest/',
    });
    expect(helpProduct('survey123').esearch).toEqual({
      site: 'arcgis_doc_col',
      products: ['survey123'],
    });
  });
});
