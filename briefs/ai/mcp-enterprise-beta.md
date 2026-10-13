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

- Esri announces "MCP in ArcGIS Enterprise (beta)" on the [developer documentation catalog](https://developers.arcgis.com/documentation/), but the card links only to the Early Adopter sign-up: <https://earlyadopter.esri.com/key/MCP>.
- There is no topic for it in the ArcGIS Enterprise product documentation yet. Only the generic [beta features policy](https://doc.esri.com/en/arcgis-enterprise/latest/introduction/beta-features.html) applies.
- The only public technical description is the Early Adopter sandbox documentation at <https://mcpbeta.webgistesting.net/mcpdoc/>. That host is a test deployment, not a documentation site: this server does not read it, and it can change or disappear when the feature is released. Everything below comes from it and must be re-checked against the deployment you are given.

Do not present this feature as generally available, and do not promise a release date.

## Shape of the server

- Endpoint pattern: `https://<host>/server/platform/mcp`, called the MCP catalog.
- Authentication: an ArcGIS Enterprise token (the portal's `generateToken`), passed through the MCP client's own authentication mechanism.
- Working pattern: discover, describe, invoke.
- Custom tools are published geoprocessing services, so the tool list differs per deployment.

## Default tool catalog (sandbox)

| Tool | Purpose |
| --- | --- |
| `search_portal_content` | find portal items with structured filters or a raw query |
| `get_search_portal_content_passthrough_instructions` | guidance for writing that raw query |
| `describe_item` | full item information by item id |
| `describe_layer` | fields, geometry type, capabilities, example values |
| `query_data` | SQL-92 where clause, spatial filter, paging, sorting, statistics |
| `get_map_image` | export an image from a map service |
| `find_address_candidates`, `reverse_geocode`, `solve_route` | geocoding and routing with the portal's configured services |
| `get_gp_task_definition`, `get_gp_task_job_status` | inspect a geoprocessing task, poll an asynchronous job |

## Rules for an agent using it

1. Call `describe_layer` before `query_data`. The query tool needs real field names and types; guessing them fails.
2. Find the item first (`search_portal_content`, then `describe_item`) instead of assuming a layer URL.
3. Asynchronous geoprocessing tools return a job: poll `get_gp_task_job_status`.

## Choosing between Esri's two MCP servers

- Enterprise MCP: the organization's own portal content and services, Early Adopter only.
- [MCP for ArcGIS Location Services](https://developers.arcgis.com/ai/mcp-arcgis-location-services/): Esri-hosted geocoding, routing, elevation, static maps and enrichment, open beta. See `brief:ai/mcp-location-services`.
