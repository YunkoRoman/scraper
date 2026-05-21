# 011 — Full parser config roundtrip via JSON export/import

## Background

Parser configurations — including step code, settings, and browser options — lived exclusively in the database. There was no way to share a working parser between teammates, move it to a staging environment, or keep a portable backup outside the DB.

## Problem

Users had to recreate parsers manually through the UI when moving between environments. A parser with 5+ steps and carefully tuned settings took significant effort to reproduce. No programmatic mechanism existed for bulk creation or seeding from a file.

## Design

**Export — `GET /api/parsers/:id/export`:**

- Loads the parser and all its steps from DB via `ParserPersistenceService`.
- Strips internal fields before serialising: `id`, `parserId`, `createdAt`, `updatedAt` are omitted.
- Returns `Content-Disposition: attachment; filename="<parserName>.parser.json"` with body `{ parser: {...}, steps: [...] }`.
- Stripping IDs is critical: re-importing with existing UUIDs on a different instance would conflict with its own auto-generated primary keys.

**Import — `POST /api/parsers/import`:**

- Route is registered **before** `/:id` in the Express router to prevent the literal string `"import"` from being matched as an ID parameter.
- Accepts `multipart/form-data` with a single `file` field (JSON) plus an optional `newName` text field.
- Parses the JSON, validates that `parser` and `steps` keys are present.
- Creates the parser via `createParser`, then creates each step via `createStep`, then applies step settings via `updateStep` (two DB round-trips per step — see Trade-offs).
- Returns `201` with the newly created parser object.

**Client — `ParserDetailPage`:**

- Export button calls `GET /api/parsers/:id/export`, receives the blob, and triggers a browser download via a temporary `<a>` element.

**Client — parsers list page:**

- Import button opens a hidden `<input type="file" accept=".json">`. On file selection, reads the file as text, optionally prompts for a new name, then `POST`s to `/api/parsers/import` as `FormData`. Calls `window.location.reload()` on success to refresh the list.

## Questions and Answers

- **Q1 — Why strip IDs on export?** Importing with hard-coded UUIDs on a different instance risks primary key conflicts if that UUID already exists (low probability but non-zero with v4 UUIDs) and, more importantly, creates confusion if the same parser config is imported multiple times — it should always create a fresh entity.
- **Q2 — Why `window.location.reload()` after import rather than a React state update?** The parsers list is a flat array fetched once on mount. Reload is the simplest correct refresh strategy; incremental state patching would require exposing the list-update function through several component layers for a rare action.
- **Q3 — Why `POST /api/parsers/import` rather than `POST /api/parsers` with a special flag?** A dedicated path makes intent explicit and keeps the regular create route simple (it only accepts a plain JSON body, not `multipart/form-data`).

## Trade-offs

| Decision | Trade-off |
|---|---|
| Two DB round-trips per step on import | `createStep` establishes the step record; `updateStep` applies `stepSettings` because the create path does not accept them in one call. Acceptable for an infrequent operation; fixing it would require changing `createStep`'s API. |
| No version history migrated | Export captures the current code snapshot only. Historical versions (once log 016 is implemented) are not portable. A future export format could include a `versions` array. |
| `window.location.reload()` on import | Full page reload discards any unsaved UI state. Acceptable because import is a deliberate navigation action. |
| Route ordering: import before /:id | Must be maintained whenever new routes are added; a comment in the router file documents the constraint. |

## Implementation Results

- `GET /api/parsers/:id/export` route added; returns stripped JSON with `Content-Disposition` header.
- `POST /api/parsers/import` route added and registered before `/:id`; route ordering verified in the Express router.
- Export button on `ParserDetailPage` triggers browser file download.
- Import button on parsers list opens file picker, reads JSON, posts to import endpoint, reloads on success.
- Build passes. Manual roundtrip test: export from instance A, import to instance B — parser and all steps recreated correctly.
