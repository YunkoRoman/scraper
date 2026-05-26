# Orchestrator Persistence Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move task state out of `ParserRun`'s in-memory `Map` into PostgreSQL. `ParserOrchestrator` reads and writes task state via a new `TaskStateStore` that reads from DB (with a thin write-through cache) instead of the in-memory `ParserRun`. The REST API and SSE event shapes stay unchanged.

**Architecture:** Introduce `TaskStateStore` — an interface owned by the orchestrator with two implementations: `InMemoryTaskStateStore` (the existing behavior, for tests and offline runs) and `DbTaskStateStore` (DB-backed with an LRU write-through cache layered over `RunPersistenceService` + `TaskWriteBuffer`). The orchestrator's state-mutation calls (`markInProgress`, `markPending`, etc.) and computed predicates (`isComplete`, `getStats`) become async and route through the store. Resume code paths shrink: instead of hydrating an in-memory map from DB, the orchestrator simply opens a `DbTaskStateStore` rooted at an existing `runId`. The transient `dispatchQueue` stays in memory.

**Tech Stack:** TypeScript, PostgreSQL via Drizzle, Vitest.

> **Sequencing note:** This plan depends on the `TaskWriteBuffer` from the *DB Pool Sizing + Write Batching* plan. If that plan has not landed yet, complete it (or at least Task 2 of it) first, then return here.

---

## File Structure

**New files:**
- `src/domain/services/TaskStateStore.ts` — interface + in-memory implementation extracted from `ParserRun`
- `src/infrastructure/persistence/DbTaskStateStore.ts` — DB-backed implementation with write-through cache and incremental stats counter
- `src/tests/InMemoryTaskStateStore.test.ts`
- `src/tests/DbTaskStateStore.test.ts`

**Modified files:**
- `src/domain/entities/ParserRun.ts` — slim down to identity + start time; delegate task ops to a `TaskStateStore`
- `src/application/orchestrator/ParserOrchestrator.ts` — accept a `TaskStateStore`, make state mutations async, gate `dispatchTask` on async store
- `src/application/use-cases/RunParser.ts` — inject `RunPersistenceService`, build `DbTaskStateStore` for normal runs
- `src/application/services/ParserRunnerService.ts` — drop snapshot-rehydration, remove `upsertTask` from `_wireTaskEvents`, pass `runId` to orchestrator
- `src/api/server.ts` — update `RunParser` construction to pass `runPersistence`
- `src/api/routes/jobs.ts` — `retryTask` / `abortTask` route handlers must be `async` with `await`
- `src/cli/index.ts` — update `RunParser` construction to pass `runPersistence`

---

### Task 1: Define `TaskStateStore` and extract `InMemoryTaskStateStore`

**Files:**
- Create: `src/domain/services/TaskStateStore.ts`

- [ ] **Step 1: Write the interface and in-memory implementation**

```ts
// src/domain/services/TaskStateStore.ts
import type { PageTask } from '../entities/PageTask.js'
import type { StepType } from '../entities/Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import type { RunStats } from '../entities/ParserRun.js'
import { PageState, isTerminal } from '../value-objects/PageState.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { createPageTask } from '../entities/PageTask.js'

export interface TaskStateStore {
  addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig?: RetryConfig,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask>

  restoreTask(task: PageTask): Promise<void>
  getTask(id: string): Promise<PageTask | undefined>

  markInProgress(id: string): Promise<PageTask>
  markPending(id: string): Promise<PageTask>
  markRetry(id: string, error: string): Promise<PageTask>
  markSuccess(id: string): Promise<PageTask>
  markFailed(id: string, error: string): Promise<PageTask>
  markAborted(id: string): Promise<PageTask>

  allTasks(): Promise<PageTask[]>
  isComplete(): Promise<boolean>
  getStats(): Promise<RunStats>
}

export class InMemoryTaskStateStore implements TaskStateStore {
  private tasks = new Map<string, PageTask>()

  constructor(readonly runId: string) {}

  async addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask> {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parent_data)
    this.tasks.set(task.id, task)
    return task
  }

  async restoreTask(task: PageTask): Promise<void> {
    this.tasks.set(task.id, task)
  }

  async getTask(id: string): Promise<PageTask | undefined> {
    return this.tasks.get(id)
  }

  async markInProgress(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.InProgress, attempts: t.attempts + 1 }))
  }
  async markPending(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Pending, error: undefined }))
  }
  async markRetry(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Retry, error }))
  }
  async markSuccess(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Success, error: undefined }))
  }
  async markFailed(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Failed, error }))
  }
  async markAborted(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Aborted }))
  }

  async allTasks(): Promise<PageTask[]> {
    return [...this.tasks.values()]
  }

  async isComplete(): Promise<boolean> {
    if (this.tasks.size === 0) return false
    return [...this.tasks.values()].every((t) => isTerminal(t.state))
  }

  async getStats(): Promise<RunStats> {
    const tasks = [...this.tasks.values()]
    const byType = (type: StepType) => {
      const subset = tasks.filter((t) => t.stepType === type)
      return {
        total: subset.length,
        success: subset.filter((t) => t.state === PageState.Success).length,
        failed: subset.filter((t) => t.state === PageState.Failed).length,
      }
    }
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.state === PageState.Pending).length,
      retry: tasks.filter((t) => t.state === PageState.Retry).length,
      success: tasks.filter((t) => t.state === PageState.Success).length,
      failed: tasks.filter((t) => t.state === PageState.Failed).length,
      aborted: tasks.filter((t) => t.state === PageState.Aborted).length,
      inProgress: tasks.filter((t) => t.state === PageState.InProgress).length,
      traversers: byType('traverser'),
      extractors: byType('extractor'),
    }
  }

  private async mutate(id: string, fn: (t: PageTask) => PageTask): Promise<PageTask> {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    const next = fn(task)
    this.tasks.set(id, next)
    return next
  }
}
```

