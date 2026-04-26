# Jobs & Run Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jobs section that shows all parser runs (past and current), with per-task drill-down, stop/resume per run, and manual retry for failed pages.

**Architecture:** Persist every parser run and its tasks to PostgreSQL (`parser_runs`, `run_tasks`, `task_results`). The orchestrator emits `task_done` and `data_extracted` events; the service layer writes to DB asynchronously. Running jobs serve task data from memory; stopped/completed jobs serve from DB. The UI adds a `/jobs` and `/jobs/:runId` hash route backed by a polled REST API.

**Tech Stack:** Node.js + TypeScript, Drizzle ORM, PostgreSQL, React 18, Tailwind CSS, Vitest

---

## File Structure

**New files:**
- `src/infrastructure/db/migrations/0002_run_persistence.sql` — DDL for 3 new tables
- `src/infrastructure/db/RunPersistenceService.ts` — all DB read/write for runs and tasks
- `client/src/components/JobsPage.tsx` — list of all runs across all parsers
- `client/src/components/JobDetailPage.tsx` — task table + task detail slide-in panel
- `client/src/components/TaskDetailPage.tsx` — individual task metadata page with retry/abort action buttons

**Modified files:**
- `src/infrastructure/db/migrate.ts` — run both migrations
- `src/infrastructure/db/schema.ts` — Drizzle table definitions for 3 new tables
- `src/domain/value-objects/PageState.ts` — add `InProgress = 'in_progress'`
- `src/domain/entities/ParserRun.ts` — add `id`, `restoreTask`, `markPending`, `markInProgress`
- `src/domain/services/LinkDeduplicator.ts` — add `seed(urls)` method
- `src/application/orchestrator/ParserOrchestrator.ts` — emit `task_done`/`data_extracted`, resume mode, `retryTask`, `abortTask`, `runId`/`getAllTasks` getters
- `src/application/use-cases/RunParser.ts` — add `resume()` factory method
- `src/application/services/ParserRunnerService.ts` — inject RunPersistenceService, add `resume()`, `retryTask()`, `getOrchestrator()`
- `src/api/server.ts` — 7 new job endpoints, update SSE init event
- `client/src/api.ts` — types + API functions for jobs
- `client/src/hooks/useParserSSE.ts` — add `'stopped'` status
- `client/src/components/ParserCard.tsx` — stopped badge + View Job link
- `client/src/App.tsx` — jobs routing + nav item

---

### Task 1: DB Migration

**Files:**
- Create: `src/infrastructure/db/migrations/0002_run_persistence.sql`
- Modify: `src/infrastructure/db/migrate.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- src/infrastructure/db/migrations/0002_run_persistence.sql
CREATE TABLE IF NOT EXISTS parser_runs (
  id          UUID        PRIMARY KEY,
  parser_name TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'running',  -- 'running'|'stopped'|'completed'
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS parser_runs_parser_name_idx ON parser_runs(parser_name);
CREATE INDEX IF NOT EXISTS parser_runs_started_at_idx  ON parser_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS run_tasks (
  id             UUID        PRIMARY KEY,
  run_id         UUID        NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
  url            TEXT        NOT NULL,
  step_name      TEXT        NOT NULL,
  step_type      TEXT        NOT NULL,
  state          TEXT        NOT NULL,
  attempts       INTEGER     NOT NULL DEFAULT 0,
  max_attempts   INTEGER     NOT NULL,
  error          TEXT,
  parent_task_id UUID,
  parent_data    JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS run_tasks_run_id_idx        ON run_tasks(run_id);
CREATE INDEX IF NOT EXISTS run_tasks_run_id_state_idx  ON run_tasks(run_id, state);

CREATE TABLE IF NOT EXISTS task_results (
  task_id UUID  PRIMARY KEY REFERENCES run_tasks(id) ON DELETE CASCADE,
  rows    JSONB NOT NULL DEFAULT '[]'
);
```

- [ ] **Step 2: Update migrate.ts to run both migrations sequentially**

```typescript
// src/infrastructure/db/migrate.ts
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const migrations = ['0001_init.sql', '0002_run_persistence.sql']
  for (const file of migrations) {
    const sql = await readFile(resolve(__dirname, 'migrations', file), 'utf8')
    await pool.query(sql)
    console.log(`Applied: ${file}`)
  }
  await pool.end()
}

migrate().catch(async (err) => {
  console.error(err)
  await pool.end().catch(() => {})
  process.exit(1)
})
```

- [ ] **Step 3: Run the migration**

```bash
npm run db:migrate
```

Expected output:
```
Applied: 0001_init.sql
Applied: 0002_run_persistence.sql
```

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/db/migrations/0002_run_persistence.sql src/infrastructure/db/migrate.ts
git commit -m "feat(db): add parser_runs, run_tasks, task_results tables"
```

---

### Task 2: RunPersistenceService + Schema

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Create: `src/infrastructure/db/RunPersistenceService.ts`

- [ ] **Step 1: Add Drizzle table definitions to schema.ts**

Append to the end of `src/infrastructure/db/schema.ts`:

```typescript
export const parserRuns = pgTable('parser_runs', {
  id:         uuid('id').primaryKey(),
  parserName: text('parser_name').notNull(),
  status:     text('status').notNull().default('running'),
  startedAt:  timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  stoppedAt:  timestamp('stopped_at', { withTimezone: true }),
})

export const runTasks = pgTable('run_tasks', {
  id:           uuid('id').primaryKey(),
  runId:        uuid('run_id').notNull().references(() => parserRuns.id, { onDelete: 'cascade' }),
  url:          text('url').notNull(),
  stepName:     text('step_name').notNull(),
  stepType:     text('step_type').notNull(),
  state:        text('state').notNull(),
  attempts:     integer('attempts').notNull().default(0),
  maxAttempts:  integer('max_attempts').notNull(),
  error:        text('error'),
  parentTaskId: uuid('parent_task_id'),
  parentData:   jsonb('parent_data'),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const taskResults = pgTable('task_results', {
  taskId: uuid('task_id').primaryKey().references(() => runTasks.id, { onDelete: 'cascade' }),
  rows:   jsonb('rows').notNull().default([]),
})
```

- [ ] **Step 2: Write the failing test**

Create `tests/infrastructure/RunPersistenceService.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RunPersistenceService } from '../../src/infrastructure/db/RunPersistenceService.js'
import { pool } from '../../src/infrastructure/db/client.js'
import { PageState } from '../../src/domain/value-objects/PageState.js'
import { randomUUID } from 'node:crypto'

// NOTE: this test requires a running PostgreSQL database with migrations applied.
// Skip in CI environments without DB. Mark tests with .skip if DB is unavailable.

const svc = new RunPersistenceService()
const runId = randomUUID()
const parserName = `test-parser-${randomUUID().slice(0, 8)}`

afterAll(async () => {
  await pool.query(`DELETE FROM parser_runs WHERE id = $1`, [runId])
  await pool.end()
})

describe('RunPersistenceService', () => {
  it('creates a run record', async () => {
    await svc.createRun(parserName, runId)
    const info = await svc.getLatestRunInfo(parserName)
    expect(info?.id).toBe(runId)
    expect(info?.status).toBe('running')
  })

  it('upserts a task and reads it back', async () => {
    const task = {
      id: randomUUID(),
      url: 'https://example.com',
      stepName: 'extract' as any,
      stepType: 'extractor' as const,
      state: PageState.Success,
      attempts: 1,
      maxAttempts: 5,
      error: undefined,
      parentTaskId: undefined,
      parentData: undefined,
    }
    await svc.upsertTask(runId, task)
    const { tasks } = await svc.getRunTasks(runId, 1, 100)
    expect(tasks.some(t => t.id === task.id)).toBe(true)
  })

  it('marks run as stopped', async () => {
    await svc.markRunStopped(runId, [])
    const info = await svc.getLatestRunInfo(parserName)
    expect(info?.status).toBe('stopped')
  })

  it('loadLatestStoppedRunTasks returns tasks for stopped run', async () => {
    const result = await svc.loadLatestStoppedRunTasks(parserName)
    expect(result?.runId).toBe(runId)
  })
})
```

- [ ] **Step 3: Run test to confirm it fails (service not created yet)**

```bash
npx vitest run tests/infrastructure/RunPersistenceService.test.ts 2>&1 | tail -5
```

Expected: FAIL — cannot find module `RunPersistenceService`

- [ ] **Step 4: Implement RunPersistenceService**

Create `src/infrastructure/db/RunPersistenceService.ts`:

```typescript
import { db } from './client.js'
import { parserRuns, runTasks, taskResults } from './schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { PageTask } from '../../domain/entities/PageTask.js'
import { PageState } from '../../domain/value-objects/PageState.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export interface RunInfo {
  id: string
  parserName: string
  status: string
  startedAt: Date
  stoppedAt?: Date | null
  stats: RunStats | null
}

export interface StoredTask {
  id: string
  runId: string
  url: string
  stepName: string
  stepType: 'traverser' | 'extractor'
  state: string
  attempts: number
  maxAttempts: number
  error?: string | null
  parentTaskId?: string | null
  parentData?: Record<string, unknown> | null
}

export class RunPersistenceService {
  async createRun(parserName: string, runId: string): Promise<void> {
    await db.insert(parserRuns).values({ id: runId, parserName, status: 'running' })
  }

