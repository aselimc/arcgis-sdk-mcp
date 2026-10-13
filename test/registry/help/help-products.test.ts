import { describe, expect, it } from 'vitest';
import { ownedPrefix } from '../../../src/core/adapter-helpers.js';
import { sourceRootUrl } from '../../../src/core/source-urls.js';
import type { AnySourceDef, Product } from '../../../src/core/types.js';
import {
  helpDeveloperLinks,
  helpDeveloperSources,
  helpProducts,
} from '../../../src/registry/data/help.generated.js';
import { validateProducts } from '../../../src/registry/schema.js';
import {
  OTHER_DEVELOPER_IDS,
  floorViolations,
  hostViolations,
  identityViolations,
  sourceViolations,
  wordingViolations,
} from '../data-rest/invariants.js';

/** Developer-tier ids defined next to the help products, which `related` may name. */
const DEVELOPER_IDS = new Set([
  ...OTHER_DEVELOPER_IDS,
  ...['rest-api', 'developer-guide', 'hub-dev', 'site-scan-api', 'urban-api'],
  ...['workflow-manager-dev', 'survey123-dev', 'velocity-grpc', 'knowledge-pbf', 'cim-spec'],
  ...['enterprise-devops', 'oss-libraries'],
]);

function byId(id: string): Product {
  const product = helpProducts.find((candidate) => candidate.id === id);
  if (product === undefined) throw new Error(`no help product ${id}`);
  return product;
}

function sourceOf(product: Product, id: string): AnySourceDef {
  const source = product.sources.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`no source ${product.id}/${id}`);
  return source;
}

