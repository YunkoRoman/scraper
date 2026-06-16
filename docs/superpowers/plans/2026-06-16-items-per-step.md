# Items Per Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show item counts (extracted rows / discovered links) per task in the task table and a "Total Items" aggregate in the job header.

**Architecture:** Add `totalItems: number` to the `RunStats` domain type; track per-task item counts in the orchestrator's private maps for live runs; compute them via SQL joins for DB-backed runs; expose both through the existing tasks and stats endpoints; render in the UI.

**Tech Stack:** TypeScript, Drizzle ORM + raw SQL, Express, Vitest, React 19, TailwindCSS

---

## File Map

| File | Change |
|---|---|
| `src/domain/entities/ParserRun.ts` | Add `totalItems: number` to `RunStats` |
| `src/domain/services/TaskStateStore.ts` | `InMemoryTaskStateStore.getStats()` returns `totalItems: 0` |
| `src/infrastructure/persistence/DbTaskStateStore.ts` | `emptyStats()` + `getStats()` include `totalItems: 0` |
| `src/application/orchestrator/ParserOrchestrator.ts` | Add `extractorItemCounts` + `traverserItemCounts` maps; override `getStats()`; add `getItemCounts()` |
| `src/infrastructure/db/RunPersistenceService.ts` | Add `getTaskItemCounts()`; add `totalItems` to `_computeStats()` |
| `src/api/routes/jobs.ts` | Merge item counts for both live and DB task list paths |
| `client/src/api.ts` | Add `itemCount: number \| null` to `TaskRow`; add `totalItems: number` to `RunStats` |
| `client/src/pages/JobDetailPage/index.tsx` | Add "Total Items" chip + "Items" table column |
| `src/tests/InMemoryTaskStateStore.test.ts` | Update existing stats test to expect `totalItems` |

---

## Task 1: Add `totalItems` to `RunStats` and update all providers

**Files:**
- Modify: `src/domain/entities/ParserRun.ts`
- Modify: `src/domain/services/TaskStateStore.ts`
- Modify: `src/infrastructure/persistence/DbTaskStateStore.ts`
- Test: `src/tests/InMemoryTaskStateStore.test.ts`

- [ ] **Step 1.1: Update the failing test first**

Open `src/tests/InMemoryTaskStateStore.test.ts`. Replace the existing `getStats aggregates by state and type` test with one that also asserts `totalItems`:

```ts
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
  expect(stats.totalItems).toBe(0)
})
```

- [ ] **Step 1.2: Run the test — expect TypeScript compile failure**

```bash
npm run test -- --reporter=verbose src/tests/InMemoryTaskStateStore.test.ts
```

Expected: error on `totalItems` not existing in `RunStats`.

- [ ] **Step 1.3: Add `totalItems` to `RunStats` in the domain entity**

In `src/domain/entities/ParserRun.ts`, add `totalItems` to the interface:

```ts
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
  totalItems: number
}
```

- [ ] **Step 1.4: Update `InMemoryTaskStateStore.getStats()` in `src/domain/services/TaskStateStore.ts`**

Find `getStats()` inside `InMemoryTaskStateStore` (around line 90) and add `totalItems: 0` to the returned object:

```ts
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
    totalItems: 0,
  }
}
```

- [ ] **Step 1.5: Update `emptyStats()` and `getStats()` in `src/infrastructure/persistence/DbTaskStateStore.ts`**

Find `emptyStats()` (around line 15) and add `totalItems: 0`:

```ts
function emptyStats(): RunStats {
  return {
    total: 0,
    pending: 0,
    retry: 0,
    success: 0,
    failed: 0,
    aborted: 0,
    inProgress: 0,
    traversers: { total: 0, success: 0, failed: 0 },
    extractors: { total: 0, success: 0, failed: 0 },
    totalItems: 0,
  }
}
```

`getStats()` (around line 194) spreads `_stats`, so `totalItems` will be included automatically. No change needed there.

- [ ] **Step 1.6: Run the test — expect pass**

```bash
npm run test -- --reporter=verbose src/tests/InMemoryTaskStateStore.test.ts
```

Expected: all tests PASS.

- [ ] **Step 1.7: Build to catch any remaining TypeScript errors**

```bash
npm run build 2>&1 | head -40
```

Fix any `totalItems` missing errors (other `RunStats` literal objects in the codebase). They will be in `RunPersistenceService._computeStatsFromRows` — add `totalItems: 0` as a placeholder there for now; Task 3 will replace it with the real value.

- [ ] **Step 1.8: Commit**

```bash
git add src/domain/entities/ParserRun.ts src/domain/services/TaskStateStore.ts src/infrastructure/persistence/DbTaskStateStore.ts src/tests/InMemoryTaskStateStore.test.ts
git commit -m "feat: add totalItems to RunStats domain type"
```

