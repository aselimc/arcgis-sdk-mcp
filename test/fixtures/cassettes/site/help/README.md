# Fixtures of the help-site adapters

Cassettes and response bodies for `test/adapters/site/help` (adapters `docfx-esri` and
`legacy-help`).

## Provenance

Everything in this directory is **synthetic**: written by hand for this project, about the
invented products "Widgets Pro", "Widget Server" and "Widget Earth". No file is a recording
of, or an excerpt from, an Esri page, table of contents or script. The hosts in the URLs are
real documentation hosts because the adapters build their URLs from them; the paths, titles,
tool names and prose are invented.

The files replicate structure only, as observed on the live sites on 2026-10-13:

| File | Structure it replicates |
| --- | --- |
| `docfx-tools-toc.json`, `docfx-arcpy-toc.json` | a doc.esri.com `toc.json`: `{ items: [{ name, href, topicHref, items }] }` with toolbox, toolset and "concepts" groups, plus entries a reader must skip |
| `docfx-help.json` (inline bodies) | a product root `toc.json` whose entries name their book as `tocHref`, and two book files |
| `docfx-sitemap.xml`, `docfx-help-sitemap.xml` | a product sitemap whose URLs spell the release number instead of `latest` |
| `docfx-tool-page.html` | a tool page: `article#main`, a syntax line with a display alias, samples with the real alias |
| `docfx-topic-page.html` | a topic page without any Python call |
| `legacy-4101.js`, `legacy-4102.js` | a table-of-contents script: `treedata.data["id"] = { parent, label, url, children }` assignments, an alias assignment, URLs with the release number, and nodes a reader must skip |
| `legacy-flisting-*.htm` | `flisting.htm`: a `noscript` list of relative links |
| `legacy-sitemap-automation.xml` | a per-book sitemap |
| `legacy-topic.htm`, `legacy-api-topic.htm` | a topic page in the older layout whose `<script src>` names the book's table-of-contents script |

Licence: Apache-2.0, like the rest of the repository.
