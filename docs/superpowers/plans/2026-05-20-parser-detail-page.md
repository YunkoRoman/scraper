# Parser Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all `/api/parsers/:name/…` routes to use parser UUID (`/:id`) throughout the full stack, then build a `ParserDetailPage` at `#/parsers/:id` showing per-parser stats, recent runs, and a CSV data preview.

**Architecture:** `router.param('id', ...)` replaces `router.param('name', ...)` in `parsers.ts`, using `parserService.findById(id)` (already exists in `ParserPersistenceService`). All client API functions are updated to embed the UUID in the URL. App.tsx hash routing changes `#/editor/:name` → `#/editor/:id` and adds `#/parsers/:id` for the new detail page. The new stats aggregation queries `parser_runs` by `parser_name` internally — the route just bridges the ID to the name via `res.locals.parser.name`.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), React 19, Tailwind CSS, Vitest

---

## File Map

**New files:**
- `client/src/components/ParserDetailPage.tsx`
- `src/tests/parserDetail.test.ts`

**Modified server files:**
- `src/infrastructure/db/RunPersistenceService.ts` — add `ParserStats`, `getParserStats`, extend `getAllRuns`, add `id` to `RawParserEnriched` + `listParsersWithLatestRun`
- `src/api/routes/parsers.ts` — migrate `router.param` + all paths to `/:id`, add `GET /:id/stats`
- `src/api/routes/jobs.ts` — add optional `?parserName=` filter to `GET /`

**Modified client files:**
- `client/src/api.ts` — add `id` to `ParserSummary`, migrate all parser-URL functions to use UUID, add `getParserStats` + `fetchFileContent`, extend `listJobs`
- `client/src/hooks/useParserEditor.ts` — rename `parserName` → `parserId`
- `client/src/hooks/useParserSSE.ts` — rename `parserName` → `parserId`, fix EventSource URL
- `client/src/hooks/useDebugRun.ts` — rename `parserName` → `parserId`, fix fetch URL
- `client/src/components/StepDebugPanel.tsx` — rename prop `parserName` → `parserId`
- `client/src/components/ParserEditorPage.tsx` — rename prop `parserName` → `parserId`, pass `p.id` after creation
- `client/src/components/ParsersPage.tsx` — use `parser.id` for all actions and navigation
- `client/src/components/DebugPage.tsx` — use `listParsersSummary` + parser IDs
- `client/src/App.tsx` — update routing to use parser IDs, add `parser-detail` page

---

## Task 1: DB Layer — `getParserStats`, extend `getAllRuns`, add `id` to `listParsersWithLatestRun`

**Files:**
- Modify: `src/infrastructure/db/RunPersistenceService.ts`

- [ ] **Step 1: Add `ParserStats` interface**

Open `src/infrastructure/db/RunPersistenceService.ts`. After the `RawParserEnriched` interface, add:

```ts
export interface ParserStats {
  totalRuns: number
  successRate: number | null
  avgDurationSeconds: number | null
}
```

- [ ] **Step 2: Add `id` to `RawParserEnriched`**

Find:
```ts
export interface RawParserEnriched {
  name: string
  dbStatus: 'running' | 'stopped' | 'idle'
```

Replace with:
```ts
export interface RawParserEnriched {
  id: string
  name: string
  dbStatus: 'running' | 'stopped' | 'idle'
```

- [ ] **Step 3: Update `listParsersWithLatestRun` — add `parser_id` to Row type**

Inside the `listParsersWithLatestRun` method, find the `type Row = {` block:
```ts
    type Row = {
      name: string
      run_id: string | null
```

Replace with:
```ts
    type Row = {
      parser_id: string
      name: string
      run_id: string | null
```

- [ ] **Step 4: Update `listParsersWithLatestRun` — add `p.id` to SQL SELECT**

Find the SELECT clause inside the sql template literal:
```sql
      SELECT
        p.name,
        lr.id         AS run_id,
```

Replace with:
```sql
      SELECT
        p.id          AS parser_id,
        p.name,
        lr.id         AS run_id,
```

- [ ] **Step 5: Update `listParsersWithLatestRun` — add `id` to return mapping**

Find:
```ts
    return (result.rows as Row[]).map((r) => ({
      name: r.name,
      dbStatus: (r.run_status === 'running' ? 'running'
```

Replace with:
```ts
    return (result.rows as Row[]).map((r) => ({
      id: r.parser_id,
      name: r.name,
      dbStatus: (r.run_status === 'running' ? 'running'
```

- [ ] **Step 6: Add `getParserStats` method**

Add the following before the `// ── Private helpers` comment:

