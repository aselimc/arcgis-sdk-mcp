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

A remote MCP server hosted by Esri that lets an AI client call ArcGIS Location Services. Tools have been renamed between beta releases: read the [release notes](https://developers.arcgis.com/ai/mcp-arcgis-location-services/release-notes/beta/) before hard-coding a name.

## Endpoint

`https://location-services-mcp.arcgis.com/beta/mcp`, Streamable HTTP only; there is no stdio build. Requests without a bearer access token get `401`.

## Authentication

- The token comes from an ArcGIS Location Platform account: API key credentials with selected privileges, or OAuth 2.0 user or app authentication ([get started](https://developers.arcgis.com/ai/mcp-arcgis-location-services/get-started/)).
- The server lists only the tools that the token's privileges allow ([FAQ](https://developers.arcgis.com/ai/mcp-arcgis-location-services/faq/)). A missing tool usually means a missing privilege.

## Tools and required privilege ([reference](https://developers.arcgis.com/ai/mcp-arcgis-location-services/tools/))

| Tools                                                 | Privilege                              |
| ----------------------------------------------------- | -------------------------------------- |
| `find_address_candidates`, `reverse_geocode`          | Geocoding, stored (pay-as-you-go only) |
| `solve_route`                                         | Routing, simple routing                |
| `elevation_at_locations`                              | Elevation                              |
| `map_with_overlay` (PNG with points, lines, polygons) | Static maps                            |
| `get_topic_fields`, then `describe_location`          | GeoEnrichment (pay-as-you-go only)     |
| `buffer` (point input, metres)                        | Allow beta access                      |

Basemap styles, places and static basemap tiles are not available through MCP ([support table](https://location.arcgis.com/help/agentic-ai/)). The server also offers [prompt templates](https://developers.arcgis.com/ai/mcp-arcgis-location-services/prompts/), for example a route between two addresses.

## Pricing rule

No MCP surcharge: every successful call to an underlying service is metered at that service's rate ([pricing](https://developers.arcgis.com/ai/mcp-arcgis-location-services/pricing/)). An agent loop that geocodes repeatedly costs money, so cache results and cap iterations.

## Caveats

- Esri's pages disagree on details such as a tool's spelling or the linked protocol revision. Trust the tools page and the live `tools/list` answer.
- Only Esri-hosted location services are covered. For an Enterprise portal read `brief:ai/mcp-enterprise-beta`; for an assistant inside a web app read `brief:ai/js-ai-components-constraints`.
