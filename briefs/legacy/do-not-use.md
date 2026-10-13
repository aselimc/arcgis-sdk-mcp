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

Old ArcGIS material is abundant on the web and in model memory, and much of it describes products that are retired or deprecated. If a search result, a snippet or a dependency matches a row below, do not build on it: use the successor. When the user maintains an existing system on one of these, say so explicitly and limit the work to maintenance or migration.

## Products

| Do not use | State | Use instead |
| --- | --- | --- |
| ArcMap, ArcObjects, ArcGIS Engine (ArcGIS Desktop 10.x) | retired; their documentation host is not read by this server | ArcGIS Pro with `arcgis-pro-sdk` (.NET add-ins) or `arcpy` |
| ArcGIS Runtime SDKs 100.x (Android, iOS, .NET, Qt, Java) | long-term support line in its final phase | the ArcGIS Maps SDKs: `kotlin-maps-sdk`, `swift-maps-sdk`, `dotnet-maps-sdk`, `qt-maps-sdk`, `flutter-maps-sdk` ([migration](https://developers.arcgis.com/kotlin/reference/migrate-from-100-x-to-200-x/), `brief:native/200-vs-300`) |
| ArcGIS Maps SDK for Java | deprecated, no further releases ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-maps-sdk-for-java-000032164)) | another native SDK |
| ArcGIS API for JavaScript 3.x | retired on July 1, 2024; migrating means a rewrite ([FAQ](https://developers.arcgis.com/javascript/latest/faq/)) | `js-maps-sdk` |
| Widgets of the JavaScript SDK | deprecated as of 5.0, removal planned ([transition plan](https://developers.arcgis.com/javascript/latest/components-transition-plan/)) | web components (`brief:js/4x-to-5x`) |
| ArcGIS AppStudio | retired ([home page notice](https://developers.arcgis.com/appstudio/)) | a native Maps SDK |
| ArcGIS Web AppBuilder, including the developer edition | retired or retiring in every deployment ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-web-appbuilder-000036340)) | `experience-builder` |
| ArcGIS GeoEvent Server | deprecated; a final release is scheduled ([notice](https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-geoevent-server-000041462)) | ArcGIS Velocity |

## npm packages that are dead ends

| Package | Why | Use instead |
| --- | --- | --- |
| `arcgis-js-api` | legacy AMD build; its repository is archived | `@arcgis/core`, `@arcgis/map-components` |
| `esri-loader` | loader for the AMD build; repository archived | ES modules from `@arcgis/core`, or the CDN with `$arcgis.import` |
| `@arcgis/cli` | stopped at a 4.x release | `@arcgis/create` to scaffold an app |
| `@arcgis/ai-orchestrator`, `@arcgis/ai-agents` | published for 5.0 only, then folded into `@arcgis/ai-components` | `@arcgis/ai-components` (`brief:ai/js-ai-components-constraints`) |

## How to recognise legacy material

- URL on `desktop.arcgis.com` or on Esri's archive host: this server answers with a link only, by design.
- JavaScript reference links of the form `api-reference/esri-*.html`: 4.x addressing. Look the symbol up again.
- Native code with `AGS`-prefixed classes or "ArcGIS Runtime" in a type name: 100.x.
- A `v200` path segment in a native SDK URL is not legacy in this sense, but it is the maintenance line: confirm that the project really is on 200.x.

For formal status and dates of any product, search `support-kb` for its deprecation notice, and ask `arcgis_docs_get_versions` for the life-cycle facts rather than quoting a date from memory.
