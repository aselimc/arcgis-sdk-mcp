# Fixtures of the npm package adapters

Cassettes and response bodies for `test/adapters/reference/npm` (adapters `npm-dts`, `npm-cem`
and `npm-json`, plus version resolution and the jsDelivr helpers).

## Provenance

Everything in this directory is **synthetic**: written by hand for this project, about
invented packages (`@arcgis/widget-core`, `@arcgis/widget-components`, `@arcgis/chart-widgets`,
`@esri/gadget-components`, `@arcgis/script-components`) that do not exist on npm. No file is a
recording of, or an excerpt from, an Esri package, registry response or documentation page.
The hosts in the URLs are the real registry, CDN and documentation hosts because the adapters
build their requests against them; package names, versions, paths, identifiers and prose are
invented.

The files replicate structure only, as observed live on 2026-10-13:

| File | Structure it replicates |
| --- | --- |
| `dts.json` | npm `dist-tags` map; jsDelivr flat file listing `{ files: [{ name, hash, size }] }` with leading slashes; jsDelivr `resolved?specifier=` answer `{ version }` |
| `PanelLayer.d.ts` | a declaration module: a `*Properties` interface plus a default-exported class with JSDoc |
| `cem.json`, `widget-components.api.json`, `chart-widgets.api.json` | Custom Elements Manifest 2.1.0 with the extensions seen in Esri's component packages: `tagName`, `customElement`, `docsTags`, members with `privacy` and `inheritedFrom: { name: "this" }`, `events` with `deprecated` |
| `cem.json` (`text/html` bodies) | a component page of the documentation site: a title and one paragraph of guidance, standing in for the half of the page above "API reference" |
| `gadget-components.api.json` | a manifest of a package whose documentation URLs use the tag without its prefix |
| `arcade.json`, `script-api.json` | function reference: array of categories `{ id, title, items }` where an entry of `items` is an item or an array of overloads; items carry `name`, `type`, `bundle`, `sinceVersion`, `link`, `description`, `examples`, `completion { label, detail }` |
| `script-profiles.json` | profile list: array of `{ name, id, bundles, variables }` |

Licence: Apache-2.0, like the rest of the repository.
