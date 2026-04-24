# Parser Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-side parser editor where devs create parsers with named steps (each with its own entry URL), write JS step code in Monaco, and test each step via the existing debug runner — all backed by PostgreSQL.

**Architecture:** Parsers and steps are stored in PostgreSQL (Drizzle ORM). A new `DbParserLoader` builds `ParserConfig` objects from DB rows using `AsyncFunction` eval for the `run()` method. Workers receive step code directly in `workerData` when no file path exists, so `DebugStepRunner` works unchanged for both file-based and DB-based parsers. The client editor uses Monaco (`@monaco-editor/react`) with hash routing (`#/editor/:name`) and autosave via 1 s debounce.

**Tech Stack:** PostgreSQL 15+, drizzle-orm 0.30+, pg (node-postgres), @monaco-editor/react, Vitest (existing)

**Split point:** Tasks 1–6 are pure backend and independently testable via curl/Vitest. Tasks 7–9 are the React frontend.

---

## File Map

**Create (backend)**
- `src/infrastructure/loader/IParserLoader.ts` — shared interface for DI
- `src/infrastructure/db/schema.ts` — Drizzle table definitions
- `src/infrastructure/db/client.ts` — pg pool + drizzle instance
- `src/infrastructure/db/migrations/0001_init.sql` — DDL
- `src/infrastructure/db/migrate.ts` — migration runner script
- `src/infrastructure/loader/DbParserLoader.ts` — load from DB via AsyncFunction
- `src/scripts/seedParsers.ts` — one-time file→DB migration
- `tests/infrastructure/DbParserLoader.test.ts`

**Modify (backend)**
- `src/infrastructure/loader/FileParserLoader.ts` — add `implements IParserLoader`
- `src/domain/entities/Traverser.ts` — add `code?: string`
- `src/domain/entities/Extractor.ts` — add `code?: string`
- `src/infrastructure/worker/messages.ts` — add `WorkerData` union type
- `src/infrastructure/worker/TraverserWorker.ts` — handle `stepCode` branch
- `src/infrastructure/worker/ExtractorWorker.ts` — handle `stepCode` branch
- `src/application/use-cases/DebugStepRunner.ts` — accept `IParserLoader`, detect file vs code mode
- `src/api/server.ts` — switch to `DbParserLoader`, add 8 CRUD endpoints
- `package.json` — add drizzle-orm, pg, @types/pg, db:migrate script

**Create (frontend)**
- `client/src/components/ParserEditorPage.tsx` — two-panel editor layout
- `client/src/hooks/useParserEditor.ts` — step CRUD + autosave state

**Modify (frontend)**
- `client/src/api.ts` — add CRUD functions
- `client/src/App.tsx` — `#/editor/:name` routing, Edit/New buttons
- `client/src/components/ParserCard.tsx` — add Edit button
- `client/package.json` — add @monaco-editor/react

---

## Task 1: Install packages + IParserLoader interface

**Files:**
- Create: `src/infrastructure/loader/IParserLoader.ts`
- Modify: `src/infrastructure/loader/FileParserLoader.ts`
- Modify: `src/application/use-cases/DebugStepRunner.ts` (constructor only)
- Modify: `package.json`
- Modify: `client/package.json`

- [ ] **Step 1: Create `IParserLoader.ts`**

```typescript
// src/infrastructure/loader/IParserLoader.ts
import type { ParserConfig } from '../../domain/entities/Parser.js'

export interface IParserLoader {
  load(parserName: string): Promise<ParserConfig>
}
```

- [ ] **Step 2: Update `FileParserLoader` to implement the interface**

Change line 8 from:
```typescript
export class FileParserLoader {
```
to:
```typescript
import type { IParserLoader } from './IParserLoader.js'

export class FileParserLoader implements IParserLoader {
```

- [ ] **Step 3: Update `DebugStepRunner` constructor to accept `IParserLoader`**

Change the import and constructor in `src/application/use-cases/DebugStepRunner.ts`:

```typescript
// replace:
import { FileParserLoader } from '../../infrastructure/loader/FileParserLoader.js'
// with:
import type { IParserLoader } from '../../infrastructure/loader/IParserLoader.js'
```

```typescript
// replace:
constructor(private readonly loader: FileParserLoader) {
// with:
constructor(private readonly loader: IParserLoader) {
```

- [ ] **Step 4: Install backend packages**

```bash
npm install drizzle-orm pg
npm install --save-dev @types/pg
```

- [ ] **Step 5: Install client package**

```bash
cd client && npm install @monaco-editor/react
```

- [ ] **Step 6: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: 14 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/loader/IParserLoader.ts src/infrastructure/loader/FileParserLoader.ts src/application/use-cases/DebugStepRunner.ts package.json package-lock.json client/package.json client/package-lock.json
git commit -m "feat(loader): extract IParserLoader interface, install drizzle-orm + monaco"
```

---

## Task 2: DB schema, client, migration

**Files:**
- Create: `src/infrastructure/db/schema.ts`
- Create: `src/infrastructure/db/client.ts`
- Create: `src/infrastructure/db/migrations/0001_init.sql`
- Create: `src/infrastructure/db/migrate.ts`
- Modify: `package.json` (add `db:migrate` script)

- [ ] **Step 1: Create `schema.ts`**

```typescript
// src/infrastructure/db/schema.ts
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const parsers = pgTable('parsers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  entryUrl: text('entry_url').notNull().default(''),
  entryStep: text('entry_step').notNull().default(''),
  browserType: text('browser_type').notNull().default('playwright'),
  browserSettings: jsonb('browser_settings').notNull().default({}),
  retryConfig: jsonb('retry_config').notNull().default({ maxRetries: 5 }),
  deduplication: boolean('deduplication').notNull().default(true),
  concurrentQuota: integer('concurrent_quota'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const steps = pgTable('steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  parserId: uuid('parser_id').notNull().references(() => parsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'traverser' | 'extractor'
  entryUrl: text('entry_url').notNull().default(''),
  outputFile: text('output_file'),
  code: text('code').notNull().default(''),
  stepSettings: jsonb('step_settings').notNull().default({}),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const parsersRelations = relations(parsers, ({ many }) => ({
  steps: many(steps),
}))

export const stepsRelations = relations(steps, ({ one }) => ({
  parser: one(parsers, { fields: [steps.parserId], references: [parsers.id] }),
}))
```

- [ ] **Step 2: Create `client.ts`**

```typescript
// src/infrastructure/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/scraper',
})

export const db = drizzle(pool, { schema })
export { pool }
```

- [ ] **Step 3: Create migration SQL**

```bash
mkdir -p src/infrastructure/db/migrations
```

```sql
-- src/infrastructure/db/migrations/0001_init.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS parsers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  entry_url TEXT NOT NULL DEFAULT '',
  entry_step TEXT NOT NULL DEFAULT '',
  browser_type TEXT NOT NULL DEFAULT 'playwright',
  browser_settings JSONB NOT NULL DEFAULT '{}',
  retry_config JSONB NOT NULL DEFAULT '{"maxRetries":5}',
  deduplication BOOLEAN NOT NULL DEFAULT true,
  concurrent_quota INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id UUID NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  entry_url TEXT NOT NULL DEFAULT '',
  output_file TEXT,
  code TEXT NOT NULL DEFAULT '',
  step_settings JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parser_id, name)
);
```

- [ ] **Step 4: Create `migrate.ts`**

```typescript
// src/infrastructure/db/migrate.ts
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const sql = await readFile(resolve(__dirname, 'migrations/0001_init.sql'), 'utf8')
  await pool.query(sql)
  console.log('Migration complete')
  await pool.end()
}

