# Demos and real output

Everything on this page is real output of this server. Outputs are shortened: `[...]` marks
where text was removed, including Esri's documentation prose, which this repository does not
reproduce. Run the same commands to see full answers; versions and hit counts change as the
documentation does.

- [The terminal recording](#the-terminal-recording)
- [The six tools, one real call each](#the-six-tools-one-real-call-each)
- [Errors](#errors)
- [doctor](#doctor)
- [The quickstart client](#the-quickstart-client)
- [The agent demo](#the-agent-demo)
- [Regenerating the images](#regenerating-the-images)

## The terminal recording

<p align="center">
  <img src="assets/hero-terminal.svg" width="900" alt="Terminal recording of three real tool calls: get_versions for the ArcGIS Maps SDK for JavaScript, lookup_symbol for arcpy.da.SearchCursor and find_samples for the Swift Maps SDK.">
</p>

The animation at the top of the README plays three calls of the built CLI. Its text, exactly
as rendered, is [assets/hero-terminal.txt](assets/hero-terminal.txt);
`scripts/render-hero.ts` ran the calls, trimmed them and wrote both files.

## The six tools, one real call each

The examples below are real output of `arcgis-sdk-mcp call` (from a clone:
`node dist/cli/main.js call`), recorded on 2026-10-13 and 2026-10-14 and shortened.

### `arcgis_docs_list_products`

```sh
arcgis-sdk-mcp call list_products '{"category":"native"}'
```

```text
ArcGIS products | category: native | 5 of 5

## native
- dotnet-maps-sdk: ArcGIS Maps SDK for .NET, 300.x. Native mapping SDK for .NET apps on WPF, .NET MAUI and WinUI in C#: 2D/3D maps, offline data, routing, geocoding.
- flutter-maps-sdk: ArcGIS Maps SDK for Flutter, 300.x. Mapping SDK for cross-platform Flutter apps in Dart on Android and iOS: maps, scenes, offline data, routing.
- kotlin-maps-sdk: ArcGIS Maps SDK for Kotlin, 300.x. Native mapping SDK for Android apps in Kotlin with Jetpack Compose: 2D/3D maps, offline data, routing, geocoding.
[...]

Next: arcgis_docs_list_products({"product":"dotnet-maps-sdk"})
```

With `product` it returns the profile (packages, version lines, documentation sources,
start-here links, pitfalls); with `product` and `section` the table of contents of one
source. The product summaries are this project's own wording.

### `arcgis_docs_get_versions`

```sh
arcgis-sdk-mcp call get_versions '{"product":"js-maps-sdk"}'
```

```text
Versions as of 2026-10-13 | js-maps-sdk

## ArcGIS Maps SDK for JavaScript (js-maps-sdk), active
Documentation describes: 5.1, released 2026-06 (https://developers.arcgis.com/javascript/latest/)
Installable:
- @arcgis/core 5.1.27 on npm [latest] (https://registry.npmjs.org/-/package/@arcgis/core/dist-tags)
Pre-release:
- rc: 5.2.0-next.145
- next: 6.0.0-next.6
Install:
- npm install @arcgis/core
[...]
Compatibility:
- ArcGIS Enterprise: 12.2 (https://developers.arcgis.com/javascript/latest/version-matrix/)
- Calcite components: 5.1.* (https://developers.arcgis.com/javascript/latest/version-matrix/)
[...]
Release notes:
- 5.1: https://developers.arcgis.com/javascript/latest/release-notes/
[...]

Next: arcgis_docs_read({"ref":"https://developers.arcgis.com/javascript/latest/release-notes/"})
Source: Esri documentation at the refs above (retrieved 2026-10-13). [...]
```

With no arguments it reports every Esri SDK it detects in the project's manifests.

### `arcgis_docs_search`

```sh
arcgis-sdk-mcp call search '{"query":"FeatureLayer queryFeatures","product":"js-maps-sdk","limit":4}'
```

```text
Search "FeatureLayer queryFeatures" | products: js-maps-sdk, resolved from "js-maps-sdk" | line: latest | mode: local index (site search off) | hits 1-4 of 103
Note: More hits: arcgis_docs_search({"query":"FeatureLayer queryFeatures","product":"js-maps-sdk","limit":4,"cursor":"eyJ2Ijox[...]"})

1. queryFeatures() [api, method] js-maps-sdk/core 5.1
   https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/#queryFeatures
   In: @arcgis/core/layers/FeatureLayer
   [...]
2. Query features from a FeatureLayerView [sample] js-maps-sdk/samples 5.1
   https://developers.arcgis.com/javascript/latest/sample-code/featurelayerview-query/
3. Query FeatureLayer [sample] js-maps-sdk/samples 5.1
   https://developers.arcgis.com/javascript/latest/sample-code/featurelayer-query/
[...]

Next: arcgis_docs_read({"ref":"https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/#queryFeatures"})
Source: Esri documentation at the refs above (retrieved 2026-10-14). [...]
```

Without `product` the search uses the SDKs detected in the project, or picks at most three
likely products and names them in the status line.

### `arcgis_docs_read`

```sh
arcgis-sdk-mcp call read '{"ref":"https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/","max_tokens":1500}'
```

```text
Query (Feature Service/Layer) | ArcGIS REST APIs (rest-api) | version 12.1 | api | cached

- **URL:** `https://<root>/<serviceName>/FeatureServer/<layerId>/query`
- **Methods:** `GET`, `POST`
[...]

Outline (pass an id as "section" to read that part):

- `query-feature-servicelayer` Query (Feature Service/Layer) (~23210 tokens)
  - `description` Description (~418 tokens)
  - `features-added-throughout-releases` Features added throughout releases (~2088 tokens)
  - `request-parameters` Request parameters (~14567 tokens)
  - `example-usage` Example usage (~1658 tokens)
  - `json-response-syntax` JSON Response syntax (~396 tokens)
  - `json-response-example` JSON Response example (~4075 tokens)

Next: arcgis_docs_read({"ref":"https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/","section":"request-parameters"})
Source: Esri, https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/ (retrieved 2026-10-13, cached). Copyright (c) Esri. Use subject to Esri's terms: https://www.esri.com/en-us/legal/overview
```

A 23,000-token page costs 1,500 tokens here, and the agent knows which section to ask for.
`view: "outline"` returns only the outline, `view: "full"` pages through the document with a
cursor, and `section: "source"` on a sample returns only its code.

### `arcgis_docs_lookup_symbol`

```sh
arcgis-sdk-mcp call lookup_symbol '{"symbol":"FeatureLayer.queryFeatures","detail":"signature"}'
```

````text
@arcgis/core/layers/FeatureLayer.queryFeatures (method) | ArcGIS Maps SDK for JavaScript (js-maps-sdk), resolved from "FeatureLayer.queryFeatures" | version 5.1 | api | cached
Note: The product js-maps-sdk was inferred from the name; pass "product" to look in another.

### queryFeatures

```ts
queryFeatures (query?: QueryProperties | null | undefined, options?: RequestOptions): Promise<FeatureSet>
```

[...]
Source: Esri, https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/#queryFeatures (retrieved 2026-10-13, cached). [...]
````

```sh
arcgis-sdk-mcp call lookup_symbol '{"symbol":"arcpy.da.SearchCursor","detail":"signature"}'
```

````text
arcpy.da.SearchCursor (class) | ArcPy and geoprocessing tools (arcpy), resolved from "arcpy.da.SearchCursor" | version 3.7 | api | cached

```python
SearchCursor(in_table, field_names, {where_clause}, {spatial_reference}, {explode_to_points}, {sql_clause}, {datum_transformation}, {spatial_filter}, {spatial_relationship}, {search_order})
```

# SearchCursor

[...]

Other matches:
- {"symbol":"arcpy.SearchCursor","product":"arcpy"} (function): https://doc.esri.com/en/arcgis-pro/latest/arcpy/functions/searchcursor.html

Next: arcgis_docs_lookup_symbol({"symbol":"arcpy.da.SearchCursor","product":"arcpy","detail":"summary"})
Source: Esri, https://doc.esri.com/en/arcgis-pro/latest/arcpy/data-access/searchcursor-class.html (retrieved 2026-10-13, cached). [...]
````

The product was resolved from the qualified name. `detail: "summary"` (the default) adds the
description, parameters, return value and one example, or the member index of a type;
`"full"` returns everything within `max_tokens`. An ambiguous name lists the candidates as
copyable calls, and a name that is not found lists the nearest names with the reminder that
this does not prove the symbol does not exist.

### `arcgis_docs_find_samples`

```sh
arcgis-sdk-mcp call find_samples '{"query":"download offline map","product":"swift-maps-sdk","limit":3}'
```

```text
Samples for "download offline map" | product: swift-maps-sdk | line: latest | pinned to 300.1.0 | 3 of 74

1. Download preplanned map area [swift-maps-sdk, swift, github, apache-2.0]
   https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/v300.1.0/Shared/Samples/Download%20preplanned%20map%20area/README.md
   [...]
   In: Edit and Manage Data
   APIs: DownloadPreplannedOfflineMapResult, OfflineMapTask, [...], PreplannedMapArea
   File: DownloadPreplannedMapAreaView.swift https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/v300.1.0/Shared/Samples/Download%20preplanned%20map%20area/DownloadPreplannedMapAreaView.swift
   [...]
2. Generate offline map with local basemap [swift-maps-sdk, swift, github, apache-2.0]
   [...]
3. Generate offline map [swift-maps-sdk, swift, github, apache-2.0]
   [...]

Next: arcgis_docs_read({"ref":"https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/v300.1.0/Shared/Samples/Download%20preplanned%20map%20area/README.md","section":"source"})
Source: Esri documentation at the refs above (retrieved 2026-10-13). [...]
```

GitHub samples are pinned to a release tag where the repository's tags are reliable.
`uses_api` finds samples that use a given class or method, `platform` narrows a
multi-platform SDK (`maui`, `wpf`, `winui`), and `with_code: true` also returns the main
source file of the best hit.

## Errors

A failed call says what went wrong and what to do next, in one line:

```text
Error [LINK_ONLY]: https://archive.developers.arcgis.com/javascript/v4-34/ is not fetched by this server. archive.developers.arcgis.com excludes automated access. Next: Open https://archive.developers.arcgis.com/javascript/v4-34/ in a browser, or see what that version is with arcgis_docs_get_versions({"product":"js-maps-sdk","version":"4.34"}).
```

## doctor

`doctor` checks the configuration, the cache directory, proxy variables and the GitHub
quota, then probes the documentation sources through the normal gateway:

```text
[ok]   config: arcgis-sdk-mcp 0.1.0, Node 22.15.0, stdio mode
[ok]   policy: preset standard
       enabled: github, registries, local-packages, workspace, website, site-index, package-cdn
       disabled: site-search, lifecycle-api
[ok]   proxy: no proxy variables are set
[ok]   adapters: 20 source adapters, 136 products
[warn] github: unauthenticated (60 requests per hour), quota not read yet
[...]
Sources probed: 2 ok, 0 failed, 0 skipped
[ok]   calcite/guide (gatsby, floor, 180 records, 27590 chars, 6 ms)
[ok]   calcite/components (npm-cem, 4 records, 85 chars, 6 ms)

Result: ok
```

## The quickstart client

[examples/quickstart-client](../examples/quickstart-client/) drives the server over MCP stdio
with the official TypeScript client and walks one agent task (pick the product, check the
version, search, look up the API, find a sample), reading each step's `structuredContent` to
choose the next call. [Its transcript](../examples/quickstart-client/transcript.txt) is a real
run from 2026-10-14, trimmed by the same rules as the terminal recording.

## The agent demo

[examples/agent-builds-a-map-app](../examples/agent-builds-a-map-app/) gives Claude the six
tools and asks it to build a small ArcGIS Maps SDK for JavaScript app, checking every API
with the tools first. **It has not been run for this repository yet**, because no Anthropic
API key was available; its README says what was checked instead. The app in its
`output/hand-checked/` directory was written by hand from tool output, by the same rules, and
is labelled as such.

## Regenerating the images

The images in [assets/](assets/) are generated by committed scripts, never drawn by hand:

| Image                                                 | Script                           | Input                                   |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------- |
| `hero-terminal.svg`, `hero-terminal.txt`              | `scripts/render-hero.ts`         | three live calls of the built CLI       |
| `coverage-light.svg`, `coverage-dark.svg`             | `scripts/render-coverage.ts`     | the registry (`src/registry`)           |
| `architecture-light.svg`, `architecture-dark.svg`     | `scripts/render-architecture.ts` | counts read from the source tree        |
| `social-preview.svg`, `social-preview.png` (1280x640) | `scripts/render-social.ts`       | the source tree and `hero-terminal.txt` |

```sh
npm run build
npx tsx scripts/render-hero.ts            # live calls; --offline re-renders from hero-terminal.txt
npx tsx scripts/render-coverage.ts
npx tsx scripts/render-architecture.ts
npx tsx scripts/render-social.ts          # needs Microsoft Edge or Chrome for the PNG (BROWSER=...)
```

The README shows the light or dark variant of a chart according to the reader's GitHub
theme. The terminal recording has its own dark background and reads the same in both.
