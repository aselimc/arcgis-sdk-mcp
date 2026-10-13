# Open-source fixtures

Files in this directory were published by Esri under the Apache License, Version 2.0, and are
copied here unmodified (line endings normalised to LF) unless the table says otherwise. They are
test inputs only and are not part of the published package. Each `*.expected.md` file next to
them is output of this project's renderers for that input and is covered by the same licence as
its source.

Licence text: <https://www.apache.org/licenses/LICENSE-2.0>. The copyright of every file stays
with its authors (Esri and contributors); see the linked repositories for their `LICENSE` and
`NOTICE` files.

| Path | Source | Revision | Licence | Notes |
| --- | --- | --- | --- | --- |
| `arcgis-rest-request/request.d.ts` | <https://cdn.jsdelivr.net/npm/@esri/arcgis-rest-request@4.11.0/dist/esm/request.d.ts> | npm `@esri/arcgis-rest-request@4.11.0`, built from `Esri/arcgis-rest-js` commit `6b32d2da8302c79837c94361548466f1bd4406f9` | Apache-2.0 (`license` field of the package) | Compiler output of `packages/arcgis-rest-request/src/request.ts` |
| `arcgis-rest-request/ApplicationCredentialsManager.d.ts` | <https://cdn.jsdelivr.net/npm/@esri/arcgis-rest-request@4.11.0/dist/esm/ApplicationCredentialsManager.d.ts> | as above | Apache-2.0 | |
| `arcgis-rest-request/IRequestOptions.d.ts` | <https://cdn.jsdelivr.net/npm/@esri/arcgis-rest-request@4.11.0/dist/esm/utils/IRequestOptions.d.ts> | as above | Apache-2.0 | |
| `arcgis-rest-request/ErrorTypes.d.ts` | <https://cdn.jsdelivr.net/npm/@esri/arcgis-rest-request@4.11.0/dist/esm/utils/ErrorTypes.d.ts> | as above | Apache-2.0 | |
| `arcgis-maps-sdk-swift-samples/display-map/README.md` | <https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/83c016f9a25c567bbed328e1259a70acb864e691/Shared/Samples/Display%20map/README.md> | commit `83c016f9a25c567bbed328e1259a70acb864e691` | Apache-2.0 (`LICENSE` of the repository) | |
| `arcgis-maps-sdk-swift-samples/display-map/README.metadata.json` | <https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/83c016f9a25c567bbed328e1259a70acb864e691/Shared/Samples/Display%20map/README.metadata.json> | as above | Apache-2.0 | |
| `arcgis-maps-sdk-swift-samples/display-map/DisplayMapView.swift` | <https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/83c016f9a25c567bbed328e1259a70acb864e691/Shared/Samples/Display%20map/DisplayMapView.swift> | as above | Apache-2.0 (file header) | |
| `arcgis-pro-sdk/ArcGIS.Desktop.GeoProcessing.excerpt.xml` | <https://github.com/Esri/arcgis-pro-sdk/blob/e2faf732a96e5acda0fda4bb59fc718c021bc38f/References/ArcGIS%20Pro%20API/ArcGIS.Desktop.GeoProcessing.XML> | commit `e2faf732a96e5acda0fda4bb59fc718c021bc38f` | Apache-2.0 (`License.txt` of the repository) | **Excerpt**: the `<assembly>` header and the 27 `<member>` elements of `FontAlignemt`, `TaskPropertyItem` and `GeoprocessingProjectItem`, unchanged; all other members removed |

Retrieved on 2026-10-13.