migrate().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 5: Add `db:migrate` script to `package.json`**

In the `"scripts"` section of `package.json`, add:
```json
"db:migrate": "tsx src/infrastructure/db/migrate.ts"
```

- [ ] **Step 6: Start PostgreSQL and run migration**

Ensure PostgreSQL is running locally, then:
```bash
createdb scraper 2>/dev/null || true
npm run db:migrate
```

Expected output:
```
Migration complete
```

- [ ] **Step 7: Verify tables exist**

```bash
psql scraper -c "\dt"
```

Expected:
```
 Schema |  Name   | Type  |  Owner
--------+---------+-------+---------
 public | parsers | table | ...
 public | steps   | table | ...
```

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/db/ package.json
git commit -m "feat(db): add PostgreSQL schema and migration for parsers + steps"
```

---

## Task 3: DbParserLoader

**Files:**
- Modify: `src/domain/entities/Traverser.ts`
- Modify: `src/domain/entities/Extractor.ts`
- Create: `src/infrastructure/loader/DbParserLoader.ts`
- Create: `tests/infrastructure/DbParserLoader.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/infrastructure/DbParserLoader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/infrastructure/db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}))

import { DbParserLoader } from '../../src/infrastructure/loader/DbParserLoader.js'
import { db } from '../../src/infrastructure/db/client.js'

const mockSelect = db.select as ReturnType<typeof vi.fn>

function makeSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(result),
  }
  mockSelect.mockReturnValue(chain)
  return chain
}

describe('DbParserLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when parser not found', async () => {
    makeSelectChain([])
    const loader = new DbParserLoader()
    await expect(loader.load('missing')).rejects.toThrow('Parser "missing" not found')
  })

  it('builds ParserConfig with traverser step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{
          id: 'abc',
          name: 'test',
          entryUrl: 'https://example.com',
          entryStep: 'crawl',
          browserType: 'playwright',
          browserSettings: {},
          retryConfig: { maxRetries: 3 },
          deduplication: true,
          concurrentQuota: null,
        }]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{
          id: 'step1',
          parserId: 'abc',
          name: 'crawl',
          type: 'traverser',
          outputFile: null,
          code: 'return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]',
          stepSettings: {},
          position: 0,
        }]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')

    expect(config.name).toBe('test')
    expect(config.entryUrl).toBe('https://example.com')
    expect(config.steps.size).toBe(1)
    const step = config.steps.get('crawl' as any)!
    expect(step.type).toBe('traverser')
    expect(step.code).toBe('return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]')
    const result = await step.run({} as any, { url: 'https://a.com' } as any)
    expect(result).toEqual([{ link: 'https://a.com', page_type: 'detail', parent_data: {} }])
  })

  it('builds ParserConfig with extractor step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{
          id: 'abc', name: 'test', entryUrl: '', entryStep: 'extract',
          browserType: 'playwright', browserSettings: {}, retryConfig: { maxRetries: 5 },
          deduplication: true, concurrentQuota: null,
        }]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{
          id: 'step2', parserId: 'abc', name: 'extract', type: 'extractor',
          outputFile: 'data.csv', code: 'return [{ title: "test" }]',
          stepSettings: {}, position: 0,
        }]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')
    const step = config.steps.get('extract' as any)! as any
    expect(step.type).toBe('extractor')
    expect(step.outputFile).toBe('data.csv')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/infrastructure/DbParserLoader.test.ts
```

Expected: FAIL — `DbParserLoader` not found.

- [ ] **Step 3: Add `code?` to Traverser entity**

In `src/domain/entities/Traverser.ts`, add `code?: string` before `constructor`:

```typescript
export class Traverser<P = import('playwright').Page> extends Step<P> {
  readonly type = 'traverser' as const
  code?: string