const ids = (products: readonly Product[]): string[] => products.map((product) => product.id);
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
    expect(ids(onDocEsri).sort()).toEqual([
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
    const search = (id: string): string[] | undefined => byId(id).esearch?.products;
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
    const help = sourceOf(byId('arcgis-pro'), 'help');
    expect(help.adapter === 'docfx-esri' ? help.config.sections : []).toEqual([
      'get-started',
      'help',
    ]);
    const [latest] = byId('arcgis-pro').lines;
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
    expect(ids(onDocArcgis.filter((product) => product.tier === 'help')).sort()).toEqual([
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
    expect(ids(onDocArcgis.filter((product) => product.tier === 'link')).sort()).toEqual([
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
    const help = sourceOf(byId('survey123'), 'help');
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
    expect(byId('survey123').homepage).toBe('https://doc.arcgis.com/en/survey123/analyze/');
  });

  it('leave the books of developer products to those products', () => {
    const paths = (id: string): string[] => {
      const help = sourceOf(byId(id), 'help');
      return help.adapter === 'legacy-help' ? help.config.books.map((book) => book.path) : [];
    };
    expect(paths('arcgis-earth')).toHaveLength(5);
    expect(paths('arcgis-earth')).not.toContain('automation-api');
    expect(paths('arcgis-for-autocad')).toHaveLength(4);
    expect(paths('arcgis-for-autocad')).not.toContain('commands-api');
  });

  it('give ArcGIS Online its seven developer-facing start-here pages', () => {
    const refs = byId('arcgis-online').startHere.map((link) => link.ref);
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
    expect(byId('dashboards').esearch).toEqual({
      site: 'arcgis_doc_col',
      products: ['ops-dashboard'],
      keepUrl: '/latest/',
    });
    expect(byId('survey123').esearch).toEqual({ site: 'arcgis_doc_col', products: ['survey123'] });
  });
});

describe('twins, aliases and tombstones', () => {
  it('add the ArcGIS Online flavour of four products as source `saas`', () => {
    const twins = ['arcgis-velocity', 'arcgis-data-pipelines', 'arcgis-workflow-manager'];
    for (const id of [...twins, 'arcgis-excalibur']) {
      const saas = sourceOf(byId(id), 'saas');
      expect(saas.floor, id).toBeUndefined();
      expect(saas.adapter === 'legacy-help' ? saas.config.host : '', id).toBe('doc.arcgis.com');
    }
    const velocity = sourceOf(byId('arcgis-velocity'), 'saas');
    expect(velocity.adapter === 'legacy-help' ? velocity.config.base : '').toBe('/en/velocity/');
  });

  it('turn migrated doc.arcgis.com entries into aliases of the current product', () => {
    const aliases: Array<[string, string]> = [
      ['arcgis-allsource', 'allsource'],
      ['arcgis-hub', 'hub'],
      ['arcgis-indoors', 'indoors'],
      ['arcgis-mission', 'mission'],
      ['arcgis-monitor', 'monitor'],
      ['arcgis-reality-studio', 'reality-studio'],
      ['arcgis-drone2map', 'drone2map'],
      ['arcgis-urban', 'urban'],
      ['arcgis-quickcapture', 'quickcapture'],
    ];
    for (const [id, alias] of aliases) expect(byId(id).aliases, id).toEqual([alias]);
    // The tenth migrated entry has the slug the product already has as its id.
    expect(byId('deep-learning-studio').aliases).toEqual([]);
    expect(byId('arcgis-hub').sources.map((source) => source.id)).toEqual(['help']);
  });

  it('never takes the id of a developer product as an alias', () => {
    expect(byId('experience-builder-help').aliases).toEqual([]);
  });

  it('are nine retired, source-less, link-only tombstones', () => {
    const tombstones = helpProducts.filter((product) => product.status === 'retired');
    expect(ids(tombstones).sort()).toEqual([
      'arcgis-for-inspire',
      'collector-classic',
      'community-analyst',
      'explorer',
      'geoanalytics-server',
      'insights',
      'microsoft-365',
      'pro-intelligence',
      'tracker',
    ]);
    for (const tombstone of tombstones) {
      expect(tombstone.tier, tombstone.id).toBe('link');
      expect(tombstone.sources, tombstone.id).toEqual([]);
      expect(tombstone.aliases, tombstone.id).toEqual([]);
      expect(tombstone.lines.map((line) => line.access)).toEqual(['link-only']);
      expect(tombstone.startHere[0]?.ref, tombstone.id).toBe(tombstone.homepage);
    }
  });

  it('point tombstones at their successors and relatives', () => {
    expect(byId('microsoft-365').related).toEqual([
      'arcgis-for-excel',
      'arcgis-for-power-bi',
      'arcgis-for-sharepoint',
      'arcgis-for-teams',
    ]);
    expect(byId('collector-classic').successor).toBe('field-maps');
    expect(byId('pro-intelligence').successor).toBe('arcgis-allsource');
    expect(byId('insights').startHere[1]?.ref).toMatch(
      /^https:\/\/support\.esri\.com\/en-us\/knowledge-base\/deprecation-/,
    );
    expect(byId('geoanalytics-server').homepage).toBe(
      'https://enterprise.arcgis.com/en/geoanalytics/11.3/',
    );
  });
});

describe('earlier versions on the legacy hosts', () => {
  it('give arcgis-enterprise eleven on-demand sources and live lines 12.0 to 10.3', () => {
    const enterprise = byId('arcgis-enterprise');
    const legacy = enterprise.sources.filter((source) => source.id.startsWith('legacy-'));
    expect(legacy.map((source) => source.id)).toEqual([
      'legacy-portal',
      'legacy-server',
      'legacy-data-store',
      'legacy-web-adaptor',
      'legacy-cloud',
      'legacy-enterprise',
      'legacy-get-started',
      'legacy-system-requirements',
      'legacy-notebook',
      'legacy-image',
      'legacy-knowledge',
    ]);
    expect(enterprise.lines.map((line) => line.id)).toEqual([
      'latest',
      ...['12.0', '11.5', '11.4', '11.3', '11.2', '11.1', '11.0'],
      ...['10.9.1', '10.9', '10.8', '10.7', '10.6', '10.5', '10.4', '10.3'],
    ]);
    expect(enterprise.lines.filter((line) => line.current).map((line) => line.id)).toEqual([
      'latest',
    ]);
    expect(enterprise.lines.every((line) => line.access === 'live')).toBe(true);
    for (const source of legacy) {
      expect(source.adapter === 'legacy-help' ? source.config : undefined, source.id).toMatchObject(
        {
          host: 'enterprise.arcgis.com',
          base: `/en/${source.id.slice('legacy-'.length)}/{line}/`,
          enumerate: 'on-demand',
          lines: source.lines,
        },
      );
      expect(source.lines, source.id).not.toContain('latest');
    }
    expect(sourceOf(enterprise, 'help').lines).toEqual(['latest']);
  });

  it('resolve a versioned URL to the legacy source and line it belongs to', () => {
    const enterprise = byId('arcgis-enterprise');
    const portal = sourceOf(enterprise, 'legacy-portal');
    const line = enterprise.lines.find((candidate) => candidate.id === '11.5');
    if (line === undefined) throw new Error('no line 11.5');
    expect(sourceRootUrl(portal, line)).toBe('https://enterprise.arcgis.com/en/portal/11.5/');
    const url = 'https://enterprise.arcgis.com/en/portal/11.5/use/what-is-portal-for-arcgis.htm';
    expect(ownedPrefix(portal, line, url)).toBe(
      'https://enterprise.arcgis.com/en/portal/11.5/use/',
    );
    expect(ownedPrefix(sourceOf(enterprise, 'legacy-server'), line, url)).toBeUndefined();
    expect(portal.probe.url).toBe(
      'https://enterprise.arcgis.com/en/portal/11.5/administer/windows/flisting.htm',
    );
  });

  it('add an on-demand source `legacy` to eight migrated products', () => {
    const expected: Array<[id: string, slug: string, newest: string]> = [
      ['arcgis-video-server', 'video', '11.5'],
      ['arcgis-workflow-manager', 'workflow-manager', '11.4'],
      ['arcgis-data-reviewer', 'data-reviewer', '11.5'],
      ['arcgis-maritime', 'maritime', '12.0'],
      ['arcgis-topographic-mapping', 'production-mapping', '11.5'],
      ['arcgis-roads-and-highways', 'roads-highways', '11.5'],
      ['arcgis-pipeline-referencing', 'pipeline-referencing', '11.5'],
      ['arcgis-monitor', 'monitor', '10.8'],
    ];
    for (const [id, slug, newest] of expected) {
      const legacy = sourceOf(byId(id), 'legacy');
      expect(legacy.adapter === 'legacy-help' ? legacy.config : undefined, id).toMatchObject({
        host: 'enterprise.arcgis.com',
        base: `/en/${slug}/{line}/`,
        enumerate: 'on-demand',
      });
      expect(legacy.lines?.[0], id).toBe(newest);
      expect(
        byId(id).lines.map((line) => line.id),
        id,
      ).toEqual(['latest', ...(legacy.lines ?? [])]);
    }
  });

  it('read ArcGIS Pro 3.6 and 3.5 on demand and link to older versions', () => {
    const pro = byId('arcgis-pro');
    const access = Object.fromEntries(pro.lines.map((line) => [line.id, line.access]));
    expect(access).toEqual({
      latest: 'live',
      '3.6': 'live',
      '3.5': 'live',
      ...Object.fromEntries(
        ['3.4', '3.3', '3.2', '3.1', '3.0', '2.9', '2.8', '2.7', '2.6'].map((id) => [
          id,
          'link-only',
        ]),
      ),
    });
    expect(pro.lines.find((line) => line.id === '3.6')?.label).toBe('Pro 3.6');
    const legacy = sourceOf(pro, 'legacy');
    expect(legacy.adapter === 'legacy-help' ? legacy.config : undefined).toEqual({
      host: 'pro.arcgis.com',
      base: '/en/pro-app/{line}/',
      books: [{ path: 'get-started' }, { path: 'help' }],
      lines: ['3.6', '3.5'],
      enumerate: 'on-demand',
    });
    // The source exists on the link-only lines too, so they answer with a link.
    expect(legacy.lines).toHaveLength(11);
  });
});

describe('what the import hands to developer products', () => {
  it('builds the sources of five developer products', () => {
    expect(Object.keys(helpDeveloperSources).sort()).toEqual([
      'arcpy/legacy',
      'autocad-api/api',
      'cityengine/help',
      'earth-automation-api/api',
      'geoevent-server/help',
    ]);
    for (const [target, source] of Object.entries(helpDeveloperSources)) {
      expect(source.id, target).toBe(target.split('/')[1]);
      expect(source.adapter, target).toBe('legacy-help');
    }
  });

  it('gives CityEngine and GeoEvent Server their eight books each', () => {
    const books = (target: string): string[] => {
      const source = helpDeveloperSources[target];
      return source?.adapter === 'legacy-help' ? source.config.books.map((book) => book.path) : [];
    };
    expect(books('cityengine/help')).toHaveLength(8);
    expect(books('cityengine/help')).toEqual(expect.arrayContaining(['cga', 'python']));
    expect(books('geoevent-server/help')).toHaveLength(8);
    expect(books('earth-automation-api/api')).toEqual(['automation-api']);
    expect(books('autocad-api/api')).toEqual(['commands-api']);
    expect(books('arcpy/legacy')).toEqual(['arcpy', 'tool-reference']);
    expect(helpDeveloperSources['geoevent-server/help']).toMatchObject({
      floor: true,
      config: { host: 'enterprise.arcgis.com', base: '/en/geoevent/latest/' },
    });
  });

  it('links the retired help of AppStudio and Web AppBuilder', () => {
    expect(helpDeveloperLinks).toEqual({
      appstudio: {
        title: 'ArcGIS AppStudio help (retired)',
        ref: 'https://doc.arcgis.com/en/appstudio/configure-apps/',
      },
      'web-appbuilder': {
        title: 'ArcGIS Web AppBuilder help (retired)',
        ref: 'https://doc.arcgis.com/en/web-appbuilder/latest/create-apps/',
      },
    });
  });
});
