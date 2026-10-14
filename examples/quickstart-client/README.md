# Quickstart client

A 150-line TypeScript script that does what a coding agent does with this server, without a
model in the loop: it starts the server over stdio with the official MCP client
(`@modelcontextprotocol/client`), then works through one task in five tool calls.

Task: _add clustered points with popups to a web map._

| Step | Tool                        | Arguments                                                     | What the script takes from the result          |
| ---- | --------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| 1    | `arcgis_docs_list_products` | `{"query":"web map javascript","limit":3}`                    | the product id (`structuredContent`)           |
| 2    | `arcgis_docs_get_versions`  | `{"product":"<id>"}`                                          | the version the documentation describes        |
| 3    | `arcgis_docs_search`        | `{"query":"cluster points popup","product":"<id>","limit":4}` | the best hit's URL                             |
| 4    | `arcgis_docs_lookup_symbol` | `{"symbol":"FeatureLayer.featureReduction",...}`              | the declaration, with its source URL           |
| 5    | `arcgis_docs_find_samples`  | `{"query":"clustering","product":"<id>","limit":3}`           | a sample whose code `arcgis_docs_read` returns |

## Run it

From the repository root:

```sh
npm ci
npm run build
npx tsx examples/quickstart-client/quickstart.ts          # trimmed transcript
npx tsx examples/quickstart-client/quickstart.ts --full   # everything the server returned
```

No key or account is needed. The calls reach Esri's public documentation sites, npm and
GitHub on first use and are cached on your machine after that. Setting `GITHUB_TOKEN` raises
the GitHub API quota from 60 to 5,000 requests per hour.

## Recorded output

[transcript.txt](transcript.txt) is the output of a real run on 2026-10-14 (the trimmed form).
The trimming keeps status lines, identifiers, versions, URLs, short code and the attribution
lines, and replaces Esri's documentation prose with `[...]`, so that this repository does not
reproduce it. Run the script yourself to see full answers. Hit counts and versions change as
the documentation does.
