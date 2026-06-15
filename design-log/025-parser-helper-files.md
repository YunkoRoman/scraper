# 025 — Parser Helper Files

**Status:** implemented

## Background

Step code in this platform runs as an `AsyncFunction` body (not an ES module). The orchestrator spawns one Worker Thread per step and passes step code as a string in `workerData`. Developers have requested the ability to split helper logic into separate files importable from step code, rather than inlining everything in one function body.

## Problem

No mechanism existed to create, store, or reference per-parser helper modules. Static `import` statements do not work inside `AsyncFunction` bodies.

## Design

### Database schema

New `parser_files` table:
```
CREATE TABLE parser_files (
  id uuid PRIMARY KEY,
  parser_id uuid NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  path text NOT NULL,
  content text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE (parser_id, path)
);
```

Flat filenames only (no slashes). `path` must be a bare identifier: `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/ (JavaScript identifier rules). Prevents path traversal (`../`, `/`) and confusion with directory structure.

### Persistence layer

**`ModulePersistenceService`** (`src/infrastructure/db/ModulePersistenceService.ts`) — extends `BasePersistenceService`:
- `createModule(parserId, path, content)` — insert, throw if `path` not a valid identifier
- `getModule(parserId, path)` — select by parser + path
- `listModules(parserId)` — select all for parser
- `updateModule(parserId, path, content)` — update content and `updated_at`
- `deleteModule(parserId, path)` — delete by parser + path

All methods validate `path` against the identifier regex before executing queries.

### Import transformation

**`transformImports` utility** (`src/infrastructure/worker/transformImports.ts`) — pure function:
- Scans the top of step code line-by-line until it hits a non-import/non-comment/non-blank line.
- Recognizes:
  - `import { x } from './name'` → `const { x } = await import('/tmp/scraper-modules/{parserName}/name.js')`
  - `import name from './name'` → `const name = await import('/tmp/scraper-modules/{parserName}/name.js')`
  - `import * as ns from './name'` → `const ns = await import('/tmp/scraper-modules/{parserName}/name.js')`
- Validates that `name` is a bare identifier (no slashes, no parent refs).
- Replaces the original `import` statements; preserves the rest of the code unchanged.
- Returns transformed code and an array of module names that were imported (for validation at worker startup).

If no imports are found, returns the original code and an empty array.

### WorkerData extension

**`WorkerData` interface** (`src/infrastructure/worker/messages.ts`) — additive fields:
- `parserName?: string` — the parser's `name` field (used in temp dir path)
- `helperFiles?: Array<{ path: string; content: string }>` — list of helper file objects

No changes to `WorkerInMessage` or `WorkerOutMessage` — these remain symmetric and unchanged.

### Worker startup

Both `ExtractorWorker.main()` and `TraverserWorker.main()` — in the inline-code path (after `parserFilePath` check):

1. If `data.helperFiles` and `data.parserName` are present:
   - Create `/tmp/scraper-modules/{parserName}/` directory (idempotent).
   - For each helper file, write `path + '.ts'` to disk with `content`.
   - Apply `transformImports(data.stepCode)` → `transformedCode`.
   - Pass `transformedCode` (not original) to `AsyncFunction` constructor.
   - Validate that all imported module names exist in the on-disk files (early error if import refers to missing module).

2. If no helper files, skip transform and use `data.stepCode` as-is.

Path traversal guards:
- `parserName` already validated at route layer as bare identifier.
- `path` in helper files validated at route layer.
- Temp directory `/tmp/scraper-modules/{parserName}/` is always under `/tmp/scraper-modules/`, never allowing escape.

### Domain changes

**`ParserConfig` interface** (`src/domain/Parser.ts`):
- Add `helperFiles?: Array<{ path: string; content: string }>`

**`DbParserLoader`** (`src/infrastructure/loader/DbParserLoader.ts`):
- After loading step code, query `parser_files` table for the parser.
- Populate `helperFiles` on the returned `ParserConfig`.

### Orchestrator integration

**`ParserOrchestrator.spawnWorker()`** — pass helper files in `workerData`:

```ts
const workerData: WorkerData = {
  // existing fields...
  parserName: parser.name,
  helperFiles: parser.helperFiles,
};
```

Only set for inline-code workers (those with `stepConfig.code`, not `parserFilePath`).

### API routes

Five new routes in `src/api/modules.ts` (or integrated into parser routes):

1. **GET `/api/parsers/:id/modules`** — list all helper files for the parser
   - Response: `{ modules: Array<{ id, path, created_at, updated_at }> }`

2. **POST `/api/parsers/:id/modules`** — create a new helper file
   - Body: `{ path: string; content: string }`
   - Validate `path` as bare identifier at route layer (return 400 if invalid).
   - Response: `{ id, path, created_at }`
   - Return 409 if path already exists.

3. **GET `/api/parsers/:id/modules/:fileId`** — get a helper file by ID
   - Response: `{ id, path, content, created_at, updated_at }`

4. **PUT `/api/parsers/:id/modules/:fileId`** — update helper file content
   - Body: `{ content: string }`
   - Response: `{ id, path, content, updated_at }`

5. **DELETE `/api/parsers/:id/modules/:fileId`** — delete a helper file
   - Response: `{ success: true }`

Path validation (bare identifier regex) happens at every route that accepts `path` in the request body.

### UI: File tree sidebar

**`ParserEditorPage`** (`client/src/pages/ParserEditorPage.tsx`):

- Left sidebar extended with a **Helper Files** collapsible section below the step list.
- Shows a tree of files with icons and right-click context menu (delete).
- **Add Module** button opens a modal with `path` (text input) and `content` (empty, ready for edit).
- Click a file name → `useParserEditor` sets `activeItemType: 'module'` and `activeModuleId`.
- Shared Monaco editor displays helper file content when a module is active (instead of step code).

**`useParserEditor` hook** (`client/src/hooks/useParserEditor.ts`) — extended:

```ts
const [activeItemType, setActiveItemType] = useState<'step' | 'module'>('step');
const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
const [helperFiles, setHelperFiles] = useState<Array<{ id, path, content }>>([]);

