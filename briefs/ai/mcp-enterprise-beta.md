---
title: MCP in ArcGIS Enterprise (beta, Early Adopter)
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/documentation/
  - https://doc.esri.com/en/arcgis-enterprise/latest/introduction/beta-features.html
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/
---

# MCP in ArcGIS Enterprise (beta, Early Adopter)

## Status

- The [documentation catalog](https://developers.arcgis.com/documentation/) announces it as beta and links only to the Early Adopter sign-up: <https://earlyadopter.esri.com/key/MCP>.
- The ArcGIS Enterprise documentation has no topic for it yet; only the general [beta features policy](https://doc.esri.com/en/arcgis-enterprise/latest/introduction/beta-features.html) applies.
- The technical details below come from the Early Adopter sandbox documentation, <https://mcpbeta.webgistesting.net/mcpdoc/>. That host is a test deployment which this server does not read and which may change or vanish at release. Re-check everything against the deployment you are given.

Never describe the feature as generally available or promise a release date.

## Shape

- Endpoint pattern `https://<host>/server/platform/mcp`, the "MCP catalog".
- Authentication: an ArcGIS Enterprise token, passed through the MCP client's own authentication mechanism.
- Pattern: discover, describe, invoke.
- Custom tools are published geoprocessing services, so the tool list differs per deployment.

## Default tools in the sandbox

| Tool                                                        | Purpose                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `search_portal_content`                                     | find portal items by filters or a raw query                      |
| `describe_item`                                             | full item information by item id                                 |
| `describe_layer`                                            | fields, geometry type, capabilities, example values              |
| `query_data`                                                | SQL-92 where clause, spatial filter, paging, sorting, statistics |
| `get_map_image`                                             | export an image from a map service                               |
| `find_address_candidates`, `reverse_geocode`, `solve_route` | geocoding and routing with the portal's services                 |
| `get_gp_task_definition`, `get_gp_task_job_status`          | inspect a geoprocessing task, poll its job                       |

## Rules for an agent

1. Call `describe_layer` before `query_data`: the query needs real field names and types.
2. Find the item first (`search_portal_content`, then `describe_item`) instead of assuming a layer URL.
3. Asynchronous geoprocessing returns a job: poll `get_gp_task_job_status`.

## Which Esri MCP server

Enterprise MCP serves an organization's own portal content. Esri-hosted geocoding, routing, elevation, static maps and enrichment are served by the open beta [MCP for ArcGIS Location Services](https://developers.arcgis.com/ai/mcp-arcgis-location-services/): `brief:ai/mcp-location-services`.
