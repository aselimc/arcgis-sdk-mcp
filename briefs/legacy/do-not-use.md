---
title: Legacy ArcGIS technology - do not use for new code
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/javascript/latest/faq/
  - https://developers.arcgis.com/javascript/latest/components-transition-plan/
  - https://developers.arcgis.com/kotlin/reference/migrate-from-100-x-to-200-x/
  - https://developers.arcgis.com/java/v200/
  - https://developers.arcgis.com/appstudio/
  - https://developers.arcgis.com/web-appbuilder/
  - https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-web-appbuilder-000036340
  - https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-geoevent-server-000041462
  - https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-maps-sdk-for-java-000032164
  - https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437
---

# Legacy ArcGIS technology - do not use for new code

Old ArcGIS material is abundant on the web and in model memory, and much of it covers retired or deprecated products. If a result, snippet or dependency matches a row below, use the successor. If the user maintains such a system, say so and limit the work to maintenance or migration.

| Do not use                        | State                                                                                                                                         | Use instead                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ArcMap, ArcObjects, ArcGIS Engine | retired; documentation host is link-only here                                                                                                 | `arcgis-pro-sdk`, `arcpy`                                                                                            |
| ArcGIS Runtime SDKs 100.x         | long-term support line near its end                                                                                                           | `kotlin-maps-sdk`, `swift-maps-sdk`, `dotnet-maps-sdk`, `qt-maps-sdk`, `flutter-maps-sdk`; `brief:native/200-vs-300` |
| ArcGIS Maps SDK for Java          | deprecated, no further releases ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-maps-sdk-for-java-000032164))      | another native SDK                                                                                                   |
| ArcGIS API for JavaScript 3.x     | retired July 1, 2024; migration is a rewrite ([FAQ](https://developers.arcgis.com/javascript/latest/faq/))                                    | `js-maps-sdk`                                                                                                        |
| JavaScript SDK widgets            | deprecated as of 5.0 ([plan](https://developers.arcgis.com/javascript/latest/components-transition-plan/))                                    | components; `brief:js/4x-to-5x`                                                                                      |
| ArcGIS AppStudio                  | retired ([notice on its home page](https://developers.arcgis.com/appstudio/))                                                                 | a native Maps SDK                                                                                                    |
| ArcGIS Web AppBuilder             | retired or retiring in every deployment ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-web-appbuilder-000036340)) | `experience-builder`                                                                                                 |
| ArcGIS GeoEvent Server            | deprecated, final release scheduled ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-geoevent-server-000041462))    | ArcGIS Velocity                                                                                                      |

## Dead npm packages

| Package                                        | Why                                            | Use instead                                  |
| ---------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `arcgis-js-api`                                | legacy AMD build, repository archived          | `@arcgis/core`, `@arcgis/map-components`     |
| `esri-loader`                                  | loader for that build, repository archived     | ES modules, or the CDN with `$arcgis.import` |
| `@arcgis/cli`                                  | ended at a 4.x release                         | `@arcgis/create`                             |
| `@arcgis/ai-orchestrator`, `@arcgis/ai-agents` | 5.0 only, folded into the package on the right | `@arcgis/ai-components`                      |

## Recognising legacy material

- A URL on `desktop.arcgis.com` or on Esri's archive host: this server answers with a link only, by design.
- JavaScript reference links like `api-reference/esri-*.html`: 4.x addressing; look the symbol up again.
- Native code with `AGS`-prefixed classes or "ArcGIS Runtime" in a type name: 100.x.
- `v200` in a native SDK URL is the maintenance line, not legacy: confirm the project is on 200.x.

For status and dates search `support-kb` for the product's deprecation notice and call `arcgis_docs_get_versions`; do not quote a date from memory.