---

## Task 2: Track item counts in ParserOrchestrator

**Files:**
- Modify: `src/application/orchestrator/ParserOrchestrator.ts`

- [ ] **Step 2.1: Add two private maps at the top of the class**

Find the class fields at the top of `ParserOrchestrator` (around where `activeTaskIds` and `globalActive` are declared) and add:

```ts
private extractorItemCounts = new Map<string, number>()
private traverserItemCounts = new Map<string, number>()
```

- [ ] **Step 2.2: Update `DATA_EXTRACTED` handler to record extractor item count**

In `handleWorkerMessage`, find the `case 'DATA_EXTRACTED':` block (around line 297) and add one line after the `for` loop:

```ts
case 'DATA_EXTRACTED': {
  for (const row of msg.rows) this.writeOutputRow(msg.outputFile, row)
  this.extractorItemCounts.set(msg.taskId, msg.rows.length)
  const task = await this.store.getTask(msg.taskId)
  this.emit('data_extracted', { taskId: msg.taskId, rows: msg.rows, task })
  break
}
```

- [ ] **Step 2.3: Update `LINKS_DISCOVERED` handler to record traverser item count**

In the `case 'LINKS_DISCOVERED':` block (around line 276), after the loop that dispatches tasks, add:

```ts
case 'LINKS_DISCOVERED': {
  if (this.stopped) break
  const validItems = msg.items.filter((i) => /^https?:\/\//i.test(i.link))
  const newLinks = new Set(this.deduplicator.filter(validItems.map((i) => i.link)))
  const newItems = validItems.filter((i) => newLinks.has(i.link))
  for (const item of newItems) {
    const sName = item.page_type as StepName
    const stepType = this.config.steps.get(sName)?.type ?? 'traverser'
    const task = await this.store.addTask(
      item.link,
      sName,
      stepType,
      this.config.retryConfig,
      msg.taskId,
      item.parent_data,
    )
    await this.dispatchTask(task.id)
  }
  const prev = this.traverserItemCounts.get(msg.taskId) ?? 0
  this.traverserItemCounts.set(msg.taskId, prev + validItems.length)
  this.emit('stats', await this.store.getStats())
  break
}
```

Note: `validItems.length` counts all valid URLs the traverser reported, before deduplication — this represents the traverser step's raw output.

- [ ] **Step 2.4: Override `getStats()` to include `totalItems`**

Find the existing `getStats()` method (around line 180):

```ts
async getStats(): Promise<RunStats> {
  return this.store.getStats()
}
```

Replace it with:

```ts
async getStats(): Promise<RunStats> {
  const stats = await this.store.getStats()
  let totalItems = 0
  for (const count of this.extractorItemCounts.values()) totalItems += count
  return { ...stats, totalItems }
}
```

- [ ] **Step 2.5: Add `getItemCounts()` public method**

Add this method to `ParserOrchestrator` right after `getStats()`:

```ts
getItemCounts(): Map<string, number> {
  const result = new Map<string, number>()
  for (const [id, count] of this.extractorItemCounts) result.set(id, count)
  for (const [id, count] of this.traverserItemCounts) result.set(id, count)
  return result
}
```

- [ ] **Step 2.6: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors related to orchestrator.

- [ ] **Step 2.7: Commit**

```bash
git add src/application/orchestrator/ParserOrchestrator.ts
git commit -m "feat: track per-task item counts in orchestrator"
```

---

## Task 3: Add item counts to DB queries

**Files:**
- Modify: `src/infrastructure/db/RunPersistenceService.ts`

- [ ] **Step 3.1: Add `itemCount` to `StoredTask` interface**

Find `StoredTask` (around line 34) and add the field:

```ts
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
  parent_data?: Record<string, unknown> | null
  itemCount: number | null
}
```

- [ ] **Step 3.2: Add `getTaskItemCounts()` method**

Add this new method to `RunPersistenceService` after `getStepStats()` (around line 309):

```ts
async getTaskItemCounts(
  taskIds: string[],
  stepTypes: Map<string, 'traverser' | 'extractor'>,
): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map()
  const result = new Map<string, number>()

  const extractorIds = taskIds.filter((id) => stepTypes.get(id) === 'extractor')
  if (extractorIds.length > 0) {
    const rows = await this.db.execute<{ task_id: string; cnt: number }>(sql`
      SELECT task_id, COALESCE(jsonb_array_length(rows), 0) AS cnt
      FROM task_results
      WHERE task_id = ANY(${extractorIds}::uuid[])
    `)
    for (const r of rows.rows) result.set(r.task_id, r.cnt)
  }

  const traverserIds = taskIds.filter((id) => stepTypes.get(id) === 'traverser')
  if (traverserIds.length > 0) {
    const rows = await this.db.execute<{ parent_task_id: string; cnt: number }>(sql`
      SELECT parent_task_id, COUNT(*)::int AS cnt
      FROM run_tasks
      WHERE parent_task_id = ANY(${traverserIds}::uuid[])
      GROUP BY parent_task_id
    `)
    for (const r of rows.rows) result.set(r.parent_task_id, r.cnt)
  }

  return result
}
```

