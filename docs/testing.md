# Testing

```sh
npm test               # unit project: everything under test/ except e2e and live. No network
npm run test:coverage  # the same with coverage thresholds
npm run test:e2e       # builds, packs the tarball and drives the packed binary over stdio
npm run test:live      # invariants on live-recorded pages; manual and scheduled only
```

## No network in tests

`test/support/no-network.ts` replaces the global `fetch` for the unit project and rejects
every request that is not to loopback. Code under test receives fakes through `makeCtx`
(`test/support/make-ctx.ts`): a replaying HTTP client that fails on any request missing from
its cassette, an in-memory cache, a fake clock, a fake GitHub client. `test/support/README.md`
lists them.

## Layers

| Layer             | Where                                                    | What it proves                                                                                                                                                            |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit              | `test/<package>/`                                        | Pure logic: budget, cursors, URL handling, version comparison, registry resolution, ranking                                                                               |
| Golden, synthetic | `test/extract`, `test/render`, `test/fixtures/synthetic` | One hand-written fixture per HTML family and renderer with an exact expected Markdown file. Acceptance: the right family, no leftover HTML, every fence closed and tagged |
| Open-source real  | `test/fixtures/oss`                                      | Renderers against Apache-2.0 files from Esri's public repositories, kept with their source URL, commit and licence                                                        |
| Adapter contract  | `test/adapters`                                          | Every adapter against cassettes through the shared contract suite, plus its own failure cases                                                                             |
| Chaos             | `test/services/chaos.test.ts`, `test/net`                | Timeouts, 5xx, 403, 429, truncated bodies, redirect loops: no tool call throws, the rung is reported, a good index is never replaced by a worse one                       |
| Policy            | `test/policy`, `test/net`                                | Which hosts each preset and capability can reach; link-only and unlisted hosts are unreachable in every configuration                                                     |
| Registry          | `test/registry`                                          | Schema, invariants, alias resolution, routing, URL ownership, generated files up to date                                                                                  |
| Tool surface      | `test/mcp`                                               | `tools/list` snapshot, description and instruction length limits, every error code renders with `Next:`                                                                   |
| Protocol          | `test/protocol`                                          | Both protocol eras end to end in memory; `structuredContent` conforms to `outputSchema`                                                                                   |
| End to end        | `test/e2e`                                               | The packed tarball: only JSON-RPC on stdout, a tool call that works offline, `--version` without starting the server                                                      |
| Package seams     | `test/integration`                                       | The real registry, adapters, extractor, renderers and services with only `fetch` scripted: what one package hands another is what the other expects                       |
| Live recorded     | `test/live`                                              | Invariants (not goldens) on real pages and structured files (OpenAPI, TypeDoc, Custom Elements Manifest, DocC) recorded to a git-ignored directory                        |

## Fixture policy

Three tiers, and only the first two are committed ([ADR-0006](adr/0006-fixture-policy.md)):

1. **Synthetic** (`test/fixtures/synthetic`, `test/fixtures/cassettes`): written by hand to
   reproduce the structure of a real response, with invented products and our own prose.
2. **Open source** (`test/fixtures/oss`): unmodified Apache-2.0 files, each directory with a
   provenance file.
3. **Recorded** (`test/fixtures/recorded`, git-ignored): real responses downloaded by
   `scripts/record-fixtures.ts` from the URLs in `test/fixtures/fixtures.manifest.json`.

When a live test fails because a site changed, fix the code and update the synthetic fixture
in the same pull request, so the regression is covered offline from then on.

## Recording and the live suite

```sh
npx tsx scripts/record-fixtures.ts          # all entries, one request per second, through the gateway
npx tsx scripts/record-fixtures.ts --only astro-tutorial,dts-featurelayer --force
npm run test:live
```

The live suite reads the recordings and checks invariants: the detected family, no leftover
HTML tags, closed and language-tagged code fences, a non-trivial outline, the size band of a
member slice, and the member list of the TypeScript declaration scanner against the
TypeScript compiler on the same file. Entries that were not recorded are skipped, so the
suite passes on a machine that never recorded anything.

## Checking against the real sites by hand

```sh
npm run build
node dist/cli/main.js doctor --product js-maps-sdk
node dist/cli/main.js call read '{"ref":"https://developers.arcgis.com/javascript/latest/get-started/"}'
```

`call` prints exactly the text an agent would receive. Read it as a user would: is the
Markdown clean, is the source line right, does the `Next:` line make sense, is the result
within its budget?

## Coverage

`npm run test:coverage` enforces 90 % of lines and 85 % of branches overall, and 100 % of
lines for `src/core`, `src/policy`, the meta-refresh detector and the site-search filter
serialiser.

## Agent evaluations

`evals/` holds 25 multi-step tasks and a runner that needs an API key. They are run by hand
before a release; see [evals/README.md](../evals/README.md).