```ts
  async getParserStats(parserName: string): Promise<ParserStats> {
    type Row = {
      total_runs: number
      successful_runs: number
      avg_duration_seconds: number | null
    }
    const result = await this.db.execute<Row>(sql`
      SELECT
        COUNT(*)::int                                                        AS total_runs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int               AS successful_runs,
        AVG(
          CASE WHEN stopped_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (stopped_at - started_at))
          END
        )::int                                                               AS avg_duration_seconds
      FROM parser_runs
      WHERE parser_name = ${parserName}
    `)
    const row = result.rows[0] as Row | undefined
    if (!row || row.total_runs === 0) {
      return { totalRuns: 0, successRate: null, avgDurationSeconds: null }
    }
    return {
      totalRuns: row.total_runs,
      successRate: Math.round((row.successful_runs / row.total_runs) * 100),
      avgDurationSeconds: row.avg_duration_seconds,
    }
  }
```

- [ ] **Step 7: Extend `getAllRuns` with optional `parserName` filter**

Find the `getAllRuns` method opening (currently around line 169):
```ts
  async getAllRuns(page: number, limit: number): Promise<{ runs: (RunInfo & { failedCount: number })[]; total: number }> {
    const offset = (page - 1) * limit
    const rows = await this.db.select().from(parserRuns)
      .orderBy(desc(parserRuns.startedAt))
      .limit(limit)
      .offset(offset)
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(parserRuns)
```

Replace those opening lines with:
```ts
  async getAllRuns(
    page: number,
    limit: number,
    options?: { parserName?: string },
  ): Promise<{ runs: (RunInfo & { failedCount: number })[]; total: number }> {
    const offset = (page - 1) * limit
    const filter = options?.parserName ? eq(parserRuns.parserName, options.parserName) : undefined
    const rows = await this.db.select().from(parserRuns)
      .where(filter)
      .orderBy(desc(parserRuns.startedAt))
      .limit(limit)
      .offset(offset)
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(parserRuns).where(filter)
```

Leave the rest of the method body unchanged. Verify `eq` is already imported from `drizzle-orm` at the top of the file (it is — line 2).

- [ ] **Step 8: Build server**

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build 2>&1 | grep -E "error TS|✓"
```

Expected: `✓` (no errors).

---

## Task 2: Backend Routes — Migrate `parsers.ts` to `/:id` + Stats Route + `jobs.ts` filter

**Files:**
- Modify: `src/api/routes/parsers.ts`
- Modify: `src/api/routes/jobs.ts`

- [ ] **Step 1: Replace `router.param('name', ...)` with `router.param('id', ...)`**

In `src/api/routes/parsers.ts`, find:
```ts
  router.param('name', async (_req, res, next, name: string) => {
    const parser = await parserService.getParserByName(name)
    if (!parser) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
    res.locals.parser = parser
    next()
  })
```

Replace with:
```ts
  router.param('id', async (_req, res, next, id: string) => {
    const parser = await parserService.findById(id)
    if (!parser) { res.status(404).json({ error: 'Parser not found' }); return }
    res.locals.parser = parser
    next()
  })
```

- [ ] **Step 2: Rename all route path strings from `/:name` to `/:id`**

Use `replace_all: true` to replace the string `'/:name` with `'/:id` throughout `parsers.ts`.

This renames all 18 route registrations:
- `router.get('/:name', ...)` → `router.get('/:id', ...)`
- `router.put('/:name', ...)` → `router.put('/:id', ...)`
- `router.delete('/:name', ...)` → `router.delete('/:id', ...)`
- `router.post('/:name/start', ...)` → `router.post('/:id/start', ...)`
- `router.post('/:name/stop', ...)` → `router.post('/:id/stop', ...)`
- `router.post('/:name/resume', ...)` → `router.post('/:id/resume', ...)`
- `router.get('/:name/status', ...)` → `router.get('/:id/status', ...)`
- `router.get('/:name/events', ...)` → `router.get('/:id/events', ...)`
- `router.get('/:name/files', ...)` → `router.get('/:id/files', ...)`
- `router.get('/:name/files/:runId/:file', ...)` → `router.get('/:id/files/:runId/:file', ...)`
- `router.post('/:name/steps', ...)` → `router.post('/:id/steps', ...)`
- `router.get('/:name/steps', ...)` → `router.get('/:id/steps', ...)`
- `router.get('/:name/steps/:step', ...)` → `router.get('/:id/steps/:step', ...)`
- `router.put('/:name/steps/:step', ...)` → `router.put('/:id/steps/:step', ...)`
- `router.delete('/:name/steps/:step', ...)` → `router.delete('/:id/steps/:step', ...)`
- `router.post('/:name/steps/:step/debug', ...)` → `router.post('/:id/steps/:step/debug', ...)`

Note: Route bodies use `const { name }: ParserRow = res.locals.parser` or `const { id: parserId }: ParserRow = res.locals.parser` — no changes needed to bodies. The `router.param('id', ...)` middleware still loads the full `ParserRow` into `res.locals.parser`, so all destructuring of `.name` and `.id` fields continues to work.

- [ ] **Step 3: Add `GET /:id/stats` route**

Find the `router.get('/:id/status', ...)` handler and add the stats route immediately **before** it:

```ts
  router.get('/:id/stats', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    const stats = await runPersistence.getParserStats(name)
    res.json(stats)
  })