const selectModule = (fileId: string) => {
  setActiveItemType('module');
  setActiveModuleId(fileId);
};

const addModule = async (path: string, content: string) => {
  // POST /api/parsers/:id/modules
  const res = await fetch(`/api/parsers/${parser.id}/modules`, {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
  const newFile = await res.json();
  setHelperFiles([...helperFiles, newFile]);
};

const removeModule = async (fileId: string) => {
  // DELETE /api/parsers/:id/modules/:fileId
  await fetch(`/api/parsers/${parser.id}/modules/${fileId}`, {
    method: 'DELETE',
  });
  setHelperFiles(helperFiles.filter(f => f.id !== fileId));
};

const updateCurrentModule = async (content: string) => {
  if (activeItemType === 'module' && activeModuleId) {
    // PUT /api/parsers/:id/modules/:fileId
    const res = await fetch(`/api/parsers/${parser.id}/modules/${activeModuleId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    const updated = await res.json();
    setHelperFiles(helperFiles.map(f => f.id === activeModuleId ? updated : f));
  }
};
```

Shared Monaco editor checks `activeItemType` and displays either step code or module content accordingly. Save button calls either `updateStep()` or `updateCurrentModule()`.

## Questions and Answers

- **Q1 — Why temp files instead of inlining content in a code string?** `tsx` handles `.ts` module files cleanly with proper scoping and syntax highlighting. Inlining would break if helpers use top-level declarations (e.g., `interface X { ... }`), force all helpers into a single scope, and make future language support harder.

- **Q2 — Why `parserName` for the temp directory path, not `parserId`?** Parser names are validated as filesystem-safe (`/^[a-zA-Z0-9 _-]{1,100}$/`) and human-readable in logs. Using the UUID `parserId` would be less debuggable. Path traversal guards are applied regardless, so the choice does not affect security.

- **Q3 — Why no protocol change to `WorkerInMessage` / `WorkerOutMessage`?** `helperFiles` and `parserName` are bootstrap payload fields in `WorkerData`, not runtime messages. Main↔worker message symmetry is untouched; adding fields to `WorkerData` (a data blob, not a message type) requires no protocol versioning.

- **Q4 — Why flat filenames only?** Simplifies the UI (no nested modal for path segments), the identifier validation regex (only allow `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`), and the import transform (match `./name` only). Org-shared files (future scope) will use a separate scoping mechanism.

- **Q5 — Why single-line imports only?** Multi-line `import { a, b, c } from './mod'` blocks would require full AST parsing to extract the module name and variable bindings. Single-line imports are sufficient for common use cases (one import per line) and keep the transform simple and auditable.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Flat filenames only | No directory hierarchies; users with many helpers must use long names or namespace convention (e.g., `helpers_db`, `helpers_dom`). |
| Single-line imports only | Users must write `import x from './mod'; import y from './other';` not `import { x, y } from './mod';`. Multi-line blocks are not supported. |
| Temp files written fresh on every worker startup | No caching across restarts; minimal performance impact (disk write is fast for small files). Ensures helper content always matches the DB. |
| Module name must start with `./` | No bare imports (`import x from 'npm-package'`) — only relative imports are supported. Out-of-scope; npm dependencies should be installed at the parser level (future feature). |
| Org-shared files out of scope | Each parser has its own isolated helper file namespace. Multi-tenant sharing requires a separate schema (nullable `parserId`, org-level `filePath` key). Additive when needed. |

## Implementation Results

See git log for commits.
