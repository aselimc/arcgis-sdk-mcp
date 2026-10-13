---
title: REST docs - Location Platform, ArcGIS Online and ArcGIS Enterprise variants
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/rest/
  - https://developers.arcgis.com/rest/geocode/
  - https://developers.arcgis.com/rest/services-reference/enterprise/find-address-candidates/
  - https://developers.arcgis.com/rest/services-reference/enterprise/feature-service/
  - https://developers.arcgis.com/rest/services-reference/online/
  - https://developers.arcgis.com/rest/users-groups-and-items/working-with-users-groups-and-items/
  - https://developers.arcgis.com/rest/enterprise-administration/
---

# REST docs - Location Platform, ArcGIS Online and ArcGIS Enterprise variants

One REST operation can have several reference pages, because the service runs in several deployments. These pages are variants, not versions: parameters, limits, URLs and billing differ, and the wrong page yields requests that fail on the user's system. Establish the deployment before searching.

## Where each deployment is documented

| The user's service                                                                                                                                      | Read under                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Esri-hosted location service (geocoding, routing, GeoEnrichment, elevation, places, basemaps) with an ArcGIS Location Platform or ArcGIS Online account | [`/rest/`](https://developers.arcgis.com/rest/) and its service sites, such as [`/rest/geocode/`](https://developers.arcgis.com/rest/geocode/) |
| Service on ArcGIS Enterprise or ArcGIS Server (feature, map, image, geoprocessing, geocode, routing)                                                    | [`/rest/services-reference/enterprise/`](https://developers.arcgis.com/rest/services-reference/enterprise/feature-service/)                    |
| Administration of services hosted in ArcGIS Online                                                                                                      | [`/rest/services-reference/online/`](https://developers.arcgis.com/rest/services-reference/online/)                                            |
| Portal content, users, groups, items (sharing API), ArcGIS Online or Enterprise portal                                                                  | [`/rest/users-groups-and-items/`](https://developers.arcgis.com/rest/users-groups-and-items/working-with-users-groups-and-items/)              |
| Enterprise site administration (server, portal, notebook, Kubernetes)                                                                                   | [`/rest/enterprise-administration/`](https://developers.arcgis.com/rest/enterprise-administration/)                                            |

## Reading the signs on a page

- Location service pages end with a product support list. The geocoding service page marks ArcGIS Location Platform and ArcGIS Online as supported and refers ArcGIS Enterprise users to the Enterprise geocode service documentation.
- Enterprise reference pages have "New at <release>" sections and "Introduced at ArcGIS Enterprise <release>" notes on parameters, as on [Find Address Candidates](https://developers.arcgis.com/rest/services-reference/enterprise/find-address-candidates/). A parameter newer than the user's Enterprise release does not exist for them.
- No tree has a version in its URL. The Enterprise release is the version that matters: ask for it.

## Clues in the user's code

- `geocode-api.arcgis.com`, `route-api.arcgis.com`: Esri-hosted location services.
- `https://<their-host>/.../rest/services/...`: ArcGIS Enterprise or ArcGIS Server.
- `.../sharing/rest/...`: the sharing API.

## Working rule

Search the `rest-api` product with the deployment named in the query, compare each hit's URL prefix with the table, and state the deployment in the answer. When an operation has two variants, cite the matching one and say that the other differs.
