# Parser Helper Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers split step logic across multiple per-parser **helper files** — flat-structured, DB-stored TypeScript modules importable into any step of the same parser via standard `import { x } from './x'` syntax. DB-stored step code runs as an `AsyncFunction` body (not an ES module), so static imports are rewritten at worker startup into `await import()` calls pointing at temp files written from DB content.

**Architecture:** DDD layering is strict — domain has zero I/O. New persistence (`parser_files` table + `ModulePersistenceService`), a pure transform utility, additive worker-protocol fields, orchestrator wiring, 5 thin API routes, and editor UI. No upward imports; no changes to the worker message *protocol* (`WorkerInMessage` / `WorkerOutMessage`) — only `WorkerData` (the worker bootstrap payload) gains additive fields, so symmetry of the message protocol is preserved by construction.

**Tech Stack:** TypeScript, Node.js Worker Threads, Playwright/Puppeteer, PostgreSQL (Drizzle ORM), Express, React 19 + Vite + Monaco, Vitest.

**Naming note:** The approved design decisions (#4, #5, #8) specify the temp dir keyed by **`parserName`** (`/tmp/scraper-modules/{parserName}/{path}.ts`). The spec prose mentions `parserId`; the approved decisions win. This plan uses `parserName` consistently. Parser names are validated server-side (`/^[a-zA-Z0-9 _-]{1,100}$/`), so they are filesystem-safe.

---

## Task 1: DB migration + Drizzle schema for `parser_files`

**Files**
- Create: `src/infrastructure/db/migrations/0009_parser_files.sql`
- Modify: `src/infrastructure/db/schema.ts`

**Steps**

- [ ] Create the migration file `src/infrastructure/db/migrations/0009_parser_files.sql` (highest existing is `0008`; reversible via the noted DROP):

```sql
-- Parser helper files: flat, per-parser, DB-stored TypeScript modules.
CREATE TABLE IF NOT EXISTS parser_files (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id  UUID        NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  path       TEXT        NOT NULL,
  content    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parser_id, path)
);
CREATE INDEX IF NOT EXISTS parser_files_parser_idx ON parser_files(parser_id);

-- Reversal (destructive — drops all helper files):
-- DROP TABLE IF EXISTS parser_files;
```

- [ ] In `src/infrastructure/db/schema.ts`, add the table definition after the `stepVersions` table (around line 102):

```ts
export const parserFiles = pgTable(
  'parser_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parserId: uuid('parser_id')
      .notNull()
      .references(() => parsers.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parserPathUnique: unique('parser_files_parser_path_unique').on(t.parserId, t.path),
  }),
)
```

- [ ] In `src/infrastructure/db/schema.ts`, add `unique` to the drizzle import on line 2:

```ts
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
```

- [ ] Run the migration and confirm it applies cleanly:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run db:migrate
```

Expected: migration runs without error; `0009_parser_files.sql` is applied (no "already exists" failure on a fresh DB).

- [ ] Confirm TypeScript still compiles:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds (exit 0).

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(db): add parser_files table for helper files

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `ModulePersistenceService`

**Files**
- Create: `src/infrastructure/db/ModulePersistenceService.ts`
- Create (test): `src/tests/modulePersistence.test.ts`

**Steps**

- [ ] Write the failing test `src/tests/modulePersistence.test.ts` (follows the `vi.mock('../infrastructure/db/client.js')` pattern from `src/tests/stepVersionPersistence.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest'

const calls: { op: string; v?: unknown }[] = []

vi.mock('../infrastructure/db/client.js', () => {
  const chain: Record<string, unknown> = {}
  chain.insert = () => chain
  chain.values = (v: unknown) => { calls.push({ op: 'insert', v }); return chain }
  chain.returning = () =>
    Promise.resolve([{ id: 'f1', parserId: 'p1', path: 'validate', content: 'x', createdAt: new Date(), updatedAt: new Date() }])
  chain.select = () => chain
  chain.from = () => chain
  chain.where = () => { calls.push({ op: 'where' }); return Promise.resolve([]) }
  chain.orderBy = () => Promise.resolve([])
  chain.delete = () => chain
  chain.update = () => chain
  chain.set = (v: unknown) => { calls.push({ op: 'set', v }); return chain }
  return { db: chain, pool: {} }
})

import { ModulePersistenceService } from '../infrastructure/db/ModulePersistenceService.js'

describe('ModulePersistenceService', () => {
  it('create() inserts parserId, path, content', async () => {
    const svc = new ModulePersistenceService()
    await svc.create({ parserId: 'p1', path: 'validate', content: 'export const validate = () => true' })
    const inserted = calls.find((c) => c.op === 'insert')
    expect((inserted?.v as { parserId: string }).parserId).toBe('p1')
    expect((inserted?.v as { path: string }).path).toBe('validate')
    expect((inserted?.v as { content: string }).content).toContain('validate')
  })

  it('update() sets updatedAt alongside provided fields', async () => {
    const svc = new ModulePersistenceService()
    await svc.update('f1', { content: 'changed' })
    const set = calls.find((c) => c.op === 'set')
    expect((set?.v as { content: string }).content).toBe('changed')
    expect((set?.v as { updatedAt?: Date }).updatedAt).toBeInstanceOf(Date)
  })
})
```

- [ ] Run the test — expect it to FAIL (module does not exist yet):

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- modulePersistence
```

Expected: failure with a resolution error for `../infrastructure/db/ModulePersistenceService.js`.

- [ ] Create `src/infrastructure/db/ModulePersistenceService.ts`:

```ts
import { eq } from 'drizzle-orm'
import { parserFiles } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type ParserFileRow = typeof parserFiles.$inferSelect

export interface CreateModuleInput {
  parserId: string
  path: string
  content?: string
}

export interface UpdateModuleInput {
  path?: string
  content?: string
}

export class ModulePersistenceService extends BasePersistenceService<
  ParserFileRow,
  CreateModuleInput,
  UpdateModuleInput
> {
  async create(input: CreateModuleInput): Promise<ParserFileRow> {
    const [row] = await this.db
      .insert(parserFiles)
      .values({ parserId: input.parserId, path: input.path, content: input.content ?? '' })
      .returning()
    return row
  }

  async findById(id: string): Promise<ParserFileRow | null> {
    const [row] = await this.db.select().from(parserFiles).where(eq(parserFiles.id, id))
    return row ?? null
  }

  async findByParserId(parserId: string): Promise<ParserFileRow[]> {
    return this.db.select().from(parserFiles).where(eq(parserFiles.parserId, parserId))
  }

  async update(id: string, input: UpdateModuleInput): Promise<ParserFileRow> {
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.path !== undefined) patch.path = input.path
    if (input.content !== undefined) patch.content = input.content
    const [row] = await this.db
      .update(parserFiles)
      .set(patch)
      .where(eq(parserFiles.id, id))
      .returning()
    return row
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(parserFiles).where(eq(parserFiles.id, id))
  }
}
```

- [ ] Run the test — expect it to PASS:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- modulePersistence
```

Expected: 2 passing tests.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(db): add ModulePersistenceService for helper files

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `transformImports` utility (pure)

**Files**
- Create: `src/infrastructure/worker/transformImports.ts`
- Create (test): `src/tests/transformImports.test.ts`

**Steps**

- [ ] Write the failing test `src/tests/transformImports.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { transformImports } from '../infrastructure/worker/transformImports.js'

const DIR = '/tmp/scraper-modules/demo'

describe('transformImports', () => {
  it('rewrites named imports to await import with destructuring', () => {
    const out = transformImports(`import { validate, retry } from './helpers'\nreturn []`, DIR)
    expect(out).toContain(`const { validate, retry } = await import('${DIR}/helpers.ts')`)
    expect(out).not.toContain('import {')
  })

  it('rewrites default imports', () => {
    const out = transformImports(`import validate from './validate'\nreturn []`, DIR)
    expect(out).toContain(`const { default: validate } = await import('${DIR}/validate.ts')`)
  })

  it('rewrites namespace imports', () => {
    const out = transformImports(`import * as v from './v'\nreturn []`, DIR)
    expect(out).toContain(`const v = await import('${DIR}/v.ts')`)
  })

  it('stops transforming once a non-import, non-comment, non-blank line is reached', () => {
    const code = `import { a } from './a'\nconst x = 1\nimport { b } from './b'`
    const out = transformImports(code, DIR)
    expect(out).toContain(`const { a } = await import('${DIR}/a.ts')`)
    // The second import is below logic — left untouched.
    expect(out).toContain(`import { b } from './b'`)
  })

  it('passes through leading comments and blank lines before imports', () => {
    const code = `// header\n\nimport { a } from './a'\nreturn []`
    const out = transformImports(code, DIR)
    expect(out).toContain(`const { a } = await import('${DIR}/a.ts')`)
  })

  it('leaves code without imports unchanged', () => {
    const code = `const page = 1\nreturn []`
    expect(transformImports(code, DIR)).toBe(code)
  })
})
```

- [ ] Run the test — expect FAIL (module missing):

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- transformImports
```

Expected: resolution error for `transformImports.js`.

- [ ] Create `src/infrastructure/worker/transformImports.ts`:

```ts
// Rewrites top-of-file single-line static imports of local helper modules into
// `await import()` calls that can run inside an AsyncFunction body.
//
//   import { a, b } from './x'   -> const { a, b } = await import('${tempDir}/x.ts')
//   import name from './x'       -> const { default: name } = await import('${tempDir}/x.ts')
//   import * as ns from './x'    -> const ns = await import('${tempDir}/x.ts')
//
// Only lines at the top of the file (before the first non-import, non-comment,
// non-blank line) are transformed. Imports must be single-line and reference a
// local module path starting with './'.

const NAMED = /^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/
const NAMESPACE = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/
const DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/

function importPath(tempDir: string, name: string): string {
  return `${tempDir}/${name}.ts`
}

function rewriteLine(line: string, tempDir: string): string | null {
  let m = line.match(NAMED)
  if (m) return `const {${m[1]}} = await import('${importPath(tempDir, m[2])}')`
  m = line.match(NAMESPACE)
  if (m) return `const ${m[1]} = await import('${importPath(tempDir, m[2])}')`
  m = line.match(DEFAULT)
  if (m) return `const { default: ${m[1]} } = await import('${importPath(tempDir, m[2])}')`
  return null
}

export function transformImports(code: string, tempDir: string): string {
  const lines = code.split('\n')
  const out: string[] = []
  let inImportRegion = true

  for (const line of lines) {
    if (inImportRegion) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('//')) {
        out.push(line)
        continue
      }
      if (trimmed.startsWith('import')) {
        const rewritten = rewriteLine(trimmed, tempDir)
        out.push(rewritten ?? line)
        continue
      }
      // First real line of logic — stop transforming.
      inImportRegion = false
    }
    out.push(line)
  }

  return out.join('\n')
}
```

- [ ] Run the test — expect PASS:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- transformImports
```

Expected: all tests pass.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(worker): add transformImports utility for helper-file imports

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Extend `WorkerData` with `helperFiles` and `parserName`

**Files**
- Modify: `src/infrastructure/worker/messages.ts`

**Steps**

- [ ] In `src/infrastructure/worker/messages.ts`, add `parserName?` and `helperFiles?` to the **inline-code** branch of `WorkerData` (the second union member, lines 23-31). Replace that branch:

```ts
  | {
      stepCode: string
      stepType: 'traverser' | 'extractor'
      outputFile?: string
      stepSettings?: StepSettings
      stepName: string
      parserName?: string
      helperFiles?: Array<{ path: string; content: string }>
      browserSettings?: BrowserSettings
      __workerPath?: string
    }
```

- [ ] Confirm the message protocol (`WorkerInMessage` / `WorkerOutMessage`) is untouched — only the `WorkerData` bootstrap payload changed. No new message types means main↔worker symmetry is preserved by construction. (No command needed; this is a review checkpoint.)

- [ ] Verify compilation:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(worker): add helperFiles and parserName to WorkerData

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Worker startup — write helper files + transform step code

**Files**
- Modify: `src/infrastructure/worker/ExtractorWorker.ts`
- Modify: `src/infrastructure/worker/TraverserWorker.ts`

Both workers build the step's `run` via `new AsyncFunction('page', 'task', ...)` inside `main()`'s `else` branch (the inline-code path). Helper files must be written to disk and step code transformed **before** that `AsyncFunction` is constructed.

**Steps**

- [ ] In `src/infrastructure/worker/ExtractorWorker.ts`, add Node fs/path imports near the top imports (after line 2, the `node:worker_threads` import):

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
```

- [ ] In `src/infrastructure/worker/ExtractorWorker.ts`, inside `main()`, in the `else` branch (the inline-code path, currently lines 167-179), replace the body so helper files are written and imports transformed before the `AsyncFunction` is built. Replace:

```ts
  } else {
    const solverUrl =
      ('stepSettings' in data ? data.stepSettings?.flareSolverrUrl : undefined) ??
      data.browserSettings?.flareSolverrUrl ??
      process.env.FLARESOLVERR_URL ??
      ''
    const solveCFSnippet = makeSolveCFSnippet(solverUrl)
    const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
    const { Extractor: E } = await import('../../domain/entities/Extractor.js')
    const outFile = data.outputFile ?? `${data.stepName}.csv`
    step = new E(stepName(data.stepName), run, outFile, data.stepSettings)
    stepSettings = data.stepSettings
  }
```

with:

```ts
  } else {
    const solverUrl =
      ('stepSettings' in data ? data.stepSettings?.flareSolverrUrl : undefined) ??
      data.browserSettings?.flareSolverrUrl ??
      process.env.FLARESOLVERR_URL ??
      ''
    const solveCFSnippet = makeSolveCFSnippet(solverUrl)

    let stepCode = data.stepCode
    if (data.helperFiles?.length) {
      const tempDir = join('/tmp/scraper-modules', data.parserName ?? data.stepName)
      mkdirSync(tempDir, { recursive: true })
      for (const file of data.helperFiles) {
        writeFileSync(join(tempDir, `${file.path}.ts`), file.content)
      }
      stepCode = transformImports(stepCode, tempDir)
    }

    const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + stepCode)
    const { Extractor: E } = await import('../../domain/entities/Extractor.js')
    const outFile = data.outputFile ?? `${data.stepName}.csv`
    step = new E(stepName(data.stepName), run, outFile, data.stepSettings)
    stepSettings = data.stepSettings
  }
```

- [ ] In `src/infrastructure/worker/ExtractorWorker.ts`, add the transform import alongside the other relative imports (after the `makeSolveCFSnippet` import, line 15):

```ts
import { transformImports } from './transformImports.js'
```

- [ ] Apply the same three edits to `src/infrastructure/worker/TraverserWorker.ts`. Add the fs/path imports and the `transformImports` import the same way, then in its `else` branch replace:

```ts
    const solveCFSnippet = makeSolveCFSnippet(solverUrl)
    const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
    const { Traverser: T } = await import('../../domain/entities/Traverser.js')
    step = new T(stepName(data.stepName), run, data.stepSettings)
    stepSettings = data.stepSettings
```

with:

```ts
    const solveCFSnippet = makeSolveCFSnippet(solverUrl)

    let stepCode = data.stepCode
    if (data.helperFiles?.length) {
      const tempDir = join('/tmp/scraper-modules', data.parserName ?? data.stepName)
      mkdirSync(tempDir, { recursive: true })
      for (const file of data.helperFiles) {
        writeFileSync(join(tempDir, `${file.path}.ts`), file.content)
      }
      stepCode = transformImports(stepCode, tempDir)
    }

    const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + stepCode)
    const { Traverser: T } = await import('../../domain/entities/Traverser.js')
    step = new T(stepName(data.stepName), run, data.stepSettings)
    stepSettings = data.stepSettings
```

- [ ] Verify compilation:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(worker): write helper files and transform imports at startup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `ParserConfig.helperFiles` + `DbParserLoader` loading

**Files**
- Modify: `src/domain/entities/Parser.ts`
- Modify: `src/infrastructure/loader/DbParserLoader.ts`

The domain change is a pure type addition — no I/O, no infrastructure import, so DDD layering is respected.

**Steps**

- [ ] In `src/domain/entities/Parser.ts`, add `helperFiles?` to the `ParserConfig` interface (after `filePath?: string` on line 41):

```ts
  filePath?: string
  helperFiles?: Array<{ path: string; content: string }>
```

- [ ] In `src/infrastructure/loader/DbParserLoader.ts`, add `parserFiles` to the schema import (line 8):

```ts
import { parsers, steps as stepsTable, parserFiles } from '../db/schema.js'
```

- [ ] In `src/infrastructure/loader/DbParserLoader.ts`, after the `stepRows` query (line 23-26) and before building `stepMap`, load helper files:

```ts
    const fileRows = await db
      .select()
      .from(parserFiles)
      .where(eq(parserFiles.parserId, row.id))
    const helperFiles = fileRows.map((f) => ({ path: f.path, content: f.content }))
```

- [ ] In `src/infrastructure/loader/DbParserLoader.ts`, add `helperFiles` to the returned config object (in the final `return {...}`, after `browserSettings: {...}`):

```ts
      browserSettings: {
        browser_type: row.browserType as BrowserType,
        ...(row.browserSettings as ParserConfig['browserSettings']),
      },
      helperFiles,
    }
```

- [ ] Verify compilation:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(loader): load helper files into ParserConfig

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Orchestrator — pass `parserName` + `helperFiles` to workers

**Files**
- Modify: `src/application/orchestrator/ParserOrchestrator.ts`

`spawnWorker()` builds `wData`. Only the **non-filePath** branch (inline code) needs the new fields, and both its `isTsx` and non-`isTsx` sub-branches must get them (the worker reads them regardless of `__workerPath`).

**Steps**

- [ ] In `src/application/orchestrator/ParserOrchestrator.ts`, in `spawnWorker()`, update the non-filePath `isTsx` branch (currently lines 218-226) to include the two new fields:

```ts
        ? {
            stepCode: step.code!,
            stepType: step.type,
            outputFile,
            stepSettings: step.settings,
            stepName: String(step.name),
            parserName: this.config.name,
            helperFiles: this.config.helperFiles ?? [],
            __workerPath: tsWorkerFile,
            browserSettings: this.config.browserSettings,
          }
```

- [ ] In the same method, update the non-filePath, non-`isTsx` branch (currently lines 227-234):

```ts
        : {
            stepCode: step.code!,
            stepType: step.type,
            outputFile,
            stepSettings: step.settings,
            stepName: String(step.name),
            parserName: this.config.name,
            helperFiles: this.config.helperFiles ?? [],
            browserSettings: this.config.browserSettings,
          }
```

- [ ] Verify compilation:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(orchestrator): pass parserName and helperFiles to workers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: API routes for modules + service wiring

**Files**
- Modify: `src/api/routes/parsers.ts`
- Modify: `src/api/server.ts`

DELETE returns `{ ok: true }` (not 204) because the client's `apiRequest` always calls `res.json()`. Path validation enforces flat filenames (no slashes/dots, valid identifier-ish). Routes live under `/:id/modules` to avoid colliding with the existing `/files` CSV routes.

**Steps**

- [ ] In `src/api/routes/parsers.ts`, add the import for the service type near the other persistence-service type imports (after line 18):

```ts
import type { ModulePersistenceService } from '../../infrastructure/db/ModulePersistenceService.js'
```

- [ ] In `src/api/routes/parsers.ts`, add `moduleService` to the `Deps` interface (after `stepVersionService` on line 30):

```ts
  stepVersionService: StepVersionPersistenceService
  moduleService: ModulePersistenceService
```

- [ ] In `src/api/routes/parsers.ts`, add `moduleService` to the destructured params of `createParsersRouter` (after `stepVersionService` on line 40):

```ts
  stepVersionService,
  moduleService,
}: Deps) {
```

- [ ] In `src/api/routes/parsers.ts`, add the 5 module routes immediately before `return router` (after the step-debug route, around line 674). The `:id` param middleware already validates parser ownership, so handlers can trust `res.locals.parser`:

```ts
  // ── Helper modules ─────────────────────────────────────────────────────────────

  const PATH_RE = /^[A-Za-z_$][\w$]*$/

  router.get('/:id/modules', async (_req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const rows = await moduleService.findByParserId(parserId)
    res.json({ modules: rows.map(({ content: _c, ...rest }) => rest) })
  })

  router.post('/:id/modules', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const { path, content } = req.body as { path?: string; content?: string }
    if (!path || !PATH_RE.test(path)) {
      res.status(400).json({ error: 'path must be a valid identifier (no slashes, no extension)' })
      return
    }
    try {
      const module = await moduleService.create({ parserId, path, content })
      res.status(201).json({ module })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: `File "${path}" already exists` })
        return
      }
      throw err
    }
  })

  router.get('/:id/modules/:fileId', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const module = await moduleService.findById(req.params.fileId)
    if (!module || module.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.json({ module })
  })

  router.put('/:id/modules/:fileId', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const existing = await moduleService.findById(req.params.fileId)
    if (!existing || existing.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    const { path, content } = req.body as { path?: string; content?: string }
    if (path !== undefined && !PATH_RE.test(path)) {
      res.status(400).json({ error: 'path must be a valid identifier (no slashes, no extension)' })
      return
    }
    try {
      const module = await moduleService.update(req.params.fileId, { path, content })
      res.json({ module })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: `File "${path}" already exists` })
        return
      }
      throw err
    }
  })

  router.delete('/:id/modules/:fileId', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const existing = await moduleService.findById(req.params.fileId)
    if (!existing || existing.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    await moduleService.delete(req.params.fileId)
    res.json({ ok: true })
  })

```

- [ ] In `src/api/server.ts`, add the service import near the other persistence imports (next to the `StepVersionPersistenceService` import on line 12):

```ts
import { ModulePersistenceService } from '../infrastructure/db/ModulePersistenceService.js'
```

- [ ] In `src/api/server.ts`, instantiate the service near the other service instantiations (after line 29, where `stepVersionService` is created):

```ts
const moduleService = new ModulePersistenceService()
```

- [ ] In `src/api/server.ts`, pass `moduleService` into `createParsersRouter` (after `stepVersionService,` in the deps object, line 105):

```ts
    stepVersionService,
    moduleService,
  }),
```

- [ ] Verify compilation:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(api): add helper-module CRUD routes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Client API functions

**Files**
- Modify: `client/src/api.ts`

Follows the existing `apiRequest` helper and the `createStep`/`deleteStep` patterns (lines 244-315).

**Steps**

- [ ] In `client/src/api.ts`, add the `ParserFileRow` interface and 5 functions immediately after `deleteStep` (after line 315):

```ts
export interface ParserFileRow {
  id: string
  parserId: string
  path: string
  content: string
  createdAt: string
  updatedAt: string
}

export async function listModules(
  parserId: string,
): Promise<Array<Omit<ParserFileRow, 'content'>>> {
  const data = await apiRequest<{ modules: Array<Omit<ParserFileRow, 'content'>> }>(
    `/api/parsers/${parserId}/modules`,
  )
  return data.modules
}

export async function createModule(
  parserId: string,
  input: { path: string; content?: string },
): Promise<ParserFileRow> {
  const data = await apiRequest<{ module: ParserFileRow }>(`/api/parsers/${parserId}/modules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.module
}

