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

5.x continues the 4.x API under semantic versioning ([FAQ](https://developers.arcgis.com/javascript/latest/faq/)); it is not a rewrite as 3.x to 4.x was. Three things still mislead agents: documentation URLs, widgets and loading. Ask `arcgis_docs_get_versions` for the current release.

## Documentation URLs changed at 5.0

- Class reference: 4.x `api-reference/esri-views-MapView.html`, 5.x `references/core/views/MapView/`. Components: `references/<package>/components/<tag>/`.
- `developers.arcgis.com/javascript/latest/` documents only the latest release; old `api-reference/esri-*.html` addresses answer with a redirect stub.
- Earlier releases are on Esri's archive host ([previous versions](https://developers.arcgis.com/javascript/latest/downloads-and-previous-versions/)), which disallows crawlers: this server returns a link. For an older release use `arcgis_docs_lookup_symbol` with `version`, which reads the typings of that `@arcgis/core` release.

## Widgets are deprecated

- Every widget is deprecated as of 5.0 and removal is planned ([transition plan](https://developers.arcgis.com/javascript/latest/components-transition-plan/), [notice](https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437)).
- New code uses `<arcgis-map>`, `<arcgis-scene>` and the other `@arcgis/map-components` elements, not `new MapView(...)` plus widgets.
- Existing code: [Migrate to components](https://developers.arcgis.com/javascript/latest/migrating-to-components/). Keep the SDK theme stylesheet while a widget or a programmatically created view remains.
- Many samples still show widget patterns under a legacy-patterns note. Prefer samples without it.

## Loading

- CDN: since 5.0 one module script, `https://js.arcgis.com/<major.minor>/`, serves the core API, map components and Calcite; load modules with `$arcgis.import(...)`.
- npm: `@arcgis/*` packages share one version. Change them together.
- `arcgis-js-api`, `esri-loader` and `@arcgis/cli` are dead ends (`brief:legacy/do-not-use`).

## Upgrade procedure ([Upgrade with AI](https://developers.arcgis.com/javascript/latest/ai-assisted-development/upgrade-with-ai/))

1. Inventory: current and target version, npm or CDN, widgets in use.
2. Read the [release notes](https://developers.arcgis.com/javascript/latest/release-notes/) of every release crossed, intermediate ones included.
3. Update dependencies or CDN URLs in one step.
4. TypeScript apps using the deprecated `__esri` types: run `npx @arcgis/codemod run refactor-out-esri-namespace` from a clean working tree. It only rewrites those types to `@arcgis/core` imports.
5. Fix remaining breaking changes, test, and verify symbols with `arcgis_docs_lookup_symbol`.