  constructor(
    name: StepName,
    readonly run: (page: P, task: PageTask) => Promise<TraverserResult[]>,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
```

- [ ] **Step 4: Add `code?` to Extractor entity**

In `src/domain/entities/Extractor.ts`, add `code?: string` before `constructor`:

```typescript
export class Extractor<P = import('playwright').Page> extends Step<P> {
  readonly type = 'extractor' as const
  code?: string

  constructor(
    name: StepName,
    readonly run: (page: P, task: PageTask) => Promise<Record<string, unknown>[]>,
    readonly outputFile: string,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
```

- [ ] **Step 5: Create `DbParserLoader.ts`**

```typescript
// src/infrastructure/loader/DbParserLoader.ts
import type { IParserLoader } from './IParserLoader.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { Traverser } from '../../domain/entities/Traverser.js'
import { Extractor } from '../../domain/entities/Extractor.js'
import { stepName } from '../../domain/value-objects/StepName.js'
import { DEFAULT_RETRY_CONFIG } from '../../domain/value-objects/RetryConfig.js'
import { db } from '../db/client.js'
import { parsers, steps as stepsTable } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>

export class DbParserLoader implements IParserLoader {
  async load(parserName: string): Promise<ParserConfig> {
    const [row] = await db.select().from(parsers).where(eq(parsers.name, parserName))
    if (!row) throw new Error(`Parser "${parserName}" not found`)

    const stepRows = await db.select().from(stepsTable)
      .where(eq(stepsTable.parserId, row.id))
      .orderBy(stepsTable.position)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepMap = new Map<any, any>()
    for (const s of stepRows) {
      const sn = stepName(s.name)
      const settings = Object.keys(s.stepSettings as object).length ? (s.stepSettings as StepSettings) : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const run = new AsyncFunction('page', 'task', s.code) as any
      if (s.type === 'traverser') {
        const t = new Traverser(sn, run, settings)
        t.code = s.code
        stepMap.set(sn, t)
      } else {
        const e = new Extractor(sn, run, s.outputFile ?? `${s.name}.csv`, settings)
        e.code = s.code
        stepMap.set(sn, e)
      }
    }

    return {
      name: row.name,
      entryUrl: row.entryUrl,
      entryStep: stepName(row.entryStep || stepRows[0]?.name || ''),
      steps: stepMap,
      retryConfig: { ...DEFAULT_RETRY_CONFIG, ...(row.retryConfig as object) },
      deduplication: row.deduplication,
      concurrentQuota: row.concurrentQuota ?? undefined,
      browserSettings: Object.keys(row.browserSettings as object).length
        ? (row.browserSettings as ParserConfig['browserSettings'])
        : undefined,
    }
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npm test tests/infrastructure/DbParserLoader.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 7: Run full suite**

```bash
npm test
```

Expected: 17 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/domain/entities/Traverser.ts src/domain/entities/Extractor.ts src/infrastructure/loader/DbParserLoader.ts tests/infrastructure/DbParserLoader.test.ts
git commit -m "feat(loader): add DbParserLoader with AsyncFunction eval, add code field to Step entities"
```

---

## Task 4: Update workers + DebugStepRunner for stepCode

**Files:**
- Modify: `src/infrastructure/worker/messages.ts`
- Modify: `src/infrastructure/worker/TraverserWorker.ts`
- Modify: `src/infrastructure/worker/ExtractorWorker.ts`
- Modify: `src/application/use-cases/DebugStepRunner.ts`

- [ ] **Step 1: Add `WorkerData` type to `messages.ts`**

```typescript
// src/infrastructure/worker/messages.ts
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

export type BrowserSettings = Pick<StepSettings, 'browser_type' | 'launchOptions' | 'contextOptions' | 'initScripts' | 'userAgent' | 'proxySettings'>

export type WorkerData =
  | { parserFilePath: string; stepName: string; browserSettings?: BrowserSettings }
  | { stepCode: string; stepType: 'traverser' | 'extractor'; outputFile?: string; stepSettings?: StepSettings; stepName: string; browserSettings?: BrowserSettings }

// Messages sent from Main → Worker
export type WorkerInMessage =
  | { type: 'PROCESS_PAGE'; task: PageTask }
  | { type: 'STOP' }

// Messages sent from Worker → Main
export type WorkerOutMessage =
  | { type: 'LINKS_DISCOVERED'; taskId: string; items: TraverserResult[] }
  | { type: 'DATA_EXTRACTED'; taskId: string; rows: Record<string, unknown>[]; outputFile: string }
  | { type: 'PAGE_SUCCESS'; taskId: string }
  | { type: 'PAGE_FAILED'; taskId: string; error: string }
  | { type: 'LOG'; level: 'log' | 'error'; stepName: string; args: string[] }
```

- [ ] **Step 2: Update `TraverserWorker.ts` to handle `stepCode`**

Replace the entire file:

```typescript
// src/infrastructure/worker/TraverserWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage, WorkerData } from './messages.js'
import { pipeConsole } from './pipeConsole.js'
import { buildContextOptions } from './buildContextOptions.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Traverser } from '../../domain/entities/Traverser.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { stepName } from '../../domain/value-objects/StepName.js'

const data = workerData as WorkerData
pipeConsole(data.stepName)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: BrowserAdapter<any> = createBrowserAdapter()
let running = true
let concurrency = 3
let activeCount = 0
const queue: PageTask[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPage(task: PageTask, step: Traverser<any>): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const items = await step.run(page, task)
    parentPort!.postMessage({ type: 'LINKS_DISCOVERED', taskId: task.id, items } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    console.error(`[FAIL] ${task.url}\n`, err)
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drainQueue(step: Traverser<any>): void {
  while (queue.length > 0 && activeCount < concurrency) {
    const task = queue.shift()!
    activeCount++
    processPage(task, step).finally(() => {
      activeCount--
      drainQueue(step)
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueue(task: PageTask, step: Traverser<any>): void {
  queue.push(task)
  drainQueue(step)
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let step: Traverser<any>
  let stepSettings: StepSettings | undefined

  if ('parserFilePath' in data) {
    const mod = (await import(data.parserFilePath)) as { default: ParserConfig }
    const config = mod.default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step = config.steps.get(data.stepName as StepName) as Traverser<any>
    if (!step) throw new Error(`Step "${data.stepName}" not found in parser "${config.name}"`)
    stepSettings = step.settings
  } else {
    const run = new AsyncFunction('page', 'task', data.stepCode)
    const { Traverser: T } = await import('../../domain/entities/Traverser.js')
    step = new T(stepName(data.stepName), run, data.stepSettings)
    stepSettings = data.stepSettings
  }

  const mergedSettings: StepSettings = {
    ...data.browserSettings,
    ...stepSettings,
    contextOptions: buildContextOptions(data.browserSettings, stepSettings),
    initScripts: [...(data.browserSettings?.initScripts ?? []), ...(stepSettings?.initScripts ?? [])],
  }
  concurrency = mergedSettings.concurrency ?? 3
  adapter = createBrowserAdapter(mergedSettings.browser_type, mergedSettings)
  await adapter.launch()
  if (mergedSettings.initScripts?.length) {
    const pa = adapter as import('../browser/PlaywrightAdapter.js').PlaywrightAdapter
    for (const script of mergedSettings.initScripts) {
      await pa.addInitScript(script)
    }
  }

  parentPort!.on('message', (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      adapter.close().catch(console.error)
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      enqueue(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 3: Update `ExtractorWorker.ts` to handle `stepCode`**

Replace the entire file:

```typescript
// src/infrastructure/worker/ExtractorWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage, WorkerData } from './messages.js'
import { pipeConsole } from './pipeConsole.js'
import { buildContextOptions } from './buildContextOptions.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { BrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Extractor } from '../../domain/entities/Extractor.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { stepName } from '../../domain/value-objects/StepName.js'

const data = workerData as WorkerData
pipeConsole(data.stepName)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: BrowserAdapter<any> = createBrowserAdapter()
let running = true
let concurrency = 3
let activeCount = 0
const queue: PageTask[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processPage(task: PageTask, step: Extractor<any>): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const rows = await step.run(page, task)
    parentPort!.postMessage({ type: 'DATA_EXTRACTED', taskId: task.id, rows, outputFile: step.outputFile } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    console.error(`[FAIL] ${task.url}\n`, err)
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drainQueue(step: Extractor<any>): void {
  while (queue.length > 0 && activeCount < concurrency) {
    const task = queue.shift()!
    activeCount++
    processPage(task, step).finally(() => {
      activeCount--
      drainQueue(step)
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueue(task: PageTask, step: Extractor<any>): void {
  queue.push(task)
  drainQueue(step)
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let step: Extractor<any>
  let stepSettings: StepSettings | undefined

  if ('parserFilePath' in data) {
    const mod = (await import(data.parserFilePath)) as { default: ParserConfig }
    const config = mod.default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step = config.steps.get(data.stepName as StepName) as Extractor<any>
    if (!step) throw new Error(`Step "${data.stepName}" not found in parser "${config.name}"`)
    stepSettings = step.settings
  } else {
    const run = new AsyncFunction('page', 'task', data.stepCode)
    const { Extractor: E } = await import('../../domain/entities/Extractor.js')
    const outFile = data.outputFile ?? `${data.stepName}.csv`
    step = new E(stepName(data.stepName), run, outFile, data.stepSettings)
    stepSettings = data.stepSettings
  }

  const mergedSettings: StepSettings = {
    ...data.browserSettings,
    ...stepSettings,
    contextOptions: buildContextOptions(data.browserSettings, stepSettings),
    initScripts: [...(data.browserSettings?.initScripts ?? []), ...(stepSettings?.initScripts ?? [])],
  }
  concurrency = mergedSettings.concurrency ?? 3
  adapter = createBrowserAdapter(mergedSettings.browser_type, mergedSettings)
  await adapter.launch()
  if (mergedSettings.initScripts?.length) {
    const pa = adapter as import('../browser/PlaywrightAdapter.js').PlaywrightAdapter
    for (const script of mergedSettings.initScripts) {
      await pa.addInitScript(script)
    }
  }

  parentPort!.on('message', (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      adapter.close().catch(console.error)
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      enqueue(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 4: Update `DebugStepRunner` to handle DB-mode (no filePath)**

In `src/application/use-cases/DebugStepRunner.ts`, update the `run()` method. Replace the `workerData` construction block (lines 50–52):

```typescript
// replace:
const workerData = isTsx
  ? { parserFilePath: config.filePath, stepName, __workerPath: tsFile, browserSettings: config.browserSettings }
  : { parserFilePath: config.filePath, stepName, browserSettings: config.browserSettings }

// with:
if (!config.filePath && !step.code) {
  throw new Error(`Step "${stepName}" has no filePath or code — cannot spawn worker`)
}

const workerData = config.filePath
  ? (isTsx
      ? { parserFilePath: config.filePath, stepName, __workerPath: tsFile, browserSettings: config.browserSettings }
      : { parserFilePath: config.filePath, stepName, browserSettings: config.browserSettings })
  : {
      stepCode: step.code!,
      stepType: step.type,
      outputFile: step.type === 'extractor' ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile : undefined,
      stepSettings: step.settings,
      stepName,
      browserSettings: config.browserSettings,
    }
```

Also update the `entryFile` selection — when using `stepCode` mode, there is no `__workerPath`, so the bootstrap still works (it uses `workerData.__workerPath` which will be absent; bootstrap must fall back gracefully). Check `worker-bootstrap.js`:

If `worker-bootstrap.js` reads `workerData.__workerPath`, it will be `undefined` in stepCode mode and crash. Open `src/infrastructure/worker/worker-bootstrap.js` and confirm it handles missing `__workerPath`. If not, fix: only add `__workerPath` to workerData when in tsx+filePath mode (already the case in the code above since the stepCode branch has no `__workerPath`).

The `entryFile` logic stays unchanged:
```typescript
const entryFile = isTsx ? bootstrapFile : jsFile
```

In dev (tsx) mode with stepCode, `bootstrapFile` is passed and `workerData.__workerPath` is `tsFile` — but `tsFile` is only defined in the `config.filePath` branch above. Fix by moving `tsFile`/`jsFile` computation before the workerData block and always computing them:

```typescript
const tsFile = step.type === 'traverser'
  ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
  : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
const jsFile = step.type === 'traverser'
  ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
  : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')
```

These lines already exist in the current file — they don't need to move. The `__workerPath` is only added in the `parserFilePath` branch, so bootstrap in stepCode mode will not find `__workerPath` in `workerData`.

Open `src/infrastructure/worker/worker-bootstrap.js` to check. If it uses `workerData.__workerPath` directly, add a fallback:

```javascript
// worker-bootstrap.js — if workerData.__workerPath is missing, bootstrap cannot load via tsx.
// In stepCode mode we still want tsx to register. The workerPath must be determined from stepName/stepType.
```

Actually, for tsx + stepCode mode, we need `__workerPath`. Update the stepCode workerData branch:

```typescript
: (isTsx
    ? {
        stepCode: step.code!,
        stepType: step.type,
        outputFile: step.type === 'extractor' ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile : undefined,
        stepSettings: step.settings,
        stepName,
        __workerPath: tsFile,
        browserSettings: config.browserSettings,
      }
    : {
        stepCode: step.code!,
        stepType: step.type,
        outputFile: step.type === 'extractor' ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile : undefined,
        stepSettings: step.settings,
        stepName,
        browserSettings: config.browserSettings,
      })
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: 17 tests pass (workers are not unit-tested, changes verified at runtime).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/worker/messages.ts src/infrastructure/worker/TraverserWorker.ts src/infrastructure/worker/ExtractorWorker.ts src/application/use-cases/DebugStepRunner.ts
git commit -m "feat(worker): handle stepCode in workerData for DB-backed parsers"
```

---

## Task 5: CRUD API endpoints

**Files:**
- Modify: `src/api/server.ts`

Switch the server to use `DbParserLoader` and add 8 new CRUD endpoints.

- [ ] **Step 1: Update imports at top of `server.ts`**

Replace:
```typescript
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
```

With:
```typescript
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { db } from '../infrastructure/db/client.js'
import { parsers as parsersTable, steps as stepsTable } from '../infrastructure/db/schema.js'
import { eq, and, sql } from 'drizzle-orm'
```

- [ ] **Step 2: Replace `loader` instantiation**

Replace:
```typescript
const loader = new FileParserLoader(parsersDir)
```

With:
```typescript
const loader = new DbParserLoader()
```

- [ ] **Step 3: Replace `GET /api/parsers` to read from DB**

Replace the existing handler:
```typescript
app.get('/api/parsers', async (_req, res) => {
  try {
    const rows = await db.select({ name: parsersTable.name }).from(parsersTable)
    res.json({ parsers: rows.map((r) => r.name) })
  } catch {
    res.json({ parsers: [] })
  }
})
```

- [ ] **Step 4: Add `POST /api/parsers` — create parser**

Add after the GET handler:

```typescript
app.post('/api/parsers', async (req, res) => {
  const { name, entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body as {
    name: string
    entryUrl?: string
    entryStep?: string
    browserType?: string
    browserSettings?: object
    retryConfig?: { maxRetries: number }
    deduplication?: boolean
    concurrentQuota?: number
  }
  if (!name) { res.status(400).json({ error: 'name is required' }); return }
  if (!/^[a-z0-9_-]+$/i.test(name)) { res.status(400).json({ error: 'name must be alphanumeric with hyphens/underscores' }); return }
  try {
    const [row] = await db.insert(parsersTable).values({
      name,
      entryUrl: entryUrl ?? '',
      entryStep: entryStep ?? '',
      browserType: browserType ?? 'playwright',
      browserSettings: browserSettings ?? {},
      retryConfig: retryConfig ?? { maxRetries: 5 },
      deduplication: deduplication ?? true,
      concurrentQuota: concurrentQuota ?? null,
    }).returning()
    res.status(201).json({ parser: row })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Parser "${name}" already exists` }); return }
    res.status(500).json({ error: msg })
  }
})
```

- [ ] **Step 5: Add `GET /api/parsers/:name` — get parser with step metadata**

```typescript
app.get('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select().from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const stepRows = await db.select().from(stepsTable)
    .where(eq(stepsTable.parserId, parserRow.id))
    .orderBy(stepsTable.position)
  res.json({ parser: parserRow, steps: stepRows })
})
```

- [ ] **Step 6: Add `PUT /api/parsers/:name` — update parser metadata**

```typescript
app.put('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const [row] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!row) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body
  const [updated] = await db.update(parsersTable).set({
    ...(entryUrl !== undefined && { entryUrl }),
    ...(entryStep !== undefined && { entryStep }),
    ...(browserType !== undefined && { browserType }),
    ...(browserSettings !== undefined && { browserSettings }),
    ...(retryConfig !== undefined && { retryConfig }),
    ...(deduplication !== undefined && { deduplication }),
    ...(concurrentQuota !== undefined && { concurrentQuota }),
    updatedAt: new Date(),
  }).where(eq(parsersTable.name, name)).returning()
  res.json({ parser: updated })
})
```

- [ ] **Step 7: Add `DELETE /api/parsers/:name`**

```typescript
app.delete('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const deleted = await db.delete(parsersTable).where(eq(parsersTable.name, name)).returning({ id: parsersTable.id })
  if (!deleted.length) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  res.json({ ok: true })
})
```

- [ ] **Step 8: Add `POST /api/parsers/:name/steps` — create step**

```typescript
app.post('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const { name: stepName, type, entryUrl, outputFile, code, position } = req.body as {
    name: string; type: 'traverser' | 'extractor'; entryUrl?: string; outputFile?: string; code?: string; position?: number
  }
  if (!stepName) { res.status(400).json({ error: 'name is required' }); return }
  if (type !== 'traverser' && type !== 'extractor') { res.status(400).json({ error: 'type must be traverser or extractor' }); return }
  try {
    const [row] = await db.insert(stepsTable).values({
      parserId: parserRow.id,
      name: stepName,
      type,
      entryUrl: entryUrl ?? '',
      outputFile: outputFile ?? (type === 'extractor' ? `${stepName}.csv` : null),
      code: code ?? '',
      position: position ?? 0,
    }).returning()
    res.status(201).json({ step: row })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Step "${stepName}" already exists` }); return }
    res.status(500).json({ error: msg })
  }
})
```

- [ ] **Step 9: Add `GET /api/parsers/:name/steps/:step` — get step with code**

```typescript
app.get('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const [stepRow] = await db.select().from(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step)))
  if (!stepRow) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  res.json({ step: stepRow })
})
```

- [ ] **Step 10: Add `PUT /api/parsers/:name/steps/:step` — update step (autosave target)**

```typescript
app.put('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const [stepRow] = await db.select({ id: stepsTable.id }).from(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step)))
  if (!stepRow) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  const { name: newName, type, entryUrl, outputFile, code, stepSettings, position } = req.body
  try {
    const [updated] = await db.update(stepsTable).set({
      ...(newName !== undefined && { name: newName }),
      ...(type !== undefined && { type }),
      ...(entryUrl !== undefined && { entryUrl }),
      ...(outputFile !== undefined && { outputFile }),
      ...(code !== undefined && { code }),
      ...(stepSettings !== undefined && { stepSettings }),
      ...(position !== undefined && { position }),
      updatedAt: new Date(),
    }).where(eq(stepsTable.id, stepRow.id)).returning()
    res.json({ step: updated })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Step name already exists` }); return }
    res.status(500).json({ error: msg })
  }
})
```

- [ ] **Step 11: Add `DELETE /api/parsers/:name/steps/:step`**

```typescript
app.delete('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const deleted = await db.delete(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step))).returning({ id: stepsTable.id })
  if (!deleted.length) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  res.json({ ok: true })
})
```

- [ ] **Step 12: Update `GET /api/parsers/:name/steps` to read from DB**

Replace the existing handler (which used `loader.load()`):

```typescript
app.get('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const stepRows = await db.select({
    name: stepsTable.name,
    type: stepsTable.type,
    position: stepsTable.position,
  }).from(stepsTable).where(eq(stepsTable.parserId, parserRow.id)).orderBy(stepsTable.position)
  res.json({ steps: stepRows })
})
```

- [ ] **Step 13: Start server and verify endpoints with curl**

```bash
npm run api &
sleep 2

# Create a parser
curl -s -X POST http://localhost:3001/api/parsers \
  -H "Content-Type: application/json" \
  -d '{"name":"test-api","entryUrl":"https://example.com","entryStep":"crawl"}' | jq .

# Create a step
curl -s -X POST http://localhost:3001/api/parsers/test-api/steps \
  -H "Content-Type: application/json" \
  -d '{"name":"crawl","type":"traverser","code":"return []"}' | jq .

# List parsers
curl -s http://localhost:3001/api/parsers | jq .

# Get step with code
curl -s http://localhost:3001/api/parsers/test-api/steps/crawl | jq .

# Delete
curl -s -X DELETE http://localhost:3001/api/parsers/test-api | jq .
```

Expected: each returns `{ ok: true }` or the created/fetched object.

- [ ] **Step 14: Run tests**

```bash
npm test
```

Expected: 17 tests pass.

- [ ] **Step 15: Commit**

```bash
git add src/api/server.ts
git commit -m "feat(api): add parser/step CRUD endpoints, switch to DbParserLoader"
```

---

## Task 6: File-to-DB seeder

**Files:**
- Create: `src/scripts/seedParsers.ts`
- Modify: `package.json` (add `db:seed` script)

Seeds existing file parsers into the DB. Copies metadata; step `code` is left empty (devs re-enter JS code in editor).

- [ ] **Step 1: Create seeder**

```typescript
// src/scripts/seedParsers.ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
import { db, pool } from '../infrastructure/db/client.js'
import { parsers as parsersTable, steps as stepsTable } from '../infrastructure/db/schema.js'
import { eq } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const parsersDir = resolve(__dirname, '../../src/parsers')

const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`

async function seed() {
  const loader = new FileParserLoader(parsersDir)
  const entries = await readdir(parsersDir, { withFileTypes: true })
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  for (const name of names) {
    let config
    try {
      config = await loader.load(name)
    } catch (err) {
      console.warn(`Skipping "${name}":`, (err as Error).message)
      continue
    }

    const existing = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
    if (existing.length) {
      console.log(`  skip (exists): ${name}`)
      continue
    }

    const [parserRow] = await db.insert(parsersTable).values({
      name: config.name,
      entryUrl: config.entryUrl,
      entryStep: String(config.entryStep),
      browserType: config.browserSettings?.browser_type ?? 'playwright',
      browserSettings: config.browserSettings ?? {},
      retryConfig: config.retryConfig,
      deduplication: config.deduplication,
      concurrentQuota: config.concurrentQuota ?? null,
    }).returning()

    let pos = 0
    for (const [stepName, step] of config.steps) {
      await db.insert(stepsTable).values({
        parserId: parserRow.id,
        name: String(stepName),
        type: step.type,
        outputFile: step.type === 'extractor' ? (step as any).outputFile : null,
        code: step.type === 'traverser' ? TRAVERSER_TEMPLATE : EXTRACTOR_TEMPLATE,
        position: pos++,
      })
    }
    console.log(`  seeded: ${name} (${config.steps.size} steps)`)
  }

  await pool.end()
  console.log('Seed complete')
}

seed().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add `db:seed` script to `package.json`**

```json
"db:seed": "tsx src/scripts/seedParsers.ts"
```

- [ ] **Step 3: Run seeder**

```bash
npm run db:seed
```

Expected output:
```
  seeded: bauer (N steps)
  seeded: example (3 steps)
  seeded: westelm (N steps)
Seed complete
```

- [ ] **Step 4: Verify via API**

```bash
curl -s http://localhost:3001/api/parsers | jq .parsers
```

Expected: `["bauer", "example", "westelm"]`

- [ ] **Step 5: Commit**

```bash
git add src/scripts/seedParsers.ts package.json
git commit -m "feat(scripts): add seedParsers to migrate file parsers into DB"
```

---

## Task 7: Client API functions + editor routing

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ParserCard.tsx`

- [ ] **Step 1: Add CRUD types and functions to `client/src/api.ts`**

Append to the end of the file:

```typescript
export interface ParserRow {
  id: string
  name: string
  entryUrl: string
  entryStep: string
  browserType: string
  browserSettings: Record<string, unknown>
  retryConfig: { maxRetries: number }
  deduplication: boolean
  concurrentQuota: number | null
  createdAt: string
  updatedAt: string
}

export interface StepRow {
  id: string
  parserId: string
  name: string
  type: 'traverser' | 'extractor'
  entryUrl: string
  outputFile: string | null
  code: string
  stepSettings: Record<string, unknown>
  position: number
  createdAt: string
  updatedAt: string
}

export interface CreateParserInput {
  name: string
  entryUrl?: string
  entryStep?: string
  browserType?: string
}

export interface UpdateParserInput {
  entryUrl?: string
  entryStep?: string
  browserType?: string
  browserSettings?: Record<string, unknown>
  retryConfig?: { maxRetries: number }
  deduplication?: boolean
  concurrentQuota?: number | null
}

export interface CreateStepInput {
  name: string
  type: 'traverser' | 'extractor'
  entryUrl?: string
  outputFile?: string
}

export interface UpdateStepInput {
  name?: string
  type?: 'traverser' | 'extractor'
  entryUrl?: string
  outputFile?: string
  code?: string
  position?: number
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function createParser(input: CreateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>('/api/parsers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function getParser(name: string): Promise<{ parser: ParserRow; steps: StepRow[] }> {
  return apiRequest(`/api/parsers/${encodeURIComponent(name)}`)
}

export async function updateParser(name: string, input: UpdateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>(`/api/parsers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function deleteParser(name: string): Promise<void> {
  await apiRequest(`/api/parsers/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function createStep(parserName: string, input: CreateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function getStep(parserName: string, stepName: string): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`)
  return data.step
}

export async function updateStep(parserName: string, stepName: string, input: UpdateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function deleteStep(parserName: string, stepName: string): Promise<void> {
  await apiRequest(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`, { method: 'DELETE' })
}
```

- [ ] **Step 2: Update routing in `App.tsx`**

Change the `Page` type and routing logic:

```typescript
// replace:
type Page = 'parsers' | 'debug'

function getPageFromHash(): Page {
  return window.location.hash === '#/debug' ? 'debug' : 'parsers'
}

// with:
type Page = 'parsers' | 'debug' | 'editor'

function getPageFromHash(): Page {
  const hash = window.location.hash
  if (hash === '#/debug') return 'debug'
  if (hash.startsWith('#/editor/')) return 'editor'
  return 'parsers'
}

function getEditorParserFromHash(): string {
  const hash = window.location.hash
  if (hash.startsWith('#/editor/')) return decodeURIComponent(hash.slice(9))
  return ''
}
```

Add state for editor parser name:
```typescript
// after: const [page, setPage] = useState<Page>(getPageFromHash)
const [editorParser, setEditorParser] = useState<string>(getEditorParserFromHash)
```

Update `navigate` function:
```typescript
function navigate(p: Page, parserName?: string) {
  if (p === 'editor' && parserName) {
    window.location.hash = `#/editor/${encodeURIComponent(parserName)}`
    setEditorParser(parserName)
  } else if (p === 'debug') {
    window.location.hash = '#/debug'
  } else {
    window.location.hash = '#/'
  }
  setPage(p)
}
```

Update `hashchange` handler:
```typescript
const handler = () => {
  setPage(getPageFromHash())
  setEditorParser(getEditorParserFromHash())
}
```

Add "Editor" nav tab after Debug:
```tsx
<button onClick={() => navigate('editor', editorParser || parsers[0])} className={tabClass('editor')}>
  Editor
</button>
```

Update `Page` type tab class:
```typescript
const tabClass = (p: Page) =>
```
(This already accepts `Page`, no change needed.)

Add import for `ParserEditorPage` and render in main:
```typescript
import { ParserEditorPage } from './components/ParserEditorPage'
```

In the `<main>` section, add the editor branch:
```tsx
) : page === 'editor' ? (
  <ParserEditorPage
    parserName={editorParser}
    onNavigateToParsers={() => navigate('parsers')}
    onParserSelect={(name) => navigate('editor', name)}
  />
) : page === 'debug' ? (
```

- [ ] **Step 3: Add "Edit" button to `ParserCard`**

Read `src/components/ParserCard.tsx`, then add an `onEdit` prop. The card's header row should include an Edit button. Add to component props:

```typescript
interface ParserCardProps {
  name: string
  onEdit: () => void
}
```

Add an Edit button in the card header area (top-right corner):
```tsx
<button
  onClick={onEdit}
  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
>
  Edit
</button>
```

Update `App.tsx` where `ParserCard` is used to pass `onEdit`:
```tsx
<ParserCard key={name} name={name} onEdit={() => navigate('editor', name)} />
```

Also add a "New Parser" button near the page header in the parsers grid section:
```tsx
<div className="flex items-center justify-between mb-4">
  <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">{parsers.length} parser{parsers.length !== 1 ? 's' : ''}</h2>
  <button
    onClick={() => navigate('editor', '')}
    className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
  >
    + New Parser
  </button>
</div>
```

- [ ] **Step 4: Pre-fill Debug page URL from step `entryUrl`**

The existing `DebugPage` (`client/src/components/DebugPage.tsx`) has a URL input. When a step is selected that has a non-empty `entryUrl`, it should be used as the initial URL value.

In `DebugPage.tsx`, the step dropdown's `onChange` handler currently only sets `selectedStep`. Add a `useEffect` (or extend the existing onChange) to also set the URL:

```typescript
// After the step dropdown onChange, add:
useEffect(() => {
  if (!selectedParser || !selectedStep) return
  getStep(selectedParser, selectedStep)
    .then((s) => { if (s.entryUrl) setUrl(s.entryUrl) })
    .catch(() => {})
}, [selectedParser, selectedStep])
```

Add `getStep` to the import from `'../api'`.

- [ ] **Step 5: Start dev server and verify routing**

```bash
npm start
```

Visit `http://localhost:5173`, click "Edit" on a parser card. URL should update to `#/editor/example`. Back button should return to parsers. "Editor" tab should be active.

Navigate to Debug page, select a step that has `entryUrl` set — URL input should auto-fill.

- [ ] **Step 6: Commit**

```bash
git add client/src/api.ts client/src/App.tsx client/src/components/ParserCard.tsx client/src/components/DebugPage.tsx
git commit -m "feat(client): add CRUD API functions, step entryUrl pre-fill in debug, editor routing"
```

---

## Task 8: ParserEditorPage

**Files:**
- Create: `client/src/components/ParserEditorPage.tsx`
- Create: `client/src/hooks/useParserEditor.ts`

- [ ] **Step 1: Create `useParserEditor.ts`**

```typescript
// client/src/hooks/useParserEditor.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getParser, updateParser, createStep, updateStep, deleteStep,
  type ParserRow, type StepRow,
} from '../api'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useParserEditor(parserName: string) {
  const [parser, setParser] = useState<ParserRow | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [selectedStepName, setSelectedStepName] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedStep = steps.find((s) => s.name === selectedStepName) ?? null

  useEffect(() => {
    if (!parserName) return
    setLoading(true)
    setError(null)
    getParser(parserName)
      .then(({ parser: p, steps: ss }) => {
        setParser(p)
        setSteps(ss)
        if (ss.length > 0) {
          setSelectedStepName(ss[0].name)
          setCode(ss[0].code)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [parserName])

  const selectStep = useCallback((name: string) => {
    const s = steps.find((st) => st.name === name)
    if (!s) return
    setSelectedStepName(name)
    setCode(s.code)
    setSaveStatus('idle')
  }, [steps])

  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    setSaveStatus('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      if (!parserName || !selectedStepName) return
      setSaveStatus('saving')
      try {
        const updated = await updateStep(parserName, selectedStepName, { code: newCode })
        setSteps((prev) => prev.map((s) => s.name === selectedStepName ? updated : s))
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 1000)
  }, [parserName, selectedStepName])

  const saveNow = useCallback(async () => {
    if (!parserName || !selectedStepName) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    try {
      const updated = await updateStep(parserName, selectedStepName, { code })
      setSteps((prev) => prev.map((s) => s.name === selectedStepName ? updated : s))
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [parserName, selectedStepName, code])

  const addStep = useCallback(async (name: string, type: 'traverser' | 'extractor') => {
    if (!parserName) return
    const created = await createStep(parserName, { name, type })
    setSteps((prev) => [...prev, created])
    setSelectedStepName(created.name)
    setCode(created.code)
    setSaveStatus('idle')
  }, [parserName])

  const removeStep = useCallback(async (name: string) => {
    if (!parserName) return
    await deleteStep(parserName, name)
    setSteps((prev) => {
      const next = prev.filter((s) => s.name !== name)
      if (selectedStepName === name) {
        setSelectedStepName(next[0]?.name ?? null)
        setCode(next[0]?.code ?? '')
      }
      return next
    })
  }, [parserName, selectedStepName])

  const saveParserSettings = useCallback(async (input: Partial<ParserRow>) => {
    if (!parserName) return
    const updated = await updateParser(parserName, input)
    setParser(updated)
  }, [parserName])

  return {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings,
  }
}
```

- [ ] **Step 2: Create `ParserEditorPage.tsx`**

```typescript
// client/src/components/ParserEditorPage.tsx
import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { useParserEditor } from '../hooks/useParserEditor'
import { createParser, type CreateParserInput } from '../api'
import { useTheme } from '../hooks/useTheme'

const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`

interface Props {
  parserName: string
  onNavigateToParsers: () => void
  onParserSelect: (name: string) => void
}

export function ParserEditorPage({ parserName, onNavigateToParsers, onParserSelect }: Props) {
  const { theme } = useTheme()
  const monacoTheme = theme === 'dark' ? 'vs-dark' : 'light'

  const {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings,
  } = useParserEditor(parserName)

  const [newParserName, setNewParserName] = useState('')
  const [newParserBrowser, setNewParserBrowser] = useState('playwright')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [addingStep, setAddingStep] = useState(false)
  const [newStepName, setNewStepName] = useState('')
  const [newStepType, setNewStepType] = useState<'traverser' | 'extractor'>('traverser')

  const saveStatusLabel = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : ''

  // New parser creation form
  if (!parserName) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-md">
        <h2 className="text-lg font-semibold mb-4">New Parser</h2>
        {createError && <p className="text-red-500 text-sm mb-3">{createError}</p>}
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              value={newParserName}
              onChange={(e) => setNewParserName(e.target.value)}
              placeholder="my-parser"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Lowercase, hyphens allowed</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Browser</label>
            <select
              value={newParserBrowser}
              onChange={(e) => setNewParserBrowser(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            >
              <option value="playwright">Playwright</option>
              <option value="playwright-stealth">Playwright Stealth</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onNavigateToParsers}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!newParserName || creating}
              onClick={async () => {
                setCreating(true)
                setCreateError(null)
                try {
                  const p = await createParser({ name: newParserName, browserType: newParserBrowser } as CreateParserInput)
                  onParserSelect(p.name)
                } catch (e) {
                  setCreateError((e as Error).message)
                } finally {
                  setCreating(false)
                }
              }}
              className="flex-1 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create Parser'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="px-8 py-8 text-gray-400">Loading...</div>
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <p className="text-red-500">{error}</p>
        <button onClick={onNavigateToParsers} className="mt-4 text-sm text-emerald-600 hover:underline">← Back to parsers</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Parser header bar */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 flex items-center gap-4 flex-wrap">
        <button onClick={onNavigateToParsers} className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">←</button>
        <span className="font-semibold text-sm">{parser?.name}</span>

        <div className="flex items-center gap-2 ml-2">
          <label className="text-xs text-gray-500">Entry URL</label>
          <input
            defaultValue={parser?.entryUrl ?? ''}
            onBlur={(e) => saveParserSettings({ entryUrl: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-48"
            placeholder="https://..."
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Entry Step</label>
          <select
            value={parser?.entryStep ?? ''}
            onChange={(e) => saveParserSettings({ entryStep: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            {steps.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Browser</label>
          <select
            value={parser?.browserType ?? 'playwright'}
            onChange={(e) => saveParserSettings({ browserType: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="playwright">Playwright</option>
            <option value="playwright-stealth">Playwright Stealth</option>
            <option value="puppeteer">Puppeteer</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">{saveStatusLabel}</span>
          <button
            onClick={saveNow}
            disabled={saveStatus === 'saving'}
            className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Step sidebar */}
        <div className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col overflow-y-auto">
          <div className="p-2 border-b border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setAddingStep(true)}
              className="w-full text-xs py-1.5 rounded border border-dashed border-gray-400 dark:border-gray-600 text-gray-500 hover:border-emerald-500 hover:text-emerald-600 transition-colors"
            >
              + Add Step
            </button>
          </div>

          {addingStep && (
            <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex flex-col gap-1.5">
              <input
                autoFocus
                value={newStepName}
                onChange={(e) => setNewStepName(e.target.value)}
                placeholder="step-name"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-transparent"
              />
              <select
                value={newStepType}
                onChange={(e) => setNewStepType(e.target.value as 'traverser' | 'extractor')}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="traverser">traverser</option>
                <option value="extractor">extractor</option>
              </select>
              <div className="flex gap-1">
                <button
                  onClick={() => { setAddingStep(false); setNewStepName('') }}
                  className="flex-1 text-xs py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500"
                >
                  Cancel
                </button>
                <button
                  disabled={!newStepName}
                  onClick={async () => {
                    const tmpl = newStepType === 'traverser' ? TRAVERSER_TEMPLATE : EXTRACTOR_TEMPLATE
                    await addStep(newStepName, newStepType)
                    // set template code
                    handleCodeChange(tmpl)
                    setAddingStep(false)
                    setNewStepName('')
                  }}
                  className="flex-1 text-xs py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {steps.map((s) => (
            <div
              key={s.name}
              onClick={() => selectStep(s.name)}
              className={[
                'group flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-100 dark:border-gray-800',
                selectedStepName === s.name
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
              ].join(' ')}
            >
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-gray-400 dark:text-gray-500">{s.type}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeStep(s.name) }}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity text-base leading-none"
                title="Delete step"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Editor panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedStep ? (
            <>
              {/* Step meta bar */}
              <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-1.5 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="font-medium text-gray-700 dark:text-gray-300">{selectedStep.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{selectedStep.type}</span>
                <div className="flex items-center gap-1.5">
                  <span>Entry URL:</span>
                  <input
                    key={selectedStep.name}
                    defaultValue={selectedStep.entryUrl}
                    onBlur={async (e) => {
                      await updateStep(parserName, selectedStep.name, { entryUrl: e.target.value })
                    }}
                    className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-56"
                    placeholder="https://..."
                  />
                </div>
                {selectedStep.type === 'extractor' && (
                  <div className="flex items-center gap-1.5">
                    <span>Output:</span>
                    <input
                      key={`out-${selectedStep.name}`}
                      defaultValue={selectedStep.outputFile ?? ''}
                      onBlur={async (e) => {
                        await updateStep(parserName, selectedStep.name, { outputFile: e.target.value })
                      }}
                      className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-32"
                      placeholder="output.csv"
                    />
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <Editor
                  height="100%"
                  language="javascript"
                  theme={monacoTheme}
                  value={code}
                  onChange={(v) => handleCodeChange(v ?? '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    tabSize: 2,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Select a step or add one
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run dev server and test the full flow**

```bash
npm start
```

1. Click "New Parser" → fill name + browser → Create Parser
2. Click "+ Add Step" → enter name "crawl", type "traverser" → Add → traverser template appears in Monaco
3. Edit code → wait 1s → "Saved" appears
4. Click "Save" button → immediate save
5. Click "Edit" on existing parser → steps load, first step selected with its code
6. Delete a step → it disappears from sidebar
7. Change Entry URL field → blur → setting saved

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ParserEditorPage.tsx client/src/hooks/useParserEditor.ts
git commit -m "feat(client): add ParserEditorPage with Monaco editor, step management, autosave"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Create parser with unique name | Task 5 (POST /api/parsers) + Task 8 (creation form) |
| Initial settings JSON pre-filled with defaults | Task 5 (DB defaults) + Task 8 (form shows current values) |
| Add steps with code | Task 5 (POST steps) + Task 8 (Add Step flow) |
| Browser type selection affecting syntax hints | Task 8 (browser selector in header bar) + Task 9 templates |
| Code editor for devs | Task 9 (Monaco) |
| Each step has its own entry URL | Task 2 (schema `entry_url`), Task 5 (API), Task 7 (pre-fill debug), Task 8 (editor UI) |
| JS code stored in DB + eval | Task 3 (DbParserLoader + AsyncFunction) |
| Autosave with debounce + manual Save | Task 8 (useParserEditor hook) |
| Debug step from editor | Existing DebugPage + DbParserLoader (Task 3) |
| File parsers deprecated → DB | Task 6 (seeder) |
| PostgreSQL for scale | Task 2 |

### Placeholder scan

No TBD or "implement later" present. All code blocks are complete.

### Type consistency

- `StepRow` used in both `useParserEditor` and `ParserEditorPage` — same import from `api.ts`
- `updateStep` called in `useParserEditor` and directly in `ParserEditorPage` (for outputFile) — both from `api.ts`
- `WorkerData` union type used in `messages.ts` and both workers — consistent
- `code?` added to both `Traverser` and `Extractor` — accessed via `step.code` in `DebugStepRunner`

---

Plan complete and saved to `docs/superpowers/plans/2026-04-23-parser-editor.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, spec + quality review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
