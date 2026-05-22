# Jobs UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `JobsPage` and `JobDetailPage` to match the provided reference designs, adding a search input, Visual Insights charts (donut + bar), and redesigned filter controls.

**Architecture:** Backend gains a `/api/jobs/:runId/step-stats` endpoint and a `stepName` task filter; the frontend adds a `JobInsightsPanel` component using the already-installed `recharts` library and rewrites both page components to match the reference layout.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Recharts 3, Framer Motion, Express, Drizzle ORM

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/infrastructure/db/RunPersistenceService.ts` | Add `getStepStats()`, add `stepName` param to `getRunTasks()` |
| Modify | `src/api/routes/jobs.ts` | Add `GET /:runId/step-stats` route; pass `stepName` to task query |
| Modify | `client/src/api.ts` | Add `getJobStepStats()`, add `stepName` param to `getJobTasks()` |
| Modify | `client/src/components/JobsPage.tsx` | Title, search, header buttons, column header, View button |
| Create | `client/src/components/JobInsightsPanel.tsx` | Donut chart + bar chart using recharts |
| Modify | `client/src/components/JobDetailPage.tsx` | New header, Visual Insights, redesigned filters, table, remove side drawer |

---

## Task 1 — Backend: step-stats endpoint + stepName filter

**Files:**
- Modify: `src/infrastructure/db/RunPersistenceService.ts`
- Modify: `src/api/routes/jobs.ts`

### Step 1.1 — Add `getStepStats` to RunPersistenceService

Open `src/infrastructure/db/RunPersistenceService.ts`. Add this method after `getRunTasks`:

```ts
async getStepStats(runId: string): Promise<{ stepName: string; total: number; success: number; failed: number }[]> {
  return this.db
    .select({
      stepName: runTasks.stepName,
      total:   sql<number>`count(*)::int`,
      success: sql<number>`count(*) filter (where state = 'success')::int`,
      failed:  sql<number>`count(*) filter (where state = 'failed')::int`,
    })
    .from(runTasks)
    .where(eq(runTasks.runId, runId))
    .groupBy(runTasks.stepName)
}
```

- [ ] Add the method above to `RunPersistenceService`

### Step 1.2 — Add `stepName` filter to `getRunTasks`

In `RunPersistenceService.ts`, update the `getRunTasks` signature and query:

```ts
async getRunTasks(
  runId: string,
  page: number,
  limit: number,
  status?: string,
  stepName?: string,
): Promise<{ tasks: StoredTask[]; total: number }> {
  const offset = (page - 1) * limit
  const clauses: SQL[] = [eq(runTasks.runId, runId)]
  if (status)   clauses.push(eq(runTasks.state, status))
  if (stepName) clauses.push(eq(runTasks.stepName, stepName))
  const conditions = and(...clauses)
  const rows = await this.db.select().from(runTasks)
    .where(conditions)
    .limit(limit)
    .offset(offset)
  const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` })
    .from(runTasks).where(conditions)
  return { tasks: rows as StoredTask[], total: count }
}
```

Add `SQL` to imports from `drizzle-orm`: `import { eq, and, sql, type SQL } from 'drizzle-orm'`

- [ ] Update `getRunTasks` signature and query as above
- [ ] Add `SQL` to drizzle-orm imports

### Step 1.3 — Add `/step-stats` route and `stepName` query param in jobs router

In `src/api/routes/jobs.ts`, add the `step-stats` route (place it before `/:runId/tasks`):

```ts
router.get('/:runId/step-stats', async (req, res) => {
  const { runId } = req.params
  const parserName = runner.findParserByRunId(runId)
  const orch = parserName ? runner.getOrchestrator(parserName) : undefined
  if (orch) {
    const tasks = orch.getAllTasks()
    const map = new Map<string, { stepName: string; total: number; success: number; failed: number }>()
    for (const t of tasks) {
      const e = map.get(t.stepName) ?? { stepName: t.stepName, total: 0, success: 0, failed: 0 }
      e.total++
      if (t.state === 'success') e.success++
      if (t.state === 'failed')  e.failed++
      map.set(t.stepName, e)
    }
    res.json({ steps: [...map.values()] })
    return
  }
  res.json({ steps: await runPersistence.getStepStats(runId) })
})
```

Also update the existing `/:runId/tasks` handler to read and pass `stepName`:

```ts
router.get('/:runId/tasks', async (req, res) => {
  const { runId } = req.params
  const page     = Math.max(1,   parseInt(String(req.query.page   ?? '1'),   10))
  const limit    = Math.min(500, parseInt(String(req.query.limit  ?? '100'), 10))
  const status   = req.query.status   as string | undefined
  const stepName = req.query.stepName as string | undefined

  const parserName = runner.findParserByRunId(runId)
  const orch = parserName ? runner.getOrchestrator(parserName) : undefined
  if (orch) {
    let allTasks = orch.getAllTasks()
    if (status)   allTasks = allTasks.filter((t) => t.state === status)
    if (stepName) allTasks = allTasks.filter((t) => t.stepName === stepName)
    res.json({ tasks: allTasks.slice((page - 1) * limit, page * limit), total: allTasks.length })
    return
  }
  res.json(await runPersistence.getRunTasks(runId, page, limit, status, stepName))
})
```

- [ ] Add `step-stats` route before `/:runId/tasks` in `src/api/routes/jobs.ts`
- [ ] Update `/:runId/tasks` to read and pass `stepName`

### Step 1.4 — Commit

```bash
git add src/infrastructure/db/RunPersistenceService.ts src/api/routes/jobs.ts
git commit -m "feat: add step-stats endpoint and stepName filter for job tasks"
```

- [ ] Commit

---

## Task 2 — Client API: add `getJobStepStats` and `stepName` to `getJobTasks`

**Files:**
- Modify: `client/src/api.ts`

### Step 2.1 — Add `StepStat` interface and `getJobStepStats` function

Open `client/src/api.ts`. Add after the `RunStats` interface block:

```ts
export interface StepStat {
  stepName: string
  total:    number
  success:  number
  failed:   number
}
```

Add this function after `getJob`:

```ts
export async function getJobStepStats(runId: string): Promise<{ steps: StepStat[] }> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/step-stats`)
}
```

- [ ] Add `StepStat` interface
- [ ] Add `getJobStepStats` function

### Step 2.2 — Add `stepName` param to `getJobTasks`

Update the existing `getJobTasks` function:

```ts
export async function getJobTasks(
  runId: string,
  page = 1,
  limit = 100,
  status?: string,
  stepName?: string,
): Promise<{ tasks: TaskRow[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status)   params.set('status',   status)
  if (stepName) params.set('stepName', stepName)
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks?${params}`)
}
```

- [ ] Update `getJobTasks` signature and body

### Step 2.3 — Commit

```bash
git add client/src/api.ts
git commit -m "feat: add getJobStepStats and stepName filter to getJobTasks"
```

- [ ] Commit

---

## Task 3 — JobsPage: restyle

**Files:**
- Modify: `client/src/components/JobsPage.tsx`

Reference changes:
- Title: `Jobs (N)` → `Jobs History` (no count)
- Add search input on the right side of the header
- Refresh button styled with border; add a Filter button placeholder
- Column header: `Tasks` → `Tasks (Success/Total)`
- "View" button: add explicit border styling

### Step 3.1 — Add search state and filtered runs

At the top of `JobsPage`, add:

```ts
const [search, setSearch] = useState('')
```

After the `runs` state, derive filtered runs (add this just before the `return`):

```ts
const filtered = search
  ? runs.filter((r) => r.parserName.toLowerCase().includes(search.toLowerCase()))
  : runs
```

Replace all uses of `runs.map(...)` and `runs.length === 0` in the JSX with `filtered`.

- [ ] Add `search` state
- [ ] Derive `filtered` and use it in place of `runs` in JSX

### Step 3.2 — Redesign header

Replace the existing `<div className="flex items-center justify-between mb-5">` block with:

```tsx
<div className="flex items-center justify-between mb-5">
  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Jobs History</h2>
  <div className="flex items-center gap-2">
    <div className="relative">
      <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search jobs..."
        className="pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48"
      />
    </div>
    <SpringButton
      variant="ghost"
      onClick={handleRefresh}
      className="text-xs px-3 py-1.5 flex items-center gap-1.5 border border-gray-200 dark:border-gray-700"
    >
      <motion.svg
        animate={refreshSpin && !reduced ? { rotate: 360 } : { rotate: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        onAnimationComplete={() => setRefreshSpin(false)}
        className="w-3.5 h-3.5"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </motion.svg>
      Refresh
    </SpringButton>
  </div>
</div>
```

- [ ] Replace header block

### Step 3.3 — Update column header and View button

In the `<thead>` row, change:
```tsx
<th ...>Tasks</th>
```
to:
```tsx
<th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
  Tasks (Success/Total)
</th>
```

In the `<td>` for the View action, replace the `SpringButton` className:
```tsx
<SpringButton
  variant="ghost"
  onClick={() => onViewJob(run.id)}
  className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
>
  View
</SpringButton>
```

- [ ] Update column header text
- [ ] Update View button className

### Step 3.4 — Commit

```bash
git add client/src/components/JobsPage.tsx
git commit -m "feat: restyle JobsPage with search, new header layout, and view button polish"
```

- [ ] Commit

---

## Task 4 — JobInsightsPanel: new charts component

**Files:**
- Create: `client/src/components/JobInsightsPanel.tsx`

### Step 4.1 — Create the component

Create `client/src/components/JobInsightsPanel.tsx`:

```tsx
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { RunStats, StepStat } from '../api'

interface Props {
  stats:     RunStats
  stepStats: StepStat[]
}

const PIE_COLORS = { success: '#10b981', failed: '#f43f5e', pending: '#f59e0b' }

export function JobInsightsPanel({ stats, stepStats }: Props) {
  const donutData = [
    { name: 'Success', value: stats.success, color: PIE_COLORS.success },
    { name: 'Failed',  value: stats.failed,  color: PIE_COLORS.failed },
    {
      name: 'Pending',
      value: stats.pending + stats.retry + stats.inProgress,
      color: PIE_COLORS.pending,
    },
  ].filter((d) => d.value > 0)

  const sorted  = [...stepStats].sort((a, b) => b.total - a.total)
  const topSteps = sorted.slice(0, 5)
  const rest     = sorted.slice(5)
  const barData  = [
    ...topSteps.map((s) => ({ name: s.stepName, value: s.total })),
    ...(rest.length > 0
      ? [{ name: 'Other Step', value: rest.reduce((acc, s) => acc + s.total, 0) }]
      : []),
  ]

  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Visual Insights</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Task Status Distribution
            </span>
            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none select-none">
              ···
            </button>
          </div>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%" cy="50%"
                  innerRadius={38} outerRadius={64}
                  dataKey="value"
                  strokeWidth={2}
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 text-xs">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-gray-600 dark:text-gray-400">
                    {d.name} ({d.value})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Tasks per Step
            </span>
            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none select-none">
              ···
            </button>
          </div>
          {barData.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">No step data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={barData} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={(v: string) => v.length > 10 ? v.slice(0, 9) + '…' : v}
                />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    background: 'var(--tw-prose-body, #fff)',
                    borderColor: '#e5e7eb',
                  }}
                />
                <Bar dataKey="value" name="Tasks" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  )
}
```

- [ ] Create `client/src/components/JobInsightsPanel.tsx` with the code above

### Step 4.2 — Commit

```bash
git add client/src/components/JobInsightsPanel.tsx
git commit -m "feat: add JobInsightsPanel with donut and bar charts using recharts"
```

- [ ] Commit

---

## Task 5 — JobDetailPage: full redesign

**Files:**
- Modify: `client/src/components/JobDetailPage.tsx`

Changes from reference:
- Stats bar becomes proper labeled boxes (Total Tasks / Success / Failed)
- Visual Insights section (JobInsightsPanel) added below header
- Side drawer panel removed; clicking "View Details" calls `onViewTask`
- Filter pill tabs replaced with URL search input + Steps dropdown + Status dropdown
- "View Details" action button is blue outlined

### Step 5.1 — Add new state and data fetching

At the top of `JobDetailPage`, replace the current state block. Add:

```ts
import { getJobStepStats } from '../api'
import type { StepStat } from '../api'
import { JobInsightsPanel } from './JobInsightsPanel'
```

In the component, add these state fields:

```ts
const [stepStats, setStepStats] = useState<StepStat[]>([])
const [stepFilter, setStepFilter] = useState<string>('')
const [urlSearch,  setUrlSearch]  = useState<string>('')
```

Remove: `selectedTask`, `taskResult`, `taskResultLoading` states (side panel removed).

Add step-stats load alongside `loadRun`:

```ts
const loadStepStats = useCallback(async () => {
  try {
    const r = await getJobStepStats(runId)
    setStepStats(r.steps)
  } catch { /* ignore */ }
}, [runId])
```

In the initial `useEffect` that calls `loadRun()` and `loadTasks()`, also call `loadStepStats()`.

Update `loadTasks` to pass `stepFilter`:

```ts
const loadTasks = useCallback(async (p: number, filter: string, step: string) => {
  setLoading(true)
  try {
    const result = await getJobTasks(
      runId, p, LIMIT,
      filter === 'all' ? undefined : filter,
      step || undefined,
    )
    setTasks(result.tasks)
    setTotal(result.total)
  } catch { /* ignore */ } finally {
    setLoading(false)
  }
}, [runId])
```

Update all calls to `loadTasks(p, f)` → `loadTasks(p, f, stepFilter)`.

- [ ] Add imports: `getJobStepStats`, `StepStat`, `JobInsightsPanel`
- [ ] Add state: `stepStats`, `stepFilter`, `urlSearch`
- [ ] Remove `selectedTask`, `taskResult`, `taskResultLoading` states
- [ ] Add `loadStepStats` callback and call it in the initial effect
- [ ] Update `loadTasks` signature to accept `step` param; pass it to `getJobTasks`
- [ ] Update all call sites of `loadTasks` to pass `stepFilter`

### Step 5.2 — Redesign header (stats + action buttons)

Replace the current `<FadeIn as="div" className="px-4 sm:px-6 py-4 border-b ...">` block with:

```tsx
<FadeIn as="div" className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
  <div className="flex items-start justify-between gap-4 flex-wrap">
    <div className="flex items-center gap-3">
      <motion.button
        onClick={onBack}
        whileHover={{ x: -3 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold"
      >
        ←
      </motion.button>
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {run?.parserName ?? '…'}
        </h2>
        <p className="text-xs text-gray-400 font-mono">Job ID: {runId.slice(0, 8)}…</p>
      </div>
    </div>

    {stats && (
      <div className="flex items-center gap-3 flex-wrap">
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
        </div>
      </div>
    )}

    <div className="flex items-center gap-2 ml-auto">
      {run?.isRunning ? (
        <SpringButton variant="danger" onClick={handleStop} loading={actionLoading} className="text-xs px-3 py-1.5">
          {actionLoading ? 'Stopping…' : 'Stop Job'}
        </SpringButton>
      ) : run?.status === 'stopped' ? (
        <SpringButton variant="warning" onClick={handleResume} loading={actionLoading} className="text-xs px-3 py-1.5">
          {actionLoading ? 'Resuming…' : 'Resume Job'}
        </SpringButton>
      ) : (run?.status === 'failed' || run?.status === 'completed') && (stats?.failed ?? 0) > 0 ? (
        <SpringButton variant="warning" onClick={handleRetryAllFailed} loading={actionLoading} className="text-xs px-3 py-1.5">
          {actionLoading ? 'Starting…' : `Retry Failed (${stats!.failed})`}
        </SpringButton>
      ) : null}
      <SpringButton
        variant="ghost"
        onClick={() => { loadRun(); loadStepStats(); loadTasks(page, statusFilter, stepFilter) }}
        className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-700"
      >
        Refresh
      </SpringButton>
    </div>
  </div>
  {actionError && <p className="text-xs text-red-500 mt-2">{actionError}</p>}
</FadeIn>
```

- [ ] Replace header block

### Step 5.3 — Add Visual Insights section and redesigned filters

Replace the existing `<div className="flex gap-1 mt-3 flex-wrap">` filter block and wrapping content. The layout below the header changes from `flex h-screen` to a scrollable column:

```tsx
<div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">

  {/* Visual Insights */}
  {stats && (
    <JobInsightsPanel stats={stats} stepStats={stepStats} />
  )}

  {/* Filters row */}
  <div className="flex items-center gap-2 mb-3 flex-wrap">
    <div className="relative flex-1 min-w-[160px] max-w-xs">
      <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={urlSearch}
        onChange={(e) => setUrlSearch(e.target.value)}
        placeholder="Search by URL"
        className="pl-9 pr-4 py-2 w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>

    {/* Steps dropdown */}
    <select
      value={stepFilter}
      onChange={(e) => {
        setStepFilter(e.target.value)
        setPage(1)
        loadTasks(1, statusFilter, e.target.value)
      }}
      className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
    >
      <option value="">Steps</option>
      {stepStats.map((s) => (
        <option key={s.stepName} value={s.stepName}>
          {s.stepName} ({s.total})
        </option>
      ))}
    </select>

    {/* Status dropdown */}
    <select
      value={statusFilter}
      onChange={(e) => {
        setStatusFilter(e.target.value)
        setPage(1)
        loadTasks(1, e.target.value, stepFilter)
      }}
      className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
    >
      <option value="all">Status</option>
      <option value="pending">Pending</option>
      <option value="in_progress">In Progress</option>
      <option value="success">Success</option>
      <option value="failed">Failed</option>
      <option value="aborted">Aborted</option>
      <option value="retry">Retry</option>
    </select>

    <span className="ml-auto text-xs text-gray-400">{total} tasks</span>
  </div>
```

Note: `urlSearch` filters client-side. Add this derived variable before the task table:

```ts
const displayTasks = urlSearch
  ? tasks.filter((t) => t.url.toLowerCase().includes(urlSearch.toLowerCase()))
  : tasks
```

Use `displayTasks` in the table map.

- [ ] Remove old `<div className="flex gap-1 mt-3 flex-wrap">` filter pill block
- [ ] Restructure outer layout: `flex flex-col h-screen` → content area is `flex-1 overflow-y-auto px-4 sm:px-6 py-4`
- [ ] Add Visual Insights section
- [ ] Add search, Steps, and Status filters
- [ ] Add `displayTasks` derived var; replace `tasks.map(...)` with `displayTasks.map(...)`

### Step 5.4 — Redesign task table and remove side drawer

Replace task table action column and remove `AnimatePresence` side drawer entirely.

In the task `<tr>`, the last `<td>` actions cell becomes:

```tsx
<td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
  <div className="flex items-center gap-1.5 justify-end">
    {(task.state === 'failed' || task.state === 'aborted') && run?.isRunning && (
      <button
        onClick={() => handleRetry(task)}
        className="text-xs px-2.5 py-1 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 font-medium transition-colors"
      >
        Retry
      </button>
    )}
    <button
      onClick={() => onViewTask(task.id)}
      className="text-xs px-3 py-1 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium transition-colors"
    >
      View Details
    </button>
  </div>
</td>
```

Remove the `onClick` on the `<motion.tr>` that called `openTaskDetail` (no longer needed).

Delete the `openTaskDetail` function, the `taskResult`/`taskResultLoading` state and the entire `<AnimatePresence>` block containing the side panel.

Update pagination to use first/last/prev/next pattern:

```tsx
{total > LIMIT && (() => {
  const totalPages = Math.ceil(total / LIMIT)
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 mt-2">
      <span className="text-xs text-gray-500">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => goTo(1)} disabled={page === 1}
          className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
          «
        </button>
        <button onClick={() => goTo(page - 1)} disabled={page === 1}
          className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
          ‹
        </button>
        <button onClick={() => goTo(page + 1)} disabled={page >= totalPages}
          className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
          ›
        </button>
        <button onClick={() => goTo(totalPages)} disabled={page >= totalPages}
          className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
          »
        </button>
      </div>
    </div>
  )
})()}
```

- [ ] Update action cell: "View Details" in blue outlined style; Retry in orange outlined
- [ ] Remove `onClick` on `<motion.tr>` that called `openTaskDetail`
- [ ] Delete `openTaskDetail`, `taskResult`, `taskResultLoading` state and all references
- [ ] Delete `AnimatePresence` side panel block
- [ ] Replace pagination with first/prev/next/last four-button layout
- [ ] Close the scrollable `<div>` wrapper opened in Step 5.3

### Step 5.5 — Commit

```bash
git add client/src/components/JobDetailPage.tsx
git commit -m "feat: redesign JobDetailPage with Visual Insights charts and new filter controls"
```

- [ ] Commit

---

## Task 6 — Verify in browser

- [ ] Run `npm run start` from repo root
- [ ] Navigate to Jobs page: confirm "Jobs History" title, search works, View buttons have border
- [ ] Click a job: confirm stats bar, Visual Insights charts render with real data
- [ ] Test Steps dropdown: selecting a step reloads the task list filtered by that step
- [ ] Test Status dropdown: selecting "Failed" shows only failed tasks
- [ ] Test URL search: typing partial URL narrows the task rows on screen
- [ ] Click "View Details": navigates to task detail page (no side panel)
- [ ] Test pagination « ‹ › » buttons
- [ ] Check dark mode: no visual regressions