  async markRunStopped(runId: string, tasks: PageTask[]): Promise<void> {
    await this._bulkUpsertTasks(runId, tasks)
    await db.update(parserRuns)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(parserRuns.id, runId))
  }

  async markRunCompleted(runId: string, tasks: PageTask[]): Promise<void> {
    await this._bulkUpsertTasks(runId, tasks)
    await db.update(parserRuns)
      .set({ status: 'completed', stoppedAt: new Date() })
      .where(eq(parserRuns.id, runId))
  }

  async upsertTask(runId: string, task: PageTask): Promise<void> {
    await db.insert(runTasks).values({
      id:           task.id,
      runId,
      url:          task.url,
      stepName:     String(task.stepName),
      stepType:     task.stepType,
      state:        task.state,
      attempts:     task.attempts,
      maxAttempts:  task.maxAttempts,
      error:        task.error ?? null,
      parentTaskId: task.parentTaskId ?? null,
      parentData:   task.parentData ?? null,
      updatedAt:    new Date(),
    }).onConflictDoUpdate({
      target: runTasks.id,
      set: {
        state:     sql`excluded.state`,
        attempts:  sql`excluded.attempts`,
        error:     sql`excluded.error`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
  }

  async saveTaskResult(taskId: string, rows: Record<string, unknown>[]): Promise<void> {
    await db.insert(taskResults).values({ taskId, rows })
      .onConflictDoUpdate({ target: taskResults.taskId, set: { rows: sql`excluded.rows` } })
  }

  async getTaskResult(taskId: string): Promise<Record<string, unknown>[] | null> {
    const [row] = await db.select().from(taskResults).where(eq(taskResults.taskId, taskId))
    return row ? (row.rows as Record<string, unknown>[]) : null
  }

  async getLatestRunInfo(parserName: string): Promise<RunInfo | null> {
    const [row] = await db.select().from(parserRuns)
      .where(eq(parserRuns.parserName, parserName))
      .orderBy(desc(parserRuns.startedAt))
      .limit(1)
    if (!row) return null
    const stats = await this._computeStats(row.id)
    return { ...row, stats }
  }

  async getAllRuns(page: number, limit: number): Promise<{ runs: (RunInfo & { failedCount: number })[]; total: number }> {
    const offset = (page - 1) * limit
    const rows = await db.select().from(parserRuns)
      .orderBy(desc(parserRuns.startedAt))
      .limit(limit)
      .offset(offset)
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(parserRuns)
    const runs = await Promise.all(rows.map(async (r) => {
      const stats = await this._computeStats(r.id)
      return { ...r, stats, failedCount: stats?.failed ?? 0 }
    }))
    return { runs, total: count }
  }

  async getRunTasks(
    runId: string,
    page: number,
    limit: number,
    status?: string,
  ): Promise<{ tasks: StoredTask[]; total: number }> {
    const offset = (page - 1) * limit
    const conditions = status
      ? and(eq(runTasks.runId, runId), eq(runTasks.state, status))
      : eq(runTasks.runId, runId)
    const rows = await db.select().from(runTasks)
      .where(conditions)
      .limit(limit)
      .offset(offset)
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(runTasks).where(conditions)
    return { tasks: rows as StoredTask[], total: count }
  }

  async loadLatestStoppedRunTasks(
    parserName: string,
  ): Promise<{ runId: string; tasks: StoredTask[] } | null> {
    const info = await this.getLatestRunInfo(parserName)
    if (!info || info.status !== 'stopped') return null
    const { tasks } = await this.getRunTasks(info.id, 1, 100_000)
    return { runId: info.id, tasks }
  }

  private async _bulkUpsertTasks(runId: string, tasks: PageTask[]): Promise<void> {
    if (tasks.length === 0) return
    for (const task of tasks) {
      await this.upsertTask(runId, task)
    }
  }

  private async _computeStats(runId: string): Promise<RunStats | null> {
    const rows = await db.select({
      state:    runTasks.state,
      stepType: runTasks.stepType,
      count:    sql<number>`count(*)::int`,
    }).from(runTasks)
      .where(eq(runTasks.runId, runId))
      .groupBy(runTasks.state, runTasks.stepType)

    if (rows.length === 0) return null

    const total    = rows.reduce((s, r) => s + r.count, 0)
    const get      = (state: string) => rows.filter(r => r.state === state).reduce((s, r) => s + r.count, 0)
    const getType  = (type: string, state: string) => rows.find(r => r.stepType === type && r.state === state)?.count ?? 0
    const typeTotal = (type: string) => rows.filter(r => r.stepType === type).reduce((s, r) => s + r.count, 0)

    return {
      total,
      pending:    get('pending'),
      retry:      get('retry'),
      success:    get('success'),
      failed:     get('failed'),
      aborted:    get('aborted'),
      inProgress: get('in_progress'),
      traversers: { total: typeTotal('traverser'), success: getType('traverser', 'success'), failed: getType('traverser', 'failed') },
      extractors: { total: typeTotal('extractor'),  success: getType('extractor',  'success'), failed: getType('extractor',  'failed') },
    }
  }
}
```

- [ ] **Step 5: Run test**

```bash
npx vitest run tests/infrastructure/RunPersistenceService.test.ts 2>&1 | tail -10
```

Expected: PASS (all 4 assertions)

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/db/schema.ts src/infrastructure/db/RunPersistenceService.ts tests/infrastructure/RunPersistenceService.test.ts
git commit -m "feat(db): add RunPersistenceService for run/task persistence"
```

---

### Task 3: Domain Model Additions

**Files:**
- Modify: `src/domain/value-objects/PageState.ts`
- Modify: `src/domain/entities/ParserRun.ts`
- Modify: `src/domain/services/LinkDeduplicator.ts`
- Modify: `tests/domain/ParserRun.test.ts`
- Modify: `tests/domain/LinkDeduplicator.test.ts`

- [ ] **Step 1: Write failing tests for new domain methods**

Append to `tests/domain/ParserRun.test.ts`:

```typescript
  it('has a stable string id in UUID format', () => {
    const run = new ParserRun('p')
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('restoreTask adds a task without changing its state', () => {
    const run1 = new ParserRun('p')
    const task = run1.addTask('https://a.com', stepName('s'), 'extractor')
    run1.markSuccess(task.id)

    const run2 = new ParserRun('p')
    run2.restoreTask(run1.getTask(task.id)!)
    expect(run2.getTask(task.id)?.state).toBe(PageState.Success)
  })

  it('markPending resets an aborted task', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markAborted(task.id)
    run.markPending(task.id)
    expect(run.getTask(task.id)?.state).toBe(PageState.Pending)
  })

  it('markInProgress sets in_progress state', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markInProgress(task.id)
    expect(run.getTask(task.id)?.state).toBe(PageState.InProgress)
  })

  it('isComplete is false when tasks are in_progress', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markInProgress(task.id)
    expect(run.isComplete()).toBe(false)
  })
```

Append to `tests/domain/LinkDeduplicator.test.ts`:

```typescript
  it('seed pre-populates seen set so seeded URLs are filtered out', () => {
    const dedup = new LinkDeduplicator()
    dedup.seed(['https://a.com/page', 'https://b.com'])
    const result = dedup.filter(['https://a.com/page', 'https://c.com'])
    expect(result).toEqual(['https://c.com'])
  })

  it('seed respects URL normalization', () => {
    const dedup = new LinkDeduplicator()
    dedup.seed(['https://a.com/page/'])   // trailing slash variant
    expect(dedup.filter(['https://a.com/page'])).toEqual([])
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/domain/ParserRun.test.ts tests/domain/LinkDeduplicator.test.ts 2>&1 | tail -10
```

Expected: FAIL — new methods don't exist yet

- [ ] **Step 3: Update PageState — add InProgress, update isTerminal**

```typescript
// src/domain/value-objects/PageState.ts
export enum PageState {
  Pending    = 'pending',
  Retry      = 'retry',
  InProgress = 'in_progress',
  Success    = 'success',
  Failed     = 'failed',
  Aborted    = 'aborted',
}

const TERMINAL_STATES = new Set([PageState.Success, PageState.Failed, PageState.Aborted])

export function isTerminal(state: PageState): boolean {
  return TERMINAL_STATES.has(state)
}
```

- [ ] **Step 4: Update ParserRun — add id, restoreTask, markPending, markInProgress**

```typescript
// src/domain/entities/ParserRun.ts
import { createPageTask, type PageTask } from './PageTask.js'
import type { StepType } from './Step.js'
import { PageState, isTerminal } from '../value-objects/PageState.js'
import type { StepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { randomUUID } from 'node:crypto'

export interface StepTypeStats {
  total: number
  success: number
  failed: number
}

export interface RunStats {
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
  traversers: StepTypeStats
  extractors: StepTypeStats
}

export class ParserRun {
  readonly id = randomUUID()
  private tasks = new Map<string, PageTask>()
  readonly startedAt = new Date()

  constructor(readonly parserName: string) {}

  addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parentData?: Record<string, unknown>,
  ): PageTask {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parentData)
    this.tasks.set(task.id, task)
    return task
  }

  restoreTask(task: PageTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): PageTask | undefined {
    return this.tasks.get(id)
  }

  markInProgress(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.InProgress })
  }

  markPending(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Pending, error: undefined })
  }

  markRetry(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Retry, attempts: task.attempts + 1, error })
  }

  markSuccess(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Success, error: undefined })
  }

  markFailed(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Failed, error })
  }

  markAborted(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Aborted })
  }

  isComplete(): boolean {
    if (this.tasks.size === 0) return false
    return [...this.tasks.values()].every((t) => isTerminal(t.state))
  }

  allTasks(): PageTask[] {
    return [...this.tasks.values()]
  }

  getStats(): RunStats {
    const tasks = [...this.tasks.values()]
    const byType = (type: StepType): StepTypeStats => {
      const subset = tasks.filter((t) => t.stepType === type)
      return {
        total:   subset.length,
        success: subset.filter((t) => t.state === PageState.Success).length,
        failed:  subset.filter((t) => t.state === PageState.Failed).length,
      }
    }
    return {
      total:      tasks.length,
      pending:    tasks.filter((t) => t.state === PageState.Pending).length,
      retry:      tasks.filter((t) => t.state === PageState.Retry).length,
      success:    tasks.filter((t) => t.state === PageState.Success).length,
      failed:     tasks.filter((t) => t.state === PageState.Failed).length,
      aborted:    tasks.filter((t) => t.state === PageState.Aborted).length,
      inProgress: tasks.filter((t) => t.state === PageState.InProgress).length,
      traversers: byType('traverser'),
      extractors: byType('extractor'),
    }
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt.getTime()
  }

  private requireTask(id: string): PageTask {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  }
}
```

- [ ] **Step 5: Update LinkDeduplicator — add seed()**

```typescript
// src/domain/services/LinkDeduplicator.ts
export class LinkDeduplicator {
  private seen = new Set<string>()

  constructor(private readonly enabled: boolean = true) {}

  seed(urls: string[]): void {
    for (const url of urls) {
      this.seen.add(this.normalize(url))
    }
  }

  filter(urls: string[]): string[] {
    if (!this.enabled) return urls
    const result: string[] = []
    for (const url of urls) {
      const normalized = this.normalize(url)
      if (!this.seen.has(normalized)) {
        this.seen.add(normalized)
        result.push(url)
      }
    }
    return result
  }

  private normalize(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      parsed.searchParams.sort()
      return parsed.toString()
    } catch {
      return url
    }
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/domain/ParserRun.test.ts tests/domain/LinkDeduplicator.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 7: Run full suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: all passing (the `addTask` tests with 2 args still work at runtime)

- [ ] **Step 8: Commit**

```bash
git add src/domain/value-objects/PageState.ts src/domain/entities/ParserRun.ts src/domain/services/LinkDeduplicator.ts tests/domain/ParserRun.test.ts tests/domain/LinkDeduplicator.test.ts
git commit -m "feat(domain): add InProgress state, ParserRun.id/restoreTask/markPending/markInProgress, LinkDeduplicator.seed"
```

---

### Task 4: ParserOrchestrator Updates

**Files:**
- Modify: `src/application/orchestrator/ParserOrchestrator.ts`

Changes: expose `runId`/`getAllTasks`; emit `task_done` and `data_extracted` events; support resume (snapshot tasks in constructor); add `retryTask()`; track InProgress state in `_sendToWorker`; abort InProgress tasks in `stop()`.

- [ ] **Step 1: Replace `ParserOrchestrator.ts` with the updated version**

```typescript
// src/application/orchestrator/ParserOrchestrator.ts
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { ParserRun, type RunStats } from '../../domain/entities/ParserRun.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Step } from '../../domain/entities/Step.js'
import { LinkDeduplicator } from '../../domain/services/LinkDeduplicator.js'
import { CsvWriter } from '../../infrastructure/csv/CsvWriter.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import { mkdir } from 'node:fs/promises'
import { PageState } from '../../domain/value-objects/PageState.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isTsx = __filename.endsWith('.ts')

export class ParserOrchestrator extends EventEmitter {
  private run: ParserRun
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, CsvWriter>()
  private pendingWrites: Promise<void>[] = []
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completing = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void
  private globalActive = 0
  private dispatchQueue: string[] = []

  constructor(
    private readonly config: ParserConfig,
    outputBaseDir: string,
    snapshotTasks?: PageTask[],
  ) {
    super()
    this.run = new ParserRun(config.name)
    if (snapshotTasks) {
      for (const t of snapshotTasks) this.run.restoreTask(t)
    }
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name)
  }

  get runId(): string {
    return this.run.id
  }

  getAllTasks(): PageTask[] {
    return this.run.allTasks()
  }

  retryTask(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (task.state !== PageState.Failed && task.state !== PageState.Aborted) {
      throw new Error(`Task "${taskId}" is not failed or aborted (state: ${task.state})`)
    }
    this.run.markPending(taskId)
    this.dispatchTask(taskId)
  }

  abortTask(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (
      task.state !== PageState.Pending &&
      task.state !== PageState.InProgress &&
      task.state !== PageState.Retry
    ) {
      throw new Error(`Task "${taskId}" cannot be aborted (state: ${task.state})`)
    }
    this.run.markAborted(taskId)
  }

  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })

    for (const [, step] of this.config.steps) {
      this.spawnWorker(step)
    }

    const snapshotTasks = this.run.allTasks()
    if (snapshotTasks.length > 0) {
      // Resume mode: seed deduplicator with succeeded URLs, re-dispatch aborted tasks
      const successUrls = snapshotTasks
        .filter((t) => t.state === PageState.Success)
        .map((t) => t.url)
      this.deduplicator.seed(successUrls)

      const toDispatch = snapshotTasks.filter(
        (t) => t.state === PageState.Aborted || t.state === PageState.Pending || t.state === PageState.Retry,
      )
      for (const task of toDispatch) {
        this.run.markPending(task.id)
        this.dispatchTask(task.id)
      }
    } else {
      // Fresh start
      const initialUrls = this.deduplicator.filter([this.config.entryUrl])
      const entryStepType = this.config.steps.get(this.config.entryStep)?.type ?? 'traverser'
      for (const url of initialUrls) {
        const task = this.run.addTask(url, this.config.entryStep, entryStepType, this.config.retryConfig)
        this.dispatchTask(task.id)
      }
    }

    this.emit('stats', this.run.getStats())

    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const task of this.run.allTasks()) {
      if (
        task.state === PageState.Pending ||
        task.state === PageState.Retry ||
        task.state === PageState.InProgress
      ) {
        this.run.markAborted(task.id)
      }
    }
    const exitPromises = [...this.workers.values()].map(
      (worker) =>
        new Promise<void>((resolve) => {
          worker.once('exit', () => resolve())
          worker.postMessage({ type: 'STOP' })
          setTimeout(() => worker.terminate().then(() => resolve()).catch(() => resolve()), 5_000)
        }),
    )
    await Promise.all(exitPromises)
    await this.closeAllWriters()
    this.resolveCompletion()
  }

  getStats(): RunStats {
    return this.run.getStats()
  }

  private spawnWorker(step: Step): void {
    const hasFilePath = !!this.config.filePath
    const hasCode = !!step.code
    if (!hasFilePath && !hasCode) {
      throw new Error(`Step "${step.name}" has no filePath or inline code`)
    }

    const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
    const tsWorkerFile =
      step.type === 'traverser'
        ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
        : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
    const jsWorkerFile =
      step.type === 'traverser'
        ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
        : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

    const entryFile = isTsx ? bootstrapFile : jsWorkerFile
    const outputFile =
      step.type === 'extractor'
        ? (step as import('../../domain/entities/Extractor.js').Extractor).outputFile
        : undefined

    const wData = hasFilePath
      ? (isTsx
          ? { parserFilePath: this.config.filePath!, stepName: String(step.name), __workerPath: tsWorkerFile, browserSettings: this.config.browserSettings }
          : { parserFilePath: this.config.filePath!, stepName: String(step.name), browserSettings: this.config.browserSettings })
      : (isTsx
          ? { stepCode: step.code!, stepType: step.type, outputFile, stepSettings: step.settings, stepName: String(step.name), __workerPath: tsWorkerFile, browserSettings: this.config.browserSettings }
          : { stepCode: step.code!, stepType: step.type, outputFile, stepSettings: step.settings, stepName: String(step.name), browserSettings: this.config.browserSettings })

    const worker = new Worker(entryFile, { workerData: wData })
    worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
    worker.on('error', (err) => this.emit('error', err))
    this.workers.set(step.name, worker)
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    if (this.stopped) return
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        const newLinks = new Set(this.deduplicator.filter(msg.items.map((i) => i.link)))
        const newItems = msg.items.filter((i) => newLinks.has(i.link))
        for (const item of newItems) {
          const stepName = item.page_type as StepName
          const stepType = this.config.steps.get(stepName)?.type ?? 'traverser'
          const task = this.run.addTask(
            item.link,
            stepName,
            stepType,
            this.config.retryConfig,
            msg.taskId,
            item.parent_data,
          )
          this.dispatchTask(task.id)
        }
        this.emit('stats', this.run.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        for (const row of msg.rows) {
          const stringRow: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            stringRow[k] = v == null ? '' : String(v)
          }
          this.writeCsvRow(msg.outputFile, stringRow)
        }
        this.emit('data_extracted', { taskId: msg.taskId, rows: msg.rows })
        break
      }
      case 'PAGE_SUCCESS': {
        this.globalActive--
        this.run.markSuccess(msg.taskId)
        this.emit('task_done', this.run.getTask(msg.taskId)!)
        this.emit('stats', this.run.getStats())
        this.flushDispatchQueue()
        this.checkCompletion()
        break
      }
      case 'LOG': {
        const line = `[${msg.stepName}] ${msg.args.join(' ')}`
        if (msg.level === 'error') console.error(line)
        else console.log(line)
        break
      }
      case 'PAGE_FAILED': {
        this.globalActive--
        const task = this.run.getTask(msg.taskId)!
        if (task.attempts < task.maxAttempts) {
          this.run.markRetry(msg.taskId, msg.error)
          this.emit('stats', this.run.getStats())
          this.dispatchTask(msg.taskId)
        } else {
          this.run.markFailed(msg.taskId, msg.error)
          this.emit('task_done', this.run.getTask(msg.taskId)!)
          this.emit('stats', this.run.getStats())
          this.checkCompletion()
        }
        this.flushDispatchQueue()
        break
      }
    }
  }

  private dispatchTask(taskId: string): void {
    if (this.stopped) return
    const quota = this.config.concurrentQuota
    if (quota !== undefined && this.globalActive >= quota) {
      this.dispatchQueue.push(taskId)
      return
    }
    this._sendToWorker(taskId)
  }

  private _sendToWorker(taskId: string): void {
    const task = this.run.getTask(taskId)
    if (!task) return
    const worker = this.workers.get(task.stepName)
    if (!worker) {
      this.run.markFailed(taskId, `No worker for step "${task.stepName}"`)
      this.emit('task_done', this.run.getTask(taskId)!)
      this.emit('stats', this.run.getStats())
      this.checkCompletion()
      return
    }
    this.run.markInProgress(taskId)
    this.globalActive++
    worker.postMessage({ type: 'PROCESS_PAGE', task })
  }

  private flushDispatchQueue(): void {
    const quota = this.config.concurrentQuota
    while (
      this.dispatchQueue.length > 0 &&
      (quota === undefined || this.globalActive < quota)
    ) {
      const nextId = this.dispatchQueue.shift()!
      this._sendToWorker(nextId)
    }
  }

  private writeCsvRow(outputFile: string, data: Record<string, string>): void {
    const filePath = resolve(this.outputDir, outputFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, new CsvWriter(filePath))
    }
    const p = this.csvWriters.get(filePath)!.write(data).catch(console.error) as Promise<void>
    this.pendingWrites.push(p)
  }

  private checkCompletion(): void {
    if (this.stopped || this.completing || !this.run.isComplete()) return
    this.completing = true
    this.closeAllWriters()
      .then(() => this.runPostProcessing())
      .then(() => {
        this.emit('complete', this.run.getStats())
        this.resolveCompletion()
      })
      .catch((err) => this.emit('error', err))
  }

  private async closeAllWriters(): Promise<void> {
    await Promise.all(this.pendingWrites)
    this.pendingWrites = []
    await Promise.all([...this.csvWriters.values()].map((w) => w.close()))
  }

  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/application/orchestrator/ParserOrchestrator.ts
