# DB Pool Sizing + Write Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop saturating Postgres at scale. Size the pg Pool explicitly (default `max: 50`) and add a `WriteBuffer` that batches `upsertTask` and `saveTaskResult` calls into one bulk upsert every 100 ms (or 500 rows, whichever comes first). Callers of `RunPersistenceService.upsertTask` / `saveTaskResult` do not change.

**Architecture:** Replace the no-config `new Pool({ connectionString })` with an env-configurable pool builder. Wrap `RunPersistenceService` writes in a `TaskWriteBuffer` that coalesces by `(runId, taskId)` keeping the latest task snapshot, and by `taskId` for results. Flush is triggered by a 100 ms debounce timer, a 500-row size cap, and an explicit `flush()` call during run completion / process shutdown. Reads bypass the buffer but optionally `peek()` it for fresh state.

**Tech Stack:** TypeScript, Drizzle ORM, `pg` Pool, Vitest.

---

## File Structure

**New files:**
- `src/infrastructure/db/TaskWriteBuffer.ts` — batched coalescing buffer for task upserts and results
- `src/__tests__/infrastructure/db/TaskWriteBuffer.test.ts` — Vitest tests with fake timers and a mock persistence layer

**Modified files:**
- `src/infrastructure/db/client.ts` — explicit pool config (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`), graceful shutdown helper
- `src/infrastructure/db/RunPersistenceService.ts` — inject and use a `TaskWriteBuffer`; expose `flushPendingWrites()`; route `upsertTask` / `saveTaskResult` through the buffer
- `src/application/services/ParserRunnerService.ts` — call `runPersistence.flushPendingWrites()` before `markRunCompleted` / `markRunStopped`
- `src/api/server.ts` — wire SIGTERM/SIGINT to `runPersistence.flushPendingWrites()` and `pool.end()`
- `src/cli/index.ts` — wire process exit to `runPersistence.flushPendingWrites()` and `closePool()`

**Note on `saveTaskHtml`:** This method writes to `taskResults.html` column via a separate `onConflictDoUpdate` that only touches `html`. It is intentionally NOT routed through `TaskWriteBuffer` — it fires at most once per failed task, and its `onConflictDoUpdate({ set: { html: excluded.html } })` is safely concurrent with a buffered `saveTaskResult` call that only updates `rows`. No write-order race exists.

---

### Task 1: Size the pg Pool

**Files:**
- Modify: `src/infrastructure/db/client.ts`

- [ ] **Step 1: Replace the file with a configurable builder**

```ts
// src/infrastructure/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import * as schema from './schema.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: intFromEnv('DB_POOL_MAX', 50),
  min: intFromEnv('DB_POOL_MIN', 2),
  idleTimeoutMillis: intFromEnv('DB_POOL_IDLE_MS', 30_000),
  connectionTimeoutMillis: intFromEnv('DB_POOL_CONNECT_TIMEOUT_MS', 10_000),
  // Recycle a connection after this many uses (helps avoid leaks)
  // pg's Pool itself doesn't natively support maxUses, so we leave it off.
}

const pool = new Pool(poolConfig)
pool.on('error', (err) => console.error('DB pool error:', err))

export const db = drizzle(pool, { schema })
export { pool }

