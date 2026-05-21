# 012 — Step code templates picker

## Background

New users opening the Monaco code editor for the first time faced a blank canvas. Without a starting scaffold, even simple traverser or extractor patterns required familiarity with the Playwright API and the scraper's step-return conventions (`TraverserResult[]` vs `Record<string, unknown>[]`). Experienced users still repeated the same boilerplate across parsers.

## Problem

Every step started from an empty code field. There was no in-editor mechanism to insert a working pattern without switching to another tab or consulting external documentation. Autocomplete (log 009) helped with method names, but not with the overall shape of a correct step function.

## Design

**`client/src/lib/stepTemplates.ts`** — defines a `StepTemplate` interface and a `STEP_TEMPLATES` constant array with five entries:

| Label | Type | Key pattern |
|---|---|---|
| Pagination Traverser | traverser | `$$eval` links + next-page link |
| Category List Traverser | traverser | nav `$$eval` with `parent_data` |
| REST API Extractor | extractor | `page.evaluate` + `fetch` |
| Product Detail Extractor | extractor | multi-field `$eval` with `task.url` spread |
| Infinite Scroll Traverser | traverser | scroll loop + `waitForTimeout` |

Each template carries `label`, `type` (`'traverser' | 'extractor'`), and `code` (complete, runnable step body).

**`ParserEditorPage.tsx` — template picker UI:**

- A "Templates" dropdown button (shown only when the step has no existing code) opens a list of templates filtered to the current step's `type`.
- Selecting a template calls `setCode(template.code)` and sets the editor value — this also marks the step as dirty, triggering the existing save-on-blur flow.
- The dropdown closes after selection.

## Questions and Answers

- **Q1 — Why filter templates by step type?** Showing traverser templates for an extractor step (or vice versa) would produce runtime errors; the return-value contract is different for each type. Filtering prevents misuse without requiring the user to read docs.
- **Q2 — Why hide the button when code already exists?** Template insertion is destructive: it replaces the editor content. Hiding the trigger after first save prevents accidental overwrites. Advanced users can clear the editor and re-open the dropdown if needed.
- **Q3 — Why a static array rather than user-defined templates?** YAGNI. The five patterns cover the vast majority of scraping use cases. User-defined templates would require persistence, a management UI, and sharing mechanisms — none of which were requested.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Static template list | Cannot be customised without a code change. Acceptable for the current user base size. |
| Filter by step type | Requires `type` to be set correctly before template selection. Users who switch type after selecting a template would see mismatched code. |
| Replace-on-select (not append) | Simpler UX; destructive but expected for a "start from template" flow. |

## Implementation Results

- `client/src/lib/stepTemplates.ts` created with 5 templates covering pagination, category traversal, REST API, product detail, and infinite scroll patterns.
- Template picker dropdown added to `ParserEditorPage`; filtered by step type and hidden once code is saved.
- No new server-side changes required — templates are client-only static data.
