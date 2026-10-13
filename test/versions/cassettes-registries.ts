import type { Cassette } from '../support/fake-http.js';

/**
 * Recorded answers of the package registries, written by hand in the shape of the real
 * documents (research `gap-version-oracle-and-lifecycle.md`, section 2.2). The values are
 * the ones observed on 2026-10-13, which is what the merge-rule cases are stated in.
 */
export const REGISTRIES: Cassette = {
  name: 'package registries',
  interactions: [
    {
      url: 'https://registry.npmjs.org/-/package/@arcgis/core/dist-tags',
      response: { json: { latest: '5.1.27', rc: '5.2.0-next.145', next: '6.0.0-next.6' } },
    },
    {
      // `latest` is older than the long-term support tag: the REST JS case.
      url: 'https://registry.npmjs.org/-/package/@esri/arcgis-rest-request/dist-tags',
      response: { json: { latest: '4.11.0', 'lts-v4.x': '4.11.1', 'v3-archive': '3.7.0' } },
    },
    {
      // A package that needs authentication answers with a JSON string.
      url: 'https://registry.npmjs.org/-/package/@esri/private-thing/dist-tags',
      response: { json: 'Unauthorized' },
    },
    {
      url: 'https://pypi.org/pypi/arcgis/json',
      response: {
        json: {
          info: { name: 'arcgis', version: '2.4.3', requires_python: '<3.15,>=3.11' },
          releases: {
            '2.4.2': [{ upload_time_iso_8601: '2025-10-13T17:02:11.000000Z' }],
            '2.4.3': [{ upload_time_iso_8601: '2026-04-21T16:40:09.000000Z' }],
          },
          urls: [{ upload_time_iso_8601: '2026-04-21T16:40:09.000000Z' }],
        },
      },
    },
    {
      url: 'https://api.nuget.org/v3-flatcontainer/esri.arcgisruntime/index.json',
      response: {
        json: {
          versions: [
            '100.15.0',
            '200.7.0',
            '200.8.0',
            '200.8.3',
            '300.0.0',
            '300.1.0',
            '300.2.0-beta.1',
          ],
        },
      },
    },
    {
      url: 'https://pub.dev/api/packages/arcgis_maps',
      response: {
        json: {
          name: 'arcgis_maps',
          latest: { version: '300.1.0+5042', published: '2026-08-05T15:12:44.123456Z' },
          versions: [{ version: '300.0.0+4900', published: '2026-04-21T14:00:00.000000Z' }],
        },
      },
    },
    {
      url: 'https://www.arcgis.com/sharing/rest?f=json',
      response: { json: { currentVersion: '2026.2' } },
    },
  ],
};

/**
 * Life-cycle API records. Besides the whitelisted fields they carry the internal ones the
 * real records have, so a test can prove that nothing else is surfaced.
 */
export const LIFECYCLE: Cassette = {
  name: 'life-cycle API',
  interactions: [
    {
      url: 'https://plc-api.esri.com/api/PLC?locale=en-us&category=Foundational&productName=Widgets+Desktop&platform=NA',
      response: {
        json: [
          record('Widgets Desktop', '3.6', '2025-11-13', '2027-12-01', '2028-12-01'),
          record('Widgets Desktop', '3.7', '2026-05-14', '2028-06-01', '2029-06-01'),
          // Patches are records of their own and are newer by date than the next minor release.
          record('Widgets Desktop', '3.7.2', '2026-09-10'),
          record('Widgets Desktop', '3.6.4', '2026-09-17'),
          // Announced, not released: a general-availability date in the future.
          record('Widgets Desktop', '3.8', '2026-11-12'),
          record('Another Product', '9.9', '2026-01-01', undefined, '2030-01-01'),
        ],
      },
    },
  ],
};

function record(
  productName: string,
  releaseVersion: string,
  ga: string,
  mature?: string,
  retirement?: string,
): Record<string, unknown> {
  return {
    productName,
    platform: 'NA',
    team: 'Foundational',
    releaseVersion,
    generalAvailability: `${ga}T07:00:00Z`,
    mature: mature === undefined ? '' : `${mature}T07:00:00Z`,
    retirement: retirement === undefined ? '' : `${retirement}T07:00:00Z`,
    author: 'internal staff name',
    editor: 'internal staff name',
    patch: { Url: 'https://intranet.example/internal' },
    showVersionInPlc: true,
  };
}
