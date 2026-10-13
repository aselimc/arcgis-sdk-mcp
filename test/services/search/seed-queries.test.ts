import { beforeAll, describe, expect, it } from 'vitest';
import type { DocKind } from '../../../src/core/types.js';
import { makeHarness, type Harness } from '../support/harness.js';

const DEV = 'https://developers.arcgis.com';
const JS = `${DEV}/javascript/latest`;
const CORE = `${JS}/references/core`;
const REST = `${DEV}/rest`;

interface Seed {
  query: string;
  product?: string;
  kind?: DocKind;
  /** Refs that must all be among the first three hits. */
  expect: string[];
}

/**
 * Thirty queries an agent would plausibly send, with the page that must come back in the
 * top three on the fixture catalogue. They pin the ranking as a whole: field boosts,
 * camelCase tokenisation, the symbol sidecar, synonyms, scoping and routing.
 */
const SEEDS: Seed[] = [
  { query: 'cluster points with popups', product: 'js-maps-sdk', expect: [`${JS}/clustering/`] },
  { query: 'configure popups', product: 'js-maps-sdk', expect: [`${JS}/popups/`] },
  { query: 'pop up', product: 'js-maps-sdk', expect: [`${JS}/popups/`] },
  { query: 'OAuth PKCE', product: 'js-maps-sdk', expect: [`${JS}/authentication/`] },
  { query: 'api key', product: 'js-maps-sdk', expect: [`${JS}/authentication/`] },
  { query: 'applyEdits attachments', product: 'js-maps-sdk', expect: [`${JS}/editing/`] },
  {
    query: 'FeatureLayer.queryFeatures',
    product: 'js-maps-sdk',
    expect: [`${CORE}/layers/FeatureLayer/#queryFeatures`],
  },
  {
    query: 'queryFeatures',
    product: 'js-maps-sdk',
    expect: [`${CORE}/layers/FeatureLayer/#queryFeatures`],
  },
  {
    query: 'query features',
    product: 'js-maps-sdk',
    expect: [`${CORE}/layers/FeatureLayer/#queryFeatures`],
  },
  { query: 'FeatureLayer', product: 'js-maps-sdk', expect: [`${CORE}/layers/FeatureLayer/`] },
  { query: 'how do I install the sdk', product: 'js-maps-sdk', expect: [`${JS}/get-started/`] },
  { query: 'release notes', product: 'js-maps-sdk', expect: [`${JS}/release-notes/`] },
  { query: 'changelog', product: 'js-maps-sdk', expect: [`${JS}/release-notes/`] },
  {
    query: 'display a map tutorial',
    product: 'js-maps-sdk',
    expect: [`${JS}/tutorials/display-a-map/`],
  },
  { query: 'migrate widgets', product: 'js-maps-sdk', expect: [`${JS}/migration/components/`] },
  {
    query: 'upgrade to components',
    product: 'js-maps-sdk',
    expect: [`${JS}/migration/components/`],
  },
  {
    query: 'goTo',
    product: 'js-maps-sdk',
    expect: [`${CORE}/views/MapView/#goTo`, `${CORE}/views/SceneView/#goTo`],
  },
  {
    query: 'clustering',
    product: 'js-maps-sdk',
    kind: 'sample',
    expect: [`${JS}/sample-code/featurereduction-cluster/`],
  },
  { query: 'edit features', product: 'js-maps-sdk', expect: [`${JS}/editing/`] },
  { query: 'MapView', product: 'javascript', expect: [`${CORE}/views/MapView/`] },
  {
    query: 'featureReduction',
    product: '@arcgis/core',
    expect: [`${CORE}/layers/FeatureLayer/#featureReduction`],
  },
  {
    query: 'take a map offline',
    product: 'kotlin-maps-sdk',
    expect: [`${DEV}/kotlin/offline-maps/`],
  },
  { query: 'preplanned areas', product: 'kotlin', expect: [`${DEV}/kotlin/offline-maps/`] },
  {
    query: 'gradle dependency',
    product: 'kotlin-maps-sdk',
    expect: [`${DEV}/kotlin/install-and-set-up/`],
  },
  {
    query: 'ArcGISMap',
    product: 'kotlin-maps-sdk',
    expect: [`${DEV}/kotlin/api-reference/arcgis/com.arcgismaps.mapping/-arc-g-i-s-map/`],
  },
  {
    query: 'applyEdits',
    product: 'rest-api',
    expect: [`${REST}/services-reference/enterprise/apply-edits-feature-service-layer/`],
  },
  {
    query: 'add attachment',
    product: 'rest',
    expect: [`${REST}/services-reference/enterprise/add-attachment/`],
  },
  {
    query: 'search',
    product: 'rest-api/portal',
    expect: [`${REST}/users-groups-and-items/search/`],
  },
  { query: 'webhooks', product: 'rest-api', expect: [`${REST}/users-groups-and-items/webhooks/`] },
  { query: 'kotlin offline map', expect: [`${DEV}/kotlin/offline-maps/`] },
  { query: 'mcp servers', expect: ['brief:ai/mcp-servers'] },
];

describe('seed queries', () => {
  let h: Harness;
  beforeAll(() => {
    h = makeHarness();
  });

  it('has at least thirty seeds', () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(SEEDS)('"$query" in $product', async (seed) => {
    const response = await h.services.search.search(
      {
        query: seed.query,
        limit: 8,
        ...(seed.product === undefined ? {} : { product: seed.product }),
        ...(seed.kind === undefined ? {} : { kind: seed.kind }),
      },
      h.call(),
    );
    const top = response.hits.slice(0, 3).map((hit) => hit.ref);
    for (const ref of seed.expect) expect(top).toContain(ref);
  });
});