```

- [ ] **Step 4: Add `parserName` filter to `jobs.ts`**

Open `src/api/routes/jobs.ts`. Find line 41:
```ts
    res.json(await runPersistence.getAllRuns(page, limit))
```

Replace with:
```ts
    const parserNameFilter = req.query.parserName as string | undefined
    res.json(await runPersistence.getAllRuns(page, limit, parserNameFilter ? { parserName: parserNameFilter } : undefined))
```

- [ ] **Step 5: Build server**

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run build 2>&1 | grep -E "error TS|✓"
```

Expected: `✓`.

---

## Task 3: Client `api.ts` — Full Migration

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add `id` to `ParserSummary`**

Find:
```ts
export interface ParserSummary {
  name: string
  status: 'idle' | 'running' | 'stopped'
```

Replace with:
```ts
export interface ParserSummary {
  id: string
  name: string
  status: 'idle' | 'running' | 'stopped'
```

- [ ] **Step 2: Fix `listParsers()` to map the enriched response**

Find:
```ts
export async function listParsers(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/parsers`)
  const data = await res.json()
  return data.parsers as string[]
}
```

Replace with:
```ts
export async function listParsers(): Promise<string[]> {
  const data = await apiRequest<{ parsers: ParserSummary[]; total: number }>('/api/parsers?limit=500')
  return data.parsers.map((p) => p.name)
}
```

- [ ] **Step 3: Migrate `startParser`, `stopParser`**

Find:
```ts
export async function startParser(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${name}/start`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to start')
  }
}

export async function stopParser(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${name}/stop`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to stop')
  }
}
```

Replace with:
```ts
export async function startParser(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${id}/start`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to start')
  }
}

export async function stopParser(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${id}/stop`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to stop')
  }
}
```

- [ ] **Step 4: Migrate `getStatus`, `listFiles`, `downloadFile`**

Find:
```ts
export async function getStatus(name: string): Promise<{ running: boolean; stats: RunStats | null }> {
  const res = await fetch(`${API_BASE}/api/parsers/${name}/status`)
  return res.json()
}

export async function listFiles(name: string): Promise<OutputFile[]> {
  const res = await fetch(`${API_BASE}/api/parsers/${name}/files`)
  const data = await res.json()
  return data.files as OutputFile[]
}

export function downloadFile(parserName: string, runId: string, fileName: string): void {
  window.open(`${API_BASE}/api/parsers/${parserName}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`, '_blank')
}
```

Replace with:
```ts
export async function getStatus(id: string): Promise<{ running: boolean; stats: RunStats | null }> {
  const res = await fetch(`${API_BASE}/api/parsers/${id}/status`)
  return res.json()
}

export async function listFiles(id: string): Promise<OutputFile[]> {
  const res = await fetch(`${API_BASE}/api/parsers/${id}/files`)
  const data = await res.json()
  return data.files as OutputFile[]
}

export function downloadFile(parserId: string, runId: string, fileName: string): void {
  window.open(`${API_BASE}/api/parsers/${parserId}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`, '_blank')
}
```

- [ ] **Step 5: Migrate `listSteps`**

Find:
```ts
export async function listSteps(parserName: string): Promise<StepInfo[]> {
  const res = await fetch(`${API_BASE}/api/parsers/${parserName}/steps`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to load steps')
  }
  const data = await res.json()
  return data.steps as StepInfo[]
}
```

Replace with:
```ts
export async function listSteps(parserId: string): Promise<StepInfo[]> {
  const res = await fetch(`${API_BASE}/api/parsers/${parserId}/steps`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to load steps')
  }
  const data = await res.json()
  return data.steps as StepInfo[]
}
```

- [ ] **Step 6: Migrate `getParser`, `updateParser`, `deleteParser`**

Find:
```ts
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
```

Replace with:
```ts
export async function getParser(id: string): Promise<{ parser: ParserRow; steps: StepRow[] }> {
  return apiRequest(`/api/parsers/${id}`)
}

export async function updateParser(id: string, input: UpdateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>(`/api/parsers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function deleteParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 7: Migrate `createStep`, `getStep`, `updateStep`, `deleteStep`**

Find:
```ts
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

Replace with:
```ts
export async function createStep(parserId: string, input: CreateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function getStep(parserId: string, stepName: string): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`)
  return data.step
}

