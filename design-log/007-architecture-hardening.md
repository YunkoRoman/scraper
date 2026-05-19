# 007 — Architecture hardening: security, concurrency correctness, persistence integrity

## Background

Senior architecture review of the full platform after the bot-detection work (006). The codebase has grown to ~3000 LOC server-side with Worker Threads, SSE, DB persistence, and user-supplied code execution. No security hardening has been applied so far.

## Problem

Review surfaced issues in four areas:

1. **Security** — path traversal in file download, unsandboxed RCE exposure, SSRF, hardcoded DB credentials.
2. **Concurrency correctness** — `globalActive` counter desync, data lost on stop, worker crash causes stuck runs, CSV overwrite on resume.
3. **Persistence integrity** — fire-and-forget DB writes, missing transactions, `__failedHtml` sentinel overloads result rows, missing DB indexes.
4. **Design / layering** — orchestrator directly instantiates CSV infrastructure, settings-merge duplicated across two workers, stats computed twice with diverging logic, type-safety gaps at persistence boundary.

## Questions and Answers

- **Q1 — Fix order?** Group 1 (security, quick wins) → Group 2 (concurrency correctness) → Group 3 (persistence) → Group 4 (layering). Each group ships as its own commit.
- **Q2 — Sandbox for user code?** Out of scope for this log. Platform is single-tenant; owner writes the step code. Document the risk, fix the network exposure (no auth + open CORS) as the actual attack surface. Sandboxing addressed separately if multi-tenant use needed.
- **Q3 — Auth?** API is localhost-only for now (no public exposure). Adding auth is a future log. This log fixes CORS wildcard and documents the gap.
- **Q4 — globalActive desync — which fix?** Gate the PAGE_SUCCESS/PAGE_FAILED decrement on whether the task was still counted (i.e. not already terminal when message arrives). On abort: mark aborted but do not decrement — let the worker's response do the single decrement.
- **Q5 — Worker crash recovery?** On `worker.on('error')`: mark all tasks owned by that worker as failed/retry, decrement globalActive for each in-progress one, attempt to flush completion.

## Design

### Group 1 — Security

**Path traversal (`GET /:name/files/:file`)**
- Reject any `file` containing `/` or `..` before calling `resolve`.
- Additionally verify the resolved path starts with `outputDir + '/parser-name/'` as defense-in-depth.

**SSRF (worker page.goto)**
- Validate URL scheme is `http:` or `https:` at task-dispatch time in the orchestrator (not in worker).
- Workers should not revalidate; validation is the orchestrator's responsibility.

**Hardcoded DB credentials**
- Throw a startup error if `DATABASE_URL` is not set, instead of silently using the dev default.

**CORS wildcard**
- Replace `cors()` with an explicit origin allowlist from env (`CORS_ORIGIN`). Default to `http://localhost:5173` in dev.

### Group 2 — Concurrency correctness

**globalActive desync**
- Remove `globalActive--` from `abortTask`. The abort marks the task terminal; when the worker responds with PAGE_SUCCESS/PAGE_FAILED the orchestrator sees `isTerminal(task.state)` is true and skips the business logic but still decrements. This gives exactly one decrement per dispatched task.
- In PAGE_SUCCESS/PAGE_FAILED: always decrement first, then check terminal state for business logic.

**In-flight data lost on stop**
- Remove the `if (this.stopped) return` early-return in `handleWorkerMessage`.
- Instead gate only the *business logic* (link discovery, new task creation) behind `stopped`.
- DATA_EXTRACTED and PAGE_SUCCESS/PAGE_FAILED state updates still run so counters stay correct.

**Worker crash recovery**
- On `worker.on('error', err)`: iterate all tasks for that step, mark in-progress ones as failed (decrement globalActive), emit stats, call checkCompletion.

**CSV overwrite on resume**
- Open CsvWriter with flag `'a'` (append). On a fresh start, truncate the file first.
- Or: write per-run output files (`stepName-runId.csv`) and never overwrite.
- Decision: use per-run filenames — avoids append/truncate logic, keeps history.

### Group 3 — Persistence integrity

**Fire-and-forget DB writes**
- `_wireTaskEvents` upserts are fire-and-forget with `.catch(console.error)`. Convert `task_done` handler to queue writes and log errors with context. Do not await in the hot path — keep async but surface failures better.

**Bulk upsert transaction**
- Wrap `_bulkUpsertTasks` in a single DB transaction and use batched inserts.

**`__failedHtml` sentinel**
- Add a separate `task_html` column to `task_results` (nullable text). Remove the `{__failedHtml}` sentinel.
- Migration: `ALTER TABLE task_results ADD COLUMN html text`.

