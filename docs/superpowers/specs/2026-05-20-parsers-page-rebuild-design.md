# Parsers Page Rebuild — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Client shell restructure + ParsersPage table + DashboardPage + SettingsPage + enriched API endpoints

---

## Background

The current parsers page lives inline in `App.tsx` and renders a card grid. It has no search, filter, sort, or pagination. The `listParsers()` API returns only `string[]` — no success rate or last run date. Navigation is a minimal top bar with two tabs (Parsers, Jobs).

The redesign introduces a left sidebar layout, a proper data table for parsers, a dashboard with live stats and a 7-day performance chart, and a settings page for global defaults.

---

## Architecture

### Shell restructure

`App.tsx` becomes a thin routing shell:
- Reads `window.location.hash` and resolves the active `Page` enum value
- Renders `<Layout page={page} navigate={navigate} />`
- All inline page rendering logic moves out

`Layout.tsx` (new):
- Two-column flex shell: fixed left sidebar (~220px) + flex-1 scrollable main area
- Sidebar contains: logo, nav items (Dashboard, Parsers, Jobs, Settings), theme toggle at bottom
- Main area renders the active page component via a switch
- The current top header bar is removed entirely; sidebar owns all navigation
- Active nav item highlighted with emerald background, same design tokens as today (`emerald-100 dark:emerald-900/40`, `emerald-700 dark:emerald-300`)

### Page components

| Component | File | Status |
|-----------|------|--------|
| `ParsersPage` | `client/src/components/ParsersPage.tsx` | New |
| `DashboardPage` | `client/src/components/DashboardPage.tsx` | New |
| `SettingsPage` | `client/src/components/SettingsPage.tsx` | New |
| `JobsPage` | existing | Unchanged |
| `JobDetailPage` | existing | Unchanged |
| `TaskDetailPage` | existing | Unchanged |
| `ParserEditorPage` | existing | Unchanged |
| `DebugPage` | existing | Unchanged |

`ParserCard.tsx` is retired — its run/stop/resume logic migrates into `ParsersPage` row actions.

### Routing

Hash-based routing is preserved. New routes added:

| Hash | Page |
|------|------|
| `#/` or `#/dashboard` | Dashboard |
| `#/parsers` | Parsers list |
| `#/editor/:name` | Parser editor (existing) |
| `#/jobs` | Jobs list (existing) |
| `#/jobs/:runId` | Job detail (existing) |
| `#/jobs/:runId/tasks/:taskId` | Task detail (existing) |
| `#/settings` | Settings |

Default route (`#/`) now resolves to Dashboard instead of Parsers.

---

## Backend Changes

### 1. Enriched parsers list endpoint

`GET /api/parsers?page=1&limit=10&search=&status=&sort=name&dir=asc`

Query params:
- `page` (integer, default 1)
- `limit` (integer, default 10)
- `search` (string, name substring match, case-insensitive)
- `status` (enum: `all` | `idle` | `running` | `stopped`, default `all`)
- `sort` (enum: `name` | `successRate` | `lastRunDate`, default `name`)
- `dir` (enum: `asc` | `desc`, default `asc`)

Response:
```json
{
  "parsers": [
    {
      "name": "bauer",
      "status": "idle",
      "successRate": 98,
      "lastRunDate": "2023-10-26T14:30:00Z",
      "lastRunId": "uuid-or-null"
    }
  ],
  "total": 42
}
```

Implementation: single SQL query joining `parsers` with latest `parserRuns` (window function or correlated subquery for latest-per-parser) and a `runTasks` aggregate for success/total counts. No N+1.

`status` derivation:
- `running` → latest parserRun has `status = 'running'`
- `stopped` → latest parserRun has `status = 'stopped'`
- `idle` → no runs, or latest run is `completed` / `failed`

`successRate` = `ROUND(success_count / total_count * 100)` from latest completed run's tasks. `null` if no runs.

`lastRunDate` = `startedAt` of the most recent `parserRun`. `null` if no runs.

The old `listParsers()` client function is replaced with `listParsersSummary(params)` returning `{ parsers: ParserSummary[], total: number }`.

### 2. Dashboard performance endpoint

`GET /api/dashboard/performance`

Response:
```json
{
  "days": [
    { "date": "2026-05-14", "successful": 142, "failed": 28 },
    ...
  ]
}
```

Returns last 7 calendar days. `successful` = count of `parserRuns` with `status = 'completed'` on that date. `failed` = count with `status = 'failed'`.

Implementation: single SQL `GROUP BY DATE(started_at)` query on `parserRuns`.

### 3. Dashboard stats