- [ ] **Step 2: Vitest coverage for the in-memory store**

```ts
// src/tests/InMemoryTaskStateStore.test.ts
import { describe, it, expect } from 'vitest'
import { InMemoryTaskStateStore } from '../domain/services/TaskStateStore.js'
import { stepName } from '../domain/value-objects/StepName.js'
import { PageState } from '../domain/value-objects/PageState.js'

describe('InMemoryTaskStateStore', () => {
  it('addTask + getTask round-trip', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    expect(await store.getTask(t.id)).toEqual(t)
  })

  it('markInProgress increments attempts', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    const inP = await store.markInProgress(t.id)
    expect(inP.attempts).toBe(t.attempts + 1)
    expect(inP.state).toBe(PageState.InProgress)
  })

  it('isComplete is false with no tasks', async () => {
    const store = new InMemoryTaskStateStore('r1')
    expect(await store.isComplete()).toBe(false)
  })

  it('isComplete reflects all terminal', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    await store.markSuccess(t.id)
    expect(await store.isComplete()).toBe(true)
  })

  it('getStats aggregates by state and type', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const a = await store.addTask('https://a', stepName('s'), 'traverser')
    const b = await store.addTask('https://b', stepName('s'), 'extractor')
    await store.markSuccess(a.id)
    await store.markFailed(b.id, 'boom')
    const stats = await store.getStats()
    expect(stats.success).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.traversers.success).toBe(1)
    expect(stats.extractors.failed).toBe(1)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/tests/InMemoryTaskStateStore.test.ts
```

Expected: 5 passing.

- [ ] **Step 4: Commit**

```bash
git add src/domain/services/TaskStateStore.ts src/tests/InMemoryTaskStateStore.test.ts
git commit -m "feat(domain): extract TaskStateStore interface with in-memory impl"
```

---

### Task 2: Slim `ParserRun`

**Files:**
- Modify: `src/domain/entities/ParserRun.ts`

- [ ] **Step 1: Reduce `ParserRun` to identity + start time**

`ParserRun` becomes a value-object-ish struct. The `RunStats` type stays here (consumers import it).

```ts
import { randomUUID } from 'node:crypto'

export interface StepTypeStats { total: number; success: number; failed: number }
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
  readonly id: string
  readonly startedAt = new Date()
  constructor(readonly parserName: string, id?: string) {
    this.id = id ?? randomUUID()
  }
  elapsedMs(): number { return Date.now() - this.startedAt.getTime() }
}
```

- [ ] **Step 2: Find every external caller of the removed methods**

```bash
grep -rn "ParserRun\b" src --include='*.ts' | grep -v __tests__
grep -rn "\.allTasks(\|\.getStats(\|\.isComplete(\|\.markSuccess(\|\.markFailed(\|\.markPending(\|\.markRetry(\|\.markInProgress(\|\.markAborted(\|\.restoreTask(\|\.addTask(" src --include='*.ts' | grep -v __tests__
```

Expected: matches are confined to `ParserOrchestrator.ts` (handled in Task 4) and `ParserRunnerService.ts` (handled in Task 5).

- [ ] **Step 3: Typecheck — *will fail* with the orchestrator still calling old methods**

```bash
npx tsc --noEmit
```

Note the errors. They will be resolved in Tasks 4-5. Do not commit yet — bundle this with Task 4.

---

### Task 3: Implement `DbTaskStateStore`

**Files:**
- Create: `src/infrastructure/persistence/DbTaskStateStore.ts`
- Create: `src/__tests__/infrastructure/persistence/DbTaskStateStore.test.ts`

