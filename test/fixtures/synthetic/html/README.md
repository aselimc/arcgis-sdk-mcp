# Synthetic HTML fixtures

One page per HTML family of the extraction pipeline (`src/extract`), with the Markdown it must
convert to.

| File | Purpose |
| --- | --- |
| `<family>/page.html` | A hand-written page that reproduces the **structure** of the family: element names, class names, ids, data attributes and nesting. |
| `<family>/page.expected.md` | The golden output: the page header (if any), then every section, compared byte for byte. |

## Provenance

- Every page was written for this project. The prose, product names (`Harbor Maps SDK`,
  `Quay`), package names (`com.example.harbor`, `@harbor/core`) and hosts (`*.example.com`)
  are invented. No file here is a copy or an excerpt of a published documentation page.
- Only markup conventions are taken from the real sites, because the selectors of the
  family profiles depend on them: for example `div.lumina-detail` member cards,
  `div.expressive-code` blocks with `button[data-code]`, `section.detail[id]` in javadoc, or
  `section.section1[id^=ESRI_SECTION1_]` in the legacy help template.
- The structures were checked against live pages on 2026-10-13. Those recordings are not
  part of the repository.

## Changing a fixture

1. Edit `page.html`. Keep it small: one example of each construct the family profile handles.
2. Regenerate the golden: `UPDATE_GOLDENS=1 npx vitest run test/extract/golden.test.ts`.
3. Read the diff of `page.expected.md` before committing it. The golden is the specification.

The acceptance checks in `test/extract/golden.test.ts` apply to every fixture: the family is
detected, no HTML is left outside code (apart from `<br>` in table cells), every fence is
closed and names a language, and section ids are unique.