**DB indexes**
- Add composite index `(run_id, state)` on `run_tasks`.
- Add index `(run_id)` on `task_results`.

### Group 4 — Design

**Settings merge extracted**
- Create `src/domain/services/mergeStepSettings.ts` — pure function, unit-testable, shared by both workers.

**Stats shape unified**
- `ParserRun.getStats()` returns `RunStats`. `_computeStatsFromRows` in RunPersistenceService returns the same shape. Add a shared `computeStats(rows)` helper.

**CSV port injection**
- Define `OutputWriter` interface in application layer. Inject into orchestrator constructor. CsvWriter implements it. Keeps orchestrator testable.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Per-run CSV filenames | More files on disk; can't append to previous run's file. Acceptable — history is useful. |
| No auth this iteration | Risk if port 3001 is accidentally exposed. Mitigated by CORS hardening + documented. |
| globalActive: always decrement in message handler | Simpler invariant; abort no longer touches the counter. Slightly delayed decrement on abort (until worker finishes the page) but quota is a soft limit anyway. |
| Wrap bulkUpsert in transaction | Longer DB lock; acceptable since this only runs at stop/complete time. |

## Implementation Results

### Group 1 — Security (implemented)

- **Path traversal** fixed in `parsers.ts`: reject file params containing `/` or `..`, verify resolved path stays under `outputDir`.
- **SSRF** blocked at orchestrator: `entryUrl` validated at fresh-start; links from `LINKS_DISCOVERED` filtered to `http(s)` only before deduplication.
- **CORS** hardened: `cors()` replaced with explicit origin allowlist from `CORS_ORIGIN` env (default `http://localhost:5173`).
- **DB credentials**: fail loud on missing `DATABASE_URL`; `.env.example` added.
- **Request body size** capped at `1mb` via `express.json({ limit: '1mb' })`.

### Group 2 — Concurrency correctness (implemented)

- **`globalActive` desync**: removed `globalActive--` from `abortTask`. Worker's PAGE_SUCCESS/PAGE_FAILED response is the single decrement. `_sendToWorker` now guards against terminal tasks in the dispatch queue.
- **Data lost on stop**: removed blanket `if (this.stopped) return` from `handleWorkerMessage`. Only `LINKS_DISCOVERED` is suppressed when stopped; DATA_EXTRACTED and PAGE_*/LOG still process.
- **Worker crash recovery**: `worker.on('error')` now marks all that worker's in-progress tasks as failed, decrements `globalActive`, emits stats, and calls `checkCompletion` so the run can resolve.
- **Debug log removed**: `console.log("mergedSettings:", ...)` removed from `ExtractorWorker`.

### Group 3 — Persistence integrity (implemented)

- **`task_html` column**: migration `0003_task_html.sql` adds `html TEXT` to `task_results`. Schema updated. `saveTaskHtml(taskId, html)` added to `RunPersistenceService`. `getTaskResult` return type changed to `{ rows, html }`. `__failedHtml` sentinel pattern eliminated from `ParserRunnerService`, `jobs.ts` route, and `TaskDetailPage`.
- **Bulk upsert transaction**: `_bulkUpsertTasks` now wraps batched inserts (500/batch) in a single DB transaction instead of N sequential awaits. Consistent on partial failure; much faster for large task counts.
- **Fire-and-forget error surfacing**: `.catch(console.error)` replaced with contextual error logs including task ID and operation name.

### Group 4 — Design (implemented)

- **Settings-merge extracted**: `mergeWorkerSettings(browserSettings, stepSettings)` utility in `infrastructure/worker/`. Identical logic removed from both `ExtractorWorker` and `TraverserWorker`. Single place to change merge behavior.
- **CSV per-run subdirs**: `outputDir` now `output/<parserName>/<runId>/`. Each run gets isolated files — resume and retry-failed no longer overwrite prior run's CSV. Files list endpoint now reads one level of subdirs and returns `{ name, runId, size, mtime }` per file. Download route is `/:name/files/:runId/:file`. Client `downloadFile()` and `OutputFile` type updated.

### Remaining (not implemented)

- Stats computation duplicated in `ParserRun.getStats()` (in-memory) and `_computeStatsFromRows` (SQL) — acceptable since they operate on different data representations and the output type enforces structural agreement.
- CSV port injection (inject `OutputWriter` interface into orchestrator) — deferred; orchestrator CSV coupling is acceptable for now.
- Pre-existing test failure: `ParserRun > transitions task to retry and increments attempts` — attempts only incremented in `markInProgress`, not `markRetry`; test calls `markRetry` directly. Pre-exists this work.