- [ ] **Step 1: Write the store**

The store sits *above* `RunPersistenceService` (which itself now sits on `TaskWriteBuffer`). It keeps a write-through cache of recently-touched tasks and an **incremental in-memory `RunStats` counter**. The counter is the key performance fix: `isComplete()` and `getStats()` read the in-memory counter instead of firing a GROUP BY DB query on every task completion.

```ts
// src/infrastructure/persistence/DbTaskStateStore.ts
import type { TaskStateStore } from '../../domain/services/TaskStateStore.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepType } from '../../domain/entities/Step.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import type { RetryConfig } from '../../domain/value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../../domain/value-objects/RetryConfig.js'
import { createPageTask } from '../../domain/entities/PageTask.js'
import { PageState, isTerminal } from '../../domain/value-objects/PageState.js'
import type { RunPersistenceService, StoredTask } from '../db/RunPersistenceService.js'
import type { RunStats, StepTypeStats } from '../../domain/entities/ParserRun.js'

const CACHE_MAX = 5_000

function emptyStats(): RunStats {
  return {
    total: 0, pending: 0, retry: 0, success: 0, failed: 0, aborted: 0, inProgress: 0,
    traversers: { total: 0, success: 0, failed: 0 },
    extractors: { total: 0, success: 0, failed: 0 },
  }
}

function statsTypeKey(stepType: StepType): 'traversers' | 'extractors' {
  return stepType === 'traverser' ? 'traversers' : 'extractors'
}

export class DbTaskStateStore implements TaskStateStore {
  private cache = new Map<string, PageTask>()
  private _stats: RunStats = emptyStats()
  /** Set to true once allTasks() has initialised _stats from DB on resume. */
  private statsInitialised = false

  constructor(
    public readonly runId: string,
    private readonly persistence: RunPersistenceService,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────
  private touch(task: PageTask): PageTask {
    if (this.cache.size >= CACHE_MAX) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(task.id, task)
    return task
  }

  private storedToTask(s: StoredTask): PageTask {
    return {
      id: s.id,
      url: s.url,
      stepName: s.stepName as unknown as StepName,
      stepType: s.stepType,
      state: s.state as PageTask['state'],
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      error: s.error ?? undefined,
      parentTaskId: s.parentTaskId ?? undefined,
      parent_data: (s.parent_data ?? undefined) as Record<string, unknown> | undefined,
    } as PageTask
  }

  /** Update the in-memory stats counter when a task transitions state. */
  private applyStatsDelta(prev: PageTask | undefined, next: PageTask): void {
    const s = this._stats
    // Decrement old state bucket
    if (prev) {
      switch (prev.state) {
        case PageState.Pending:    s.pending--; break
        case PageState.Retry:      s.retry--; break
        case PageState.InProgress: s.inProgress--; break
        case PageState.Success:    s.success--; s[statsTypeKey(prev.stepType)].success--; break
        case PageState.Failed:     s.failed--;  s[statsTypeKey(prev.stepType)].failed--; break
        case PageState.Aborted:    s.aborted--; break
      }
    }
    // Increment new state bucket
    switch (next.state) {
      case PageState.Pending:    s.pending++; break
      case PageState.Retry:      s.retry++; break
      case PageState.InProgress: s.inProgress++; break
      case PageState.Success:    s.success++; s[statsTypeKey(next.stepType)].success++; break
      case PageState.Failed:     s.failed++;  s[statsTypeKey(next.stepType)].failed++; break
      case PageState.Aborted:    s.aborted++; break
    }
  }

  // ── Adds / restores ───────────────────────────────────────────────────
  async addTask(
    url: string,
    step: StepName,
    stepType: StepType,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parent_data?: Record<string, unknown>,
  ): Promise<PageTask> {
    const task = createPageTask(url, step, stepType, retryConfig, parentTaskId, parent_data)
    this.touch(task)
    this._stats.total++
    this._stats[statsTypeKey(stepType)].total++
    this.applyStatsDelta(undefined, task)
    await this.persistence.upsertTask(this.runId, task)
    return task
  }

  /** Restore a task into the cache without a DB write (used on resume warm-up). */
  async restoreTask(task: PageTask): Promise<void> {
    this.touch(task)
    // Stats are rebuilt in bulk by initStatsFromTasks(); don't double-count here.
  }

  async getTask(id: string): Promise<PageTask | undefined> {
    const hit = this.cache.get(id)
    if (hit) return hit
    const stored = await this.persistence.getTask(this.runId, id)
    if (!stored) return undefined
    return this.touch(this.storedToTask(stored))
  }

  // ── Mutators (write-through) ──────────────────────────────────────────
  private async mutate(id: string, fn: (t: PageTask) => PageTask): Promise<PageTask> {
    const current = await this.getTask(id)
    if (!current) throw new Error(`Task ${id} not found`)
    const next = fn(current)
    this.applyStatsDelta(current, next)
    this.touch(next)
    await this.persistence.upsertTask(this.runId, next)
    return next
  }

  async markInProgress(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.InProgress, attempts: t.attempts + 1 }))
  }
  async markPending(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Pending, error: undefined }))
  }
  async markRetry(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Retry, error }))
  }
  async markSuccess(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Success, error: undefined }))
  }
  async markFailed(id: string, error: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Failed, error }))
  }
  async markAborted(id: string): Promise<PageTask> {
    return this.mutate(id, (t) => ({ ...t, state: PageState.Aborted }))
  }

  // ── Aggregates (in-memory counter — no DB round-trip on hot path) ─────
  async isComplete(): Promise<boolean> {
    if (this._stats.total === 0) return false
    const terminal = this._stats.success + this._stats.failed + this._stats.aborted
    return terminal >= this._stats.total
  }

  async getStats(): Promise<RunStats> {
    return { ...this._stats, traversers: { ...this._stats.traversers }, extractors: { ...this._stats.extractors } }
  }

  // ── Bulk load (resume path) ───────────────────────────────────────────
  /**
   * Load all existing tasks from DB, warm the cache, and rebuild _stats.
   * Call this once at the start of a resumed run (before dispatching anything).
   * Returns tasks so the caller can re-dispatch pending/retry/aborted ones.
   */
  async allTasks(): Promise<PageTask[]> {
    await this.persistence.flushPendingWrites()
    const { tasks } = await this.persistence.getRunTasks(this.runId, 1, 100_000)
    const pageTasks = tasks.map((s) => this.storedToTask(s))
    // Warm cache and rebuild stats counter from DB state
    this._stats = emptyStats()
    for (const t of pageTasks) {
      this.touch(t)
      this._stats.total++
      this._stats[statsTypeKey(t.stepType)].total++
      this.applyStatsDelta(undefined, t)
    }
    this.statsInitialised = true
    return pageTasks
  }
}
```

