---
title: JavaScript AI components - hard constraints
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/
  - https://developers.arcgis.com/javascript/latest/agentic-apps/ai-introduction/
  - https://developers.arcgis.com/javascript/latest/agentic-apps/ai-webmap-setup/
  - https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/
  - https://developers.arcgis.com/javascript/latest/release-notes/
  - https://github.com/Esri/jsapi-resources/tree/main/templates
---

# JavaScript AI components - hard constraints

`@arcgis/ai-components` (`arcgis-assistant` and its agents) is beta. A design that ignores the points below cannot be deployed. Sources: the [FAQ](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/) and the [introduction](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-introduction/).

## Who can use the app

1. Every end user signs in as a named member of an ArcGIS Online organization. Public and trial accounts do not qualify, and sign-in is required even for a public web map.
2. API keys cannot enable the components: no anonymous public app.
3. The organization has AI assistants enabled, does not block beta apps, and the user's role includes the AI assistant privilege.
4. ArcGIS Enterprise is not supported. Esri plans support in a later Enterprise release; treat dates as tentative.
5. Free during the beta; usage-based cost may follow.

## Fixed by Esri

6. The model behind the Esri agents and the orchestrator cannot be changed. Agents built with the agent utilities cannot bring their own model; a LangGraph agent can, with your own backend.
7. `arcgis-assistant` has no capability of its own: register at least one agent.

## Contract change at 5.1

8. The orchestrator-to-agent contract became structured: an agent receives an execution context (`userRequest`, `assignedTask`, `messages`, `priorSteps`, `sharedState`) and returns a result (`outputMessage`, `status`, `summary`, optional `sharedStatePatch`). 5.0 agents that exchange plain messages may stop working. Check the [release notes](https://developers.arcgis.com/javascript/latest/release-notes/) and verify types with `arcgis_docs_lookup_symbol`.

## Web map embeddings

Needed only by the web-map-based Esri agents ([setup](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-webmap-setup/)):

- They describe layer titles and field metadata, are stored on the web map item, and are generated in the item settings by its owner or an administrator.
- Agents see feature layers only. Use few layers with descriptive names, field aliases and descriptions; missing descriptions are model-generated and cannot be reviewed.

## Custom agents

Two routes ([guide](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/)): the agent utilities (`LLMAgent`, `FunctionAgent`, `WorkflowAgent`, `FunctionTool`, human-in-the-loop middleware) or a LangGraph agent. Start from the `ai-components-*` [templates](https://github.com/Esri/jsapi-resources/tree/main/templates). Never install `@arcgis/ai-orchestrator` or `@arcgis/ai-agents` (`brief:legacy/do-not-use`).
