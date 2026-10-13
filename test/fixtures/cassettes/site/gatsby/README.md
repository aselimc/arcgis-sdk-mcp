# Fixtures of the gatsby adapter

Cassettes for `test/adapters/site/gatsby`. Each file is one invented Gatsby sub-site, replayed
through `FakeHttp`.

## Provenance

Everything in this directory is **synthetic**: written for this project, about invented
products ("Widgets SDK", "gadget services", "Toolkit JS", "beacons service", "Server SDK",
"pylib", "Engine SDK", "thing specification"). No file is a recording of, or an excerpt from,
an Esri page, index file or API document. The host in the URLs is a real documentation host
because the adapter resolves registry paths against it; the paths, titles, descriptions,
hashes and code are invented.

The files replicate structure only, as observed on the live sites on 2026-10-13:

| File                 | Structure it replicates                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guide.json`         | guide site: `topicNavigation.nav` and `search.publicStoreURL` inline in page-data; `static/<hash>.store.json`; a divider and a cross-site `DEVSITE` link in the nav                             |
| `rest.json`          | REST reference: page-data with `staticQueryHashes` only; `sq/d/<hash>.json` files of which one holds `nav`, `search` and `resourceHierarchy`; store titles of the form `/operation: Label (Resource)` |
| `documentation.json` | developer guide: a root page without navigation, sections with their own nav (`topics.nav`) and store, the glossary static query (`glossaryData.terms`)                                         |
| `typedoc.json`       | TypeDoc reference: `allTypedocPage.nodes`, `typedocPage.raw`, `apiRefNav.nav`, `searchIndex` in the page-data of every API page                                                                 |
| `openapi.json`       | OpenAPI sections: `openApiOperationPage.operation`, `openApiSchemasPage.schemas`, `topics.nav` with operations filed under path folders, no store                                               |
| `apiref.json`        | .NET reference: `apiRef.html` body, navigation tree (namespace, kind folders, types) in a static query that only API pages list                                                                |
| `python.json`        | Sphinx reference in a site whose `pathPrefix` is above the source base: `sphinxJson.html`, `nav.nav.publicPaginationURL`, the flat pagination file, a `jupyterNotebook.html` guide page         |
| `engine.json`        | game-engine site: a store that lists API types and members (`pageType`, anchored URLs, `breadcrumb`)                                                                                            |
| `spec.json`          | specification site: `mdxPage.childMarkdownRemark.html`, `allMdxPage.edges`, the store as a JSON string in `search.store`                                                                        |

HTML bodies are minimal Gatsby-shaped pages (`main#main`, generator meta); conversion is the
renderer's job and is not tested here.

Licence: Apache-2.0, like the rest of the repository.