/** Closes the pool gracefully. Idempotent. */
let ended = false
export async function closePool(): Promise<void> {
  if (ended) return
  ended = true
  await pool.end()
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-check defaults**

```bash
node -e "import('./dist/infrastructure/db/client.js').then(({ pool }) => { console.log({ max: pool.options.max, min: pool.options.min }); pool.end(); })"
```

(After `npm run build`.) Expected: `{ max: 50, min: 2 }`.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/db/client.ts
git commit -m "feat(db): configurable pg pool with explicit max=50 default"
```

---

### Task 2: Implement `TaskWriteBuffer`

**Files:**
- Create: `src/infrastructure/db/TaskWriteBuffer.ts`

- [ ] **Step 1: Write the buffer**

```ts
// src/infrastructure/db/TaskWriteBuffer.ts
import type { PageTask } from '../../domain/entities/PageTask.js'

export interface TaskSink {
  /** Bulk-write a batch of task upserts, grouped by runId. */
  flushTaskBatch(batch: { runId: string; tasks: PageTask[] }[]): Promise<void>
  /** Bulk-write task result rows. */
  flushResultBatch(batch: { taskId: string; rows: Record<string, unknown>[] }[]): Promise<void>
}

export interface TaskWriteBufferOptions {
  flushIntervalMs?: number
  maxBatchSize?: number
}

/**
 * Coalescing buffer for task upserts and result writes.
 *
 * - Task upserts are keyed by `taskId` so only the latest state per task is sent.
 * - Result writes are keyed by `taskId` (full overwrite, matches existing onConflictDoUpdate).
 * - Flush is triggered by either the debounce timer (default 100 ms) or
 *   when the pending count reaches `maxBatchSize` (default 500), or via
 *   explicit `flush()`.
 */
export class TaskWriteBuffer {
  private tasks = new Map<string, { runId: string; task: PageTask }>()
  private results = new Map<string, Record<string, unknown>[]>()
  private timer: NodeJS.Timeout | null = null
  private flushing: Promise<void> | null = null
  private readonly intervalMs: number
  private readonly maxBatchSize: number

  constructor(
    private readonly sink: TaskSink,
    opts: TaskWriteBufferOptions = {},
  ) {
    this.intervalMs = opts.flushIntervalMs ?? 100
    this.maxBatchSize = opts.maxBatchSize ?? 500
  }

  enqueueTask(runId: string, task: PageTask): void {
    this.tasks.set(task.id, { runId, task })
    this.maybeScheduleFlush()
  }

  enqueueResult(taskId: string, rows: Record<string, unknown>[]): void {
    this.results.set(taskId, rows)
    this.maybeScheduleFlush()
  }

  /** Snapshot of latest task state in the buffer (read-through helper). */
  peekTask(taskId: string): PageTask | undefined {
    return this.tasks.get(taskId)?.task
  }

  /** Wait for any in-flight flush, then flush everything currently pending. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing
    this.clearTimer()
    if (this.tasks.size === 0 && this.results.size === 0) return
    const taskEntries = [...this.tasks.values()]
    const resultEntries = [...this.results.entries()].map(([taskId, rows]) => ({ taskId, rows }))
    this.tasks.clear()
    this.results.clear()
    this.flushing = this._doFlush(taskEntries, resultEntries)
    try {
      await this.flushing
    } finally {
      this.flushing = null
    }
  }

  private async _doFlush(
    taskEntries: { runId: string; task: PageTask }[],
    resultEntries: { taskId: string; rows: Record<string, unknown>[] }[],
  ): Promise<void> {
    // Tasks MUST flush before results in every flush cycle to satisfy the
    // taskResults.taskId → runTasks.id FK constraint. Never reorder these two awaits.
    const byRun = new Map<string, PageTask[]>()
    for (const { runId, task } of taskEntries) {
      const list = byRun.get(runId) ?? []
      list.push(task)
      byRun.set(runId, list)
    }
    const taskBatch = [...byRun.entries()].map(([runId, tasks]) => ({ runId, tasks }))
    if (taskBatch.length > 0) {
      await this.sink.flushTaskBatch(taskBatch)
    }
    if (resultEntries.length > 0) {
      await this.sink.flushResultBatch(resultEntries)
    }
  }

  private maybeScheduleFlush(): void {
    if (this.tasks.size + this.results.size >= this.maxBatchSize) {
      // Fire immediately; do not await — caller doesn't block.
      void this.flush()
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.intervalMs)
    // Don't keep the event loop alive just for the buffer.
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/db/TaskWriteBuffer.ts
git commit -m "feat(db): add TaskWriteBuffer for coalesced batched writes"
```

---

### Task 3: Tests for `TaskWriteBuffer`

**Files:**
- Create: `src/tests/TaskWriteBuffer.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/tests/TaskWriteBuffer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskWriteBuffer, type TaskSink } from '../infrastructure/db/TaskWriteBuffer.js'
import type { PageTask } from '../domain/entities/PageTask.js'
import { PageState } from '../domain/value-objects/PageState.js'
import { stepName } from '../domain/value-objects/StepName.js'

function task(id: string, runState: PageState = PageState.Success): PageTask {
  return {
    id,
    url: `https://x/${id}`,
    stepName: stepName('s'),
    stepType: 'extractor',
    state: runState,
    attempts: 1,
    maxAttempts: 3,
  } as PageTask
}

function mockSink(): TaskSink & {
  flushTaskBatch: ReturnType<typeof vi.fn>
  flushResultBatch: ReturnType<typeof vi.fn>
} {
  return {
    flushTaskBatch: vi.fn(async () => {}),
    flushResultBatch: vi.fn(async () => {}),
  }
}

describe('TaskWriteBuffer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches multiple enqueues into one flush after debounce', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r1', task('b'))
    buf.enqueueTask('r1', task('c'))
    expect(sink.flushTaskBatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushTaskBatch.mock.calls[0][0]).toEqual([
      { runId: 'r1', tasks: [task('a'), task('b'), task('c')] },
    ])
  })

  it('coalesces multiple enqueues of the same taskId to the latest snapshot', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a', PageState.InProgress))
    buf.enqueueTask('r1', task('a', PageState.Success))
    await vi.advanceTimersByTimeAsync(100)
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    const [batch] = sink.flushTaskBatch.mock.calls[0]
    expect(batch[0].tasks).toHaveLength(1)
    expect(batch[0].tasks[0].state).toBe(PageState.Success)
  })

  it('groups by runId in a single flush', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r2', task('b'))
    await vi.advanceTimersByTimeAsync(100)
    const [batch] = sink.flushTaskBatch.mock.calls[0]
    expect(batch).toHaveLength(2)
    expect(new Set(batch.map((b: { runId: string }) => b.runId))).toEqual(new Set(['r1', 'r2']))
  })

  it('flushes immediately once maxBatchSize is reached', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 3 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r1', task('b'))
    buf.enqueueTask('r1', task('c'))
    // size-triggered flush is microtask-scheduled via void this.flush()
    await Promise.resolve()
    await Promise.resolve()
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
  })

  it('peekTask returns latest pending snapshot', () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    buf.enqueueTask('r1', task('a', PageState.InProgress))
    expect(buf.peekTask('a')?.state).toBe(PageState.InProgress)
    buf.enqueueTask('r1', task('a', PageState.Failed))
    expect(buf.peekTask('a')?.state).toBe(PageState.Failed)
  })

  it('flush() drains both tasks and results', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    buf.enqueueTask('r1', task('a'))
    buf.enqueueResult('a', [{ x: 1 }])
    await buf.flush()
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushResultBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushResultBatch.mock.calls[0][0]).toEqual([{ taskId: 'a', rows: [{ x: 1 }] }])
  })

  it('flush() is a no-op when the buffer is empty', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    await buf.flush()
    expect(sink.flushTaskBatch).not.toHaveBeenCalled()
    expect(sink.flushResultBatch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/tests/TaskWriteBuffer.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/TaskWriteBuffer.test.ts
git commit -m "test(db): cover TaskWriteBuffer batching, coalescing, and flush"
```

---

### Task 4: Wire the buffer into `RunPersistenceService`

**Files:**
- Modify: `src/infrastructure/db/RunPersistenceService.ts`

- [ ] **Step 1: Add the buffer member and constructor wiring**

`RunPersistenceService` extends `BasePersistenceService<...>`. We need a constructor that wires up the buffer without breaking the base class. Inspect the existing constructor signature in your tree and add the buffer alongside it; if `BasePersistenceService` has a default-arg constructor, the cleanest path is:

```ts
import { TaskWriteBuffer, type TaskSink } from './TaskWriteBuffer.js'
// ...inside class RunPersistenceService:

  private readonly writeBuffer: TaskWriteBuffer = new TaskWriteBuffer(this.makeSink())

  private makeSink(): TaskSink {
    return {
      flushTaskBatch: async (batch) => {
        for (const { runId, tasks } of batch) {
          await this._bulkUpsertTasks(runId, tasks)
        }
      },
      flushResultBatch: async (batch) => {
        await this._bulkSaveResults(batch)
      },
    }
  }
```

(Field initializers using `this.makeSink()` are valid because `_bulkUpsertTasks` already exists on the class and `makeSink` is a private method. If your TypeScript config disallows `this` in field initializers, hoist this into the constructor instead.)

- [ ] **Step 2: Route `upsertTask` and `saveTaskResult` through the buffer**

Replace the bodies of these two methods. The existing `_bulkUpsertTasks` private helper handles the actual SQL; we add a parallel `_bulkSaveResults` for results.

```ts
  async upsertTask(runId: string, task: PageTask): Promise<void> {
    this.writeBuffer.enqueueTask(runId, task)
  }

  async saveTaskResult(taskId: string, rows: Record<string, unknown>[]): Promise<void> {
    this.writeBuffer.enqueueResult(taskId, rows)
  }
```

- [ ] **Step 3: Add `_bulkSaveResults`**

Drop this private helper into the class, modeled on the existing `_bulkUpsertTasks`:

```ts
  private async _bulkSaveResults(batch: { taskId: string; rows: Record<string, unknown>[] }[]): Promise<void> {
    if (batch.length === 0) return
    const BATCH = 500
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < batch.length; i += BATCH) {
        const chunk = batch.slice(i, i + BATCH)
        await tx.insert(taskResults).values(chunk.map((b) => ({ taskId: b.taskId, rows: b.rows })))
          .onConflictDoUpdate({ target: taskResults.taskId, set: { rows: sql`excluded.rows` } })
      }
    })
  }
```

- [ ] **Step 4: Expose a `flushPendingWrites()` method and use it in lifecycle calls**

Add:

```ts
  async flushPendingWrites(): Promise<void> {
    await this.writeBuffer.flush()
  }
```

Then update `markRunStopped` and `markRunCompleted` to drain the buffer first so the bulk upsert they already perform is the *last* write:

```ts
  async markRunStopped(runId: string, tasks: PageTask[]): Promise<void> {
    await this.flushPendingWrites()
    await this._bulkUpsertTasks(runId, tasks)
    await this.update(runId, { status: 'stopped', stoppedAt: new Date() })
  }

  async markRunCompleted(runId: string, tasks: PageTask[]): Promise<void> {
    await this.flushPendingWrites()
    await this._bulkUpsertTasks(runId, tasks)
    const hasFailed = tasks.some((t) => t.state === 'failed')
    const finalStatus = hasFailed ? 'failed' : 'completed'
    console.log(`[RunPersistenceService] markRunCompleted runId=${runId} tasks=${tasks.length} hasFailed=${hasFailed} → ${finalStatus}`)
    await this.update(runId, { status: finalStatus, stoppedAt: new Date() })
  }
```

- [ ] **Step 5: Also drain before `getTask` / `getTaskResult` read paths that the API touches mid-run**

The simplest safe path is to also peek the buffer for fresh task state inside `getTask`:

```ts
  async getTask(runId: string, taskId: string): Promise<StoredTask | null> {
    const buffered = this.writeBuffer.peekTask(taskId)
    if (buffered) {
      return {
        id: buffered.id,
        runId,
        url: buffered.url,
        stepName: String(buffered.stepName),
        stepType: buffered.stepType,
        state: buffered.state,
        attempts: buffered.attempts,
        maxAttempts: buffered.maxAttempts,
        error: buffered.error ?? null,
        parentTaskId: buffered.parentTaskId ?? null,
        parent_data: buffered.parent_data ?? null,
      }
    }
    const [row] = await this.db.select().from(runTasks)
      .where(and(eq(runTasks.id, taskId), eq(runTasks.runId, runId)))
    return row ? (row as StoredTask) : null
  }
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/db/RunPersistenceService.ts
git commit -m "feat(db): route upsertTask/saveTaskResult through TaskWriteBuffer"
```

---

### Task 5: Flush on run lifecycle and process shutdown

**Files:**
- Modify: `src/application/services/ParserRunnerService.ts`
- Modify: `src/api/server.ts`

- [ ] **Step 1: Flush in `ParserRunnerService` before completion / stop**

The existing `onComplete` and `stop()` already call `markRunCompleted` / `markRunStopped`, which now flush internally. No change required *here* unless you want belt-and-braces; if so, add an explicit `await this.runPersistence.flushPendingWrites()` at the top of `stop()` and at the start of `onComplete`. This is recommended:

```ts
  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) {
      const runId = orchestrator.runId
      await orchestrator.stop()
      await this.runPersistence.flushPendingWrites().catch(console.error)
      await this.runPersistence.markRunStopped(runId, orchestrator.getAllTasks()).catch(console.error)
      this.activeRuns.delete(parserName)
      this.emit('stopped', parserName)
      return
    }
    // ... (rest unchanged)
  }
```

- [ ] **Step 2: Hook process signals in the API server**

Open `src/api/server.ts`. Find the existing `shutdown` function (currently handles `runner.stop(name)` for each active run) and extend it. The **required ordering** is:

1. Stop all active runs (`runner.stop(name)` — this calls `markRunStopped` which itself flushes first)
2. `await runPersistence.flushPendingWrites()` — drain any residual buffer entries
3. `await closePool()` — close pool LAST, after all writes are done

```ts
import { closePool } from '../infrastructure/db/client.js'

// Inside the existing shutdown function, after stopping all active runs:
try {
  await runPersistence.flushPendingWrites()
} catch (err) {
  console.error('[server] flush failed:', err)
}
try {
  await closePool()
} catch (err) {
  console.error('[server] pool close failed:', err)
}
```

If `server.ts` already has SIGTERM/SIGINT handlers, fold into them. Do NOT close the pool before flushing.

- [ ] **Step 3: Hook process exit in the CLI**

Open `src/cli/index.ts`. Add a SIGINT handler so CLI runs also flush before exit:

```ts
import { closePool } from '../infrastructure/db/client.js'
import { runPersistence } from '../infrastructure/db/RunPersistenceService.js' // or wherever it's instantiated

process.on('SIGINT', async () => {
  console.log('[cli] SIGINT received, flushing writes…')
  try { await runPersistence.flushPendingWrites() } catch {}
  try { await closePool() } catch {}
  process.exit(0)
})
```

Adapt variable names to match the actual `RunPersistenceService` instance in scope.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/application/services/ParserRunnerService.ts src/api/server.ts src/cli/index.ts
git commit -m "feat(api,cli): flush write buffer and close pool on shutdown"
```

---

### Task 6: Integration sanity test

**Files:**
- Create: `src/__tests__/integration/persistence-batching.test.ts` (only if a Postgres test instance is available; otherwise skip)

- [ ] **Step 1: Decide on integration coverage**

If `DATABASE_URL` points to a disposable test DB during `npm run test`, write a thin integration test that fires ~200 `upsertTask` calls and asserts that the underlying SQL was invoked far fewer times. Pseudocode:

```ts
import { describe, it, expect, vi } from 'vitest'
// Mock the db query function or count Pool.query calls via a spy on pool.query.
// Assert that 200 upsertTask calls flush in <= 5 batches.
```

If no test DB is available, skip this task and add a manual smoke step instead (Step 2).

- [ ] **Step 2: Manual smoke test**

```bash
npm run db:migrate
npm run start
```

In the UI, start a parser that produces ~500 tasks. While it runs, in another shell:

```bash
psql "$DATABASE_URL" -c "SELECT now(), count(*) FROM run_tasks WHERE run_id = '<run-id>';" 
```

Run that query repeatedly. Expected: the count climbs in 100 ms-cadence steps of 50-500, not one row at a time.

Also check `pg_stat_activity`:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name <> '';"
```

Expected: well under 50 connections (typically 5-20) under steady load.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(db): integration smoke notes for batched persistence"
```

---

### Task 7: Document in design-log

**Files:**
- Create: `design-log/NNN-db-pool-and-write-batching.md`
- Modify: `design-log/index.md`

- [ ] **Step 1: Write the entry**

Sections: Background, Problem, Design, Q&A, Trade-offs, Implementation Results. Cover:
- Pool default of 10 saturating under 100 parsers.
- The buffer's coalescing key (`taskId`) and why repeated state transitions for the same task collapse to the latest snapshot — and the implications (intermediate `in_progress` rows may never reach DB if the task finishes within a 100 ms window). Note that this is acceptable because terminal states win and the orchestrator's in-memory `ParserRun` remains the source of truth for the live run.
- Why `getTask` peeks the buffer (avoids stale-read after a state change that's still queued).
- Trade-offs: durability window of ~100 ms on crash; mitigated by graceful shutdown hook.

- [ ] **Step 2: Update index**

Add a row to `design-log/index.md`.

- [ ] **Step 3: Commit**

```bash
git add design-log/
git commit -m "docs(design-log): record DB pool sizing and write batching"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test -- --run
```

Expected: green, including the new `TaskWriteBuffer` suite.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Verify env knobs**

```bash
DB_POOL_MAX=80 DB_POOL_MIN=5 npm run api:dev
```

In another shell:

```bash
psql "$DATABASE_URL" -c "SELECT max_conn, used FROM (SELECT setting::int AS max_conn FROM pg_settings WHERE name='max_connections') a, (SELECT count(*) AS used FROM pg_stat_activity) b;"
```

Expected: `used` stays below `DB_POOL_MAX` even under sustained load.