- [ ] **Step 3.3: Update `_computeStats` to compute `totalItems`**

Find `_computeStats` (around line 497). Add a second query and pass `totalItems` to `_computeStatsFromRows`:

```ts
private async _computeStats(runId: string): Promise<RunStats | null> {
  const rows = await this.db
    .select({
      runId: runTasks.runId,
      state: runTasks.state,
      stepType: runTasks.stepType,
      count: sql<number>`count(*)::int`,
    })
    .from(runTasks)
    .where(eq(runTasks.runId, runId))
    .groupBy(runTasks.runId, runTasks.state, runTasks.stepType)

  const [itemRow] = await this.db.execute<{ total: number }>(sql`
    SELECT COALESCE(SUM(jsonb_array_length(tr.rows)), 0)::int AS total
    FROM run_tasks rt
    JOIN task_results tr ON tr.task_id = rt.id
    WHERE rt.run_id = ${runId}
      AND rt.step_type = 'extractor'
  `)
  const totalItems = itemRow?.total ?? 0

  return this._computeStatsFromRows(rows, totalItems)
}
```

- [ ] **Step 3.4: Update `_computeStatsFromRows` signature and body**

Find `_computeStatsFromRows` (around line 511). Add `totalItems` parameter:

```ts
private _computeStatsFromRows(
  rows: { state: string; stepType: string; count: number }[],
  totalItems = 0,
): RunStats | null {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.count, 0)
  const get = (state: string) =>
    rows.filter((r) => r.state === state).reduce((s, r) => s + r.count, 0)
  const getType = (type: string, state: string) =>
    rows.find((r) => r.stepType === type && r.state === state)?.count ?? 0
  const typeTotal = (type: string) =>
    rows.filter((r) => r.stepType === type).reduce((s, r) => s + r.count, 0)
  return {
    total,
    pending: get('pending'),
    retry: get('retry'),
    success: get('success'),
    failed: get('failed'),
    aborted: get('aborted'),
    inProgress: get('in_progress'),
    traversers: {
      total: typeTotal('traverser'),
      success: getType('traverser', 'success'),
      failed: getType('traverser', 'failed'),
    },
    extractors: {
      total: typeTotal('extractor'),
      success: getType('extractor', 'success'),
      failed: getType('extractor', 'failed'),
    },
    totalItems,
  }
}
```

- [ ] **Step 3.5: Check `_computeStatsFromRows` callers — update the `getAllRuns` path**

Search for all calls to `_computeStatsFromRows` in the file:

```bash
grep -n "_computeStatsFromRows" src/infrastructure/db/RunPersistenceService.ts
```

