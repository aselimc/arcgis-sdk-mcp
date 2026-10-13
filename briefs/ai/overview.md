---
title: Esri AI surface for developers
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/javascript/latest/agentic-apps/ai-introduction/
  - https://developers.arcgis.com/javascript/latest/ai-assisted-development/
  - https://developers.arcgis.com/ai/mcp-arcgis-location-services/
  - https://location.arcgis.com/help/agentic-ai/
  - https://developers.arcgis.com/documentation/
  - https://doc.arcgis.com/en/arcgis-online/administer/configure-assistants.htm
  - https://developers.arcgis.com/python/latest/guide/introduction-to-ai-powered-services/
---

# Esri AI surface for developers

Three layers, each with its own authentication and maturity. Identify the layer before reading further.

## AI inside your app

- **JavaScript AI components** (`@arcgis/ai-components`: `arcgis-assistant` and agents): beta, without Esri technical support. End users must be signed-in members of an ArcGIS Online organization that has AI assistants enabled; API keys and ArcGIS Enterprise do not work. Read `brief:ai/js-ai-components-constraints`, then the [introduction](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-introduction/).
- **Python `arcgis.ai`** (translate, analyze text, analyze image): beta; needs a `GIS` connection to such an organization and consumes credits ([guide](https://developers.arcgis.com/python/latest/guide/introduction-to-ai-powered-services/)).

## AI reaching ArcGIS: Esri's MCP servers

- **MCP for ArcGIS Location Services**: beta, hosted by Esri. Geocoding, routing, elevation, static maps and enrichment with an ArcGIS Location Platform token (API key or OAuth 2.0). Read `brief:ai/mcp-location-services`; [docs](https://developers.arcgis.com/ai/mcp-arcgis-location-services/), [supported services](https://location.arcgis.com/help/agentic-ai/).
- **MCP in ArcGIS Enterprise**: beta, Early Adopter program only, ArcGIS Enterprise token. Read `brief:ai/mcp-enterprise-beta`.

## AI helping you write ArcGIS code

- JavaScript: the [AI-assisted development guides](https://developers.arcgis.com/javascript/latest/ai-assisted-development/) provide a project-instructions template, prompts and a validation checklist. They concern coding assistants, not AI features in the finished app.
- ArcGIS Pro SDK: Esri documents GitHub Copilot workflows and publishes `Esri/arcgis-pro-sdk-snippets` as reference code for assistants.
- Experience Builder: `Esri/arcgis-experience-builder-sdk-resources` contains a widget-development skill.

## The gate behind most of it

Assistants are opt-in per ArcGIS Online organization: an administrator allows AI assistants, must not block beta apps for the beta ones, and custom roles need the privilege added ([Configure AI](https://doc.arcgis.com/en/arcgis-online/administer/configure-assistants.htm)). State this prerequisite in every design.

Beta items change without notice: read the item's release notes before relying on a name or parameter.