export async function updateStep(parserId: string, stepName: string, input: UpdateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function deleteStep(parserId: string, stepName: string): Promise<void> {
  await apiRequest(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`, { method: 'DELETE' })
}
```

- [ ] **Step 8: Migrate `resumeParser`**

Find:
```ts
export async function resumeParser(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${encodeURIComponent(name)}/resume`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to resume')
  }
}
```

Replace with:
```ts
export async function resumeParser(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/parsers/${id}/resume`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to resume')
  }
}
```

- [ ] **Step 9: Add `ParserStats`, `getParserStats`, `fetchFileContent`; extend `listJobs`**

After the `getDashboardPerformance` function, add:

```ts
export interface ParserStats {
  totalRuns: number
  successRate: number | null
  avgDurationSeconds: number | null
}

export async function getParserStats(parserId: string): Promise<ParserStats> {
  return apiRequest(`/api/parsers/${parserId}/stats`)
}

export async function fetchFileContent(
  parserId: string,
  runId: string,
  fileName: string,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/parsers/${parserId}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`,
  )
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`)
  return res.text()
}
```

Find the existing `listJobs`:
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

Replace with:
```ts
export async function listJobs(
  page = 1,
  limit = 50,
  status?: string,
  parserName?: string,
): Promise<{ runs: (RunInfo & { elapsed?: number })[]; total: number }> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status)     q.set('status',     status)
  if (parserName) q.set('parserName', parserName)
  return apiRequest(`/api/jobs?${q}`)
}
```

- [ ] **Step 10: Build client**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client && npm run build 2>&1 | grep -E "error TS|✓"
```

TypeScript errors pointing to other files (components, hooks) that still pass parser names are expected and OK at this step. Verify there are no errors *within* `api.ts` itself.

---

## Task 4: Client Hooks Migration

**Files:**
- Modify: `client/src/hooks/useParserEditor.ts`
- Modify: `client/src/hooks/useParserSSE.ts`
- Modify: `client/src/hooks/useDebugRun.ts`

- [ ] **Step 1: Rename `parserName` → `parserId` throughout `useParserEditor.ts`**

Use `replace_all: true` to replace every occurrence of `parserName` with `parserId` in `client/src/hooks/useParserEditor.ts`.

Verify the function signature becomes:
```ts
export function useParserEditor(parserId: string) {
```

Verify key callsites now read:
```ts
  useEffect(() => {
    if (!parserId) return
    getParser(parserId)
    ...
  }, [parserId])

  const handleCodeChange = useCallback((newCode: string) => {
    ...
    if (!parserId || !capturedStepName) return
    const updated = await updateStep(parserId, capturedStepName, { code: newCode })
    ...
  }, [parserId, selectedStepName])

  const saveNow = useCallback(async () => {
    if (!parserId || !selectedStepName) return
    const updated = await updateStep(parserId, selectedStepName, { code })
    ...
  }, [parserId, selectedStepName, code])

  const addStep = useCallback(async (...) => {
    if (!parserId) return
    const created = await createStep(parserId, { name, type })
    ...
  }, [parserId])

  const removeStep = useCallback(async (name: string) => {
    if (!parserId) return
    await deleteStep(parserId, name)
    ...
  }, [parserId, selectedStepName, steps])

  const saveStepMeta = useCallback(async (stepName: string, input: UpdateStepInput) => {
    if (!parserId) return
    const updated = await updateStep(parserId, stepName, input)
    ...
  }, [parserId])

  const saveParserSettings = useCallback(async (input: UpdateParserInput) => {
    if (!parserId) return
    const updated = await updateParser(parserId, input)
    ...
  }, [parserId])
```

- [ ] **Step 2: Rename `parserName` → `parserId` throughout `useParserSSE.ts`**

Use `replace_all: true` to replace every occurrence of `parserName` with `parserId` in `client/src/hooks/useParserSSE.ts`.

Verify the hook signature and key lines become:
```ts
export function useParserSSE(parserId: string): ParserState {
  ...
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/parsers/${parserId}/events`)
    ...
    es.onerror = (err) => {
      console.error(`SSE connection error for ${parserId}:`, err)
    }
    return () => es.close()
  }, [parserId])
  ...
}
```

- [ ] **Step 3: Rename `parserName` → `parserId` in `useDebugRun.ts`**

In `client/src/hooks/useDebugRun.ts`, find the `run` function signature and fetch URL:
```ts
  async function run(
    parserName: string,
    stepName: string,
    url: string,
    parent_data?: Record<string, unknown>,
  ) {
    ...
    const res = await fetch(`${API_BASE}/api/parsers/${parserName}/steps/${stepName}/debug`, {
```

Replace with:
```ts
  async function run(
    parserId: string,
    stepName: string,
    url: string,
    parent_data?: Record<string, unknown>,
  ) {
    ...
    const res = await fetch(`${API_BASE}/api/parsers/${parserId}/steps/${stepName}/debug`, {
```

- [ ] **Step 4: Build client**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client && npm run build 2>&1 | grep -E "error TS|✓"
```

TypeScript errors in components are still expected at this step (hooks accept `parserId` but components still pass `parserName`).

---

## Task 5: Client Component Migration + App.tsx Editor Routing

**Files:**
- Modify: `client/src/components/StepDebugPanel.tsx`
- Modify: `client/src/components/ParserEditorPage.tsx`
- Modify: `client/src/components/ParsersPage.tsx`
- Modify: `client/src/components/DebugPage.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: `StepDebugPanel.tsx` — rename `parserName` prop to `parserId`**

Use `replace_all: true` to replace every occurrence of `parserName` with `parserId` in `client/src/components/StepDebugPanel.tsx`.

Verify the Props interface becomes:
```ts
interface Props {
  parserId: string
  stepName: string
  initialUrl: string
  onClose: () => void
}
```

And the run call:
```tsx
onClick={() => run(parserId, stepName, url, parseJsonSafe(parentDataJson))}
```

- [ ] **Step 2: `ParserEditorPage.tsx` — rename `parserName` prop to `parserId` and fix creation**

a) Use `replace_all: true` to replace every occurrence of `parserName` with `parserId`.

b) Verify the Props interface is:
```ts
interface Props {
  parserId: string
  onNavigateToParsers: () => void
  onParserSelect: (id: string) => void
}
```

c) Verify the new-parser guard uses `parserId`:
```ts
  if (!parserId) {
```

