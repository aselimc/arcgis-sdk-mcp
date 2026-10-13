# Test support

Fakes and builders that let every package test offline against the contracts in `src/core`.
Import them directly from the file that defines them (there is no barrel).

| File                  | What it gives you                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-ctx.ts`         | `makeCtx(options)`: a complete `Ctx` made of the fakes below, sharing one `FakeClock`. `makeCall(ctx)`: `CallOptions` with a fresh request budget                                                    |
| `fake-http.ts`        | `FakeHttp`: replay `HttpClient`. Answers from a cassette or `on(url, response)`, fails on unrecorded requests, validates `expect`, counts the request budget, injects faults with `fail(url, fault)` |
| `cassette.ts`         | Types of recordings (`Cassette`, `Interaction`, `RecordedResponse`, `Fault`); re-exported by `fake-http.ts`                                                                                          |
| `fixtures.ts`         | `fixturePath`, `readFixture`, `readJsonFixture`, `hasFixture`, `loadCassette`: loaders relative to `test/fixtures`                                                                                   |
| `memory-cache.ts`     | `MemoryCache`: in-memory `Cache` that stores values as JSON, like the disk cache                                                                                                                     |
| `fake-clock.ts`       | `FakeClock` (`advance`, `set`) and the constants `SECOND`, `MINUTE`, `HOUR`, `DAY`                                                                                                                   |
| `fake-github.ts`      | `FakeGithub`: in-memory `GithubClient` with repositories, refs, wiki pages, releases, quota exhaustion and `outage()`; counts calls against `opts.budget`                                            |
| `fake-policy.ts`      | `fakePolicy(options)`: `SourcePolicy` with optional host table (allow-list, link-only, capability switch)                                                                                            |
| `fake-registry.ts`    | `fakeRegistry({ products, hosts, briefs })`: plain `Registry` over test products; `ownerOf` uses `ownedPrefix` from `src/core`                                                                       |
| `fake-render.ts`      | `FakeRenderer`: `Renderer` that records calls and returns simple or canned pages; provenance fields come from `pageProvenance`, as in the real renderers                                             |
| `fake-adapter.ts`     | `FakeAdapter`: scriptable `SourceAdapter` (`failOn`, `block`, call log); `fakeAdapterRegistry`                                                                                                       |
| `fake-logger.ts`      | `FakeLogger`: collects log entries                                                                                                                                                                   |
| `builders.ts`         | `makeConfig`, `makeProduct`, `makeSource`, `makeLine`, `makeRecord`, `makeHit`, `makeHost`, `makeResponse`, `makeDocPage`                                                                            |
| `adapter-contract.ts` | `describeAdapterContract(name, makeCase)`: the shared contract suite for source adapters                                                                                                             |
| `prng.ts`             | `Prng`, `forSeeds`: seeded randomness for property tests                                                                                                                                             |
| `no-network.ts`       | Setup file of the `unit` project: the global `fetch` rejects every non-loopback request                                                                                                              |

## Typical adapter test

```ts
import { bindSource } from '../../../src/core/adapter-helpers.js';
import { makeLine, makeProduct, makeSource } from '../../support/builders.js';
import { loadCassette } from '../../support/fixtures.js';
import { makeCtx } from '../../support/make-ctx.js';

const source = makeSource('astro', { base: '/widgets/', sitemap: 'sitemap-0.xml' });
const product = makeProduct({ sources: [source] });

it('enumerates the sitemap', async () => {
  const ctx = makeCtx({ cassette: loadCassette('cassettes', 'site', 'astro-guide.json') });
  const records = await adapter.enumerate(ctx, bindSource(product, source, makeLine()));
  expect(records).toHaveLength(2);
  expect(ctx.http.unrecorded).toEqual([]); // nothing outside the cassette was requested
  expect(ctx.http.count()).toBeLessThanOrEqual(adapter.maxEnumerateRequests);
});

it('degrades when the index file is gone', async () => {
  const ctx = makeCtx({ cassette: loadCassette('cassettes', 'site', 'astro-guide.json') });
  ctx.http.fail(/search\.json$/, 404);
  // ...
});
```

## Cassettes

A cassette is a JSON file under the owning package's fixture directory:

```json
{
  "name": "astro guide, happy path",
  "interactions": [
    {
      "url": "https://developers.arcgis.com/widgets/sitemap-0.xml",
      "response": { "contentType": "application/xml", "bodyFile": "sitemap-0.xml" }
    },
    {
      "url": "https://developers.arcgis.com/widgets/index.json",
      "response": { "json": { "pages": 2 } }
    },
    { "url": "https://developers.arcgis.com/widgets/gone/", "response": { "status": 404 } }
  ]
}
```

- `bodyFile` is read relative to the cassette file. `json` is a shorthand for a JSON body.
- Several interactions for the same URL are served in order; the last one repeats.
- A recorded status other than 200 behaves like the fault of the same number.
- Faults: HTTP statuses, `'timeout'`, `'network'`, `'html'` (catch-all page), `'truncated'`,
  `'empty'` and `'oversized'`; a request with an explicit `maxBytes` smaller than the body fails
  like `'oversized'`.
- A request with `encoding: 'base64'` (binary files such as a Sphinx `objects.inv`) gets the
  recorded body back unchanged: record it base64-encoded.
- Bodies are written by hand, or are Apache-2.0 files under `test/fixtures/oss`. Recorded Esri
  pages are never committed.

## What the fakes do not do

They implement the contracts, not the production rules. `FakeHttp` has no cache, limiter or
redirect logic; `fakePolicy` has no robots handling; `fakeRegistry` has no fuzzy matching or
router vocabulary; `FakeRenderer` converts nothing. Those behaviours are tested by the
packages that own them.

`selftest/` holds the two files the support library's own tests read through the loader.