- [ ] **Step 2: Tests with a mocked `RunPersistenceService`**

```ts
// src/tests/DbTaskStateStore.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DbTaskStateStore } from '../infrastructure/persistence/DbTaskStateStore.js'
import { stepName } from '../domain/value-objects/StepName.js'
import { PageState } from '../domain/value-objects/PageState.js'

function mockPersistence() {
  const stored = new Map<string, any>()
  return {
    upsertTask: vi.fn(async (_runId: string, task: any) => { stored.set(task.id, task) }),
    getTask: vi.fn(async (_runId: string, id: string) => stored.get(id) ?? null),
    getRunTasks: vi.fn(async () => ({ tasks: [...stored.values()], total: stored.size })),
    findById: vi.fn(async () => ({ stats: { total: stored.size, pending: 0, retry: 0, success: 0, failed: 0, aborted: 0, inProgress: 0, traversers: { total: 0, success: 0, failed: 0 }, extractors: { total: 0, success: 0, failed: 0 } } })),
    flushPendingWrites: vi.fn(async () => {}),
    _stored: stored,
  }
}

describe('DbTaskStateStore', () => {
  it('addTask writes through and caches', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    expect(p.upsertTask).toHaveBeenCalledTimes(1)
    expect(await store.getTask(t.id)).toEqual(t)
    // Second getTask should be cached (no second persistence.getTask call)
    expect(p.getTask).not.toHaveBeenCalled()
  })

  it('markInProgress increments attempts and writes through', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    const inP = await store.markInProgress(t.id)
    expect(inP.state).toBe(PageState.InProgress)
    expect(inP.attempts).toBe(t.attempts + 1)
    expect(p.upsertTask).toHaveBeenCalledTimes(2)
  })

  it('getTask falls back to DB on cache miss', async () => {
    const p = mockPersistence()
    p._stored.set('z', { id: 'z', url: 'u', stepName: 's', stepType: 'traverser', state: 'pending', attempts: 0, maxAttempts: 3, error: null, parentTaskId: null, parent_data: null })
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.getTask('z')
    expect(t?.id).toBe('z')
    expect(p.getTask).toHaveBeenCalledTimes(1)
  })

  it('isComplete uses DB stats', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    await store.addTask('https://x', stepName('s'), 'traverser')
    // Default mockPersistence.findById returns all-zero counts → not complete
    expect(await store.isComplete()).toBe(false)
  })
})
```

Also add a test that verifies `isComplete()` uses the in-memory counter (no DB call) and that `allTasks()` correctly initialises the stats counter:

```ts
  it('isComplete() uses in-memory counter, not DB', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    // No DB call needed for isComplete
    expect(p.findById).not.toHaveBeenCalled()
    await store.markSuccess(t.id)
    expect(await store.isComplete()).toBe(true)
    expect(p.findById).not.toHaveBeenCalled()
  })

  it('allTasks() rebuilds stats counter from DB on resume', async () => {
    const p = mockPersistence()
    p._stored.set('a', { id: 'a', url: 'u', stepName: 's', stepType: 'traverser', state: 'success', attempts: 1, maxAttempts: 3, error: null, parentTaskId: null, parent_data: null })
    const store = new DbTaskStateStore('r1', p as any)
    await store.allTasks()
    const stats = await store.getStats()
    expect(stats.total).toBe(1)
    expect(stats.success).toBe(1)
  })
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/tests/DbTaskStateStore.test.ts
```

Expected: 6 passing.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/persistence/DbTaskStateStore.ts src/tests/DbTaskStateStore.test.ts
git commit -m "feat(persistence): add DbTaskStateStore with write-through cache and incremental stats"
```

---

### Task 4: Refactor `ParserOrchestrator` to use `TaskStateStore`

**Files:**
- Modify: `src/application/orchestrator/ParserOrchestrator.ts`

This is the biggest single change. All `this.run.<method>()` calls become `await this.store.<method>()`. Several call sites are inside sync paths (constructor, `handleWorkerMessage` switch arms); convert those arms to fire-and-forget async or wrap them in helper async methods. The orchestrator already runs in an event-driven style; making message handlers `async` is safe because `Worker.on('message', ...)` accepts async listeners (their returned promises are ignored, so add a `.catch(console.error)`).

- [ ] **Step 1: Update the constructor signature**

Replace the constructor and field declarations:

```ts
import type { TaskStateStore } from '../../domain/services/TaskStateStore.js'

export class ParserOrchestrator extends EventEmitter {
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, OutputWriter>()
  private pendingWrites: Promise<void>[] = []
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completing = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void
  private globalActive = 0
  private dispatchQueue: string[] = []
  private taskHtml = new Map<string, string>()

  constructor(
    private readonly config: ParserConfig,
    outputBaseDir: string,
    private readonly store: TaskStateStore,
    private readonly runId_: string,
    snapshotTasks?: PageTask[],
  ) {
    super()
    if (snapshotTasks) {
      for (const t of snapshotTasks) void this.store.restoreTask(t)
    }
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name, this.runId_)
  }

  get runId(): string {
    return this.runId_
  }
```

The orchestrator no longer constructs a `ParserRun`; the run's identity comes from `runId_`.

- [ ] **Step 2: Convert `getAllTasks` to async**

```ts
  async getAllTasks(): Promise<PageTask[]> {
    return this.store.allTasks()
  }
```

Update the two callers in `ParserRunnerService` (Task 5) to `await` it.

- [ ] **Step 3: Convert `retryTask` / `abortTask` to async**

```ts
  async retryTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (task.state !== PageState.Failed && task.state !== PageState.Aborted) {
      throw new Error(`Task "${taskId}" is not failed or aborted (state: ${task.state})`)
    }
    await this.store.markPending(taskId)
    await this.dispatchTask(taskId)
  }

  async abortTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) throw new Error(`Task "${taskId}" not found`)
    if (
      task.state !== PageState.Pending &&
      task.state !== PageState.InProgress &&
      task.state !== PageState.Retry
    ) {
      throw new Error(`Task "${taskId}" cannot be aborted (state: ${task.state})`)
    }
    await this.store.markAborted(taskId)
  }