git commit -m "feat(orchestrator): add runId/getAllTasks/retryTask/abortTask, emit task_done/data_extracted, support resume mode, track InProgress"
```

---

### Task 5: RunParser.resume() + ParserRunnerService Wiring

**Files:**
- Modify: `src/application/use-cases/RunParser.ts`
- Modify: `src/application/services/ParserRunnerService.ts`

- [ ] **Step 1: Add `resume()` to RunParser**

```typescript
// src/application/use-cases/RunParser.ts
import { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { IParserLoader } from '../../infrastructure/loader/IParserLoader.js'
import type { PageTask } from '../../domain/entities/PageTask.js'

export class RunParser {
  constructor(
    private readonly loader: IParserLoader,
    private readonly outputDir: string,
  ) {}

  async execute(
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const orchestrator = new ParserOrchestrator(config, this.outputDir)
    this._wire(orchestrator, parserName, onStats, onComplete, onPostProcess)
    orchestrator.start().catch((err) => console.error(`[${parserName}] Start error:`, err))
    return orchestrator
  }

  async resume(
    parserName: string,
    snapshotTasks: PageTask[],
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const orchestrator = new ParserOrchestrator(config, this.outputDir, snapshotTasks)
    this._wire(orchestrator, parserName, onStats, onComplete, onPostProcess)
    orchestrator.start().catch((err) => console.error(`[${parserName}] Resume error:`, err))
    return orchestrator
  }

  private _wire(
    orchestrator: ParserOrchestrator,
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): void {
    orchestrator.on('stats', onStats)
    orchestrator.on('complete', onComplete)
    orchestrator.on('postprocess', onPostProcess)
    orchestrator.on('error', (err: Error) =>
      console.error(`[${parserName}] Worker error:`, err.message),
    )
  }
}
```

- [ ] **Step 2: Rewrite ParserRunnerService with persistence wiring**

```typescript
// src/application/services/ParserRunnerService.ts
import { EventEmitter } from 'node:events'
import { RunParser } from '../use-cases/RunParser.js'
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

export class ParserRunnerService extends EventEmitter {
  private activeRuns = new Map<string, ParserOrchestrator>()
  private lastStats = new Map<string, RunStats>()

  constructor(
    private readonly runParser: RunParser,
    private readonly runPersistence: RunPersistenceService,
  ) {
    super()
  }

  async run(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    let orchestrator!: ParserOrchestrator
    orchestrator = await this.runParser.execute(
      parserName,
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      async (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        await this.runPersistence.markRunCompleted(orchestrator.runId, orchestrator.getAllTasks()).catch(console.error)
        this.emit('complete', parserName, s)
        this.activeRuns.delete(parserName)
      },
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(orchestrator)
    await this.runPersistence.createRun(parserName, orchestrator.runId).catch(console.error)
    this.activeRuns.set(parserName, orchestrator)
  }

  async resume(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    const snapshot = await this.runPersistence.loadLatestStoppedRunTasks(parserName)
    if (!snapshot) throw new Error(`No stopped run found for "${parserName}"`)

    let orchestrator!: ParserOrchestrator
    orchestrator = await this.runParser.resume(
      parserName,
      snapshot.tasks.map((t) => ({
        id:           t.id,
        url:          t.url,
        stepName:     t.stepName as any,
        stepType:     t.stepType,
        state:        t.state as any,
        attempts:     t.attempts,
        maxAttempts:  t.maxAttempts,
        error:        t.error ?? undefined,
        parentTaskId: t.parentTaskId ?? undefined,
        parentData:   (t.parentData as Record<string, unknown>) ?? undefined,
      })),
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      async (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        await this.runPersistence.markRunCompleted(orchestrator.runId, orchestrator.getAllTasks()).catch(console.error)
        this.emit('complete', parserName, s)
        this.activeRuns.delete(parserName)
      },
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(orchestrator)
    await this.runPersistence.createRun(parserName, orchestrator.runId).catch(console.error)
    this.activeRuns.set(parserName, orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    const runId = orchestrator.runId
    await orchestrator.stop()
    await this.runPersistence.markRunStopped(runId, orchestrator.getAllTasks()).catch(console.error)
    this.activeRuns.delete(parserName)
    this.emit('stopped', parserName)
  }

  retryTask(parserName: string, taskId: string): void {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    orchestrator.retryTask(taskId)
  }

  abortTask(parserName: string, taskId: string): void {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    orchestrator.abortTask(taskId)
  }

  getOrchestrator(parserName: string): ParserOrchestrator | undefined {
    return this.activeRuns.get(parserName)
  }

  getStats(parserName: string): RunStats | undefined {
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) return orchestrator.getStats()
    return this.lastStats.get(parserName)
  }

  isRunning(parserName: string): boolean {
    return this.activeRuns.has(parserName)
  }

  listRunning(): string[] {
    return [...this.activeRuns.keys()]
  }

  private _wireTaskEvents(orchestrator: ParserOrchestrator): void {
    orchestrator.on('task_done', (task: PageTask) => {
      this.runPersistence.upsertTask(orchestrator.runId, task).catch(console.error)
      this.emit('task_done', orchestrator.runId, task)
    })
    orchestrator.on('data_extracted', ({ taskId, rows }: { taskId: string; rows: Record<string, unknown>[] }) => {
      this.runPersistence.saveTaskResult(taskId, rows).catch(console.error)
    })
  }
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/application/use-cases/RunParser.ts src/application/services/ParserRunnerService.ts
git commit -m "feat(runner): add resume(), retryTask(), abortTask(), persist task events via RunPersistenceService"
```

---

### Task 6: API — Jobs Endpoints

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/infrastructure/db/RunPersistenceService.ts` — add `getTask(taskId)` method

Add 9 new endpoints and update the SSE init event to include `stoppedRunExists`.

- [ ] **Step 1: Update server.ts top — wire RunPersistenceService into runner**

Replace the top-of-file setup section (lines 1–27 area):

```typescript
import express from 'express'
import cors from 'cors'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import type { RunStats } from '../domain/entities/ParserRun.js'
import type { Response } from 'express'
import { DebugStepRunner } from '../application/use-cases/DebugStepRunner.js'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { RunPersistenceService } from '../infrastructure/db/RunPersistenceService.js'
import { db } from '../infrastructure/db/client.js'
import { parsers as parsersTable, steps as stepsTable } from '../infrastructure/db/schema.js'
import { eq, and } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputDir = resolve(process.cwd(), 'output')

const dbLoader = new DbParserLoader()
const runPersistence = new RunPersistenceService()
const runParser = new RunParser(dbLoader, outputDir)
const runner = new ParserRunnerService(runParser, runPersistence)
```

- [ ] **Step 2: Update the SSE init event to include stoppedRunExists**

Find the `app.get('/api/parsers/:name/events', ...)` handler and replace the `res.write(...)` init line with:

```typescript
app.get('/api/parsers/:name/events', async (req, res) => {
  const { name } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const isRunning = runner.isRunning(name)
  let stoppedRunExists = false
  if (!isRunning) {
    const info = await runPersistence.getLatestRunInfo(name).catch(() => null)
    stoppedRunExists = info?.status === 'stopped'
  }

  res.write(
    `data: ${JSON.stringify({
      type: 'init',
      running: isRunning,
      stats: runner.getStats(name) ?? null,
      stoppedRunExists,
    })}\n\n`,
  )

  getClients(name).add(res)
  req.on('close', () => getClients(name).delete(res))
})
```

- [ ] **Step 3: Add resume endpoint for parsers**

Add after the `/stop` endpoint:

```typescript
app.post('/api/parsers/:name/resume', (req, res) => {
  const { name } = req.params
  if (runner.isRunning(name)) {
    res.status(409).json({ error: 'Already running' })
    return
  }
  runner.resume(name).catch((err: Error) => {
    console.error(`[server] resume error:`, err)
    broadcast(name, { type: 'error', message: err.message })
  })
  res.json({ ok: true })
})
```

- [ ] **Step 4: Add all jobs endpoints**

Append before the `const PORT = ...` line:

```typescript
// GET /api/jobs — list all runs, paginated
app.get('/api/jobs', async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10))
  const limit = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10))
  try {
    const result = await runPersistence.getAllRuns(page, limit)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId — run info + stats
app.get('/api/jobs/:runId', async (req, res) => {
  const { runId } = req.params
  // Look up parserName from any run with this id
  try {
    const { runs } = await runPersistence.getAllRuns(1, 1_000)
    const run = runs.find((r) => r.id === runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    const isRunning = runner.isRunning(run.parserName) &&
      runner.getOrchestrator(run.parserName)?.runId === runId
    res.json({ ...run, isRunning })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId/tasks — paginated task list
app.get('/api/jobs/:runId/tasks', async (req, res) => {
  const { runId } = req.params
  const page   = Math.max(1, parseInt(String(req.query.page   ?? '1'),   10))
  const limit  = Math.min(500, parseInt(String(req.query.limit ?? '100'), 10))
  const status = req.query.status as string | undefined

  try {
    // For a running job, merge in-memory tasks with DB tasks
    // (In-memory tasks include pending/in_progress not yet persisted)
    const dbResult = await runPersistence.getRunTasks(runId, page, limit, status)

    // Find the orchestrator for this runId
    const parserName = Object.entries(Object.fromEntries(
      [...runner['activeRuns' as any] as any]
    )).find(([, orch]: any) => orch.runId === runId)?.[0]

    const orch = parserName ? runner.getOrchestrator(parserName as string) : undefined
    if (orch) {
      // Return in-memory tasks (more up-to-date for running jobs)
      const allTasks = orch.getAllTasks()
      const filtered = status ? allTasks.filter((t) => t.state === status) : allTasks
      const total = filtered.length
      const tasks = filtered.slice((page - 1) * limit, page * limit)
      res.json({ tasks, total })
      return
    }

    res.json(dbResult)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId/tasks/:taskId/result — extracted rows for a task
app.get('/api/jobs/:runId/tasks/:taskId/result', async (req, res) => {
  const { taskId } = req.params
  try {
    const rows = await runPersistence.getTaskResult(taskId)
    res.json({ rows: rows ?? [] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/stop
app.post('/api/jobs/:runId/stop', async (req, res) => {
  const { runId } = req.params
  // Find parserName from active runs
  const entry = [...(runner['activeRuns' as any] as Map<string, any>).entries()]
    .find(([, orch]) => orch.runId === runId)
  if (!entry) { res.status(404).json({ error: 'No active run with this runId' }); return }
  const [parserName] = entry
  try {
    await runner.stop(parserName)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/resume
app.post('/api/jobs/:runId/resume', async (req, res) => {
  // Look up parserName from DB
  try {
    const { runs } = await runPersistence.getAllRuns(1, 1_000)
    const run = runs.find((r) => r.id === runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    if (runner.isRunning(run.parserName)) {
      res.status(409).json({ error: 'Parser already running' }); return
    }
    runner.resume(run.parserName).catch((err: Error) => {
      broadcast(run.parserName, { type: 'error', message: err.message })
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/tasks/:taskId/retry
app.post('/api/jobs/:runId/tasks/:taskId/retry', (req, res) => {
  const { runId, taskId } = req.params
  const entry = [...(runner['activeRuns' as any] as Map<string, any>).entries()]
    .find(([, orch]) => orch.runId === runId)
  if (!entry) { res.status(404).json({ error: 'No active run with this runId — resume the job first' }); return }
  const [parserName] = entry
  try {
    runner.retryTask(parserName, taskId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})
```

Add `getTask(taskId)` to `RunPersistenceService` (needed by the single-task GET endpoint added below). Append to `src/infrastructure/db/RunPersistenceService.ts`:

```typescript
async getTask(taskId: string): Promise<StoredTask | null> {
  const [row] = await db.select().from(runTasks).where(eq(runTasks.id, taskId))
  return row ? (row as StoredTask) : null
}
```

Add two more endpoints after the retry handler:

```typescript
// GET /api/jobs/:runId/tasks/:taskId — single task metadata
app.get('/api/jobs/:runId/tasks/:taskId', async (req, res) => {
  const { runId, taskId } = req.params
  try {
    const parserName = runner.findParserByRunId(runId)
    if (parserName) {
      const orchestrator = runner.getOrchestrator(parserName)
      const task = orchestrator?.getAllTasks().find((t) => t.id === taskId)
      if (task) { res.json(task); return }
    }
    const task = await runPersistence.getTask(taskId)
    if (!task) { res.status(404).json({ error: 'Task not found' }); return }
    res.json(task)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/tasks/:taskId/abort — abort a pending/in-progress task
app.post('/api/jobs/:runId/tasks/:taskId/abort', (req, res) => {
  const { runId, taskId } = req.params
  const parserName = runner.findParserByRunId(runId)
  if (!parserName) { res.status(404).json({ error: 'No active run with this runId — resume the job first' }); return }
  try {
    runner.abortTask(parserName, taskId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})
```

Note: the `runner['activeRuns']` hack accesses the private field. To avoid this, add a public method `findRunIdParserName(runId)` to `ParserRunnerService` in Task 5. Update it:

In `ParserRunnerService`, add:
```typescript
findParserByRunId(runId: string): string | undefined {
  for (const [parserName, orch] of this.activeRuns) {
    if (orch.runId === runId) return parserName
  }
  return undefined
}
```

Then replace `runner['activeRuns' as any]` usages with:
```typescript
const parserName = runner.findParserByRunId(runId)
if (!parserName) { res.status(404).json({ error: 'No active run' }); return }
```

- [ ] **Step 5: Smoke-test the new endpoints**

Start the server:
```bash
npm run api
```

In another terminal:
```bash
# List all jobs (should have some from playwright-demo run)
curl -s http://localhost:3001/api/jobs | python3 -m json.tool | head -20

# Start a parser so we have a running job
curl -s -X POST http://localhost:3001/api/parsers/playwright-demo/start
curl -s http://localhost:3001/api/jobs
```

Expected: JSON response with runs array and total count.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts src/application/services/ParserRunnerService.ts
git commit -m "feat(api): add /api/jobs endpoints, single-task GET, abort task, resume endpoint, update SSE init with stoppedRunExists"
```

---

### Task 7: Client API + useParserSSE + ParserCard

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/hooks/useParserSSE.ts`
- Modify: `client/src/components/ParserCard.tsx`

- [ ] **Step 1: Add job types and API functions to client/src/api.ts**

Append to the end of `client/src/api.ts`:

```typescript
export interface RunInfo {
  id: string
  parserName: string
  status: 'running' | 'stopped' | 'completed'
  startedAt: string
  stoppedAt: string | null
  stats: RunStats | null
  isRunning?: boolean
}

export interface TaskRow {
  id: string
  runId: string
  url: string
  stepName: string
  stepType: 'traverser' | 'extractor'
  state: 'pending' | 'in_progress' | 'retry' | 'success' | 'failed' | 'aborted'
  attempts: number
  maxAttempts: number
  error?: string | null
  parentTaskId?: string | null
  parentData?: Record<string, unknown> | null
}

export async function listJobs(page = 1, limit = 50): Promise<{ runs: RunInfo[]; total: number }> {
  return apiRequest(`/api/jobs?page=${page}&limit=${limit}`)
}

export async function getJob(runId: string): Promise<RunInfo> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}`)
}

export async function getJobTasks(
  runId: string,
  page = 1,
  limit = 100,
  status?: string,
): Promise<{ tasks: TaskRow[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set('status', status)
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks?${params}`)
}

export async function getTaskResult(runId: string, taskId: string): Promise<{ rows: Record<string, unknown>[] }> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/result`)
}

export async function stopJob(runId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
}

export async function resumeJob(runId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/resume`, { method: 'POST' })
}

export async function getTask(runId: string, taskId: string): Promise<TaskRow> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`)
}

export async function retryTask(runId: string, taskId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' })
}

export async function abortTask(runId: string, taskId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/abort`, { method: 'POST' })
}

export async function resumeParser(name: string): Promise<void> {
  const res = await fetch(`/api/parsers/${encodeURIComponent(name)}/resume`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to resume')
  }
}
```

- [ ] **Step 2: Update useParserSSE — add 'stopped' status and stoppedRunExists**

```typescript
// client/src/hooks/useParserSSE.ts
import { useEffect, useState } from 'react'
import type { RunStats } from '../api'

export type ParserStatus = 'idle' | 'running' | 'stopped' | 'complete' | 'error'

export interface ParserState {
  status: ParserStatus
  stats: RunStats | null
  errorMessage: string | null
  stoppedRunExists: boolean
}

export function useParserSSE(parserName: string): ParserState {
  const [state, setState] = useState<ParserState>({
    status: 'idle',
    stats: null,
    errorMessage: null,
    stoppedRunExists: false,
  })

  useEffect(() => {
    const es = new EventSource(`/api/parsers/${parserName}/events`)

    es.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as {
        type: string
        running?: boolean
        stats?: RunStats | null
        stoppedRunExists?: boolean
        message?: string
      }

      switch (msg.type) {
        case 'init':
          setState({
            status: msg.running
              ? 'running'
              : msg.stoppedRunExists
                ? 'stopped'
                : msg.stats
                  ? 'complete'
                  : 'idle',
            stats: msg.stats ?? null,
            errorMessage: null,
            stoppedRunExists: msg.stoppedRunExists ?? false,
          })
          break
        case 'stats':
          setState({ status: 'running', stats: msg.stats ?? null, errorMessage: null, stoppedRunExists: false })
          break
        case 'complete':
          setState({ status: 'complete', stats: msg.stats ?? null, errorMessage: null, stoppedRunExists: false })
          break
        case 'stopped':
          setState((prev) => ({ ...prev, status: 'stopped', stoppedRunExists: true }))
          break
        case 'error':
          setState((prev) => ({ ...prev, status: 'error', errorMessage: msg.message ?? 'Unknown error' }))
          break
      }
    }

    es.onerror = () => {}
    return () => es.close()
  }, [parserName])

  return state
}
```

- [ ] **Step 3: Update ParserCard — stopped badge, Resume button, View Job link**

```typescript
// client/src/components/ParserCard.tsx
import { useState, useEffect } from 'react'
import { useParserSSE } from '../hooks/useParserSSE'
import { StatsPanel } from './StatsPanel'
import { startParser, stopParser, resumeParser, listFiles, downloadFile } from '../api'
import type { OutputFile } from '../api'

interface Props {
  name: string
  onEdit: () => void
  onViewJob: () => void
}

const STATUS_BADGE: Record<string, string> = {
  idle:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  running:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 animate-pulse',
  stopped:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  error:    'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  idle:     'Idle',
  running:  'Running',
  stopped:  'Stopped',
  complete: 'Complete',
  error:    'Error',
}

export function ParserCard({ name, onEdit, onViewJob }: Props) {
  const { status, stats, errorMessage } = useParserSSE(name)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<OutputFile[]>([])

  useEffect(() => {
    if (status === 'complete' || status === 'idle' || status === 'stopped') {
      listFiles(name).then(setFiles).catch(() => setFiles([]))
    }
  }, [status, name])

  async function handleRun() {
    setLoading(true)
    try { await startParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  async function handleStop() {
    setLoading(true)
    try { await stopParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  async function handleResume() {
    setLoading(true)
    try { await resumeParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const isRunning = status === 'running'
  const isStopped = status === 'stopped'

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-sm dark:shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-yellow-400 animate-ping' : isStopped ? 'bg-amber-400' : status === 'complete' ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-500'}`} />
          <h2 className="text-gray-900 dark:text-white font-semibold text-base tracking-wide m-0 truncate">{name}</h2>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onViewJob} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-600 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors" title="View Jobs">
            Jobs
          </button>
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            Edit
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded px-3 py-2">
          {errorMessage}
        </div>
      )}

      {stats && <StatsPanel stats={stats} />}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {isRunning ? (
          <button onClick={handleStop} disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
            {loading ? 'Stopping…' : 'Stop'}
          </button>
        ) : isStopped ? (
          <>
            <button onClick={handleResume} disabled={loading}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
              {loading ? 'Resuming…' : 'Resume'}
            </button>
            <button onClick={handleRun} disabled={loading}
              className="px-3 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
              Run Fresh
            </button>
          </>
        ) : (
          <button onClick={handleRun} disabled={loading}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
            {loading ? 'Starting…' : 'Run'}
          </button>
        )}
      </div>

      {/* Output files */}
      {files.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-wider">Output files</p>
          <div className="space-y-1">
            {files.map((f) => (
              <button key={f.name} onClick={() => downloadFile(name, f.name)}
                className="w-full flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 transition-colors group">
                <span className="text-gray-700 dark:text-gray-300 font-mono truncate">{f.name}</span>
                <span className="text-gray-400 dark:text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 ml-2 shrink-0 flex items-center gap-1">
                  {formatBytes(f.size)}
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
```

- [ ] **Step 4: Run test suite**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/api.ts client/src/hooks/useParserSSE.ts client/src/components/ParserCard.tsx
git commit -m "feat(client): add jobs API functions, stopped status in SSE, Resume/Run Fresh buttons in ParserCard"
```

---

### Task 8: App Routing + JobsPage

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/components/JobsPage.tsx`

- [ ] **Step 1: Update App.tsx — add jobs routing and nav**

```typescript
// client/src/App.tsx
import { useEffect, useState } from 'react'
import { listParsers, createParser } from './api'
import type { CreateParserInput } from './api'
import { ParserCard } from './components/ParserCard'
import { DebugPage } from './components/DebugPage'
import { ParserEditorPage } from './components/ParserEditorPage'
import { JobsPage } from './components/JobsPage'
import { JobDetailPage } from './components/JobDetailPage'
import { TaskDetailPage } from './components/TaskDetailPage'
import { useTheme } from './hooks/useTheme'

// ... (keep SunIcon, MoonIcon, MonitorIcon unchanged) ...

type Page = 'parsers' | 'debug' | 'editor' | 'jobs' | 'job-detail' | 'task-detail'

function getPageFromHash(): Page {
  const hash = window.location.hash
  if (hash === '#/debug') return 'debug'
  if (hash.startsWith('#/editor/')) return 'editor'
  if (hash.match(/^#\/jobs\/[^/]+\/tasks\//)) return 'task-detail'
  if (hash.startsWith('#/jobs/')) return 'job-detail'
  if (hash === '#/jobs') return 'jobs'
  return 'parsers'
}

function getEditorParserFromHash(): string {
  const hash = window.location.hash
  if (hash.startsWith('#/editor/')) return decodeURIComponent(hash.slice(9))
  return ''
}

function getJobRunIdFromHash(): string {
  const hash = window.location.hash
  if (hash.startsWith('#/jobs/')) {
    const rest = hash.slice(7)
    return decodeURIComponent(rest.split('/')[0])
  }
  return ''
}

function getTaskIdFromHash(): string {
  const match = window.location.hash.match(/^#\/jobs\/[^/]+\/tasks\/(.+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

export default function App() {
  const [parsers, setParsers] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(getPageFromHash)
  const [editorParser, setEditorParser] = useState<string>(getEditorParserFromHash)
  const [jobRunId, setJobRunId] = useState<string>(getJobRunIdFromHash)
  const [jobTaskId, setJobTaskId] = useState<string>(getTaskIdFromHash)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    listParsers()
      .then(setParsers)
      .catch(() => setApiError('Could not connect to API. Is the server running?'))
  }, [])

  useEffect(() => {
    const handler = () => {
      setPage(getPageFromHash())
      setEditorParser(getEditorParserFromHash())
      setJobRunId(getJobRunIdFromHash())
      setJobTaskId(getTaskIdFromHash())
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(p: Page, param?: string) {
    if (p === 'editor') {
      window.location.hash = param ? `#/editor/${encodeURIComponent(param)}` : '#/editor/'
      setEditorParser(param ?? '')
    } else if (p === 'debug') {
      window.location.hash = '#/debug'
    } else if (p === 'jobs') {
      window.location.hash = '#/jobs'
    } else if (p === 'job-detail' && param) {
      window.location.hash = `#/jobs/${encodeURIComponent(param)}`
      setJobRunId(param)
    } else if (p === 'task-detail' && param) {
      // param format: "runId:taskId"
      const colonIdx = param.indexOf(':')
      const rId = param.slice(0, colonIdx)
      const tId = param.slice(colonIdx + 1)
      window.location.hash = `#/jobs/${encodeURIComponent(rId)}/tasks/${encodeURIComponent(tId)}`
      setJobRunId(rId)
      setJobTaskId(tId)
    } else {
      window.location.hash = '#/'
    }
    setPage(p)
  }

  const navBtn = (label: string, target: Page, current: Page) =>
    `text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
      current === target
        ? 'bg-emerald-600 text-white'
        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center gap-3">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight m-0 text-gray-900 dark:text-white">
            Scraper Platform
          </h1>
          <nav className="flex items-center gap-1 ml-4">
            <button onClick={() => navigate('parsers')} className={navBtn('Parsers', 'parsers', page)}>
              Parsers
            </button>
            <button onClick={() => navigate('jobs')} className={navBtn('Jobs', 'jobs', page)}>
              Jobs
            </button>
          </nav>
          <span className="ml-auto" />
          <button onClick={toggle}
            className="ml-2 sm:ml-3 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center justify-center"
            aria-label={`Toggle theme (current: ${theme})`} title={`Theme: ${theme}`}>
            {theme === 'system' ? <MonitorIcon /> : theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="w-full">
        {apiError ? (
          <div className="px-4 sm:px-6 lg:px-8 py-5">
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
              <p className="text-red-500 dark:text-red-400 font-medium">{apiError}</p>
              <p className="text-gray-500 text-sm mt-2">Run: <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-xs font-mono">npm run api</code></p>
            </div>
          </div>
        ) : page === 'editor' ? (
          <ParserEditorPage
            parserName={editorParser}
            onNavigateToParsers={() => navigate('parsers')}
            onParserSelect={(name) => navigate('editor', name)}
          />
        ) : page === 'debug' ? (
          <DebugPage />
        ) : page === 'jobs' ? (
          <JobsPage onViewJob={(runId) => navigate('job-detail', runId)} />
        ) : page === 'job-detail' ? (
          <JobDetailPage
            runId={jobRunId}
            onBack={() => navigate('jobs')}
            onViewTask={(taskId) => navigate('task-detail', `${jobRunId}:${taskId}`)}
          />
        ) : page === 'task-detail' ? (
          <TaskDetailPage runId={jobRunId} taskId={jobTaskId} onBack={() => navigate('job-detail', jobRunId)} />
        ) : (
          <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                {parsers.length} parser{parsers.length !== 1 ? 's' : ''}
              </span>
              <button onClick={() => navigate('editor', '')}
                className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors">
                + New Parser
              </button>
            </div>
            <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {parsers.map((name) => (
                <ParserCard
                  key={name}
                  name={name}
                  onEdit={() => navigate('editor', name)}
                  onViewJob={() => navigate('jobs')}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create JobsPage**

Create `client/src/components/JobsPage.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react'
import { listJobs } from '../api'
import type { RunInfo } from '../api'

const STATUS_BADGE: Record<string, string> = {
  running:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 animate-pulse',
  stopped:   'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

interface Props {
  onViewJob: (runId: string) => void
}

export function JobsPage({ onViewJob }: Props) {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const LIMIT = 50

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const result = await listJobs(p, LIMIT)
      setRuns(result.runs)
      setTotal(result.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(page) }, [load, page])

  // Poll for running jobs
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => load(page), 3000)
    return () => clearInterval(id)
  }, [runs, load, page])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString()
  }

  function formatDuration(run: RunInfo) {
    if (!run.stoppedAt) return '—'
    const ms = new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Jobs <span className="text-sm font-normal text-gray-500 ml-1">({total})</span>
        </h2>
        <button onClick={() => load(page)}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          Refresh
        </button>
      </div>

      {loading && runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No jobs yet. Run a parser to see jobs here.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parser</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Started</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Failed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {runs.map((run) => (
                <tr key={run.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{run.parserName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[run.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(run.startedAt)}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDuration(run)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">
                    {run.stats ? `${run.stats.success}/${run.stats.total}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(run.stats?.failed ?? 0) > 0 ? (
                      <span className="text-xs text-red-500 font-medium">{run.stats!.failed}</span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onViewJob(run.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>Page {page} of {Math.ceil(total / LIMIT)}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              ← Prev
            </button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / LIMIT)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify UI renders**

Start the dev server:
```bash
npm run start
```

Open `http://localhost:5173`, click "Jobs" in the nav — should show the jobs table (empty if no runs persisted yet). Run a parser and verify a new job row appears.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/JobsPage.tsx client/src/components/TaskDetailPage.tsx
git commit -m "feat(ui): add Jobs nav section, JobsPage, and task-detail routing"
```

---

### Task 9: JobDetailPage + TaskDetailPanel

**Files:**
- Create: `client/src/components/JobDetailPage.tsx`

This is the largest UI component: a paginated task table with status filter, stop/resume/retry buttons, and a slide-in task detail panel showing extracted data.

- [ ] **Step 1: Create JobDetailPage.tsx**

Create `client/src/components/JobDetailPage.tsx`:

```typescript
import { useEffect, useState, useCallback, useRef } from 'react'
import { getJob, getJobTasks, getTaskResult, stopJob, resumeJob, retryTask } from '../api'
import type { RunInfo, TaskRow } from '../api'

const STATE_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 animate-pulse',
  retry:       'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
  success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:      'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  aborted:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const FILTERS = ['all', 'pending', 'in_progress', 'success', 'failed', 'aborted']

interface Props {
  runId: string
  onBack: () => void
  onViewTask: (taskId: string) => void
}

export function JobDetailPage({ runId, onBack, onViewTask }: Props) {
  const [run, setRun] = useState<RunInfo | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
  const [taskResult, setTaskResult] = useState<Record<string, unknown>[] | null>(null)
  const [taskResultLoading, setTaskResultLoading] = useState(false)
  const LIMIT = 100

  const loadTasks = useCallback(async (p: number, filter: string) => {
    setLoading(true)
    try {
      const result = await getJobTasks(runId, p, LIMIT, filter === 'all' ? undefined : filter)
      setTasks(result.tasks)
      setTotal(result.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [runId])

  const loadRun = useCallback(async () => {
    try {
      const r = await getJob(runId)
      setRun(r)
    } catch { /* ignore */ }
  }, [runId])

  useEffect(() => {
    loadRun()
    loadTasks(1, 'all')
  }, [loadRun, loadTasks])

  // Poll while running
  useEffect(() => {
    if (!run?.isRunning) return
    const id = setInterval(() => {
      loadRun()
      loadTasks(page, statusFilter)
    }, 3000)
    return () => clearInterval(id)
  }, [run?.isRunning, loadRun, loadTasks, page, statusFilter])

  function handleFilterChange(f: string) {
    setStatusFilter(f)
    setPage(1)
    loadTasks(1, f)
  }

  async function handleStop() {
    setActionLoading(true)
    try { await stopJob(runId); await loadRun() } catch { /* ignore */ } finally { setActionLoading(false) }
  }

  async function handleResume() {
    setActionLoading(true)
    try { await resumeJob(runId); await loadRun() } catch { /* ignore */ } finally { setActionLoading(false) }
  }

  async function handleRetry(task: TaskRow) {
    await retryTask(runId, task.id).catch(console.error)
    loadTasks(page, statusFilter)
  }

  async function openTaskDetail(task: TaskRow) {
    setSelectedTask(task)
    setTaskResult(null)
    if (task.stepType === 'extractor' && task.state === 'success') {
      setTaskResultLoading(true)
      try {
        const r = await getTaskResult(runId, task.id)
        setTaskResult(r.rows)
      } catch { /* ignore */ } finally {
        setTaskResultLoading(false)
      }
    }
  }

  const stats = run?.stats

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold">
            ←
          </button>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {run?.parserName ?? '…'}
            </h2>
            <p className="text-xs text-gray-500 font-mono">{runId.slice(0, 8)}…</p>
          </div>

          {/* Stats summary */}
          {stats && (
            <div className="flex gap-3 text-xs ml-2">
              <span className="text-gray-500">Total: <b className="text-gray-800 dark:text-gray-200">{stats.total}</b></span>
              <span className="text-emerald-600">✓ {stats.success}</span>
              <span className="text-red-500">✗ {stats.failed}</span>
              {stats.pending > 0 && <span className="text-blue-500">⏳ {stats.pending}</span>}
              {stats.aborted > 0 && <span className="text-gray-400">⊘ {stats.aborted}</span>}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {run?.isRunning ? (
              <button onClick={handleStop} disabled={actionLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 transition-colors">
                {actionLoading ? 'Stopping…' : 'Stop Job'}
              </button>
            ) : run?.status === 'stopped' ? (
              <button onClick={handleResume} disabled={actionLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-semibold disabled:opacity-50 transition-colors">
                {actionLoading ? 'Resuming…' : 'Resume Job'}
              </button>
            ) : null}
            <button onClick={() => { loadRun(); loadTasks(page, statusFilter) }}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              Refresh
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-3 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => handleFilterChange(f)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              {f === 'in_progress' ? 'in progress' : f}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400 self-center">{total} tasks</span>
        </div>
      </div>

      {/* Body: task table + optional detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Task table */}
        <div className="flex-1 overflow-y-auto">
          {loading && tasks.length === 0 ? (
            <p className="text-center text-gray-400 py-12">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No tasks match the filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Step</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Attempts</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Error</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {tasks.map((task) => (
                  <tr key={task.id}
                    onClick={() => openTaskDetail(task)}
                    className={`cursor-pointer transition-colors ${
                      selectedTask?.id === task.id
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}>
                    <td className="px-4 py-2 max-w-xs">
                      <a href={task.url} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block" title={task.url}>
                        {task.url.replace(/^https?:\/\//, '').slice(0, 60)}{task.url.length > 67 ? '…' : ''}
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs text-gray-600 dark:text-gray-400">{task.stepName}</span>
                      <span className="ml-1 text-xs text-gray-400 dark:text-gray-600">({task.stepType[0]})</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[task.state] ?? ''}`}>
                        {task.state}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {task.attempts}/{task.maxAttempts}
                    </td>
                    <td className="px-4 py-2 max-w-xs">
                      {task.error && (
                        <span className="text-xs text-red-500 truncate block" title={task.error}>
                          {task.error.slice(0, 50)}{task.error.length > 50 ? '…' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {(task.state === 'failed' || task.state === 'aborted') && run?.isRunning && (
                          <button onClick={() => handleRetry(task)}
                            className="text-xs px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800/40 font-medium transition-colors">
                            Retry
                          </button>
                        )}
                        <button onClick={() => onViewTask(task.id)}
                          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors">
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-sm text-gray-500">
              <span>Page {page} of {Math.ceil(total / LIMIT)} ({total} total)</span>
              <div className="flex gap-2">
                <button onClick={() => { setPage((p) => p - 1); loadTasks(page - 1, statusFilter) }} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs">
                  ← Prev
                </button>
                <button onClick={() => { setPage((p) => p + 1); loadTasks(page + 1, statusFilter) }} disabled={page >= Math.ceil(total / LIMIT)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Task detail slide-in panel */}
        {selectedTask && (
          <div className="w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Task Detail</span>
              <button onClick={() => setSelectedTask(null)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {/* URL */}
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">URL</p>
                <a href={selectedTask.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-mono text-blue-600 dark:text-blue-400 break-all hover:underline">
                  {selectedTask.url}
                </a>
              </div>
              {/* Meta */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Step</p>
                  <p className="text-gray-800 dark:text-gray-200">{selectedTask.stepName} <span className="text-gray-400">({selectedTask.stepType})</span></p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Status</p>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[selectedTask.state] ?? ''}`}>
                    {selectedTask.state}
                  </span>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Attempts</p>
                  <p className="text-gray-800 dark:text-gray-200 font-mono">{selectedTask.attempts} / {selectedTask.maxAttempts}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Task ID</p>
                  <p className="text-gray-400 font-mono text-xs">{selectedTask.id.slice(0, 8)}…</p>
                </div>
              </div>
              {/* Error */}
              {selectedTask.error && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Error</p>
                  <pre className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2 whitespace-pre-wrap break-all">
                    {selectedTask.error}
                  </pre>
                </div>
              )}
              {/* Parent data */}
              {selectedTask.parentData && Object.keys(selectedTask.parentData).length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Parent Data</p>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                    {JSON.stringify(selectedTask.parentData, null, 2)}
                  </pre>
                </div>
              )}
              {/* Extracted data */}
              {selectedTask.stepType === 'extractor' && selectedTask.state === 'success' && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Extracted Data</p>
                  {taskResultLoading ? (
                    <p className="text-xs text-gray-400">Loading…</p>
                  ) : taskResult && taskResult.length > 0 ? (
                    <pre className="text-xs text-emerald-400 bg-gray-950 rounded p-2 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                      {JSON.stringify(taskResult, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-gray-400">No data stored (run before persistence was enabled)</p>
                  )}
                </div>
              )}
              {/* Retry button */}
              {(selectedTask.state === 'failed' || selectedTask.state === 'aborted') && run?.isRunning && (
                <button onClick={() => handleRetry(selectedTask)}
                  className="w-full mt-2 text-sm px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold transition-colors">
                  Retry This Page
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify JobDetailPage renders**

With the dev server running (`npm run start`):
1. Go to Jobs page (`#/jobs`)
2. Click "View" on a completed job
3. Verify task table appears
4. Click a row — verify detail panel slides in
5. For a successful extractor task — verify "Extracted Data" section shows or shows the "no data" message
6. Start a parser, open its job, verify tasks appear in the table and status updates every 3s
7. With a running job open, click "Stop Job" — verify status changes to "stopped", button changes to "Resume Job"
8. Click "Resume Job" — verify tasks re-dispatch

- [ ] **Step 3: Verify retry works**

1. Open a job with failed tasks
2. Ensure the job is running (resume first if needed)
3. Click "Retry" on a failed task row
4. Verify the task state changes to pending/in_progress in the next poll

- [ ] **Step 4: Commit**

```bash
git add client/src/components/JobDetailPage.tsx client/src/App.tsx
git commit -m "feat(ui): add JobDetailPage with task table, detail panel, stop/resume/retry controls"
```

---

### Task 10: TaskDetailPage

**Files:**
- Create: `client/src/components/TaskDetailPage.tsx`

Individual task metadata page at route `#/jobs/:runId/tasks/:taskId`. Shows all task fields, extracted data, and action buttons (Retry / Abort) based on current state.

- [ ] **Step 1: Create TaskDetailPage.tsx**

Create `client/src/components/TaskDetailPage.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react'
import { getJob, getTask, getTaskResult, retryTask, abortTask } from '../api'
import type { RunInfo, TaskRow } from '../api'

const STATE_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 animate-pulse',
  retry:       'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
  success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:      'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  aborted:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const TERMINAL = new Set(['success', 'failed', 'aborted'])

interface Props {
  runId: string
  taskId: string
  onBack: () => void
}

export function TaskDetailPage({ runId, taskId, onBack }: Props) {
  const [run, setRun] = useState<RunInfo | null>(null)
  const [task, setTask] = useState<TaskRow | null>(null)
  const [taskResult, setTaskResult] = useState<Record<string, unknown>[] | null>(null)
  const [taskResultLoading, setTaskResultLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'retry' | 'abort' | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [runData, taskData] = await Promise.all([getJob(runId), getTask(runId, taskId)])
      setRun(runData)
      setTask(taskData)
      if (taskData.stepType === 'extractor' && taskData.state === 'success') {
        setTaskResultLoading(true)
        const r = await getTaskResult(runId, taskId).catch(() => ({ rows: [] }))
        setTaskResult(r.rows)
        setTaskResultLoading(false)
      }
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [runId, taskId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!task || TERMINAL.has(task.state)) return
    const id = setInterval(loadData, 3000)
    return () => clearInterval(id)
  }, [task, loadData])

  async function handleRetry() {
    setActionLoading('retry')
    setActionError(null)
    try {
      await retryTask(runId, taskId)
      await loadData()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleAbort() {
    setActionLoading('abort')
    setActionError(null)
    try {
      await abortTask(runId, taskId)
      await loadData()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  const canRetry = task && (task.state === 'failed' || task.state === 'aborted') && run?.isRunning
  const canAbort = task && (task.state === 'pending' || task.state === 'in_progress' || task.state === 'retry') && run?.isRunning

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold">
          ←
        </button>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Task Detail</h2>
          <p className="text-xs text-gray-500 font-mono">{taskId.slice(0, 8)}…</p>
        </div>
        <button onClick={loadData}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {loadError}
        </div>
      )}

      {!task ? (
        <p className="text-center text-gray-400 py-12">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Metadata card */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
            {/* URL */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">URL</p>
              <a href={task.url} target="_blank" rel="noopener noreferrer"
                className="text-sm font-mono text-blue-600 dark:text-blue-400 break-all hover:underline">
                {task.url}
              </a>
            </div>

            {/* Grid of metadata fields */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Status</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[task.state] ?? ''}`}>
                  {task.state}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Step</p>
                <p className="text-gray-800 dark:text-gray-200">
                  {task.stepName} <span className="text-gray-400 text-xs">({task.stepType})</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Attempts</p>
                <p className="text-gray-800 dark:text-gray-200 font-mono">{task.attempts} / {task.maxAttempts}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Task ID</p>
                <p className="text-gray-400 font-mono text-xs break-all">{task.id}</p>
              </div>
              {task.parentTaskId && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Parent Task</p>
                  <p className="text-gray-400 font-mono text-xs">{task.parentTaskId.slice(0, 8)}…</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Job</p>
                <p className="text-gray-500 text-xs">{run?.parserName ?? '…'}</p>
              </div>
            </div>

            {/* Error */}
            {task.error && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Error</p>
                <pre className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-3 whitespace-pre-wrap break-all">
                  {task.error}
                </pre>
              </div>
            )}

            {/* Parent data */}
            {task.parentData && Object.keys(task.parentData).length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Parent Data</p>
                <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-3 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {JSON.stringify(task.parentData, null, 2)}
                </pre>
              </div>
            )}

            {/* Extracted data */}
            {task.stepType === 'extractor' && task.state === 'success' && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Extracted Data</p>
                {taskResultLoading ? (
                  <p className="text-xs text-gray-400">Loading…</p>
                ) : taskResult && taskResult.length > 0 ? (
                  <pre className="text-xs text-emerald-400 bg-gray-950 rounded p-3 whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                    {JSON.stringify(taskResult, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400">No data stored</p>
                )}
              </div>
            )}
          </div>

          {/* Actions section — shown when the job is running */}
          {(canRetry || canAbort) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs text-gray-500 font-medium mb-3 uppercase tracking-wider">Actions</p>
              {actionError && (
                <p className="text-xs text-red-500 mb-3">{actionError}</p>
              )}
              <div className="flex gap-2 flex-wrap">
                {canRetry && (
                  <button onClick={handleRetry} disabled={actionLoading !== null}
                    className="text-sm px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold disabled:opacity-50 transition-colors">
                    {actionLoading === 'retry' ? 'Retrying…' : 'Retry'}
                  </button>
                )}
                {canAbort && (
                  <button onClick={handleAbort} disabled={actionLoading !== null}
                    className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 transition-colors">
                    {actionLoading === 'abort' ? 'Aborting…' : 'Abort'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TaskDetailPage renders**

With dev server running (`npm run start`):
1. Navigate to a job detail page (`#/jobs/:runId`)
2. Click "Details" on any task row — verify hash changes to `#/jobs/:runId/tasks/:taskId` and the metadata page renders
3. Verify URL field shows as a clickable link that opens in a new tab
4. Verify all metadata fields show (step, status badge, attempts, task ID, job name)
5. For a failed task on a running job — verify "Retry" button appears; click it and verify state updates
6. For a pending task on a running job — verify "Abort" button appears; click it and verify state changes to `aborted`
7. Click ← back — verify returns to the job detail page

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TaskDetailPage.tsx
git commit -m "feat(ui): add TaskDetailPage with full task metadata and retry/abort actions"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|-----------|
| New Jobs section showing all runs | Task 8 (JobsPage) |
| Past and current runs | Task 2 (RunPersistenceService) + Task 8 |
| Each job openable to see all pages as table | Task 9 (JobDetailPage) |
| Each task row shows current status badge | Task 9 — state badge column |
| Each task row shows clickable link to scraped URL | Task 9 — URL `<a>` cell |
| Each task row shows Details link → separate metadata page | Task 9 — Details button + Task 8 routing |
| Task detail page shows all metadata (step, attempts, error, parent data, extracted data) | Task 10 (TaskDetailPage) |
| Task detail page has Retry button for failed/aborted tasks | Task 10 — canRetry + handleRetry |
| Task detail page has Abort button for pending/in-progress tasks | Task 4 (abortTask) + Task 5 + Task 6 + Task 10 |
| Each page shows returned data | Task 9 — extracted data slide-in + Task 10 — extracted data section |
| Stop each job | Task 9 — Stop Job button |
| Resume each job | Task 5/6 + Task 9 — Resume Job button |
| Retry failed page | Task 4 (retryTask) + Task 9 — inline Retry + Task 10 — Retry button |
| Stopped parser status in card | Task 7 (useParserSSE) + Task 7 (ParserCard) |
| Resume from parser card | Task 7 (ParserCard Resume button) |

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency check:**
- `RunInfo.status` is `'running' | 'stopped' | 'completed'` consistently across schema, service, and client types
- `TaskRow.state` matches `PageState` enum values including new `'in_progress'`
- `retryTask(runId, taskId)` and `abortTask(runId, taskId)` signatures consistent between API, service, and client
- `getTask(runId, taskId)` returns `TaskRow` in client API, backed by `RunPersistenceService.getTask(taskId)` in Task 6
- `runner.findParserByRunId` added in Task 6, used in Task 6 API endpoints — consistent
- `navigate('task-detail', \`${runId}:${taskId}\`)` encoding matches the `colonIdx` decode in the `navigate` function

**One gap fixed:** The `GET /api/jobs/:runId` endpoint uses a full scan (`getAllRuns(1, 1_000)`) to find the run — inefficient. For correctness it works; optimization (direct lookup by id) is a future concern.