There is one more call (around line 265 — `getAllRuns` batch stats). That call uses pre-aggregated rows without `task_results`. Update that call site to pass `totalItems: 0` as default (the `getAllRuns` listing doesn't need per-run item totals):

```ts
const stats = this._computeStatsFromRows(runStatRows)
// leave as-is — default parameter totalItems = 0 handles it
```

The default `totalItems = 0` in the signature covers this case automatically. No change needed.

- [ ] **Step 3.6: Build**

```bash
npm run build 2>&1 | head -40
```

Fix any TypeScript errors from the `StoredTask` interface change. The `storedToTask` method in `DbTaskStateStore` maps `StoredTask → PageTask` and will not need `itemCount` since `PageTask` doesn't have it — verify no errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/infrastructure/db/RunPersistenceService.ts
git commit -m "feat: add item counts to DB queries (getTaskItemCounts + totalItems in stats)"
```

---

## Task 4: Wire item counts through API routes

**Files:**
- Modify: `src/api/routes/jobs.ts`

- [ ] **Step 4.1: Update the tasks endpoint for active runs to merge item counts**

In `src/api/routes/jobs.ts`, find `router.get('/:runId/tasks', ...)` (around line 109). Update the `if (orch)` branch:

```ts
if (orch) {
  let allTasks = await orch.getAllTasks()
  if (status)   allTasks = allTasks.filter((t) => t.state === status)
  if (stepName) allTasks = allTasks.filter((t) => String(t.stepName) === stepName)
  const pageTasks = allTasks.slice((page - 1) * limit, page * limit)
  const itemCounts = orch.getItemCounts()
  const tasks = pageTasks.map((t) => ({
    ...t,
    itemCount: itemCounts.has(t.id) ? itemCounts.get(t.id)! : null,
  }))
  res.json({ tasks, total: allTasks.length })
  return
}
```

- [ ] **Step 4.2: Update the tasks endpoint for DB-backed runs to merge item counts**

In the same handler, update the `else` path (the `res.json(await runPersistence.getRunTasks(...))` line) to:

```ts
const { tasks: storedTasks, total } = await runPersistence.getRunTasks(runId, page, limit, status, stepName)
const stepTypes = new Map(storedTasks.map((t) => [t.id, t.stepType] as const))
const itemCountMap = await runPersistence.getTaskItemCounts(storedTasks.map((t) => t.id), stepTypes)
const tasks = storedTasks.map((t) => ({
  ...t,
  itemCount: itemCountMap.has(t.id) ? itemCountMap.get(t.id)! : null,
}))
res.json({ tasks, total })
```

- [ ] **Step 4.3: Build**

```bash
npm run build 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/api/routes/jobs.ts
git commit -m "feat: include itemCount in tasks API response for both live and DB paths"
```

---

## Task 5: Update client types and render in UI

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/pages/JobDetailPage/index.tsx`

- [ ] **Step 5.1: Add `itemCount` to `TaskRow` and `totalItems` to `RunStats` in `client/src/api.ts`**

Find `interface TaskRow` (around line 389) and add the field:

```ts
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
  parent_data?: Record<string, unknown> | null
  itemCount: number | null
}
```

Find `interface RunStats` (around line 7) and add `totalItems`:

```ts
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
  totalItems: number
}
```

- [ ] **Step 5.2: Add "Total Items" chip to header stat strip in `client/src/pages/JobDetailPage/index.tsx`**

Find the `stats &&` block that renders the Total/Success/Failed chips (around line 136). Add the "Total Items" chip after "Failed":

```tsx
{stats && (
  <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <div className="text-center">
      <p className="text-xs text-gray-500">Total Tasks:</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{stats.total}</p>
    </div>
    <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
    <div className="text-center">
      <p className="text-xs text-gray-500">Success:</p>
      <p className="text-lg font-bold text-emerald-600 leading-tight">{stats.success}</p>
    </div>
    <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
    <div className="text-center">
      <p className="text-xs text-gray-500">Failed:</p>
      <p className={`text-lg font-bold leading-tight ${stats.failed > 0 ? 'text-rose-500' : 'text-gray-400'}`}>
        {stats.failed}
      </p>
    </div>
    {stats.totalItems > 0 && (
      <>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
        <div className="text-center">
          <p className="text-xs text-gray-500">Total Items:</p>
          <p className="text-lg font-bold text-indigo-600 leading-tight">{stats.totalItems}</p>
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5.3: Add "Items" column header to the task table**

Find the `<thead>` in the task table (around line 254). Add the "Items" column after "Attempts":

```tsx
<thead className="bg-gray-50 dark:bg-gray-800">
  <tr>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">URL</th>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Step</th>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Attempts</th>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Items</th>
    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Error</th>
    <th className="px-4 py-2"></th>
  </tr>
</thead>
```

- [ ] **Step 5.4: Add "Items" cell to each task row**

In the `<motion.tr>` for each task (around line 270), add the Items cell after the Attempts cell:

```tsx
<td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
  {task.attempts}/{task.maxAttempts}
</td>
<td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
  {task.itemCount !== null && task.itemCount !== undefined
    ? task.stepType === 'extractor'
      ? `${task.itemCount} rows`
      : `${task.itemCount} links`
    : '—'}
</td>
```

- [ ] **Step 5.5: Build client**

```bash
npm run build 2>&1 | head -40
```

Expected: no TypeScript errors.

- [ ] **Step 5.6: Commit**

```bash
git add client/src/api.ts client/src/pages/JobDetailPage/index.tsx
git commit -m "feat: show item counts per task and total items in job header"
```

---

## Task 6: Verify end-to-end in the browser

**Files:** none (verification only)

- [ ] **Step 6.1: Start the dev server**

```bash
npm run start
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 6.2: Check a completed job**

Navigate to Jobs → pick any completed job. Verify:
- Header chip "Total Items" appears and shows a non-zero number for runs with extractor steps
- Task table has an "Items" column
- Extractor task rows show `N rows`, traverser task rows show `N links`
- Pending/failed tasks with no result show `—`

- [ ] **Step 6.3: Check an active job (if one exists)**

Start a parser run if needed. Navigate to its job detail. Verify:
- "Total Items" updates as tasks complete (page refreshes every 3 s)
- Items column shows counts as extractor tasks finish

- [ ] **Step 6.4: Stop the dev server**

`Ctrl+C`