```

- [ ] **Step 4: Convert `start()` and `stop()`**

```ts
  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })
    this.completionPromise = new Promise((resolve) => { this.resolveCompletion = resolve })

    for (const [, step] of this.config.steps) this.spawnWorker(step)

    const snapshotTasks = await this.store.allTasks()
    if (snapshotTasks.length > 0) {
      // Warm the cache so subsequent getTask() calls don't round-trip to DB per task.
      for (const t of snapshotTasks) await this.store.restoreTask(t)
      const successUrls = snapshotTasks.filter((t) => t.state === PageState.Success).map((t) => t.url)
      this.deduplicator.seed(successUrls)
      const toDispatch = snapshotTasks.filter(
        (t) => t.state === PageState.Aborted || t.state === PageState.Pending || t.state === PageState.Retry,
      )
      for (const task of toDispatch) {
        await this.store.markPending(task.id)
        await this.dispatchTask(task.id)
      }
    } else {
      if (!/^https?:\/\//i.test(this.config.entryUrl)) {
        throw new Error('Invalid entryUrl: must start with http:// or https://')
      }
      const initialUrls = this.deduplicator.filter([this.config.entryUrl])
      const entryStepType = this.config.steps.get(this.config.entryStep)?.type ?? 'traverser'
      for (const url of initialUrls) {
        const task = await this.store.addTask(url, this.config.entryStep, entryStepType, this.config.retryConfig)
        await this.dispatchTask(task.id)
      }
    }

    this.emit('stats', await this.store.getStats())
    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    const tasks = await this.store.allTasks()
    for (const task of tasks) {
      if (
        task.state === PageState.Pending ||
        task.state === PageState.Retry ||
        task.state === PageState.InProgress
      ) {
        await this.store.markAborted(task.id)
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

  async getStats(): Promise<RunStats> {
    return this.store.getStats()
  }
```

- [ ] **Step 5: Make `handleWorkerMessage` async-tolerant**

Convert the listener attached to `worker.on('message', ...)` to delegate to an async method and swallow the returned promise:

```ts
    worker.on('message', (msg: WorkerOutMessage) => {
      this.handleWorkerMessage(msg).catch((err) => console.error('[orchestrator] handler failed', err))
    })
```

Then the body of `handleWorkerMessage`:

```ts
  private async handleWorkerMessage(msg: WorkerOutMessage): Promise<void> {
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        if (this.stopped) break
        const validItems = msg.items.filter((i) => /^https?:\/\//i.test(i.link))
        const newLinks = new Set(this.deduplicator.filter(validItems.map((i) => i.link)))
        const newItems = validItems.filter((i) => newLinks.has(i.link))
        for (const item of newItems) {
          const sName = item.page_type as StepName
          const stepType = this.config.steps.get(sName)?.type ?? 'traverser'
          const task = await this.store.addTask(item.link, sName, stepType, this.config.retryConfig, msg.taskId, item.parent_data)
          await this.dispatchTask(task.id)
        }
        this.emit('stats', await this.store.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        for (const row of msg.rows) this.writeOutputRow(msg.outputFile, row)
        const task = await this.store.getTask(msg.taskId)
        this.emit('data_extracted', { taskId: msg.taskId, rows: msg.rows, task })
        break
      }
      case 'PAGE_SUCCESS': {
        this.globalActive--
        const task = await this.store.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) { await this.flushDispatchQueue(); this.checkCompletion(); break }
        const updated = await this.store.markSuccess(msg.taskId)
        this.emit('task_done', updated)
        this.emit('stats', await this.store.getStats())
        await this.flushDispatchQueue()
        this.checkCompletion()
        break
      }
      case 'LOG': {
        const line = `[${msg.stepName}] ${msg.args.join(' ')}`
        if (msg.level === 'error') console.error(line); else console.log(line)
        break
      }
      case 'PAGE_FAILED': {
        this.globalActive--
        if (msg.html) this.taskHtml.set(msg.taskId, msg.html)
        const task = await this.store.getTask(msg.taskId)
        if (!task || isTerminal(task.state)) { await this.flushDispatchQueue(); break }
        if (task.attempts < task.maxAttempts) {
          await this.store.markRetry(msg.taskId, msg.error)
          this.emit('stats', await this.store.getStats())
          await this.dispatchTask(msg.taskId)
        } else {
          const updated = await this.store.markFailed(msg.taskId, msg.error)
          const html = this.taskHtml.get(msg.taskId)
          if (html) { this.emit('task_failed_html', msg.taskId, html); this.taskHtml.delete(msg.taskId) }
          this.emit('task_done', updated)
          this.emit('stats', await this.store.getStats())
          this.checkCompletion()
        }
        await this.flushDispatchQueue()
        break
      }
    }
  }
```

- [ ] **Step 6: Convert `dispatchTask` / `_sendToWorker` / `flushDispatchQueue`**

```ts
  private async dispatchTask(taskId: string): Promise<void> {
    if (this.stopped) return
    const quota = this.config.concurrentQuota
    if (quota !== undefined && this.globalActive >= quota) {
      this.dispatchQueue.push(taskId)
      return
    }
    await this._sendToWorker(taskId)
  }

  private async _sendToWorker(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task || isTerminal(task.state)) return
    const worker = this.workers.get(task.stepName)
    if (!worker) {
      const failed = await this.store.markFailed(taskId, `No worker for step "${task.stepName}"`)
      this.emit('task_done', failed)
      this.emit('stats', await this.store.getStats())
      this.checkCompletion()
      return
    }
    // Increment BEFORE the await so concurrent calls don't bypass the quota
    // check in dispatchTask(). If markInProgress throws, decrement to compensate.
    this.globalActive++
    let inProgress: PageTask
    try {
      inProgress = await this.store.markInProgress(taskId)
    } catch (err) {
      this.globalActive--
      throw err
    }
    worker.postMessage({ type: 'PROCESS_PAGE', task: inProgress })
  }

  private async flushDispatchQueue(): Promise<void> {
    const quota = this.config.concurrentQuota
    while (this.dispatchQueue.length > 0 && (quota === undefined || this.globalActive < quota)) {
      const nextId = this.dispatchQueue.shift()!
      await this._sendToWorker(nextId)
    }
  }
