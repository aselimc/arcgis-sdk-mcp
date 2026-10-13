# Synthetic fixtures for the structured renderers

Every file in this directory was written by hand for this project. The inputs replicate the
**structure** of the formats the renderers in `src/render` read; all names, prose, URLs and
values are invented (a fictional "tides" and "beacons" API). Nothing here was copied or
recorded from an Esri page, package or service.

| Directory | Input | Replicates | Golden files |
| --- | --- | --- | --- |
| `openapi/` | `operation.json`, `schemas.json` | `openApiOperationPage` and `openApiSchemasPage` of Gatsby page data, with the `%%[Name](/path)%%` link syntax | `operation.expected.md`, `schemas.expected.md` |
| `openapi/` | `spec.json` | an OpenAPI 3.0 document with `$ref`, `allOf` and shared parameters | `spec-operation.expected.md`, `spec-index.expected.md` |
| `typedoc/` | `class.json` | a TypeDoc 0.23+ class reflection (`typedocPage.raw`) | `class.expected.md`, `class-summary.expected.md` |
| `cem/` | `api.json` | a Custom Elements Manifest 2.1 with the `docsTags`, `demos` and `signature` extensions | `component.expected.md` |
| `docc/` | `symbol.json` | DocC render JSON, schema 0.3, including one node type that does not exist | `symbol.expected.md` |
| `sphinx/` | `module.html` | the body of a Sphinx page with `dl.py` objects | `class.expected.md`, `module.expected.md` |
| `xmldoc/` | `Example.Tides.xml` | a C# compiler documentation file | `type.expected.md` |
| `dts/` | `Lighthouse.d.ts` | the class layout of `@arcgis/core` typings: `XProperties`, `__XSansType`, `XSuperclass`, `XEvents` | `Lighthouse.expected.md` |
| `dts/` | `Broken.d.ts` | a truncated file with one member that lost a bracket | `Broken.expected.md` |
| `arcade/` | `category.json`, `profile.json` | the Arcade function and profile JSON of the coding components | `category.expected.md`, `profile.expected.md` |
| `markdown/` | `readme.md` | a repository README with front matter and relative links | `readme.expected.md` |
| `notebook/` | `tides.ipynb` | an nbformat 4 notebook with text, rich and error outputs | `tides.expected.md` |

`*.expected.md` files are byte-exact renderer output: the page header, the sections joined by
blank lines, then one comment line per source file. Regenerate them with
`UPDATE_GOLDEN=1 npx vitest run test/render` after an intended change and review the diff.

The Sphinx goldens were produced with the small stand-in converter in
`test/render/helpers.ts`, not with the real HTML extractor, which this package does not import.
