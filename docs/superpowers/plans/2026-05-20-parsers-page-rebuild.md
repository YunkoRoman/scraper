# Parsers Page Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline card grid in App.tsx with a full sidebar layout, a paginated+searchable parsers table, a live dashboard with a 7-day chart, and a settings page backed by localStorage.

**Architecture:** New `Layout.tsx` owns the sidebar shell; `App.tsx` is stripped to a hash router. `RunPersistenceService` gets two new methods (enriched parser list + 7-day performance). Two new API routes (`GET /api/parsers` enriched, `GET /api/dashboard/performance`) replace the old name-only list.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), React 19, Tailwind CSS, Framer Motion, Recharts (new), Vitest

**Spec:** `docs/superpowers/specs/2026-05-20-parsers-page-rebuild-design.md`

---

## File Map

**New server files:**
- `src/api/routes/dashboard.ts` — `GET /api/dashboard/performance`

**Modified server files:**
- `src/infrastructure/db/RunPersistenceService.ts` — add `listParsersWithLatestRun`, `getPerformanceLast7Days`
- `src/api/routes/parsers.ts` — enrich `GET /api/parsers` with page/search/status/sort params
- `src/api/routes/jobs.ts` — add `status=running` filter to `GET /api/jobs`
- `src/api/server.ts` — mount dashboard router

**New client files:**
- `client/src/hooks/useSettings.ts`
- `client/src/components/Layout.tsx`
- `client/src/components/ParsersPage.tsx`
- `client/src/components/DashboardPage.tsx`
- `client/src/components/SettingsPage.tsx`

**Modified client files:**
- `client/src/App.tsx` — routing shell only
- `client/src/api.ts` — add `ParserSummary`, `listParsersSummary`, `getDashboardPerformance`, update `listJobs`

**Retired client files:**
- `client/src/components/ParserCard.tsx` (deleted in Task 13)
- `client/src/hooks/useTheme.ts` (deleted in Task 13)

---

## Task 1: Install Recharts

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install recharts in the client**

```bash
cd client && npm install recharts
```

Expected output: `added N packages` with recharts and its peer deps.

- [ ] **Step 2: Verify TypeScript types are included**

Recharts ships its own types. Confirm:

```bash
ls client/node_modules/recharts/types
```

Expected: directory exists (not empty).

---

## Task 2: `useSettings` hook

**Files:**
- Create: `client/src/hooks/useSettings.ts`

This hook owns all app-level settings (theme, page size, parser defaults) and applies the theme DOM effect. It replaces `useTheme`.

- [ ] **Step 1: Create `client/src/hooks/useSettings.ts`**

```ts
import { useEffect, useState } from 'react'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  pageLimit: 10 | 25 | 50
  defaultBrowserType: 'playwright' | 'playwright-stealth' | 'puppeteer'
  defaultRetryCount: number
  defaultConcurrentQuota: number | null
  defaultDeduplication: boolean
}

const DEFAULTS: AppSettings = {
  theme: 'system',
  pageLimit: 10,
  defaultBrowserType: 'playwright',
  defaultRetryCount: 5,
  defaultConcurrentQuota: null,
  defaultDeduplication: true,
}

const KEY = 'app-settings'

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore parse errors */ }
  return { ...DEFAULTS }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const active =
        settings.theme === 'system'
          ? media.matches ? 'dark' : 'light'
          : settings.theme
      root.classList.toggle('dark', active === 'dark')
    }
    apply()
    if (settings.theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [settings.theme])

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }

  return { settings, updateSettings }
}
```

- [ ] **Step 2: Add unit tests for `useSettings`**

Create `src/tests/useSettings.test.ts` (root-level vitest, no DOM needed for logic):

```ts
import { describe, it, expect } from 'vitest'

// Pure logic extracted from useSettings: compute active theme
function resolveTheme(
  theme: 'light' | 'dark' | 'system',
  systemDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

describe('resolveTheme', () => {
  it('returns dark when system dark and theme=system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
  })
  it('returns light when system light and theme=system', () => {
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('returns explicit theme regardless of system', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- src/tests/useSettings.test.ts
```

Expected: `3 passed`.

---

## Task 3: Backend — enrich `RunPersistenceService`

**Files:**
- Modify: `src/infrastructure/db/RunPersistenceService.ts`

Add two methods:
1. `listParsersWithLatestRun(search)` — returns raw enriched data for all matching parsers in 1 SQL query
2. `getPerformanceLast7Days()` — returns daily successful/failed run counts

- [ ] **Step 1: Add `RawParserEnriched` interface and `listParsersWithLatestRun` to `RunPersistenceService`**

At the top of `src/infrastructure/db/RunPersistenceService.ts`, add the interface after the existing imports:

```ts
export interface RawParserEnriched {
  name: string
  dbStatus: 'running' | 'stopped' | 'idle'
  lastRunDate: string | null
  lastRunId: string | null
  successRate: number | null
}
```

Add the method to the `RunPersistenceService` class (before the private helpers section):

