import { describe, expect, it } from 'vitest';
import { ownedPrefix } from '../../../src/core/adapter-helpers.js';
import { sourceRootUrl } from '../../../src/core/source-urls.js';
import {
  helpDeveloperLinks,
  helpDeveloperSources,
  helpProducts,
} from '../../../src/registry/data/help.generated.js';
import { helpProduct, idsOf, sourceOf } from './lookup.js';

describe('twins, aliases and tombstones', () => {
  it('add the ArcGIS Online flavour of four products as source `saas`', () => {
    const twins = ['arcgis-velocity', 'arcgis-data-pipelines', 'arcgis-workflow-manager'];
    for (const id of [...twins, 'arcgis-excalibur']) {
      const saas = sourceOf(helpProduct(id), 'saas');
      expect(saas.floor, id).toBeUndefined();
      expect(saas.adapter === 'legacy-help' ? saas.config.host : '', id).toBe('doc.arcgis.com');
    }
    const velocity = sourceOf(helpProduct('arcgis-velocity'), 'saas');
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
    for (const [id, alias] of aliases) expect(helpProduct(id).aliases, id).toEqual([alias]);
    // The tenth migrated entry has the slug the product already has as its id.
    expect(helpProduct('deep-learning-studio').aliases).toEqual([]);
    expect(helpProduct('arcgis-hub').sources.map((source) => source.id)).toEqual(['help']);
  });

  it('never takes the id of a developer product as an alias', () => {
    expect(helpProduct('experience-builder-help').aliases).toEqual([]);
  });

  it('are nine retired, source-less, link-only tombstones', () => {
    const tombstones = helpProducts.filter((product) => product.status === 'retired');
    expect(idsOf(tombstones).sort()).toEqual([
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
    expect(helpProduct('microsoft-365').related).toEqual([
      'arcgis-for-excel',
      'arcgis-for-power-bi',
      'arcgis-for-sharepoint',
      'arcgis-for-teams',
    ]);
    expect(helpProduct('collector-classic').successor).toBe('field-maps');
    expect(helpProduct('pro-intelligence').successor).toBe('arcgis-allsource');
    expect(helpProduct('insights').startHere[1]?.ref).toMatch(
      /^https:\/\/support\.esri\.com\/en-us\/knowledge-base\/deprecation-/,
    );
    expect(helpProduct('geoanalytics-server').homepage).toBe(
      'https://enterprise.arcgis.com/en/geoanalytics/11.3/',
    );
  });
});

describe('earlier versions on the legacy hosts', () => {
  it('give arcgis-enterprise eleven on-demand sources and live lines 12.0 to 10.3', () => {
    const enterprise = helpProduct('arcgis-enterprise');
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
    const enterprise = helpProduct('arcgis-enterprise');
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
      const legacy = sourceOf(helpProduct(id), 'legacy');
      expect(legacy.adapter === 'legacy-help' ? legacy.config : undefined, id).toMatchObject({
        host: 'enterprise.arcgis.com',
        base: `/en/${slug}/{line}/`,
        enumerate: 'on-demand',
      });
      expect(legacy.lines?.[0], id).toBe(newest);
      expect(
        helpProduct(id).lines.map((line) => line.id),
        id,
      ).toEqual(['latest', ...(legacy.lines ?? [])]);
    }
  });

  it('read ArcGIS Pro 3.6 and 3.5 on demand and link to older versions', () => {
    const pro = helpProduct('arcgis-pro');
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
