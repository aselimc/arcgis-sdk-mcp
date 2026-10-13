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

Esri's AI material falls into three layers. Decide which one the task is in before reading anything else: they have different authentication, different maturity and different products.

## 1. AI inside your app

| Item | Status | Who can use it | Read next |
| --- | --- | --- | --- |
| JavaScript AI components (`@arcgis/ai-components`: `arcgis-assistant`, built-in and custom agents) | beta, no Esri technical support | signed-in members of an ArcGIS Online organization with AI assistants enabled; no API keys, no ArcGIS Enterprise | `brief:ai/js-ai-components-constraints`, then the [introduction](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-introduction/) |
| Python `arcgis.ai` (translate, analyze text, analyze image) | beta | a `GIS` connection to an ArcGIS Online organization with AI assistants enabled; consumes credits | [AI-powered services guide](https://developers.arcgis.com/python/latest/guide/introduction-to-ai-powered-services/) |
| Arcade AI functions | released, consumes credits | organization with AI premium services enabled | [function reference](https://developers.arcgis.com/arcade/function-reference/ai_functions/) |

## 2. AI reaching ArcGIS (Esri-hosted MCP servers)

| Item | Status | Auth | Read next |
| --- | --- | --- | --- |
| MCP for ArcGIS Location Services (geocoding, routing, elevation, static maps, enrichment) | beta | access token from ArcGIS Location Platform: API key or OAuth 2.0 | `brief:ai/mcp-location-services`, [docs](https://developers.arcgis.com/ai/mcp-arcgis-location-services/), [service support table](https://location.arcgis.com/help/agentic-ai/) |
| MCP in ArcGIS Enterprise | beta, Early Adopter only | ArcGIS Enterprise token | `brief:ai/mcp-enterprise-beta` |

## 3. AI helping you write ArcGIS code

- JavaScript: the [AI-assisted development guides](https://developers.arcgis.com/javascript/latest/ai-assisted-development/) give a project-instructions template, prompts and a validation checklist. They are about coding assistants, not about AI features in the resulting app.
- ArcGIS Pro SDK: Esri documents GitHub Copilot workflows and publishes `Esri/arcgis-pro-sdk-snippets` as reference code for assistants.
- Experience Builder: `Esri/arcgis-experience-builder-sdk-resources` ships a widget-development skill.

## The gate behind most of it

Assistant features are opt-in per ArcGIS Online organization: an administrator allows AI assistants, must not block beta apps for the beta ones, and custom roles need the privilege added. See [Configure AI](https://doc.arcgis.com/en/arcgis-online/administer/configure-assistants.htm). Design for that prerequisite and say so in the plan.

Everything marked beta can change without notice: check the release notes of the item before relying on a name or a parameter.