d) Verify `createParser` success now passes `p.id` to `onParserSelect`:
```ts
        const p = await createParser({ ... })
        onParserSelect(p.id)
```

e) Verify `useParserEditor(parserId)` call and `<StepDebugPanel parserId={parserId} ...>`.

- [ ] **Step 3: `ParsersPage.tsx` — use `parser.id` for all actions and navigation**

a) Update Props interface — add `onViewParser`, update `onEdit`:

Find:
```ts
interface Props {
  onEdit: (name: string) => void
}
```

Replace with:
```ts
interface Props {
  onEdit: (id: string) => void
  onViewParser: (id: string) => void
}
```

b) Update function signature:
```ts
export function ParsersPage({ onEdit, onViewParser }: Props) {
```

c) Update `handleRun`, `handleStop`, `handleResume` to accept `id` and key `rowLoading` on `id`:

Find:
```ts
  async function handleRun(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await startParser(name); await fetchData() }
    catch { /* error visible on next poll */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }

  async function handleStop(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await stopParser(name); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }

  async function handleResume(name: string) {
    setRowLoading((prev) => ({ ...prev, [name]: true }))
    try { await resumeParser(name); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [name]: false })) }
  }
```

Replace with:
```ts
  async function handleRun(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await startParser(id); await fetchData() }
    catch { /* error visible on next poll */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  async function handleStop(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await stopParser(id); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  async function handleResume(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await resumeParser(id); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }
```

d) Update table row key and `rowLoading` lookup:

Find:
```tsx
            {data.map((parser) => {
              const statusConfig = PARSER_STATUS[parser.status] ?? UNKNOWN_STATUS
              const busy = rowLoading[parser.name] ?? false
              return (
                <tr key={parser.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
```

Replace with:
```tsx
            {data.map((parser) => {
              const statusConfig = PARSER_STATUS[parser.status] ?? UNKNOWN_STATUS
              const busy = rowLoading[parser.id] ?? false
              return (
                <tr key={parser.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
```

e) Make the Name cell clickable:

Find:
```tsx
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {parser.name}
                  </td>
```

Replace with:
```tsx
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onViewParser(parser.id)}
                      className="text-sm font-medium text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors text-left"
                    >
                      {parser.name}
                    </button>
                  </td>
```

f) Update action button callbacks and Edit button to use `parser.id`:

Find:
```tsx
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
```

Replace with:
```tsx
                      {parser.status === 'running' ? (
                        <SpringButton variant="danger" onClick={() => handleStop(parser.id)} loading={busy} className="text-xs py-1 px-3">
                          Stop
                        </SpringButton>
                      ) : parser.status === 'stopped' ? (
                        <>
                          <SpringButton variant="warning" onClick={() => handleResume(parser.id)} loading={busy} className="text-xs py-1 px-3">
                            Resume
                          </SpringButton>
                          <SpringButton variant="ghost" onClick={() => handleRun(parser.id)} disabled={busy} className="text-xs py-1 px-3 border border-gray-300 dark:border-gray-600">
                            Run Fresh
                          </SpringButton>
                        </>
                      ) : (
                        <SpringButton variant="success" onClick={() => handleRun(parser.id)} loading={busy} className="text-xs py-1 px-3">
                          Run
                        </SpringButton>
                      )}
                      <button
                        onClick={() => onEdit(parser.id)}
```

- [ ] **Step 4: `DebugPage.tsx` — use `listParsersSummary` + parser IDs**

a) Update imports:

Find:
```ts
import { listParsers, listSteps, getStep } from '../api'
import type { StepInfo } from '../api'
```

Replace with:
```ts
import { listParsersSummary, listSteps, getStep } from '../api'
import type { StepInfo } from '../api'
```

b) Update state types:

Find:
```ts
  const [parsers, setParsers] = useState<string[]>([])
  const [selectedParser, setSelectedParser] = useState('')
```

Replace with:
```ts
  const [parsers, setParsers] = useState<{ id: string; name: string }[]>([])
  const [selectedParserId, setSelectedParserId] = useState('')
```

c) Update the fetch effect:

Find:
```ts
    listParsers().then(setParsers).catch(() => setParsers([]))
```

Replace with:
```ts
    listParsersSummary({ limit: 500 })
      .then((r) => setParsers(r.parsers.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setParsers([]))
```

