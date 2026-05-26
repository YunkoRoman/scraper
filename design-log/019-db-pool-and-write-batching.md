# 019 — DB Pool Sizing and Write Batching

## Background

The pg Pool was constructed with no `max` config (pg default: 10). Under parallel parser runs with many concurrent workers, Postgres would receive one `INSERT INTO run_tasks` per task state transition — potentially thousands of connections saturating the pool and causing queue buildup.

## Problem

1. **Pool exhaustion:** Default `max: 10` is far too small for a platform that may run dozens of steps concurrently. Workers emit `upsertTask` on every page dispatch and completion.
2. **Write storm:** Every task state transition (pending → in_progress → success/failed) issued a separate parameterized `INSERT … ON CONFLICT DO UPDATE`. For a 10k-task run at 50 concurrent workers, this is ~500+ DB round-trips per second.

## Design

### Pool sizing
Replaced the bare `new Pool({ connectionString })` with `intFromEnv`-driven config: `DB_POOL_MAX` (default 50), `DB_POOL_MIN` (default 2), `DB_POOL_IDLE_MS` (30s), `DB_POOL_CONNECT_TIMEOUT_MS` (10s). A `closePool()` helper prevents double-close in shutdown.

### TaskWriteBuffer
A coalescing buffer wraps `RunPersistenceService`'s hot write paths:
- **Coalescing key:** `taskId` (Map). If a task transitions `pending → in_progress → success` within a 100ms window, only the final `success` snapshot is flushed. Intermediate states never reach the DB (acceptable: `ParserOrchestrator`'s in-memory `ParserRun` is the source of truth for live runs).
- **Flush triggers:** 100ms debounce timer (`.unref()`-d so it doesn't prevent process exit), 500-row size cap, or explicit `flush()`.
- **FK ordering:** Within each `_doFlush`, task batches are flushed before result batches to satisfy `taskResults.taskId → runTasks.id`. This ordering must never be reversed.
- **Read-through:** `peekTask(taskId)` returns the latest buffered snapshot so `getTask()` can return fresh state without waiting for a flush.

### Shutdown safety
All shutdown paths (SIGTERM, SIGINT in API and CLI) follow: stop active runs → `flushPendingWrites()` → `closePool()`. `markRunStopped`/`markRunCompleted` also call `flushPendingWrites()` first before their terminal bulk upsert, ensuring no buffered writes are lost at run completion.

### What is NOT buffered
`saveTaskHtml` is intentionally excluded — it writes to `taskResults.html` via a separate `onConflictDoUpdate({ set: { html: excluded.html } })` that only touches its own column and fires at most once per failed task.

## Questions and Answers

**Q: Could a timer-triggered flush fire after the terminal `_bulkUpsertTasks` in `markRunCompleted`, overwriting terminal state with stale data?**
A: No. `flush()` calls `clearTimer()` first, then drains the buffer. After `flushPendingWrites()` returns, the buffer is empty and the timer is cancelled. The subsequent `_bulkUpsertTasks` writes final state. No post-flush timer can fire for those entries.

**Q: Can results flush without their parent task row existing?**
A: No. `saveTaskResult` is called from `data_extracted` / `task_done` events, which only fire after the task was created via `addTask` + `upsertTask`. The task's `enqueueTask` call is always ordered before the result's `enqueueResult`. Within a single `_doFlush`, task batch runs first. Across separate flushes, the task is already in DB from an earlier flush.

**Q: Does the 100ms durability window risk data loss on hard crash (SIGKILL)?**
A: Yes — up to 100ms of task state updates may be lost if the process is killed without SIGTERM/SIGINT. This is acceptable for this use case: the orchestrator's in-memory state is the authoritative source during a live run; the DB is used for resume and UI polling. On resume, pending/in-progress tasks are re-dispatched regardless of what state they held in DB.

## Trade-offs

- **Durability window:** ~100ms of writes unprotected against hard crash. Mitigated by graceful shutdown hooks.
- **Stale reads:** `getRunTasks` API may return task state up to 100ms stale during an active run. `getTask` (single task) peeks the buffer and returns fresh state.
- **Complexity:** `TaskWriteBuffer` adds a new stateful object that must be flushed on shutdown. Any future caller of `upsertTask`/`saveTaskResult` is asynchronously buffered — callers that previously relied on synchronous completion must call `flushPendingWrites()` before reading back.

## Implementation Results

All 7 unit tests pass (TaskWriteBuffer suite). TypeScript clean. Shutdown paths cover API (SIGTERM/SIGINT) and CLI (SIGINT).
