---
title: REST docs - Location Platform, ArcGIS Online and ArcGIS Enterprise variants
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/rest/
  - https://developers.arcgis.com/rest/geocode/
  - https://developers.arcgis.com/rest/services-reference/enterprise/find-address-candidates/
  - https://developers.arcgis.com/rest/services-reference/enterprise/feature-service/
  - https://developers.arcgis.com/rest/services-reference/online/
  - https://developers.arcgis.com/rest/users-groups-and-items/
  - https://developers.arcgis.com/rest/enterprise-administration/
---

# REST docs - Location Platform, ArcGIS Online and ArcGIS Enterprise variants

The same REST operation can be documented on more than one page, because the service runs in more than one deployment. The pages are variants, not versions: parameters, limits, URLs and billing differ. Reading the wrong one produces requests that fail on the user's system. Establish the deployment before you search.

## Where each deployment is documented

| The user's service is | Read under | Notes |
| --- | --- | --- |
| Esri-hosted location service (geocoding, routing, GeoEnrichment, elevation, places, basemap styles, static maps) used with an ArcGIS Location Platform or ArcGIS Online account | [`/rest/`](https://developers.arcgis.com/rest/) and its service sites such as [`/rest/geocode/`](https://developers.arcgis.com/rest/geocode/) | pricing per deployment is on the service home page |
| A service on ArcGIS Enterprise or ArcGIS Server (feature, map, image, geoprocessing, geocode, routing and more) | [`/rest/services-reference/enterprise/`](https://developers.arcgis.com/rest/services-reference/enterprise/feature-service/) | the largest reference; also the general description of feature services |
| Administration of services hosted in ArcGIS Online | [`/rest/services-reference/online/`](https://developers.arcgis.com/rest/services-reference/online/) | a small set of hosted-service admin operations |
| Portal content, users, groups, items (the sharing API) for ArcGIS Online or an Enterprise portal | [`/rest/users-groups-and-items/`](https://developers.arcgis.com/rest/users-groups-and-items/) | one reference for both |
| Enterprise site administration (server, portal, notebook, Kubernetes) | [`/rest/enterprise-administration/`](https://developers.arcgis.com/rest/enterprise-administration/) | Enterprise only |

## How to tell from a page

- Location service pages end with a product support list. The geocoding service page marks ArcGIS Location Platform and ArcGIS Online as supported and sends ArcGIS Enterprise users to the Enterprise geocode service documentation.
- Enterprise reference pages carry "New at <release>" sections and "Introduced at ArcGIS Enterprise <release>" notes on parameters, as on [Find Address Candidates](https://developers.arcgis.com/rest/services-reference/enterprise/find-address-candidates/). A parameter introduced at a release newer than the user's Enterprise does not exist for them.
- None of these trees has a version in the URL. The Enterprise release is the version that matters: ask for it or read it from the service's REST info.

## Clues in the user's code

- Host `*.arcgis.com` service domains of Esri (for example `geocode-api.arcgis.com`, `route-api.arcgis.com`): Esri-hosted location services.
- `https://<their-host>/<context>/rest/services/...`: ArcGIS Enterprise or ArcGIS Server.
- `https://www.arcgis.com/sharing/rest/...` or `https://<their-host>/<context>/sharing/rest/...`: the sharing API.

## Working rule

Search inside the `rest-api` product with the deployment named in the query, check the URL prefix of each hit against the table, and state the deployment in the answer. When two variants of an operation exist, cite the one that matches and mention that the other differs.