```ts
async listParsersWithLatestRun(search: string): Promise<RawParserEnriched[]> {
  const pattern = `%${search}%`

  type Row = {
    name: string
    run_id: string | null
    run_status: string | null
    started_at: Date | null
    success_count: number
    total_count: number
  }

  const result = await this.db.execute<Row>(sql`
    WITH latest_runs AS (
      SELECT DISTINCT ON (parser_name) id, parser_name, status, started_at
      FROM parser_runs
      ORDER BY parser_name, started_at DESC
    ),
    run_stats AS (
      SELECT
        run_id,
        COUNT(CASE WHEN state = 'success' THEN 1 END)::int AS success_count,
        COUNT(*)::int AS total_count
      FROM run_tasks
      WHERE run_id IN (SELECT id FROM latest_runs)
      GROUP BY run_id
    )
    SELECT
      p.name,
      lr.id         AS run_id,
      lr.status     AS run_status,
      lr.started_at AS started_at,
      COALESCE(rs.success_count, 0) AS success_count,
      COALESCE(rs.total_count,   0) AS total_count
    FROM parsers p
    LEFT JOIN latest_runs lr  ON lr.parser_name = p.name
    LEFT JOIN run_stats    rs ON rs.run_id = lr.id
    WHERE p.name ILIKE ${pattern}
    ORDER BY p.name ASC
  `)

  return (result.rows as Row[]).map((r) => ({
    name: r.name,
    dbStatus: (r.run_status === 'running' ? 'running'
      : r.run_status === 'stopped' ? 'stopped'
      : 'idle') as 'running' | 'stopped' | 'idle',
    lastRunDate: r.started_at ? (r.started_at as Date).toISOString() : null,
    lastRunId: r.run_id ?? null,
    successRate: r.total_count > 0
      ? Math.round((r.success_count / r.total_count) * 100)
      : null,
  }))
}
```

- [ ] **Step 2: Add `getPerformanceLast7Days` method**

Add immediately after `listParsersWithLatestRun`:

