## What this changes

<!-- One or two sentences. Link the issue it closes, if any. -->

## How it was checked

<!-- Commands you ran and what you looked at, for example
     `node dist/cli/main.js call read '{"ref":"<url>"}'` before and after. -->

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass
- [ ] `npm run format:check` passes
- [ ] New behaviour has a test; a bug found against a live site has a synthetic fixture that
      reproduces the markup

## Source policy

<!-- Delete this section when the change does not alter what is fetched. -->

- [ ] No new host, no new kind of file and no higher request rate, **or** the description
      states the host, its `robots.txt` rules, the licence of the content, the capability
      that gates it and the number of requests it costs (see `docs/source-policy.md`)

## Content

- [ ] No Esri-authored text in the diff: fixtures are synthetic or Apache-2.0 files under
      `test/fixtures/oss` with a provenance row, and registry and brief text is our own wording
- [ ] Generated files are current (`npm run gen`, and `npx tsx scripts/gen-tools-doc.ts` after
      a tool schema change)
- [ ] `CHANGELOG.md` has an entry under "Unreleased" when users can notice the change
