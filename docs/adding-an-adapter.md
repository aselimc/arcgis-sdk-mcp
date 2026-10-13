# Adding an adapter

An adapter teaches the server one way documentation is published: a site generator, a
reference-documentation tool, a package layout. Add one only when no existing adapter can be
configured for the source; most new products need registry data, not code
([adding-a-product.md](adding-a-product.md)).

## The contract

`SourceAdapter` in `src/core/ports.ts`:

| Member | Purpose |
|---|---|
| `type` | The adapter's name, one of `ADAPTER_TYPES` |
| `maxEnumerateRequests` | Hard cap on the upstream requests of one `enumerate()` |
| `enumerate(ctx, src)` | Lists the source as catalogue records (pages, samples, symbols). Reads index files, never page bodies in bulk |
| `owns(url, src)` | Optional: claims URLs beyond the registry's prefix match |
| `read(ctx, src, target)` | Fetches one document and returns a `DocPage`. Honours `target.select` by slicing before cleaning on heavy pages |
| `symbol(ctx, src, record, detail)` | Optional: renders one type or member |
| `sample(ctx, src, record)` | Optional: returns a sample bundle (README, metadata, files) |
| `probe(ctx, src)` | A canary of at most two requests |

Rules:

- Use `ctx.http` (and `ctx.github`) for every request and pass `src.budget`. Never call
  `fetch`, never read files, never read `process.env`.
- Convert content through `ctx.render`. An adapter does not parse page HTML itself: the HTML
  pipeline lives in `src/extract`, structured formats in `src/render`.
- Reject only with `McpDocError`. A missing optional file is not an error: continue from the
  next rung and let the result say so.
- Site-published index files are read only while `ctx.policy.enabled('site-index')`.
- Never store a hashed file name. Discover it at run time and rediscover it once when it has
  rotated.
- Treat every upstream body as untrusted: validate its shape, cap what you read, and return a
  typed failure for a renamed field or an HTML page where JSON was expected.

## Steps

1. **Types.** Add the type name to `AdapterType` and `ADAPTER_TYPES`, and its configuration
   to `AdapterConfigMap`, in `src/core/types.ts`. Add the config to the zod schema in
   `src/registry/schema.ts`.
2. **Implementation.** Create the adapter under `src/adapters/site/` (a documentation site)
   or `src/adapters/reference/` (API reference, package or repository source) and add it to
   that package's `index.ts`. Keep `enumerate`, `read` and parsing helpers in separate small
   files.
3. **Renderer or family, if the format is new.** A structured format gets a renderer in
   `src/render/`; a new HTML layout gets a family profile in `src/extract/families/` and a
   place in the detection order of `src/extract/detect-family.ts`.
4. **Cassettes.** Write synthetic recordings under `test/fixtures/cassettes/` that reproduce
   the structure of the real responses with your own content. Do not commit real responses.
5. **Contract suite.** Register the adapter with `describeAdapterContract`
   (`test/support/adapter-contract.ts`). It checks that refs are absolute and de-duplicated,
   that the request cap holds, that `probe()` stays within two requests, that `read()`
   returns sections with the right source line, and that only `McpDocError` crosses the
   boundary when every request fails.
6. **Adapter-specific tests.** Cover the ways this source breaks: a renamed field, a missing
   file, HTML instead of JSON, a rotated hash, an empty index, an oversized body.
7. **Live check.** Add one URL per new response shape to
   `test/fixtures/fixtures.manifest.json`, run `npx tsx scripts/record-fixtures.ts --only <id>`
   and `npm run test:live`. The recording stays on your machine.
8. **Registry.** Use the adapter in a product entry and run `doctor --product <id>`.

## Checklist for review

- [ ] Which host or hosts, what their `robots.txt` says, and which capability gates the source
- [ ] Requests per enumeration and per read
- [ ] Licence tier of the content and the resulting source line
- [ ] What the adapter returns when its richest input is missing (the lower rung)
- [ ] Synthetic fixtures only; no Esri-authored text in the diff