d) Rename all remaining `selectedParser` occurrences to `selectedParserId` using `replace_all: true`. This covers:
- `if (!selectedParser)` → `if (!selectedParserId)`
- `listSteps(selectedParser)` → `listSteps(selectedParserId)`
- `getStep(selectedParser, selectedStep)` → `getStep(selectedParserId, selectedStep)`
- `run(selectedParser, selectedStep, ...)` → `run(selectedParserId, selectedStep, ...)`
- `!!selectedParser` → `!!selectedParserId`
- `setSelectedParser(e.target.value)` → `setSelectedParserId(e.target.value)`
- `value={selectedParser}` → `value={selectedParserId}`
- `[selectedParser]` dependency → `[selectedParserId]`

e) Update the parser `<select>` options:

Find:
```tsx
              {parsers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
```

Replace with:
```tsx
              {parsers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
```

- [ ] **Step 5: `App.tsx` — update editor routing + ParsersPage prop + ParserEditorPage prop**

a) Rename `editorParser` → `editorParserId` in the `parseHash` return type:

Find:
```ts
function parseHash(): { page: Page; editorParser: string; jobRunId: string; jobTaskId: string } {
```

Replace with:
```ts
function parseHash(): { page: Page; editorParserId: string; jobRunId: string; jobTaskId: string } {
```

b) Replace every occurrence of `editorParser:` and `editorParser }` and `state.editorParser` using `replace_all: true` for `editorParser` → `editorParserId` in `App.tsx`.

Verify the `#/editor/` branch in `parseHash` now reads:
```ts
  if (hash.startsWith('#/editor/'))
    return { page: 'editor', editorParserId: decodeURIComponent(hash.slice(9)), jobRunId: '', jobTaskId: '' }
```

And the editor render case:
```tsx
      case 'editor':
        return (
          <ParserEditorPage
            parserId={state.editorParserId}
            onNavigateToParsers={() => navigate('parsers')}
            onParserSelect={(id) => navigate('editor', id)}
          />
        )
```

c) Update `ParsersPage` render to pass `onViewParser` (the `parser-detail` page is wired in Task 6):

Find:
```tsx
      case 'parsers':
        return <ParsersPage onEdit={(name) => navigate('editor', name)} />
```

Replace with:
```tsx
      case 'parsers':
        return (
          <ParsersPage
            onEdit={(id) => navigate('editor', id)}
            onViewParser={(id) => navigate('parser-detail', id)}
          />
        )
```

Note: `navigate('parser-detail', id)` will fall through to the `else` default (hash `#/`) until Task 6 adds the `parser-detail` case. That's fine for now.

- [ ] **Step 6: Build client**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client && npm run build 2>&1 | grep -E "error TS|✓"
```

Expected: `✓` (no TypeScript errors). The one remaining known issue is that `navigate('parser-detail', id)` references a page type not yet in the `Page` union — if TS complains, add `'parser-detail'` to the `Page` type now, or proceed to Task 6 immediately.

---

## Task 6: App.tsx — `parser-detail` Route + Placeholder `ParserDetailPage`

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/components/ParserDetailPage.tsx`

- [ ] **Step 1: Add `parser-detail` to the `Page` union**

Find:
```ts
type Page =
  | 'dashboard'
  | 'parsers'
  | 'editor'
```

Replace with:
```ts
type Page =
  | 'dashboard'
  | 'parsers'
  | 'parser-detail'
  | 'editor'
```

- [ ] **Step 2: Add `parserDetailId` to `parseHash` return type**

Find:
```ts
function parseHash(): { page: Page; editorParserId: string; jobRunId: string; jobTaskId: string } {
```

Replace with:
```ts
function parseHash(): { page: Page; editorParserId: string; jobRunId: string; jobTaskId: string; parserDetailId: string } {
```

- [ ] **Step 3: Add `#/parsers/:id` match in `parseHash`**

Find:
```ts
  if (hash === '#/parsers')  return { page: 'parsers',   editorParserId: '', jobRunId: '', jobTaskId: '' }
```

Add this block **immediately before** it (more-specific prefix must be checked first):
```ts
  if (hash.startsWith('#/parsers/'))
    return { page: 'parser-detail', editorParserId: '', jobRunId: '', jobTaskId: '',
             parserDetailId: decodeURIComponent(hash.slice(10)) }
```

- [ ] **Step 4: Add `parserDetailId: ''` to all other `parseHash` return statements**

Every return statement that does NOT already have `parserDetailId` needs it added. There are ~8 such statements (for `task-detail`, `job-detail`, `jobs`, `parsers`, `settings`, `debug`, `dashboard`, `editor`). Add `parserDetailId: ''` to each.

Example — `parsers` case after the change:
```ts
  if (hash === '#/parsers')  return { page: 'parsers', editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
```

- [ ] **Step 5: Add `parser-detail` case to `navigate`**

Find:
```ts
    else if (page === 'parsers')   window.location.hash = '#/parsers'
```

Add immediately **before** it:
```ts
    else if (page === 'parser-detail' && param)
      window.location.hash = `#/parsers/${encodeURIComponent(param)}`
