---
title: ArcGIS Maps SDK for JavaScript - moving from 4.x to 5.x
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/javascript/latest/release-notes/
  - https://developers.arcgis.com/javascript/latest/migrating-to-components/
  - https://developers.arcgis.com/javascript/latest/components-transition-plan/
  - https://developers.arcgis.com/javascript/latest/ai-assisted-development/upgrade-with-ai/
  - https://developers.arcgis.com/javascript/latest/ai-assisted-development/migrate-widgets-to-components/
  - https://developers.arcgis.com/javascript/latest/downloads-and-previous-versions/
  - https://developers.arcgis.com/javascript/latest/faq/
  - https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437
---

# ArcGIS Maps SDK for JavaScript - moving from 4.x to 5.x

5.x continues the 4.x API under semantic versioning ([FAQ](https://developers.arcgis.com/javascript/latest/faq/)); it is not a rewrite like 3.x to 4.x was. Three things still trip up agents: documentation URLs, widgets, and how the SDK is loaded. Ask `arcgis_docs_get_versions` for the current release instead of assuming one.

## 1. Documentation URLs changed at 5.0

| | 4.x | 5.x |
| --- | --- | --- |
| Class reference | `api-reference/esri-views-MapView.html` | `references/core/views/MapView/` |
| Component reference | (same tree) | `references/<package>/components/<tag>/` |

- Only the latest release is documented on `developers.arcgis.com/javascript/latest/`. Old `api-reference/esri-*.html` addresses answer with a redirect stub to the new page.
- Earlier releases are on Esri's archive host, linked from [Downloads and previous versions](https://developers.arcgis.com/javascript/latest/downloads-and-previous-versions/). That host disallows crawlers, so this server returns a link instead of the page; for an older release use the typings of the matching `@arcgis/core` npm version (`arcgis_docs_lookup_symbol` with `version`).

## 2. Widgets are deprecated, components replace them

- Web components arrived during 4.x; every widget is deprecated as of 5.0 and Esri plans to remove widgets in a later release ([transition plan](https://developers.arcgis.com/javascript/latest/components-transition-plan/), [deprecation notice](https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437)).
- New code: `<arcgis-map>`, `<arcgis-scene>` and the other elements of `@arcgis/map-components`, not `new MapView(...)` plus widgets.
- Existing code: follow [Migrate to components](https://developers.arcgis.com/javascript/latest/migrating-to-components/). Keep the SDK theme stylesheet while any widget or programmatically created view remains; component-only apps do not need it.
- Many samples still show widget patterns and carry a legacy-patterns note. Prefer a sample without it.

## 3. Loading

- CDN: since 5.0 a single module script, `<script type="module" src="https://js.arcgis.com/<major.minor>/">`, serves the core API, map components and Calcite; modules are loaded with `$arcgis.import(...)`.
- npm: the `@arcgis/*` packages are versioned together; change them in one step.
- `arcgis-js-api`, `esri-loader` and `@arcgis/cli` are dead ends (`brief:legacy/do-not-use`).

## Upgrade procedure (Esri's own, [Upgrade with AI](https://developers.arcgis.com/javascript/latest/ai-assisted-development/upgrade-with-ai/))

1. Inventory first: current and target version, npm or CDN, widgets in use, validation commands.
2. Read the [release notes](https://developers.arcgis.com/javascript/latest/release-notes/) of every release crossed, including the intermediate ones, especially the breaking-changes sections.
3. Update dependencies or CDN URLs together.
4. TypeScript apps that use the deprecated `__esri` namespace types: `npx @arcgis/codemod run refactor-out-esri-namespace`, from a clean working tree. It converts those types to explicit `@arcgis/core` imports and nothing else.
5. Fix the remaining breaking changes, then test. Widget migration can be a separate step ([guide](https://developers.arcgis.com/javascript/latest/ai-assisted-development/migrate-widgets-to-components/)).

Verify each symbol with `arcgis_docs_lookup_symbol` before using it: names remembered from 4.x examples may be deprecated.
