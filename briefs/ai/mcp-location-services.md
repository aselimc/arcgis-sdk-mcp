---
title: MCP for ArcGIS Location Services (beta)
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/get-started/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/tools/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/prompts/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/pricing/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/faq/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/release-notes/beta/
  - https://location.arcgis.com/help/agentic-ai/
---

# MCP for ArcGIS Location Services (beta)

An Esri-hosted remote MCP server that lets an AI client call ArcGIS Location Services. It is a beta: tool names have already been renamed between beta releases, so read the [release notes](https://developers.arcgis.com/ai/mcp-arcgis-location-services/release-notes/beta/) before hard-coding one.

## Endpoint and transport

- `https://location-services-mcp.arcgis.com/beta/mcp`, Streamable HTTP only. There is no stdio build and no package to install.
- Every request needs a bearer access token; without one the server answers `401`.

## Authentication ([get started](https://developers.arcgis.com/ai/mcp-arcgis-location-services/get-started/))

- An ArcGIS Location Platform account issues the token: either API key credentials with selected privileges, or OAuth 2.0 user or app authentication.
- The credential needs the beta-access privilege plus one privilege per service it will call.
- The server lists only the tools the token's privileges allow ([FAQ](https://developers.arcgis.com/ai/mcp-arcgis-location-services/faq/)). A missing tool usually means a missing privilege, not a missing feature.

## Tools ([reference](https://developers.arcgis.com/ai/mcp-arcgis-location-services/tools/))

| Group | Tools | Privilege |
| --- | --- | --- |
| Geocoding | `find_address_candidates`, `reverse_geocode` | Geocoding, stored geocodes (pay-as-you-go accounts only) |
| Routing | `solve_route` | Routing, simple routing |
| Elevation | `elevation_at_locations` | Elevation |
| Static maps | `map_with_overlay` (PNG with points, lines, polygons) | Static maps |
| Data enrichment | `get_topic_fields`, then `describe_location` | GeoEnrichment (pay-as-you-go accounts only) |
| Geometry | `buffer` (point input, metres) | Allow beta access |

Basemap styles, places and static basemap tiles are not exposed through MCP ([support table](https://location.arcgis.com/help/agentic-ai/)).

The server also publishes prompt templates such as a route between two addresses or a map of an address ([prompts](https://developers.arcgis.com/ai/mcp-arcgis-location-services/prompts/)).

## Pricing rule

There is no MCP surcharge. Each successful call to the underlying service is metered at that service's normal rate ([pricing](https://developers.arcgis.com/ai/mcp-arcgis-location-services/pricing/)), so an agent loop that geocodes repeatedly costs real money: cache results and cap iterations.

## Caveats

- Esri's own pages disagree on details (tool spelling on the pricing page, the protocol revision linked from the references page). Trust the tools page and the live `tools/list` answer.
- This server covers Esri-hosted location services only. For content in an ArcGIS Enterprise portal see `brief:ai/mcp-enterprise-beta`; for an assistant inside a web app see `brief:ai/js-ai-components-constraints`.