```

- [ ] **Step 7: Convert `checkCompletion` to await `isComplete`**

```ts
  private checkCompletion(): void {
    if (this.stopped || this.completing) return
    void (async () => {
      if (!(await this.store.isComplete())) return
      if (this.completing) return
      this.completing = true
      try {
        await this.closeAllWriters()
        await this.runPostProcessing()
        this.emit('complete', await this.store.getStats())
        this.resolveCompletion()
      } catch (err) {
        this.emit('error', err)
      }
    })()
  }
```

- [ ] **Step 8: Fix the worker `'error'` handler**

The previous handler iterated `this.run.allTasks()` synchronously. Make it async:

```ts
    worker.on('error', (err) => {
      this.emit('error', err)
      void (async () => {
        const tasks = await this.store.allTasks()
        for (const task of tasks) {
          if (String(task.stepName) === String(step.name) && task.state === PageState.InProgress) {
            this.globalActive--
            const failed = await this.store.markFailed(task.id, `Worker crashed: ${err.message}`)
            this.emit('task_done', failed)
          }
        }
        this.emit('stats', await this.store.getStats())
        await this.flushDispatchQueue()
        this.checkCompletion()
      })()
    })
```

- [ ] **Step 9: Typecheck and run tests**

```bash
npx tsc --noEmit
npm run test -- --run
```

Some existing tests of `ParserRun` will break (they exercise the removed API). Either: (a) delete them since their behavior is now covered by `InMemoryTaskStateStore.test.ts`, or (b) port them to construct `InMemoryTaskStateStore`. Pick (a).

- [ ] **Step 10: Commit**

```bash
git add src/domain/entities/ParserRun.ts src/application/orchestrator/ParserOrchestrator.ts
git commit -m "refactor(orchestrator): route task state through TaskStateStore"
```

---

### Task 5: Update `RunParser`, `ParserRunnerService`, and API routes

**Files:**
- Modify: `src/application/use-cases/RunParser.ts`
- Modify: `src/application/services/ParserRunnerService.ts`
- Modify: `src/api/routes/jobs.ts`
- Modify: `src/api/server.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 0: Inject `RunPersistenceService` into `RunParser`**

`RunParser` currently takes only `(loader, outputDir)`. Add `runPersistence` as a third constructor arg:

```ts
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

export class RunParser {
  constructor(
    private readonly loader: DbParserLoader,
    private readonly outputDir: string,
    private readonly runPersistence: RunPersistenceService,
  ) {}
  // ...
}
```

Then update every construction site:
- `src/api/server.ts`: `new RunParser(dbLoader, outputDir, runPersistence)`
- `src/cli/index.ts`: `new RunParser(loader, outputDir, runPersistence)` — ensure `runPersistence` is instantiated and passed.

- [ ] **Step 1: `RunParser` wires the DB store by default**

In `RunParser.execute(...)` and `RunParser.resume(...)`, replace the `new ParserOrchestrator(config, outputBaseDir, snapshotTasks, runId)` construction with:

```ts
import { DbTaskStateStore } from '../../infrastructure/persistence/DbTaskStateStore.js'

const runId = providedRunId ?? randomUUID()
const store = new DbTaskStateStore(runId, this.runPersistence)
const orchestrator = new ParserOrchestrator(config, outputBaseDir, store, runId, snapshotTasks)
```

- [ ] **Step 2: Drop snapshot rehydration in `resume()` paths**

In `ParserRunnerService.resume(parserName)`, the snapshot pull is no longer required for state — but the resume entrypoint still needs the `runId` of the stopped run. Simplify:

```ts
  async resume(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) throw new Error(`Parser "${parserName}" is already running`)
    const latest = await this.runPersistence.getLatestRunInfo(parserName)
    if (!latest || latest.status !== 'stopped') throw new Error(`No stopped run found for "${parserName}"`)

    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      const tasks = await ref.orchestrator!.getAllTasks()
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, tasks).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.resume(parserName, latest.id, /* no snapshot tasks */ [], /* …callbacks… */)
    this._wireTaskEvents(ref.orchestrator)
    await this.runPersistence.markRunRunning(latest.id).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }
```

The orchestrator's `start()` will internally call `this.store.allTasks()` to pick up the existing tasks from DB. The argument formerly named `snapshotTasks` can stay (empty array) — it's now a vestigial restore hook only used by tests.

- [ ] **Step 3: Adjust `retryFailed`**

Same change: instead of pulling `tasks` and passing them in, just pass `runId`. The orchestrator reads from DB.

- [ ] **Step 4: Update `getAllTasks()` callers**