```

- [ ] **Step 6: Add `parser-detail` to `navPage` derivation**

Find:
```ts
  const navPage: NavPage =
    state.page === 'parsers' || state.page === 'editor' ? 'parsers'
```

Replace with:
```ts
  const navPage: NavPage =
    state.page === 'parsers' || state.page === 'parser-detail' || state.page === 'editor' ? 'parsers'
```

- [ ] **Step 7: Add `parser-detail` import and render case**

Add import at top of `App.tsx`:
```ts
import { ParserDetailPage } from './components/ParserDetailPage'
```

In `renderPage()`, add before `case 'parsers':`:
```tsx
      case 'parser-detail':
        return (
          <ParserDetailPage
            parserId={state.parserDetailId}
            onBack={() => navigate('parsers')}
            onEdit={(id) => navigate('editor', id)}
            onViewJob={(runId) => navigate('job-detail', runId)}
          />
        )
```

- [ ] **Step 8: Create placeholder `ParserDetailPage.tsx`**

Create `client/src/components/ParserDetailPage.tsx`:

```tsx
interface Props {
  parserId: string
  onBack: () => void
  onEdit: (id: string) => void
  onViewJob: (runId: string) => void
}

export function ParserDetailPage({ parserId, onBack }: Props) {
  return (
    <div className="px-6 py-6">
      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-1"
      >
        ← Back to Parsers
      </button>
      <p className="text-gray-400 text-sm">{parserId} — loading…</p>
    </div>
  )
}
```

- [ ] **Step 9: Build client**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client && npm run build 2>&1 | grep -E "error TS|✓"
```

Expected: `✓`. Navigate to `#/parsers`, click a parser name — it should navigate to `#/parsers/:uuid` showing the placeholder.

---

## Task 7: Full `ParserDetailPage` Implementation

**Files:**
- Create (overwrite placeholder): `client/src/components/ParserDetailPage.tsx`
- Create: `src/tests/parserDetail.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/parserDetail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function parseCsvRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (const char of line) {
    if (char === '"') { inQuote = !inQuote }
    else if (char === ',' && !inQuote) { result.push(current); current = '' }
    else { current += char }
  }
  result.push(current)
  return result
}

describe('formatDuration', () => {
  it('formats seconds into Xm Ys', () => {
    expect(formatDuration(272)).toBe('4m 32s')
  })
  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m 0s')
  })
  it('returns — for null', () => {
    expect(formatDuration(null)).toBe('—')
  })
  it('handles sub-minute', () => {
    expect(formatDuration(45)).toBe('0m 45s')
  })
})

describe('parseCsvRow', () => {
  it('splits a simple CSV row', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c'])
  })
  it('handles quoted fields containing commas', () => {
    expect(parseCsvRow('"hello, world",foo,bar')).toEqual(['hello, world', 'foo', 'bar'])
  })
  it('handles empty fields', () => {
    expect(parseCsvRow('a,,c')).toEqual(['a', '', 'c'])
  })
})
```

- [ ] **Step 2: Run tests — they should pass immediately (functions defined inline)**

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- src/tests/parserDetail.test.ts 2>&1 | tail -10
```

Expected: `7 passed`.

- [ ] **Step 3: Write `client/src/components/ParserDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  getParser,
  getParserStats,
  listJobs,
  listFiles,
  fetchFileContent,
  startParser,
  stopParser,
  type ParserStats,
  type RunInfo,
  type OutputFile,
} from '../api'
import { SpringButton } from './motion/SpringButton'

interface Props {
  parserId: string
  onBack: () => void
  onEdit: (id: string) => void
  onViewJob: (runId: string) => void
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function runDurationSeconds(run: RunInfo): number | null {
  if (!run.startedAt || !run.stoppedAt) return null
  return Math.round((new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
}

function parseCsvRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false
  for (const char of line) {
    if (char === '"') { inQuote = !inQuote }
    else if (char === ',' && !inQuote) { result.push(current); current = '' }
    else { current += char }
  }
  result.push(current)
  return result
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').map((l) => l.trimEnd()).filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCsvRow(lines[0])
  const rows = lines.slice(1, 11).map(parseCsvRow)
  return { headers, rows }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: RunInfo['status'] }) {
  const cls =
    status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : status === 'running'  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    : status === 'stopped'  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  const label =
    status === 'completed' ? 'Success'
    : status === 'running'  ? 'Running'
    : status === 'stopped'  ? 'Stopped'
    : 'Failed'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParserDetailPage({ parserId, onBack, onEdit, onViewJob }: Props) {
  const [parserName, setParserName] = useState<string | null>(null)
  const [stats, setStats] = useState<ParserStats | null>(null)
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [files, setFiles] = useState<OutputFile[]>([])
  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null)
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)