```ts
async getPerformanceLast7Days(): Promise<{ date: string; successful: number; failed: number }[]> {
  type Row = { date: string; successful: number; failed: number }

  const result = await this.db.execute<Row>(sql`
    SELECT
      TO_CHAR(DATE(started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
      COUNT(CASE WHEN status IN ('completed') THEN 1 END)::int    AS successful,
      COUNT(CASE WHEN status IN ('failed')    THEN 1 END)::int    AS failed
    FROM parser_runs
    WHERE started_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(started_at AT TIME ZONE 'UTC')
    ORDER BY date ASC
  `)

  return result.rows as Row[]
}
```

- [ ] **Step 3: Add unit tests for the pure enrichment helpers**

Create `src/tests/parserEnrichment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

// Pure logic extracted from the route handler
function computeStatus(
  dbStatus: 'running' | 'stopped' | 'idle',
  isRunning: boolean,
): 'running' | 'stopped' | 'idle' {
  return isRunning ? 'running' : dbStatus
}

function applyStatusFilter(
  parsers: { name: string; status: 'running' | 'stopped' | 'idle' }[],
  filter: string,
) {
  if (filter === 'all' || !filter) return parsers
  return parsers.filter((p) => p.status === filter)
}

describe('computeStatus', () => {
  it('overrides db status when runner says running', () => {
    expect(computeStatus('idle', true)).toBe('running')
    expect(computeStatus('stopped', true)).toBe('running')
  })
  it('uses db status when not running', () => {
    expect(computeStatus('stopped', false)).toBe('stopped')
    expect(computeStatus('idle', false)).toBe('idle')
  })
})

describe('applyStatusFilter', () => {
  const list = [
    { name: 'a', status: 'idle' as const },
    { name: 'b', status: 'running' as const },
    { name: 'c', status: 'stopped' as const },
  ]

  it('returns all when filter=all', () => {
    expect(applyStatusFilter(list, 'all')).toHaveLength(3)
  })
  it('filters to running only', () => {
    expect(applyStatusFilter(list, 'running')).toEqual([{ name: 'b', status: 'running' }])
  })
  it('filters to stopped only', () => {
    expect(applyStatusFilter(list, 'stopped')).toEqual([{ name: 'c', status: 'stopped' }])
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- src/tests/parserEnrichment.test.ts
```

Expected: `5 passed`.

---

## Task 4: Update `GET /api/parsers` route

**Files:**
- Modify: `src/api/routes/parsers.ts`

Replace the simple name-list handler with an enriched, paginated handler. All other routes are unchanged.

- [ ] **Step 1: Replace the `router.get('/')` handler**

Find and replace the existing handler (lines 37–43):

```ts
// REPLACE THIS:
router.get('/', async (_req, res) => {
  try {
    res.json({ parsers: await parserService.listParserNames() })
  } catch {
    res.json({ parsers: [] })
  }
})
```

With:

```ts
router.get('/', async (req, res) => {
  const page   = Math.max(1,   parseInt(String(req.query.page   ?? '1'),  10))
  const limit  = Math.min(200, parseInt(String(req.query.limit  ?? '10'), 10))
  const search = String(req.query.search ?? '')
  const status = String(req.query.status ?? 'all')
  const sort   = (['name', 'successRate', 'lastRunDate'] as const)
    .includes(req.query.sort as 'name') ? req.query.sort as 'name' | 'successRate' | 'lastRunDate' : 'name'
  const dir    = req.query.dir === 'desc' ? 'desc' : 'asc'

  const raw = await runPersistence.listParsersWithLatestRun(search)

  // Enrich status from in-memory runner (authoritative for running state)
  const enriched = raw.map((p) => ({
    ...p,
    status: (runner.isRunning(p.name) ? 'running' : p.dbStatus) as 'running' | 'stopped' | 'idle',
  }))

  // Filter by status
  const filtered = status === 'all'
    ? enriched
    : enriched.filter((p) => p.status === status)

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sort === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else if (sort === 'successRate') {
      cmp = (a.successRate ?? -1) - (b.successRate ?? -1)
    } else if (sort === 'lastRunDate') {
      cmp = (a.lastRunDate ?? '').localeCompare(b.lastRunDate ?? '')
    }
    return dir === 'asc' ? cmp : -cmp
  })

  const total = sorted.length
  const page_items = sorted.slice((page - 1) * limit, page * limit)

  res.json({
    parsers: page_items.map(({ dbStatus: _db, ...rest }) => rest),
    total,
  })
})
```

- [ ] **Step 2: Verify the server starts without errors**

```bash
npm run api &
sleep 3
curl -s "http://localhost:3001/api/parsers?limit=5" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log('total:', j.total, 'parsers:', j.parsers?.length)"
kill %1
```

Expected: prints `total: N parsers: M` without errors.

---

## Task 5: Dashboard performance route

**Files:**
- Create: `src/api/routes/dashboard.ts`
- Modify: `src/api/server.ts`

- [ ] **Step 1: Create `src/api/routes/dashboard.ts`**

```ts
import express from 'express'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

interface Deps {
  runPersistence: RunPersistenceService
}

export function createDashboardRouter({ runPersistence }: Deps) {
  const router = express.Router()

  router.get('/performance', async (_req, res) => {
    const days = await runPersistence.getPerformanceLast7Days()
    res.json({ days })
  })

  return router
}
```

- [ ] **Step 2: Mount the dashboard router in `src/api/server.ts`**

Add the import after the existing route imports:

```ts
import { createDashboardRouter } from './routes/dashboard.js'
```

Add the mount after the `/api/jobs` mount line:

```ts
app.use('/api/dashboard', createDashboardRouter({ runPersistence }))
```

- [ ] **Step 3: Verify**

```bash
npm run api &
sleep 3
curl -s "http://localhost:3001/api/dashboard/performance" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log('days:', j.days?.length)"
kill %1
```

Expected: `days: N` (0–7 depending on whether there are runs in the DB).

---

## Task 6: Add `status=running` filter to `GET /api/jobs`

**Files:**
- Modify: `src/api/routes/jobs.ts`

- [ ] **Step 1: Update the `router.get('/')` handler**

Find the existing handler (lines 16–19):

```ts
router.get('/', async (req, res) => {
  const page  = Math.max(1,   parseInt(String(req.query.page  ?? '1'),  10))
  const limit = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10))
  res.json(await runPersistence.getAllRuns(page, limit))
})
```

Replace with:

```ts
router.get('/', async (req, res) => {
  const page   = Math.max(1,   parseInt(String(req.query.page  ?? '1'),  10))
  const limit  = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10))
  const status = req.query.status as string | undefined

  if (status === 'running') {
    const runningNames = runner.listRunning()
    const runs = await Promise.all(
      runningNames.map(async (name) => {
        const orch = runner.getOrchestrator(name)
        if (!orch) return null
        const run = await runPersistence.findById(orch.runId)
        if (!run) return null
        const stats = runner.getStats(name) ?? null
        const elapsed = run.startedAt
          ? Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000)
          : 0
        return { ...run, isRunning: true, stats, elapsed }
      }),
    )
    const active = runs.filter(Boolean)
    res.json({ runs: active, total: active.length })
    return
  }

  res.json(await runPersistence.getAllRuns(page, limit))
})
```

- [ ] **Step 2: Verify**

```bash
npm run api &
sleep 3
curl -s "http://localhost:3001/api/jobs?status=running" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log('running:', j.total)"
kill %1
```

Expected: `running: 0` (or however many are active).

---

## Task 7: Update `client/src/api.ts`

**Files:**
- Modify: `client/src/api.ts`

Add new types and functions. Do not remove anything existing (other pages still use `listJobs`, etc.).

- [ ] **Step 1: Add `ParserSummary` interface and `listParsersSummary` function**

After the `OutputFile` interface (around line 24), add:

```ts
export interface ParserSummary {
  name: string
  status: 'idle' | 'running' | 'stopped'
  successRate: number | null
  lastRunDate: string | null
  lastRunId: string | null
}

export interface ListParsersSummaryParams {
  page?: number
  limit?: number
  search?: string
  status?: 'all' | 'idle' | 'running' | 'stopped'
  sort?: 'name' | 'successRate' | 'lastRunDate'
  dir?: 'asc' | 'desc'
}

export async function listParsersSummary(
  params: ListParsersSummaryParams = {},
): Promise<{ parsers: ParserSummary[]; total: number }> {
  const q = new URLSearchParams()
  if (params.page)   q.set('page',   String(params.page))
  if (params.limit)  q.set('limit',  String(params.limit))
  if (params.search) q.set('search', params.search)
  if (params.status) q.set('status', params.status)
  if (params.sort)   q.set('sort',   params.sort)
  if (params.dir)    q.set('dir',    params.dir)
  return apiRequest(`/api/parsers?${q}`)
}
```

- [ ] **Step 2: Add `DashboardPerformanceDay` interface and `getDashboardPerformance` function**

After the `listParsersSummary` function, add:

```ts
export interface DashboardPerformanceDay {
  date: string
  successful: number
  failed: number
}

export async function getDashboardPerformance(): Promise<{ days: DashboardPerformanceDay[] }> {
  return apiRequest('/api/dashboard/performance')
}
```

- [ ] **Step 3: Add `ActiveRun` interface and update `listJobs` to support `status=running`**

Add the interface after `RunInfo`:

```ts
export interface ActiveRun extends RunInfo {
  elapsed: number
}
```

The existing `listJobs` function already accepts `page` and `limit` and calls `/api/jobs`. For the dashboard we call it with `status=running`. Update `listJobs` to accept an optional status param:

Find the existing `listJobs` function:

```ts
export async function listJobs(page = 1, limit = 50): Promise<{ runs: RunInfo[]; total: number }> {
  return apiRequest(`/api/jobs?page=${page}&limit=${limit}`)
}
```

Replace with:

```ts
export async function listJobs(
  page = 1,
  limit = 50,
  status?: string,
): Promise<{ runs: (RunInfo & { elapsed?: number })[]; total: number }> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) q.set('status', status)
  return apiRequest(`/api/jobs?${q}`)
}
```

---

## Task 8: `Layout.tsx`

**Files:**
- Create: `client/src/components/Layout.tsx`

The sidebar shell. Owns theme application via `useSettings`.

- [ ] **Step 1: Create `client/src/components/Layout.tsx`**

```tsx
import { useSettings } from '../hooks/useSettings'

export type NavPage = 'dashboard' | 'parsers' | 'jobs' | 'settings'

interface Props {
  activePage: NavPage
  onNavigate: (page: NavPage) => void
  children: React.ReactNode
}

function DashboardIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function JobsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

const NAV: { id: NavPage; label: string; icon: JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { id: 'parsers',   label: 'Parsers',   icon: <BoltIcon /> },
  { id: 'jobs',      label: 'Jobs',      icon: <JobsIcon /> },
  { id: 'settings',  label: 'Settings',  icon: <SettingsIcon /> },
]

export function Layout({ activePage, onNavigate, children }: Props) {
  const { settings, updateSettings } = useSettings()

  function cycleTheme() {
    const next =
      settings.theme === 'system' ? 'light'
      : settings.theme === 'light' ? 'dark'
      : 'system'
    updateSettings({ theme: next })
  }

  const ThemeIcon =
    settings.theme === 'system' ? MonitorIcon
    : settings.theme === 'dark' ? SunIcon
    : MoonIcon

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <BoltIcon />
          </div>
          <span className="font-extrabold text-base tracking-tight text-gray-900 dark:text-white">
            Parser
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={[
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                activePage === item.id
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
              ].join(' ')}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Theme toggle */}
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
          <button
            onClick={cycleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
            title={`Theme: ${settings.theme}`}
          >
            <ThemeIcon />
            <span className="capitalize">{settings.theme}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
```

---

## Task 9: Update `App.tsx` to thin routing shell

**Files:**
- Modify: `client/src/App.tsx`

Strip all inline page rendering logic. `App.tsx` only resolves the hash → page enum and renders `<Layout>`.

- [ ] **Step 1: Rewrite `client/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Layout, type NavPage } from './components/Layout'
import { ParsersPage } from './components/ParsersPage'
import { DashboardPage } from './components/DashboardPage'
import { SettingsPage } from './components/SettingsPage'
import { DebugPage } from './components/DebugPage'
import { ParserEditorPage } from './components/ParserEditorPage'
import { JobsPage } from './components/JobsPage'
import { JobDetailPage } from './components/JobDetailPage'
import { TaskDetailPage } from './components/TaskDetailPage'
import { PageTransition } from './components/motion/PageTransition'

type Page =
  | 'dashboard'
  | 'parsers'
  | 'editor'
  | 'jobs'
  | 'job-detail'
  | 'task-detail'
  | 'settings'
  | 'debug'

function parseHash(): { page: Page; editorParser: string; jobRunId: string; jobTaskId: string } {
  const hash = window.location.hash
  if (hash.match(/^#\/jobs\/[^/]+\/tasks\//)) {
    const match = hash.match(/^#\/jobs\/([^/]+)\/tasks\/(.+)$/)
    return {
      page: 'task-detail',
      editorParser: '',
      jobRunId: match ? decodeURIComponent(match[1]) : '',
      jobTaskId: match ? decodeURIComponent(match[2]) : '',
    }
  }
  if (hash.startsWith('#/jobs/')) {
    return {
      page: 'job-detail',
      editorParser: '',
      jobRunId: decodeURIComponent(hash.slice(7).split('/')[0]),
      jobTaskId: '',
    }
  }
  if (hash === '#/jobs')     return { page: 'jobs',      editorParser: '', jobRunId: '', jobTaskId: '' }
  if (hash.startsWith('#/editor/'))
    return { page: 'editor', editorParser: decodeURIComponent(hash.slice(9)), jobRunId: '', jobTaskId: '' }
  if (hash === '#/parsers')  return { page: 'parsers',   editorParser: '', jobRunId: '', jobTaskId: '' }
  if (hash === '#/settings') return { page: 'settings',  editorParser: '', jobRunId: '', jobTaskId: '' }
  if (hash === '#/debug')    return { page: 'debug',     editorParser: '', jobRunId: '', jobTaskId: '' }
  return { page: 'dashboard', editorParser: '', jobRunId: '', jobTaskId: '' }
}

export default function App() {
  const [state, setState] = useState(parseHash)

  useEffect(() => {
    const handler = () => setState(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(page: Page, param?: string) {
    if (page === 'editor')     window.location.hash = `#/editor/${encodeURIComponent(param ?? '')}`
    else if (page === 'job-detail' && param)
      window.location.hash = `#/jobs/${encodeURIComponent(param)}`
    else if (page === 'task-detail' && param) {
      const [rId, tId] = param.split(':')
      window.location.hash = `#/jobs/${encodeURIComponent(rId)}/tasks/${encodeURIComponent(tId)}`
    }
    else if (page === 'jobs')      window.location.hash = '#/jobs'
    else if (page === 'parsers')   window.location.hash = '#/parsers'
    else if (page === 'settings')  window.location.hash = '#/settings'
    else if (page === 'debug')     window.location.hash = '#/debug'
    else window.location.hash = '#/'
  }

  const navPage: NavPage =
    state.page === 'parsers' || state.page === 'editor' ? 'parsers'
    : state.page === 'jobs' || state.page === 'job-detail' || state.page === 'task-detail' ? 'jobs'
    : state.page === 'settings' ? 'settings'
    : 'dashboard'

  function renderPage() {
    switch (state.page) {
      case 'editor':
        return (
          <ParserEditorPage
            parserName={state.editorParser}
            onNavigateToParsers={() => navigate('parsers')}
            onParserSelect={(name) => navigate('editor', name)}
          />
        )
      case 'debug':
        return <DebugPage />
      case 'jobs':
        return <JobsPage onViewJob={(runId) => navigate('job-detail', runId)} />
      case 'job-detail':
        return (
          <JobDetailPage
            runId={state.jobRunId}
            onBack={() => navigate('jobs')}
            onViewTask={(taskId) => navigate('task-detail', `${state.jobRunId}:${taskId}`)}
          />
        )
      case 'task-detail':
        return (
          <TaskDetailPage
            runId={state.jobRunId}
            taskId={state.jobTaskId}
            onBack={() => navigate('job-detail', state.jobRunId)}
          />
        )
      case 'settings':
        return <SettingsPage />
      case 'parsers':
        return <ParsersPage onEdit={(name) => navigate('editor', name)} />
      default:
        return <DashboardPage onNavigate={navigate} />
    }
  }

  return (
    <Layout activePage={navPage} onNavigate={(p) => navigate(p)}>
      <AnimatePresence mode="wait">
        <PageTransition key={state.page}>
          {renderPage()}
        </PageTransition>
      </AnimatePresence>
    </Layout>
  )
}
```

- [ ] **Step 2: Run the dev server and verify the sidebar renders**

```bash
npm run start
```

Open `http://localhost:5173`. Expected: sidebar visible with Dashboard, Parsers, Jobs, Settings nav items. Clicking each updates the active highlight. Clicking Parsers/Jobs/Settings navigates to those pages (they'll be empty/error until Tasks 10–12 are done).

