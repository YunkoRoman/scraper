# Parser Helper Files

**Date:** 2026-06-15  
**Status:** Approved

## Overview

Developers need to split step logic across multiple files. Today, all code for a traverser or extractor must live inside a single function body. This design adds per-parser **helper files** — flat-structured, DB-stored modules that can be imported into any step of the same parser using standard `import` syntax.

---

## Data Model

New table `parser_files`:

```sql
parser_files
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
  parser_id  uuid NOT NULL REFERENCES parsers(id) ON DELETE CASCADE
  path       text NOT NULL   -- filename only, e.g. "validate", "retry"
  content    text NOT NULL DEFAULT ''
  created_at timestamptz NOT NULL DEFAULT now()
  updated_at timestamptz NOT NULL DEFAULT now()
  UNIQUE (parser_id, path)
```

- `path` is a bare filename with no extension and no slashes (flat, no folders)
- Content is raw TypeScript (tsx is already registered in workers)
- Cascade delete keeps files in sync with parser lifetime
- Future org-shared files: add `organization_id uuid` (nullable) alongside a nullable `parser_id`, with a check constraint ensuring exactly one is set

---

## API

New routes under `/api/parsers/:name/modules` (avoids collision with existing `/files` CSV routes):

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/parsers/:name/modules` | List helper files (id, path, updatedAt) |
| POST | `/api/parsers/:name/modules` | Create file `{ path, content }` |
| GET | `/api/parsers/:name/modules/:fileId` | Get file with content |
| PUT | `/api/parsers/:name/modules/:fileId` | Update `{ path?, content? }` |
| DELETE | `/api/parsers/:name/modules/:fileId` | Delete file |

Implementation lives in `ModulePersistenceService` (`src/infrastructure/db/ModulePersistenceService.ts`) and thin route handlers in `src/api/`.

---

## Worker Execution

### WorkerData extension

```ts
// messages.ts
helperFiles?: Array<{ path: string; content: string }>
```

### Startup sequence (in `main()`, before AsyncFunction is built)

1. Write each helper file to `/tmp/scraper-modules/{parserId}/{path}.ts`
2. Run import transform on `data.stepCode`
3. Build and execute `AsyncFunction` with transformed code

### Import transform

Applied to the step code string before `new AsyncFunction(...)`. Converts top-of-file static import lines to top-of-body `await import()` calls that AsyncFunction can execute:

```
// User writes:
import { validate } from './validate'

// Platform rewrites to:
const { validate } = await import('/tmp/scraper-modules/{parserId}/validate.ts')
```

Supported import forms:
- Named: `import { a, b } from './x'` → `const { a, b } = await import(...)`
- Default: `import validate from './x'` → `const { default: validate } = await import(...)`
- Namespace: `import * as v from './x'` → `const v = await import(...)`

Anything that does not match these patterns is passed through unchanged. Transform is limited to lines at the top of the file (before any non-import, non-comment line) to avoid false positives inside logic.

### Orchestrator

Loads helper files from DB when assembling `workerData` before spawning each worker. No change to worker lifecycle.

---

## UI — File Tree Sidebar

The parser editor left panel gains a **"Files"** section below the step list.

**Create:**
- Click `+` button next to "Files" heading
- Inline text input for filename (e.g. `validate`) — Enter to confirm, Escape to cancel
- File is created in DB and opened immediately in Monaco

**Open:**
- Click filename → content loads in the shared Monaco editor pane
- Active item (step or file) is highlighted in the sidebar

**Delete:**
- Hover row → trash icon appears
- Confirm dialog before deletion (same pattern as step delete)

**Unsaved state:**
- Dot indicator on the sidebar item when content is modified but not saved
- Switching to another item triggers a save (or prompts if unsaved — consistent with existing step editor behavior)

The Monaco editor is shared between steps and helper files. No new editor instance is needed.

---

## Constraints & Conventions

- Helper files are flat — no subfolders
- `path` must be a valid JS identifier string (no slashes, no extension)
- Import paths in step code must start with `./` to be recognized by the transform
- Imports must be single-line (multi-line import braces are not supported by the transform in this iteration)
- Helper files run through tsx, so TypeScript syntax is supported
- Temp files in `/tmp/scraper-modules/` are written fresh on each worker startup; no cache invalidation needed

---

## Out of Scope (This Iteration)

- Org-level shared files (schema is forward-compatible; implementation deferred)
- Importing helpers from other parsers
- Helper file versioning
- Linting / type-checking helper files in the UI
