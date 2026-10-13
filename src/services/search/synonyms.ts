/**
 * Query-time synonyms for ArcGIS vocabulary: abbreviations and spellings that agents use but
 * documentation titles do not (or the other way round). The list is this project's own and
 * deliberately short: a wrong synonym costs precision on every query that contains the word.
 */

/** Groups of interchangeable phrases; every member expands to all the others. */
const GROUPS: ReadonlyArray<readonly string[]> = [
  ['popup', 'pop up', 'popups'],
  ['basemap', 'base map'],
  ['webmap', 'web map'],
  ['webscene', 'web scene'],
  ['geocode', 'geocoding'],
  ['geoprocessing', 'gp'],
  ['auth', 'authentication'],
  ['oauth', 'oauth2', 'oauth 2 0'],
  ['apikey', 'api key'],
  ['js', 'javascript'],
  ['agol', 'arcgis online'],
  ['featurelayer', 'feature layer'],
  ['featureservice', 'feature service'],
  ['mapservice', 'map service'],
  ['renderer', 'symbology'],
  ['cluster', 'clustering'],
  ['route', 'routing', 'directions'],
  ['offline', 'disconnected'],
  ['install', 'installation', 'setup'],
  ['upgrade', 'migrate', 'migration'],
  ['deprecated', 'deprecation'],
  ['changelog', 'release notes', 'whats new'],
];

function buildTable(): Map<string, string[]> {
  const table = new Map<string, string[]>();
  for (const group of GROUPS) {
    for (const phrase of group) {
      // Only single words can be looked up: a query is expanded word by word.
      if (phrase.includes(' ')) continue;
      const others = group.filter((other) => other !== phrase);
      table.set(phrase, [...(table.get(phrase) ?? []), ...others]);
    }
  }
  return table;
}

/** Lower-case word to the phrases that may stand in for it. */
export const SYNONYMS: ReadonlyMap<string, readonly string[]> = buildTable();

/** The synonyms of one lower-case word; empty when it has none. */
export function synonymsOf(word: string): readonly string[] {
  return SYNONYMS.get(word.toLowerCase()) ?? [];
}
