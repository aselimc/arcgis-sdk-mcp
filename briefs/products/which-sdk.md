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

Routing table from a goal to the product id used by the `arcgis_docs_*` tools. Esri's own catalog is the [documentation home](https://developers.arcgis.com/documentation/). An ArcGIS dependency already present in the project decides; use this table for a fresh start or an unclear request.

## Web

| Goal                                                              | Product id                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Interactive 2D or 3D map app in the browser                       | `js-maps-sdk`                                                           |
| UI components matching ArcGIS                                     | `calcite`                                                               |
| Call ArcGIS services from JavaScript or Node without a map        | `rest-js`                                                               |
| Keep an open-source map library, add ArcGIS basemaps and services | `esri-leaflet`, `maplibre-arcgis`, `openlayers-arcgis`, `cesium-arcgis` |
| Configurable app with custom widgets                              | `experience-builder`                                                    |
| Expressions for pop-ups, labels, symbology                        | `arcade`                                                                |
| Web map or web scene JSON                                         | `web-map-spec`, `web-scene-spec`                                        |

## Native and game engines

| Goal                       | Product id                                               |
| -------------------------- | -------------------------------------------------------- |
| iOS, macOS                 | `swift-maps-sdk`                                         |
| Android                    | `kotlin-maps-sdk`                                        |
| Windows desktop, .NET MAUI | `dotnet-maps-sdk`                                        |
| C++ or QML                 | `qt-maps-sdk`                                            |
| Flutter                    | `flutter-maps-sdk`                                       |
| Unity, Unreal Engine       | `unity-maps-sdk`, `unreal-maps-sdk`                      |
| JavaFX                     | `java-maps-sdk` is deprecated: `brief:native/200-vs-300` |

## Python and data science

| Goal                                                       | Product id            |
| ---------------------------------------------------------- | --------------------- |
| Script a portal, content, users, notebooks                 | `python-api`          |
| Geoprocessing and map automation with ArcGIS Pro or Server | `arcpy`               |
| Large-scale spatial analysis with SQL functions and tools  | `geoanalytics-engine` |
| R                                                          | `r-arcgis`            |

## Extending Esri software

| Goal                                                         | Product id       |
| ------------------------------------------------------------ | ---------------- |
| ArcGIS Pro add-in (.NET)                                     | `arcgis-pro-sdk` |
| Server object extensions and interceptors, custom data feeds | `enterprise-sdk` |

## Services and shared topics

| Goal                                                                           | Product id                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| HTTP requests to any ArcGIS service                                            | `rest-api`; first `brief:rest/deployment-variants`            |
| Concepts across SDKs: authentication, location services, data hosting, offline | `developer-guide`; first `brief:auth/choosing-authentication` |
| Accounts and pricing of Esri-hosted location services                          | `location-platform`                                           |
| AI assistants in an app, agents using ArcGIS through MCP                       | `ai-agents`; first `brief:ai/overview`                        |
| Known problems, deprecation notices                                            | `support-kb`                                                  |

`arcgis_docs_list_products` gives the full list, including product help for ArcGIS Online, ArcGIS Pro and ArcGIS Enterprise. Do not choose a retired technology because old examples are easy to find: `brief:legacy/do-not-use`.