  // Load parser name + stats + runs on mount, poll every 5s
  useEffect(() => {
    let active = true
    async function load() {
      const [parserRes, statsRes, runsRes] = await Promise.allSettled([
        getParser(parserId),
        getParserStats(parserId),
        listJobs(1, 20),
      ])
      if (!active) return
      if (parserRes.status === 'fulfilled') {
        const name = parserRes.value.parser.name
        setParserName(name)
        // Re-fetch runs filtered by name now that we have it
        const filtered = await listJobs(1, 20, undefined, name).catch(() => ({ runs: [], total: 0 }))
        if (!active) return
        setRuns(filtered.runs)
        setIsRunning(filtered.runs.some((r) => r.status === 'running'))
      } else if (runsRes.status === 'fulfilled') {
        setRuns(runsRes.value.runs)
        setIsRunning(runsRes.value.runs.some((r) => r.status === 'running'))
      }
      if (statsRes.status === 'fulfilled') setStats(statsRes.value)
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { active = false; clearInterval(interval) }
  }, [parserId])

  // Load file list once
  useEffect(() => {
    listFiles(parserId)
      .then((f) => {
        setFiles(f)
        if (f.length > 0) setSelectedFile(f[0])
      })
      .catch(() => {})
  }, [parserId])

  // Load CSV when selected file changes
  useEffect(() => {
    if (!selectedFile) return
    setCsvLoading(true)
    setCsvData(null)
    fetchFileContent(parserId, selectedFile.runId, selectedFile.name)
      .then((text) => setCsvData(parseCsv(text)))
      .catch(() => setCsvData(null))
      .finally(() => setCsvLoading(false))
  }, [parserId, selectedFile])

  async function handleRunNow() {
    setActionLoading(true)
    try { await startParser(parserId); setIsRunning(true) }
    catch { /* poll will update */ }
    finally { setActionLoading(false) }
  }

  async function handleStop() {
    setActionLoading(true)
    try { await stopParser(parserId); setIsRunning(false) }
    catch { /* poll will update */ }
    finally { setActionLoading(false) }
  }

  const displayName = parserName ?? parserId

  return (
    <div className="px-6 py-6">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Parsers
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">{displayName}</h1>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
            isRunning
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
            {isRunning ? 'Active' : 'Idle'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <SpringButton variant="danger" onClick={handleStop} loading={actionLoading} className="px-4 py-2 text-sm">
              Stop
            </SpringButton>
          ) : (
            <SpringButton variant="success" onClick={handleRunNow} loading={actionLoading} className="px-4 py-2 text-sm flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Now
            </SpringButton>
          )}
          <button
            onClick={() => onEdit(parserId)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Config
          </button>
        </div>
      </div>

      {/* Body: 3 columns */}
      <div className="grid grid-cols-1 xl:grid-cols-[220px_1fr_320px] gap-4">

        {/* Left: stat cards */}
        <div className="flex flex-col gap-4">
          <StatCard
            label="Total Runs"
            value={stats ? stats.totalRuns : '…'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            }
          />
          <StatCard
            label="Success Rate"
            value={stats?.successRate !== null && stats?.successRate !== undefined ? `${stats.successRate}%` : '—'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            }
          />
          <StatCard
            label="Avg. Duration"
            value={stats ? formatDuration(stats.avgDurationSeconds) : '…'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        {/* Center: recent runs */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Runs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Job ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Start Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">End Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">No runs yet.</td>
                  </tr>
                )}
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onViewJob(run.id)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {run.id.slice(0, 18)}…
                    </td>
                    <td className="px-4 py-3"><RunStatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(run.stoppedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDuration(runDurationSeconds(run))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: data preview */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 shrink-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Data Preview</h2>
            {files.length > 0 && (
              <select
                value={selectedFile?.name ?? ''}
                onChange={(e) => {
                  const f = files.find((x) => x.name === e.target.value)
                  if (f) setSelectedFile(f)
                }}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[140px] truncate"
              >
                {files.map((f) => (
                  <option key={`${f.runId}/${f.name}`} value={f.name}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="overflow-auto flex-1">
            {files.length === 0 ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">No output files yet.</p>
            ) : csvLoading ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">Loading…</p>
            ) : !csvData || csvData.headers.length === 0 ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">Could not parse file.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                  <tr>
                    {csvData.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 dark:border-gray-700">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {csvData.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[120px] truncate">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build client**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client && npm run build 2>&1 | grep -E "error TS|✓"
```

Expected: `✓` no errors.

- [ ] **Step 5: Run tests**

```bash
cd /Users/ryunko/Desktop/Projects/scraper && npm run test -- src/tests/parserDetail.test.ts 2>&1 | tail -10
```

Expected: `7 passed`.

- [ ] **Step 6: Smoke test**

Start the app (`npm run start`), navigate to `http://localhost:5173/#/parsers`, click any parser name. Verify:
- URL changes to `#/parsers/:uuid`
- "Back to Parsers" returns to the list
- Header shows the parser name (not the UUID) and Active/Idle badge
- "Run Now" and "Edit Config" buttons are present
- Stat cards load (Total Runs, Success Rate, Avg. Duration)
- Recent Runs table shows runs; clicking a row opens job detail
- Data Preview panel shows file selector and CSV table if output files exist
- Editor navigation (`#/editor/:uuid`) loads the parser editor correctly