export async function getModule(parserId: string, fileId: string): Promise<ParserFileRow> {
  const data = await apiRequest<{ module: ParserFileRow }>(
    `/api/parsers/${parserId}/modules/${fileId}`,
  )
  return data.module
}

export async function updateModule(
  parserId: string,
  fileId: string,
  input: { path?: string; content?: string },
): Promise<ParserFileRow> {
  const data = await apiRequest<{ module: ParserFileRow }>(
    `/api/parsers/${parserId}/modules/${fileId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return data.module
}

export async function deleteModule(parserId: string, fileId: string): Promise<void> {
  await apiRequest(`/api/parsers/${parserId}/modules/${fileId}`, { method: 'DELETE' })
}
```

- [ ] Verify the client builds:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(client): add module API functions

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: `useParserEditor` — module state + dispatch

**Files**
- Modify: `client/src/hooks/useParserEditor.ts`

Add `activeItemType` so the shared Monaco `code` state and `handleCodeChange` debounce save route to either a step or a module. `selectStep` and `addStep`/`removeStep` set `activeItemType('step')`; the module equivalents set `'module'`.

**Steps**

- [ ] In `client/src/hooks/useParserEditor.ts`, extend the API import (lines 3-6):

```ts
import {
  getParser, updateParser, createStep, updateStep, deleteStep,
  listModules, createModule, getModule, updateModule, deleteModule,
  type ParserRow, type StepRow, type UpdateStepInput, type UpdateParserInput,
  type ParserFileRow,
} from '../api'
```

- [ ] Add module state after the existing state declarations (after `debounceRef` on line 18):

```ts
  const [modules, setModules] = useState<Array<Omit<ParserFileRow, 'content'>>>([])
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
  const [activeItemType, setActiveItemType] = useState<'step' | 'module'>('step')
```

- [ ] In the initial load `useEffect` (lines 22-38), also load modules. Replace the `.then(...)` block body so it fetches modules in parallel:

```ts
    Promise.all([getParser(parserId), listModules(parserId)])
      .then(([{ parser: p, steps: ss }, ms]) => {
        setParser(p)
        setSteps(ss)
        setModules(ms)
        if (ss.length > 0) {
          setSelectedStepName(ss[0].name)
          setCode(ss[0].code)
          setActiveItemType('step')
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
```

- [ ] Update `selectStep` (lines 47-54) to set `activeItemType` to `'step'`:

```ts
  const selectStep = useCallback((name: string) => {
    const s = steps.find((st) => st.name === name)
    if (!s) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setActiveItemType('step')
    setSelectedStepName(name)
    setCode(s.code)
    setSaveStatus('idle')
  }, [steps])
```

- [ ] Add `selectModule` after `selectStep`:

```ts
  const selectModule = useCallback(async (id: string) => {
    if (!parserId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setActiveItemType('module')
    setSelectedModuleId(id)
    setSaveStatus('idle')
    try {
      const m = await getModule(parserId, id)
      setCode(m.content)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserId])
```

- [ ] Replace `handleCodeChange` (lines 56-73) so it dispatches the debounced save to a module or step based on `activeItemType`:

```ts
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    setSaveStatus('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const capturedType = activeItemType
    const capturedStepName = selectedStepName
    const capturedModuleId = selectedModuleId
    debounceRef.current = setTimeout(async () => {
      if (!parserId) return
      setSaveStatus('saving')
      try {
        if (capturedType === 'module') {
          if (!capturedModuleId) return
          await updateModule(parserId, capturedModuleId, { content: newCode })
        } else {
          if (!capturedStepName) return
          const updated = await updateStep(parserId, capturedStepName, { code: newCode })
          setSteps((prev) => prev.map((s) => (s.name === capturedStepName ? updated : s)))
        }
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 1000)
  }, [parserId, activeItemType, selectedStepName, selectedModuleId])
```

- [ ] Add `addModule` and `removeModule` after `removeStep` (after line 122):

```ts
  const addModule = useCallback(async (path: string) => {
    if (!parserId) return
    try {
      const created = await createModule(parserId, { path, content: '' })
      const { content: _c, ...summary } = created
      setModules((prev) => [...prev, summary])
      setActiveItemType('module')
      setSelectedModuleId(created.id)
      setCode(created.content)
      setSaveStatus('idle')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserId])

  const removeModule = useCallback(async (id: string) => {
    if (!parserId) return
    try {
      await deleteModule(parserId, id)
      const next = modules.filter((m) => m.id !== id)
      setModules(next)
      if (selectedModuleId === id) {
        setSelectedModuleId(null)
        setActiveItemType('step')
        setCode(selectedStep?.code ?? steps[0]?.code ?? '')
        setSelectedStepName(selectedStepName ?? steps[0]?.name ?? null)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserId, modules, selectedModuleId, selectedStep, selectedStepName, steps])
```

- [ ] Update the `addStep` callback (lines 90-106) to set `activeItemType('step')` after a successful create (add `setActiveItemType('step')` right after `setSelectedStepName(stepWithCode.name)`):

```ts
      setSteps((prev) => [...prev, stepWithCode])
      setActiveItemType('step')
      setSelectedStepName(stepWithCode.name)
      setCode(stepWithCode.code)
```

- [ ] Extend the hook's return object (lines 144-148) with the new state and functions:

```ts
  return {
    parser, steps, selectedStep, selectedStepName, code,
    modules, selectedModuleId, activeItemType,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings, saveStepMeta,
    selectModule, addModule, removeModule,
  }
```

- [ ] Verify the client builds:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(client): add helper-module state to useParserEditor

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Editor UI — "Files" sidebar section

**Files**
- Modify: `client/src/pages/ParserEditorPage/index.tsx`

Add a "Files" section below the step list in the left sidebar (the step list renders around lines 369-470). `+` reveals an inline filename input (Enter confirms, Escape cancels). Clicking a filename opens it in the shared Monaco editor. Hovering a row reveals a trash icon that deletes after `window.confirm`. Active item (step or module) is highlighted using `activeItemType`/`selectedModuleId`.

**Steps**

- [ ] In `client/src/pages/ParserEditorPage/index.tsx`, pull the new values from the hook (extend the destructure at lines 42-58):

```ts
  const {
    parser,
    steps,
    selectedStep,
    selectedStepName,
    code,
    modules,
    selectedModuleId,
    activeItemType,
    saveStatus,
    loading,
    error,
    selectStep,
    handleCodeChange,
    saveNow,
    addStep,
    removeStep,
    saveParserSettings,
    saveStepMeta,
    selectModule,
    addModule,
    removeModule,
  } = useParserEditor(parserId)
```

- [ ] Add local UI state for the inline filename input, next to the existing `addingStep` state (after line 72):

```ts
  const [addingModule, setAddingModule] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')
  const [moduleNameError, setModuleNameError] = useState<string | null>(null)
```

- [ ] Add a handler (place it near the other inline handlers in the component body, before the JSX `return`):

```ts
  async function confirmAddModule() {
    const name = newModuleName.trim()
    if (!name) return
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      setModuleNameError('Use a valid identifier: no slashes, no extension')
      return
    }
    await addModule(name)
    setAddingModule(false)
    setNewModuleName('')
    setModuleNameError(null)
  }
```

- [ ] In the left sidebar JSX, immediately after the closing tag of the step-list block (after the `steps.map(...)` render that ends around line 470, before the sidebar container closes), add the Files section. Match the existing Tailwind classes used by step rows for visual consistency:

```tsx
            {/* Files (helper modules) */}
            <div className="mt-6">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Files
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAddingModule(true)
                    setNewModuleName('')
                    setModuleNameError(null)
                  }}
                  className="text-gray-400 hover:text-emerald-500"
                  title="New file"
                >
                  +
                </button>
              </div>

              {addingModule && (
                <div className="px-2 mb-2">
                  <input
                    autoFocus
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void confirmAddModule()
                      if (e.key === 'Escape') {
                        setAddingModule(false)
                        setNewModuleName('')
                        setModuleNameError(null)
                      }
                    }}
                    placeholder="filename (e.g. validate)"
                    className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                  {moduleNameError && (
                    <p className="mt-1 text-xs text-red-500">{moduleNameError}</p>
                  )}
                </div>
              )}

              {modules.map((m) => {
                const active = activeItemType === 'module' && selectedModuleId === m.id
                return (
                  <div
                    key={m.id}
                    className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm ${
                      active
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => void selectModule(m.id)}
                  >
                    <span className="truncate">{m.path}.ts</span>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                      title="Delete file"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`Delete file "${m.path}.ts"?`)) void removeModule(m.id)
                      }}
                    >
                      🗑
                    </button>
                  </div>
                )
              })}
            </div>
```

- [ ] Verify the client builds:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build
```

Expected: build succeeds.

- [ ] Manual smoke check (optional but recommended): start the app, open a parser in the editor, create a file `validate`, type `export const validate = () => true`, switch to a step, write `import { validate } from './validate'` at the top, and confirm both save without errors:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run start
```

Expected: editor loads; Files section appears below steps; creating, opening, editing, and deleting a file all work; switching between a step and a file swaps the Monaco content.

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "feat(client): add Files sidebar section to parser editor

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Design log entry

**Files**
- Create: `design-log/010-parser-helper-files.md`
- Modify: `design-log/index.md`

CLAUDE.md mandates a design-log entry for new entities/services, persistence patterns, API contracts, worker behaviour, and runtime settings — this feature touches all of them.

**Steps**

- [ ] Read an existing recent entry to match the exact section format:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && ls design-log/ && tail -5 design-log/index.md
```

Expected: lists existing numbered entries and the current index table tail.

- [ ] Create `design-log/010-parser-helper-files.md` following the existing entry format (Background, Problem, Design, Questions and Answers, Trade-offs, Implementation Results). Summary of content to capture:
  - **Background:** Step code runs as an `AsyncFunction` body, not an ES module — static `import` is impossible natively. Developers want to share logic across steps.
  - **Problem:** No mechanism to split/share step logic; all code must live in one function body.
  - **Design:** New `parser_files` table (flat `path`, cascade delete); `ModulePersistenceService`; pure `transformImports` rewriting top-of-file single-line local imports to `await import()` of temp files written from DB at worker startup (`/tmp/scraper-modules/{parserName}/{path}.ts`); additive `WorkerData` fields (`helperFiles`, `parserName`) — message protocol unchanged; `ParserConfig.helperFiles`; `DbParserLoader` loads files; orchestrator forwards them; 5 `/:id/modules` API routes; shared-Monaco editor UI with `activeItemType` dispatch.
  - **Questions and Answers:** Why temp files instead of inlining? (tsx handles TS modules cleanly; keeps source maps/identity per module.) Why `parserName` not `parserId` for the temp dir? (Approved decision; names are validated filesystem-safe.) Why no protocol change? (Only the bootstrap `WorkerData` payload grew; `WorkerInMessage`/`WorkerOutMessage` are untouched, so main↔worker symmetry holds.)
  - **Trade-offs:** Single-line imports only; flat namespace (no folders); imports must start with `./`; temp files rewritten every worker startup (no cache). Org-shared files are out of scope but schema is forward-compatible.
  - **Implementation Results:** (fill in after implementation — note any deviations.)

- [ ] Append a row to `design-log/index.md` matching the existing table format:

```
| 010 | [Parser Helper Files](010-parser-helper-files.md) | Implemented | Per-parser DB-stored helper modules importable into steps via rewritten `await import()` |
```

- [ ] Commit:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && git add -A && git commit -m "docs(design-log): add 010 parser helper files

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full build + test suite green:

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build && npm run test
```

Expected: build exits 0; all tests pass, including `modulePersistence` and `transformImports`.