No new endpoint. `DashboardPage` composes:
- `GET /api/parsers?limit=1` → `total` field gives Total Parsers
- `GET /api/jobs?status=running&limit=20` → active runs list + count for Active Runs stat
- `GET /api/dashboard/performance` → last-24h totals derivable from the same data (sum of today's day entry)
- Average Success Rate computed client-side from `GET /api/parsers?limit=100` summary

### 4. Jobs status filter

`GET /api/jobs?status=running` — if not already supported, add `status` filter to the jobs list query.

---

## ParsersPage Component

**State:**
```ts
page: number          // current page, default 1
limit: number         // from useSettings, default 10
search: string        // debounced 300ms, resets page to 1
statusFilter: string  // 'all'|'idle'|'running'|'stopped', resets page to 1
sort: { column: 'name'|'successRate'|'lastRunDate', dir: 'asc'|'desc' }
data: ParserSummary[]
total: number
loading: boolean
error: string | null
```

**Polling:** refetch on 5s interval (keeps row statuses live without SSE per row).

**Toolbar (above table):**
- Left: `N parsers` count label
- Center: search input (magnifier icon) + Filter dropdown (All / Idle / Running / Stopped)
- Right: `+ New Parser` button → navigates to `#/editor/`

**Table columns:**

| Column | Content | Sortable |
|--------|---------|----------|
| Status | `StatusDot` + badge text | No |
| Name | Parser name string | Yes |
| Success Rate | `XX%` (green ≥90, amber 70–89, red <70) or `—` | Yes |
| Last Run Date | `Oct 26, 2023` or `—` | Yes |
| Actions | Run/Stop/Resume + Edit | No |

Clicking a sortable column header toggles `asc` → `desc` → `asc`. Active sort column shows a direction chevron.

**Actions column:**
- Idle: green `Run` button
- Running: red `Stop` button  
- Stopped: amber `Resume` + ghost `Run Fresh` button pair
- Edit: always-visible ghost button → `#/editor/:name`
- Loading state per row (button shows spinner, row slightly dimmed)

**Pagination (below table):**
- "Showing X–Y of Z parsers" label on left
- Page number buttons + prev/next chevrons on right
- Hidden when total ≤ limit

**Success rate color logic:**
```ts
rate >= 90  → emerald-600 dark:emerald-400
rate >= 70  → amber-600 dark:amber-400
rate < 70   → red-600 dark:red-400
null        → gray-400 ("—")
```

---

## DashboardPage Component

**Stat cards (top row, 4 columns):**

| Card | Value | Icon |
|------|-------|------|
| Total Parsers | `total` from parsers list | grid icon |
| Total Jobs (24h) | sum of today's `successful + failed` from performance data | clipboard icon |
| Average Success Rate | mean of all parser `successRate` values | — (large green text, no icon box) |
| Active Runs | count of `GET /api/jobs?status=running` results | bolt icon |

**Job Performance chart (left, ~65% width):**
- Library: **Recharts** `AreaChart` (new dependency, ~50KB gzipped)
- Two `Area` series: Successful (emerald, `#10b981`) + Failed (red, `#ef4444`) with 20% opacity fill
- X-axis: abbreviated date labels
- Y-axis: auto-scaled
- Legend: dot + label for each series
- Data from `GET /api/dashboard/performance`

**Current Runs panel (right, ~35% width):**
- Polls `GET /api/jobs?status=running&limit=20` every 3s
- Each row: parser name | status badge | progress bar | elapsed time
- `status` badge: "Running" (emerald) or "Initializing" (amber — run where `inProgress > 0` but `success === 0`)
- Progress bar width: `successCount / totalCount * 100` (from run stats)
- Elapsed time: `now - startedAt` formatted as `Xm Ys`
- Empty state: "No active runs" centered message

---

## SettingsPage Component

**Parser Defaults section** (persisted to `localStorage` key `parser-defaults`):
- Default browser type: select (Playwright / Playwright Stealth / Puppeteer)
- Default retry count: number input (1–10)
- Default concurrency quota: number input + "Unlimited" checkbox
- Default deduplication: toggle

These values are read by `ParserEditorPage` when `parserName` is empty (new parser) to pre-populate form fields.

**App Preferences section** (absorbed into existing `useTheme` / new `useSettings` hook):
- Theme: Light / Dark / System — button group, replaces the header toggle
- Items per page: 10 / 25 / 50 — read by `ParsersPage` as default `limit`

**`useSettings` hook** (new, `client/src/hooks/useSettings.ts`):
- Wraps `localStorage` reads/writes
- Exports: `settings`, `updateSettings(partial)`
- `useTheme` is refactored to delegate to `useSettings` so theme state has one source of truth

No save button — settings apply immediately on change.

---

## Error Handling

- `ParsersPage`: inline error banner above table on fetch failure, retry button
- `DashboardPage`: each data section (cards, chart, current runs) fails independently with a small inline error state — one broken endpoint doesn't blank the whole page
- `SettingsPage`: no async operations, no error states needed

---

## Testing Considerations

- `ParsersPage` query-param logic (search debounce, filter, sort, page reset) is pure state logic — unit-testable without DOM
- `DashboardPage` `Initializing` status derivation (inProgress > 0 && success === 0) should have a unit test
- Backend: `GET /api/parsers` enriched query — integration test covering search, status filter, sort, pagination
- Backend: `GET /api/dashboard/performance` — integration test for date grouping

---

## Files Changed

**New client files:**
- `client/src/components/Layout.tsx`
- `client/src/components/ParsersPage.tsx`
- `client/src/components/DashboardPage.tsx`
- `client/src/components/SettingsPage.tsx`
- `client/src/hooks/useSettings.ts`

**Modified client files:**
- `client/src/App.tsx` — stripped to routing shell
- `client/src/api.ts` — `listParsers` → `listParsersSummary`, add `getDashboardPerformance`
- `client/src/hooks/useTheme.ts` — delegates to `useSettings`

**Retired client files:**
- `client/src/components/ParserCard.tsx` (run logic migrates inline to ParsersPage)

**New server files:**
- `src/api/routes/dashboard.ts` — `GET /api/dashboard/performance`

**Modified server files:**
- `src/api/routes/parsers.ts` — enrich `GET /api/parsers` with page/search/status/sort params
- `src/api/routes/jobs.ts` — add `status` filter to `GET /api/jobs`
- `src/api/index.ts` — mount dashboard router