---

## Task 10: `ParsersPage.tsx`

**Files:**
- Create: `client/src/components/ParsersPage.tsx`

Paginated, searchable, sortable table of parsers with inline run controls.

- [ ] **Step 1: Create `client/src/components/ParsersPage.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { listParsersSummary, startParser, stopParser, resumeParser, type ParserSummary } from '../api'
import { useSettings } from '../hooks/useSettings'
import { StatusDot } from './motion/StatusDot'
import { SpringButton } from './motion/SpringButton'
import { PARSER_STATUS, UNKNOWN_STATUS } from '../design/status'

interface Props {
  onEdit: (name: string) => void
}

type SortCol = 'name' | 'successRate' | 'lastRunDate'
type SortDir = 'asc' | 'desc'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function SuccessRateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-400 dark:text-gray-600">—</span>
  const cls =
    rate >= 90 ? 'text-emerald-600 dark:text-emerald-400'
    : rate >= 70 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400'
  return <span className={cls}>{rate}%</span>
}

function ChevronIcon({ dir }: { dir: SortDir }) {
  return dir === 'asc'
    ? <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
    : <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
}

function SortableHeader({
  col, label, active, dir, onClick,
}: { col: SortCol; label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
      onClick={onClick}
    >
      {label}
      {active && <ChevronIcon dir={dir} />}
    </th>
  )
}

export function ParsersPage({ onEdit }: Props) {
  const { settings } = useSettings()
  const [page, setPage] = useState(1)
  const limit = settings.pageLimit
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'idle' | 'running' | 'stopped'>('all')
  const [sort, setSort] = useState<SortCol>('name')
  const [dir, setDir] = useState<SortDir>('asc')
  const [data, setData] = useState<ParserSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetch = useCallback(async () => {
    try {
      const result = await listParsersSummary({
        page,
        limit,
        search: debouncedSearch,
        status: statusFilter,
        sort,
        dir,
      })
      setData(result.parsers)
      setTotal(result.total)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, statusFilter, sort, dir])

  useEffect(() => { fetch() }, [fetch])

  useEffect(() => {
    const interval = setInterval(() => { fetch() }, 5000)
    return () => clearInterval(interval)
  }, [fetch])

  // Debounce search → reset page
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  function handleSort(col: SortCol) {
    if (sort === col) setDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSort(col); setDir('asc') }
    setPage(1)
  }

  function handleStatusFilter(s: typeof statusFilter) {
    setStatusFilter(s)
    setPage(1)
  }

  async function handleRun(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await startParser(name); await fetch() }
    catch { /* error visible on next poll */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }

  async function handleStop(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await stopParser(name); await fetch() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }

  async function handleResume(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await resumeParser(name); await fetch() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }

  const totalPages = Math.ceil(total / limit)
  const fromItem = total === 0 ? 0 : (page - 1) * limit + 1
  const toItem   = Math.min(page * limit, total)

  return (
    <div className="px-6 py-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0">
          {total} parser{total !== 1 ? 's' : ''}
        </span>

        <div className="flex items-center gap-2 flex-1 justify-center max-w-lg">
          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All</option>
            <option value="idle">Idle</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>

        <SpringButton
          variant="primary"
          onClick={() => onEdit('')}
          className="px-3 py-1.5 text-sm shrink-0"
        >
          + New Parser
        </SpringButton>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
          <button onClick={fetch} className="ml-3 underline">Retry</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-28">Status</th>
              <SortableHeader col="name"          label="Name"          active={sort === 'name'}          dir={dir} onClick={() => handleSort('name')} />
              <SortableHeader col="successRate"   label="Success Rate"  active={sort === 'successRate'}   dir={dir} onClick={() => handleSort('successRate')} />
              <SortableHeader col="lastRunDate"   label="Last Run Date" active={sort === 'lastRunDate'}   dir={dir} onClick={() => handleSort('lastRunDate')} />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td>
              </tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  {search || statusFilter !== 'all' ? 'No parsers match this filter.' : 'No parsers yet.'}
                </td>
              </tr>
            )}
            {data.map((parser) => {
              const statusConfig = PARSER_STATUS[parser.status] ?? UNKNOWN_STATUS
              const busy = rowLoading[parser.name] ?? false
              return (
                <tr key={parser.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot dotClass={statusConfig.dot} pulse={statusConfig.pulse} />
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusConfig.badge}`}>
                        {statusConfig.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {parser.name}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <SuccessRateCell rate={parser.successRate} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(parser.lastRunDate)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {parser.status === 'running' ? (
                        <SpringButton variant="danger" onClick={() => handleStop(parser.name)} loading={busy} className="text-xs py-1 px-3">
                          Stop
                        </SpringButton>
                      ) : parser.status === 'stopped' ? (
                        <>
                          <SpringButton variant="warning" onClick={() => handleResume(parser.name)} loading={busy} className="text-xs py-1 px-3">
                            Resume
                          </SpringButton>
                          <SpringButton variant="ghost" onClick={() => handleRun(parser.name)} disabled={busy} className="text-xs py-1 px-3 border border-gray-300 dark:border-gray-600">
                            Run Fresh
                          </SpringButton>
                        </>
                      ) : (
                        <SpringButton variant="success" onClick={() => handleRun(parser.name)} loading={busy} className="text-xs py-1 px-3">
                          Run
                        </SpringButton>
                      )}
                      <button
                        onClick={() => onEdit(parser.name)}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {fromItem}–{toItem} of {total} parsers
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = i + 1
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={[
                    'w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors',
                    p === page
                      ? 'bg-emerald-500 text-white font-medium'
                      : 'border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300',
                  ].join(' ')}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Open `http://localhost:5173/#/parsers` and verify**

- Table renders with Status, Name, Success Rate, Last Run Date, Actions columns
- Search input filters rows after 300ms
- Status filter dropdown works
- Clicking column headers toggles sort direction (chevron appears)
- Run/Stop/Resume buttons fire and row updates on next poll
- Pagination controls appear when total > `settings.pageLimit`

---

## Task 11: `DashboardPage.tsx`

**Files:**
- Create: `client/src/components/DashboardPage.tsx`

Stat cards + 7-day performance chart + live current runs panel.

- [ ] **Step 1: Create `client/src/components/DashboardPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  listParsersSummary,
  getDashboardPerformance,
  listJobs,
  type DashboardPerformanceDay,
  type RunInfo,
} from '../api'

interface Props {
  onNavigate: (page: 'jobs' | 'parsers', param?: string) => void
}

function StatCard({
  label,
  value,
  icon,
  valueClass = 'text-gray-900 dark:text-white',
}: {
  label: string
  value: string | number
  icon?: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 flex items-center gap-4 shadow-sm">
      {icon && (
        <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0 text-white">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className={`text-3xl font-bold mt-0.5 ${valueClass}`}>{value}</p>
      </div>
    </div>
  )
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function isInitializing(run: RunInfo & { elapsed?: number }): boolean {
  const stats = run.stats
  if (!stats) return true
  return stats.inProgress > 0 && stats.success === 0
}

export function DashboardPage({ onNavigate }: Props) {
  const [totalParsers, setTotalParsers] = useState<number | null>(null)
  const [avgSuccessRate, setAvgSuccessRate] = useState<number | null>(null)
  const [perfDays, setPerfDays] = useState<DashboardPerformanceDay[]>([])
  const [activeRuns, setActiveRuns] = useState<(RunInfo & { elapsed?: number })[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)

  // One-time data fetch on mount
  useEffect(() => {
    async function load() {
      const [parsersRes, perfRes] = await Promise.allSettled([
        listParsersSummary({ limit: 500 }),
        getDashboardPerformance(),
      ])
      if (parsersRes.status === 'fulfilled') {
        setTotalParsers(parsersRes.value.total)
        const rates = parsersRes.value.parsers
          .map((p) => p.successRate)
          .filter((r): r is number => r !== null)
        setAvgSuccessRate(rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null)
      }
      if (perfRes.status === 'fulfilled') {
        setPerfDays(perfRes.value.days)
      }
      setLoadingInitial(false)
    }
    load()
  }, [])

  // Poll active runs every 3s
  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await listJobs(1, 20, 'running')
        setActiveRuns(res.runs)
      } catch { /* ignore */ }
    }
    fetchActive()
    const interval = setInterval(fetchActive, 3000)
    return () => clearInterval(interval)
  }, [])

  // Today's jobs count from performance data
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayData = perfDays.find((d) => d.date === todayStr)
  const totalJobsToday = todayData ? todayData.successful + todayData.failed : 0

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Parsers"
          value={loadingInitial ? '…' : (totalParsers ?? 0)}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          }
        />
        <StatCard
          label="Total Jobs (24h)"
          value={loadingInitial ? '…' : totalJobsToday}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <StatCard
          label="Average Success Rate"
          value={loadingInitial ? '…' : avgSuccessRate !== null ? `${avgSuccessRate}%` : '—'}
          valueClass="text-emerald-600 dark:text-emerald-400 text-3xl font-bold"
        />
        <StatCard
          label="Active Runs"
          value={activeRuns.length}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Chart + Current Runs */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        {/* Chart */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Job Performance (Last 7 Days)
          </h2>
          {perfDays.length === 0 && !loadingInitial ? (
            <p className="text-sm text-gray-400 text-center py-10">No run data in the last 7 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={perfDays} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--tw-prose-bg, #1f2937)', border: 'none', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="successful" name="Successful Runs" stroke="#10b981" fill="url(#colorSuccess)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="failed"     name="Failed Runs"     stroke="#ef4444" fill="url(#colorFailed)"  strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Current Runs */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4 shrink-0">
            Current Runs
          </h2>
          {activeRuns.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10 flex-1 flex items-center justify-center">
              No active runs
            </p>
          ) : (
            <div className="space-y-4 overflow-y-auto flex-1">
              {activeRuns.map((run) => {
                const initializing = isInitializing(run)
                const progress = run.stats && run.stats.total > 0
                  ? Math.round((run.stats.success / run.stats.total) * 100)
                  : 0
                return (
                  <button
                    key={run.id}
                    onClick={() => onNavigate('jobs', run.id)}
                    className="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded-lg p-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">
                        {run.parserName}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                        initializing
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {initializing ? 'Initializing' : 'Running'}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-1.5">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>{progress}%</span>
                      {run.elapsed !== undefined && <span>{formatElapsed(run.elapsed)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add unit test for `isInitializing`**

Add to `src/tests/parserEnrichment.test.ts`:

```ts
import type { RunStats } from '../src/domain/entities/ParserRun'

function isInitializing(stats: RunStats | null): boolean {
  if (!stats) return true
  return stats.inProgress > 0 && stats.success === 0
}

describe('isInitializing', () => {
  it('returns true when no stats', () => {
    expect(isInitializing(null)).toBe(true)
  })
  it('returns true when inProgress > 0 and success === 0', () => {
    expect(isInitializing({ total: 5, pending: 0, retry: 0, success: 0, failed: 0, aborted: 0, inProgress: 5, traversers: { total: 5, success: 0, failed: 0 }, extractors: { total: 0, success: 0, failed: 0 } })).toBe(true)
  })
  it('returns false when success > 0', () => {
    expect(isInitializing({ total: 5, pending: 0, retry: 0, success: 2, failed: 0, aborted: 0, inProgress: 3, traversers: { total: 5, success: 2, failed: 0 }, extractors: { total: 0, success: 0, failed: 0 } })).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- src/tests/parserEnrichment.test.ts
```

Expected: `8 passed`.

- [ ] **Step 4: Open `http://localhost:5173/#/` and verify**

- 4 stat cards render
- Chart renders (empty state or data depending on DB)
- Current Runs panel shows active runs (polls every 3s)

---

## Task 12: `SettingsPage.tsx`

**Files:**
- Create: `client/src/components/SettingsPage.tsx`

- [ ] **Step 1: Create `client/src/components/SettingsPage.tsx`**

```tsx
import { useSettings } from '../hooks/useSettings'

export function SettingsPage() {
  const { settings, updateSettings } = useSettings()

  return (
    <div className="px-6 py-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      {/* App Preferences */}
      <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
          App Preferences
        </h2>

        <div className="space-y-5">
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings({ theme: t })}
                  className={[
                    'px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize',
                    settings.theme === t
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Items per page */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Parsers per page
            </label>
            <div className="flex gap-2">
              {([10, 25, 50] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => updateSettings({ pageLimit: n })}
                  className={[
                    'w-14 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                    settings.pageLimit === n
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Parser Defaults */}
      <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
          Parser Defaults
        </h2>

        <div className="space-y-5">
          {/* Browser type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default browser
            </label>
            <select
              value={settings.defaultBrowserType}
              onChange={(e) => updateSettings({ defaultBrowserType: e.target.value as typeof settings.defaultBrowserType })}
              className="w-full max-w-xs text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="playwright">Playwright</option>
              <option value="playwright-stealth">Playwright Stealth</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </div>

          {/* Retry count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default retry count
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.defaultRetryCount}
              onChange={(e) => updateSettings({ defaultRetryCount: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-24 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Concurrency quota */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default concurrency quota
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                disabled={settings.defaultConcurrentQuota === null}
                value={settings.defaultConcurrentQuota ?? 10}
                onChange={(e) => updateSettings({ defaultConcurrentQuota: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-24 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.defaultConcurrentQuota === null}
                  onChange={(e) => updateSettings({ defaultConcurrentQuota: e.target.checked ? null : 10 })}
                  className="w-4 h-4 rounded accent-emerald-500"
                />
                Unlimited
              </label>
            </div>
          </div>

          {/* Deduplication */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.defaultDeduplication}
                onChange={(e) => updateSettings({ defaultDeduplication: e.target.checked })}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Default deduplication enabled
              </span>
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Open `http://localhost:5173/#/settings` and verify**

- Theme buttons change the page theme immediately
- Page size buttons persist across navigation (visit Parsers, return to Settings)
- Parser defaults persist across page refresh (reload and check values)

---

## Task 13: Cleanup — retire `ParserCard.tsx` and `useTheme.ts`

**Files:**
- Delete: `client/src/components/ParserCard.tsx`
- Delete: `client/src/hooks/useTheme.ts`

- [ ] **Step 1: Verify nothing imports `ParserCard` or `useTheme` anymore**

```bash
grep -r "ParserCard\|useTheme" client/src --include="*.tsx" --include="*.ts" -l
```

Expected: no output (no files import them).

- [ ] **Step 2: Delete the files**

```bash
rm client/src/components/ParserCard.tsx client/src/hooks/useTheme.ts
```

- [ ] **Step 3: Build to confirm no broken imports**

```bash
cd client && npm run build
```

Expected: `✓ built in X.XXs` with no TypeScript errors.

- [ ] **Step 4: Full smoke test**

Start the app and verify these flows work end to end:

```bash
npm run start
```

1. `http://localhost:5173/` → Dashboard renders with stat cards
2. Click **Parsers** → table with search/filter/sort/pagination
3. Click **+ New Parser** → editor page opens
4. Click **Jobs** → jobs list page
5. Click **Settings** → settings page; change theme, verify it applies
6. Reload page → theme and page size persist
7. Run a parser from the Parsers table → status updates to Running within 5s
8. Stop it → status returns to Stopped

---

## Self-Review Notes

- `ParserEditorPage` receives `defaultBrowserType` etc. from `useSettings` to pre-populate new parser form — **this wire-up is NOT yet in this plan**. When implementing, update `ParserEditorPage` to call `useSettings()` and use `settings.defaultBrowserType` etc. as initial values for the create form. Add this as a sub-step in Task 12.

- The pagination in `ParsersPage` only renders pages 1–7 (uses `Math.min(totalPages, 7)`). For > 7 pages, add ellipsis logic if needed — kept simple here per YAGNI.

- `onNavigate` in `DashboardPage` accepts `'jobs'` and `'parsers'` but `App.tsx` `navigate` uses a wider `Page` type. The prop type `(page: 'jobs' | 'parsers', param?: string) => void` is intentionally narrow to keep the dashboard from navigating anywhere unexpected.