Every `orchestrator.getAllTasks()` is now `await orchestrator.getAllTasks()`. Find them:

```bash
grep -rn "getAllTasks(" src --include='*.ts'
```

Add `await` to each call site (mostly `ParserRunnerService` and `src/api/server.ts`).

- [ ] **Step 4b: Remove double-write from `_wireTaskEvents`**

In `ParserRunnerService._wireTaskEvents`, the `task_done` listener currently calls `runPersistence.upsertTask(...)`. The `DbTaskStateStore` already writes through to `RunPersistenceService` on every mutation, so this is a double-write. Remove the `upsertTask` call:

```ts
// BEFORE (remove this):
orchestrator.on('task_done', (task) => {
  void runPersistence.upsertTask(runId, task).catch(console.error)
  // ...
})

// AFTER: Keep saveTaskResult and saveTaskHtml listeners, remove only upsertTask.
orchestrator.on('task_done', (_task) => {
  // upsertTask removed — store already persists on every state mutation
})
```

Keep the `data_extracted` → `saveTaskResult` and `task_failed_html` → `saveTaskHtml` listeners as-is; those are separate columns not owned by the store.

- [ ] **Step 5: API handlers**

`retryTask` and `abortTask` in `ParserRunnerService` now return promises. Adjust signatures:

```ts
  async retryTask(parserName: string, taskId: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.retryTask(taskId)
  }

  async abortTask(parserName: string, taskId: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.abortTask(taskId)
  }
```

Then in `src/api/routes/jobs.ts`, the route handlers that call these must be `async` with `await`. Find them:

```bash
grep -rn "retryTask\|abortTask" src/api --include='*.ts'
```

For each matching route, change `(req, res) => {` to `async (req, res) => {` and add `await` before the `runner.retryTask(...)` / `runner.abortTask(...)` calls.

- [ ] **Step 6: Typecheck and run tests**

```bash
npx tsc --noEmit
npm run test -- --run
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/application src/api src/cli
git commit -m "refactor(application,api,cli): use DbTaskStateStore and async task ops"
```

---

### Task 6: Smoke test end-to-end

- [ ] **Step 1: Migrate DB**

```bash
npm run db:migrate
```

- [ ] **Step 2: Start the platform**

```bash
npm run start
```

- [ ] **Step 3: Run a parser and crash the API mid-run**

Start a parser via the UI or `curl -X POST http://localhost:3001/api/parsers/<name>/start`. Once tasks are visibly in flight, kill the API process with `Ctrl+C` (graceful) or `kill -9 <pid>` (hard).

- [ ] **Step 4: Restart and resume**

```bash
npm run start
```

Verify in the Jobs UI that the previous run shows `stopped` (for SIGINT) or `running` → fix-up to `stopped` (for SIGKILL — the orphan-cleanup path in `ParserRunnerService.stop` handles this).

Click Resume. Expected: the run continues, the orchestrator picks up the in-DB tasks via `DbTaskStateStore.allTasks()` and re-dispatches pending/retry/aborted ones, without needing the old snapshot rehydration code path.

- [ ] **Step 5: Verify DB is the source of truth**

```bash
psql "$DATABASE_URL" -c "SELECT state, count(*) FROM run_tasks WHERE run_id='<run-id>' GROUP BY state;"
```

Expected counts match the UI's stats panel.

---

### Task 7: Document in design-log

**Files:**
- Create: `design-log/NNN-orchestrator-persistence-offload.md`
- Modify: `design-log/index.md`

- [ ] **Step 1: Write the entry**

Cover:
- Why: in-memory `ParserRun` Map didn't scale and couldn't survive restarts.
- Design: `TaskStateStore` abstraction, `DbTaskStateStore` with write-through LRU.
- Q&A: Why the cache is bounded at 5,000 entries (covers a single page of the largest typical run; aggregates always read fresh via `findById`).
- Trade-offs: every state mutation now has an extra `await`; reads of aggregates round-trip to DB but ride on `TaskWriteBuffer` for write consolidation. The orchestrator's worker `'message'` handler is now async; failures inside it surface via the existing `console.error` channel.
- Open work: shrinking `findById`'s stats query for hot polling (covered separately if needed).

- [ ] **Step 2: Update index**

Add a row in `design-log/index.md`.

- [ ] **Step 3: Commit**

```bash
git add design-log/
git commit -m "docs(design-log): orchestrator persistence offload"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full test run**

```bash
npm run test -- --run
```

Expected: green.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: API contract check**

```bash
curl -s http://localhost:3001/api/jobs | jq '.runs[0]'
curl -s http://localhost:3001/api/jobs/<run-id>/tasks | jq '.tasks | length'
```

Expected: identical shapes to before this refactor. The UI works without changes.
