---
title: Which ArcGIS developer product for which goal
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/documentation/
  - https://developers.arcgis.com/javascript/latest/
  - https://developers.arcgis.com/rest/
  - https://developers.arcgis.com/python/latest/
  - https://developers.arcgis.com/experience-builder/
  - https://developers.arcgis.com/enterprise-sdk/
  - https://developers.arcgis.com/documentation/security-and-authentication/
---

# Which ArcGIS developer product for which goal

Routing table from what the user wants to build to the product id used by the `arcgis_docs_*` tools. Esri's own catalog is the [documentation home](https://developers.arcgis.com/documentation/). When the project already contains an ArcGIS dependency, that dependency decides; this table is for a fresh start or an unclear request.

## Web

| Goal | Product id |
| --- | --- |
| Interactive 2D or 3D map app in the browser, Esri's full feature set | `js-maps-sdk` |
| UI components and design system that match ArcGIS | `calcite` |
| Call ArcGIS services from JavaScript or Node without a map (auth, geocode, route, portal items) | `rest-js` |
| Keep an open-source map library and add ArcGIS basemaps and services | `esri-leaflet`, `maplibre-arcgis`, `openlayers-arcgis`, `cesium-arcgis` |
| Configurable app with custom widgets instead of a hand-written app | `experience-builder` |
| Expressions for pop-ups, labels, symbology, field calculations | `arcade` |
| JSON format of web maps and web scenes | `web-map-spec`, `web-scene-spec` |

## Native, mobile, game engines

| Goal | Product id |
| --- | --- |
| iOS, macOS | `swift-maps-sdk` |
| Android | `kotlin-maps-sdk` |
| Windows desktop, .NET MAUI | `dotnet-maps-sdk` |
| Cross-platform C++ / QML | `qt-maps-sdk` |
| Cross-platform Flutter | `flutter-maps-sdk` |
| Real-world terrain and layers inside a game engine | `unity-maps-sdk`, `unreal-maps-sdk` |
| JavaFX desktop | `java-maps-sdk` exists but is deprecated: choose another native SDK (`brief:native/200-vs-300`) |

## Python, automation, data science

| Goal | Product id |
| --- | --- |
| Script a portal, manage content and users, notebooks, analysis from outside ArcGIS Pro | `python-api` |
| Geoprocessing tools, map automation, anything that needs ArcGIS Pro or Server installed | `arcpy` |
| Spatial analysis at scale on Spark | `geoanalytics-engine` |
| R | `r-arcgis` |

## Extending Esri's own software

| Goal | Product id |
| --- | --- |
| Add-in or configuration for ArcGIS Pro (.NET) | `arcgis-pro-sdk` |
| Extend ArcGIS Enterprise services: server object extensions and interceptors, custom data feeds | `enterprise-sdk` |

## Services and cross-cutting topics

| Goal | Product id |
| --- | --- |
| Raw HTTP requests to any ArcGIS service, any language | `rest-api` (read `brief:rest/deployment-variants` first) |
| Concepts shared by all SDKs: authentication, location services, data hosting, offline | `developer-guide` (for authentication start with `brief:auth/choosing-authentication`) |
| Accounts, billing and pricing of Esri-hosted location services | `location-platform` |
| AI assistants in an app, or agents calling ArcGIS through MCP | `ai-agents` (read `brief:ai/overview` first) |
| Error messages, known bugs, deprecation notices | `support-kb` |

## Rules

- Use `arcgis_docs_list_products` for the complete list, including product help for ArcGIS Online, ArcGIS Pro and ArcGIS Enterprise.
- Do not pick a retired technology because old examples are easy to find: see `brief:legacy/do-not-use`.
