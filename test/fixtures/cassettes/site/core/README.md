# Fixtures of the core site adapters

Cassettes and response bodies for `test/adapters/site/core` (adapters `astro`, `sitemap`,
`static`, `openapi`; `brief` needs none).

## Provenance

Everything in this directory is **synthetic**: written by hand for this project, about an
invented "Widgets SDK". No file is a recording of, or an excerpt from, an Esri page, index
file or API document. The hosts in the URLs are real documentation hosts because the adapters
resolve registry paths against them; the paths, titles, descriptions and code are invented.

The files replicate structure only, as observed on the live sites on 2026-10-13:

| File | Structure it replicates |
| --- | --- |
| `astro-guide.json`, `astro-api.json` | Astro search files: `{ options, index }` where `index` is a serialised MiniSearch document **as a JSON string**; the adapters read its `storedFields` |
| `astro-samples.json`, `sample-index.html` | sample index page with `a[data-sample-id]` cards |
| `astro-sitemap.xml`, `astro-samples-sitemap.xml`, `kb-sitemap*.xml` | flat `urlset` sitemaps and a sitemap index |
| `openapi.json` | an OpenAPI 3.0 document, an OpenAPI 3.1 document without operation ids, and a Swagger 2 document |
| `swagger-ui-init.js` | a Swagger UI start-up script with the document under `"swaggerDoc"` |
| `page.html`, `sample-page.html` | minimal pages; conversion is the renderer's job and is not tested here |

Licence: Apache-2.0, like the rest of the repository.
