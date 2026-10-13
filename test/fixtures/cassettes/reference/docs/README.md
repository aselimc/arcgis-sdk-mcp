# Fixtures of the API-reference adapters

Cassettes and response bodies for `test/adapters/reference/docs` (adapters `docc`, `dokka`,
`dartdoc`, `javadoc`, `sphinx`, `docfx-net`, `xmldoc`, `pkgdown`).

## Provenance

Everything in this directory is **synthetic**: written by hand for this project, about an
invented "Widgets SDK". No file is a recording of, or an excerpt from, an Esri page, index
file, package or repository. The hosts in the URLs are real documentation hosts because the
adapters resolve registry paths against them; the paths, names, signatures and prose are
invented.

The files replicate structure only, as observed on the live sites on 2026-10-13:

| File | Structure it replicates |
| --- | --- |
| `docc.json` | DocC navigator tree (`index/index.json`: `interfaceLanguages.swift[]` of `{ path, title, type, children }`, group markers without a path, a page listed twice) and two render JSON documents |
| `dokka.json` | Dokka `scripts/pages.json`: `{ name, description, location, searchKeys }` with the declaration in `name` and the qualified name in `description`; overloads share a location |
| `dartdoc.json` | dartdoc `index.json`: `{ name, qualifiedName, href, kind, desc, enclosedBy }` with numeric kinds and the type name repeated for constructors |
| `javadoc.json`, `javadoc-*-search-index.js` | javadoc search-index scripts (`typeSearchIndex = [...];updateSearchResults();`) with a module per package, a nested type and percent-encoded constructor anchors |
| `javadoc-legacy.json`, `javadoc-allclasses-noframe.html` | the class list of a JDK 8 javadoc site (`<a href title="class in package">`) |
| `sphinx-objects.txt` | the rows of a Sphinx `objects.inv` before compression (`name domain:role priority uri dispname`); the tests add the four header lines and compress the rows with zlib |
| `sphinx-searchindex.js` | Sphinx `searchindex.js` with `objects` in the list form of Sphinx 5 and later |
| `docfx-net.json`, `docfx-*.xrefmap.yml` | DocFX xrefmaps of two API sets (overload groups, generic arity, quoted scalars, language variants, an external reference) and the `toc.json` of each set |
| `xmldoc-*.xml` / `.XML` | C# compiler documentation files (`<member name="T:...">`), with an `<exclude/>` member, a static constructor, a nested type, an operator and an explicit interface implementation |
| `pkgdown.json` | pkgdown `search.json` (one row per page section, absolute paths written for another host, a junk row), `llms.txt` and a Markdown twin |
| `page.html` | a minimal page; conversion is the renderer's job and is not tested here |

Licence: Apache-2.0, like the rest of the repository.
