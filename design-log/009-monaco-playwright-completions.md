# 009 — Monaco autocomplete for Playwright page.* and task.* APIs

## Background

The step code editor uses Monaco with `language="javascript"` to let users write traverser and extractor functions. Monaco's built-in JavaScript intelligence knows nothing about the two objects that the scraper runtime always injects into step scope: `page` (a Playwright `Page` instance) and `task` (a `PageTask` containing `url`, `parent_data`, and related fields). Developers writing step code had to rely on memory or external Playwright documentation.

## Problem

No autocompletions for `page` or `task` meant:

- Common Playwright methods (`page.locator`, `page.waitForSelector`, `page.evaluate`, etc.) were not suggested.
- `task.url` and `task.parent_data` were invisible to the editor.
- New users faced the blank editor with no discoverability path beyond reading docs.

## Design

A lightweight Monaco completion provider replaces the need for a full TypeScript language service.

**`client/src/lib/monacoPlaywrightCompletions.ts`** — exports `registerPlaywrightCompletions(monaco)`:

- Calls `monaco.languages.registerCompletionItemProvider('javascript', ...)` with a trigger character of `.`.
- Inspects the token immediately before the `.` to detect `page` and `task` identifiers.
- Returns 20 `Page` method completions for `page.` (e.g. `locator`, `goto`, `waitForSelector`, `evaluate`, `screenshot`, `click`, `fill`, `selectOption`, `waitForLoadState`, `content`, `url`, `title`, `close`, `reload`, `waitForTimeout`, `keyboard`, `mouse`, `frames`, `bringToFront`, `emulateMedia`).
- Returns 2 field completions for `task.` (`url`, `parent_data`).
- Each item carries a `detail` string (brief signature) and `documentation` (one-line description).

**Registration** — called once via the `beforeMount` prop on `<Editor>` in `ParserEditorPage`. A module-level `_registered` flag prevents duplicate registration when the `Editor` component remounts on step switch (the editor is keyed by `stepName`, causing a remount on each switch).

## Questions and Answers

- **Q1 — Why not use Monaco's TypeScript language server with Playwright type declarations?** The TypeScript service is heavy: it would require bundling the full `@playwright/test` type tree, switching the editor language to `typescript`, and configuring `lib` and `types`. Step code is a plain JavaScript string evaluated at runtime, not a TypeScript module. A lightweight static completion provider covers 95% of practical use cases.
- **Q2 — Why fire only on `.` trigger?** Dot-triggered completions are the most natural discovery path for object APIs. Free-text completion for bare identifiers would compete with Monaco's built-in keyword completions and produce noise.
- **Q3 — Why a module-level flag rather than a React ref or context?** `registerCompletionItemProvider` operates on the global Monaco instance, not on a specific editor instance. Once registered, the provider applies to all `javascript`-language editors in the process; re-registering on remount accumulates duplicate providers that each fire for every completion request.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Static list of 20 methods | Does not cover the full Playwright API (~150 Page methods). Good enough for the most common scraping patterns without maintenance burden. |
| Dot-trigger only | Users typing `pa` will not see `page` suggested. Acceptable: `page` and `task` are always in scope; users know the variable names. |
| Module-level `_registered` flag | Global singleton; if a future feature needs per-editor provider scoping, this will need rethinking. |

## Implementation Results

- `client/src/lib/monacoPlaywrightCompletions.ts` created with 20 Page method completions and 2 task field completions.
- `registerPlaywrightCompletions` wired into `beforeMount` on the Monaco `<Editor>` in `ParserEditorPage`.
- Module-level `_registered` guard confirmed to prevent duplicate registration on step switch.
- 3 unit tests pass (provider registration, `page.` completions, `task.` completions).
- Duplicate registration bug (double-firing completions) identified and fixed during review.
