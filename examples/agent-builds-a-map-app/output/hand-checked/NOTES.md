# Hand-checked app: how it was written

**This is not agent output.** No Anthropic API key was available when this example was
added, so `agent.ts` has not been run for this repository. This app was written by hand, by
the same process the agent is asked to follow: every SDK fact below was taken from an
`arcgis-sdk-mcp` tool call (run with `node dist/cli/main.js call ...` on 2026-10-14), and
nothing was taken from memory. It is this project's own code, not a copy of an Esri sample.

It was then opened in a headless Microsoft Edge from a local web server: it loaded
ArcGIS Maps SDK for JavaScript 5.1.27 from the CDN, drew the countries layer and the
clustered earthquakes with count labels, and reported "10,199 earthquakes in the feed". The
screenshot is not committed, because the map shows Esri-hosted data and attribution.

## The calls and what each one confirmed

| Call                                                                                               | Used for                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_versions {"product":"js-maps-sdk"}`                                                           | The documentation describes 5.1; `@arcgis/core` 5.1.27 is the npm `latest`. The CDN URL uses `5.1`                                             |
| `find_samples {"query":"clustering","product":"js-maps-sdk","limit":3}`                            | "Intro to clustering" enables clustering on a `GeoJSONLayer`                                                                                   |
| `read {"ref":".../sample-code/featurereduction-cluster/","section":"source"}`                       | The 5.x page structure: `<script type="module" src="https://js.arcgis.com/5.1/">`, `<arcgis-map>`, slots, `$arcgis.import([...])`, `{cluster_count}` |
| `lookup_symbol {"symbol":"FeatureLayer.featureReduction","detail":"signature"}`                    | `featureReduction` takes a `FeatureReductionUnion`, or `null` to turn it off                                                                   |
| `lookup_symbol {"symbol":"FeatureReductionCluster","detail":"summary"}`                            | `clusterRadius`, `clusterMinSize`, `clusterMaxSize`, `labelingInfo`, `popupTemplate`; label deconfliction off for labels inside clusters       |
| `lookup_symbol {"symbol":"GeoJSONLayer","detail":"signature"}`                                     | The CDN import path `@arcgis/core/layers/GeoJSONLayer.js`                                                                                      |
| `lookup_symbol {"symbol":"GeoJSONLayer.queryFeatureCount","detail":"signature"}`                   | `queryFeatureCount(query?, options?): Promise<number>`                                                                                         |
| `lookup_symbol {"symbol":"FeatureLayer.portalItem","detail":"signature"}`                          | Loading the background layer from a portal item                                                                                                |
| `lookup_symbol {"symbol":"arcgis-map.basemap","detail":"summary"}`                                 | The basemap styles service requires an access token, so the app uses no basemap and needs no key                                              |
| `lookup_symbol {"symbol":"arcgis-map.scale","detail":"signature"}`                                 | `scale` is a number property (set as an attribute)                                                                                             |
| `lookup_symbol {"symbol":"arcgis-legend"}`, `{"symbol":"arcgis-zoom"}`                             | Both components exist in `@arcgis/map-components` 5.1.27                                                                                       |
| `read {"ref":".../map-components/components/arcgis-map/","section":"slots"}`                       | Slots `top-left`, `top-right`, `bottom-left`, `bottom-right`                                                                                   |

`...` stands for `https://developers.arcgis.com/javascript/latest/references` or
`https://developers.arcgis.com/javascript/latest` as appropriate. Every product argument was
`js-maps-sdk`.

## Data

- Earthquakes: the public USGS GeoJSON feed of the last 30 days,
  `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson`.
- Countries: the public ArcGIS Online item `2b93b06dc0dc4e809d3c8db5cb96ba69` (World Countries
  Generalized, Esri), the same item Esri's clustering sample uses as background.

## Run it

```sh
cd examples/agent-builds-a-map-app/output/hand-checked
npx http-server -p 8080 .
```

Then open `http://127.0.0.1:8080/`. Any static web server works; `file://` does not.
