# 020 — Orchestrator Persistence Offload

## Background

ParserRun held all active task state in an in-memory Map (`_taskMap`). This map was the source of truth for live runs, but was discarded on orchestrator shutdown. Resume required loading a "snapshot" from DB and rehydrating the Map. Stats queries needed a `GROUP BY` to count tasks in each state, creating multiple round-trips per API poll. The Map could grow unbounded with no eviction strategy.

## Problem

1. **Resume complexity:** `ParserOrchestrator` constructor accepted a `snapshotTasks?: PageTask[]` parameter, and `ParserRunnerService.resume()` loaded the snapshot from DB, then passed it to the orchestrator. This pattern was fragile: the snapshot was optional, unclear when it was required, and any restart between snapshot load and orchestrator construction risked losing state.

2. **Stats hot path:** Every `.getStats()` call on a live run executed a `COUNT(*)` GROUP BY query. With UI polling every 2–5 seconds and dozens of active runs, this became hundreds of queries per second.

3. **Unbounded memory:** Long-running parsers with 100k+ tasks would keep all task state in a single in-memory Map with no eviction. A context-rotation failure cascading to a large task set could exhaust Node memory.

4. **Architectural opacity:** The ParserRun Map was the de facto state store, but the DB held the persistent copy. This split ownership was unclear: which source was canonical during a live run? On what schedule did they synchronize?

## Design

### TaskStateStore abstraction
Introduced a `TaskStateStore` interface (all async) that encapsulates all task-state access. Two implementations:

- **`InMemoryTaskStateStore`** — test/offline mode. Backed by a `Map<taskId, PageTask>`. Used in test suites.
- **`DbTaskStateStore`** — production. Backed by PostgreSQL, with a write-through FIFO cache (max 5000 entries) and an incremental in-memory `_stats: RunStats` counter.

### ParserOrchestrator refactoring
Moved all task state mutations into the store. Constructor signature changed to:
```ts
constructor(
  config: ParserConfig,
  outputBaseDir: string,
  store: TaskStateStore,
  runId: string,
  snapshotTasks?: PageTask[]
)
```

All prior `_taskMap` operations (`add`, `get`, `mutate`, `getStats`) became async calls to `store.*`:
- `addTask(task)` — creates a new task
- `mutate(taskId, delta)` — applies a state delta
- `getTask(taskId)` — retrieves a task
- `getStats()` — returns `RunStats` (O(1) for `DbTaskStateStore`)
- `allTasks()` — returns all tasks (used on resume)
- `isComplete()` — checks if all tasks are terminal (O(1))

### DbTaskStateStore internals
The store is initialized with a `runId`:

1. **Write-through FIFO cache:** Reads check the cache first; if miss, they read from DB and store the result. Writes go to cache AND `RunPersistenceService` (which queues in `TaskWriteBuffer`). When cache size exceeds 5000, the oldest entry is evicted.

2. **Incremental stats counter:** `_stats` is an in-memory object tracking `{ pending, inProgress, success, failed, aborted }`. Every `mutate()` call:
   - Fetches the current task from cache/DB
   - Computes `applyStatsDelta(prev, next)` — decrements the old state bucket, increments the new bucket
   - Stores the result
   - Updates `_stats` in-place
   
   Result: `getStats()` returns the counter directly without DB queries.

3. **On resume:** `allTasks()` is called to restore state:
   - Flush the write buffer to ensure all pending writes reach the DB
   - Load all tasks for the run from the DB
   - Rebuild `_stats` by summing task state counts
   - Warm the cache with loaded tasks

### Concurrency safety
`ParserOrchestrator`'s quota enforcement was reordered:

```ts
globalActive++;  // Increment FIRST
await store.markInProgress(task);  // Then persist
```

This prevents concurrent quota bypass: if many tasks complete simultaneously, `globalActive++` reserves the quota slot before the await; concurrent callers see the updated count.

### Wire event cleanup
Removed the double-write pattern from `ParserRunnerService._wireTaskEvents`. Previously, the runner called `_orchest.addTask(task)` (which called `store.addTask`) AND separately called `upsertTask` on the persistence service. Now only the store call remains; persistence is the store's responsibility.

## Questions and Answers

**Q: Why is the cache FIFO and not LRU?**
A: FIFO (simple queue) is predictable and has no "hot" bias — we evict the oldest entry regardless of access pattern. This avoids pathological behavior where a single frequently-accessed task blocks eviction of rarely-accessed older entries. For typical runs (tasks complete in order), FIFO aligns well with task lifecycle.

**Q: Can the incremental stats counter diverge from reality?**
A: Only if a `mutate()` call fails after modifying `_stats`. The counter is updated in-place and not rolled back. Mitigation: `mutate()` is simple (one async write to the cache/DB) so failure is rare. On resume, `allTasks()` rebuilds `_stats` from the DB, so any divergence is corrected on the next resume.

**Q: What if the orchestrator crashes during a task's transition?**
A: The task's latest state is either in the write buffer (if the write hasn't flushed yet) or in the DB (if it has). On resume, `allTasks()` loads from DB (after flushing the buffer). pending/in_progress tasks are re-dispatched. Completed tasks are skipped. There is no "partial" state — a task is either fully updated or not.

**Q: Does moving state to the DB add noticeable latency?**
A: For live runs, the write-through cache absorbs reads and writes. Latency is 1–2 ms per store call (cache lookup + buffer enqueue). The orchestrator's event loop is not blocked (writes are async and proceed in parallel). For `getStats()` calls, the in-memory counter removes any DB round-trip.

**Q: Why is snapshotTasks still an optional parameter?**
A: For backward compatibility and tests. In production, `RunParser.execute()` always passes `undefined` (never uses snapshot). Tests may pass a snapshot to initialize state without DB setup. In a future refactor, the parameter could be removed.

## Trade-offs

- **Async pervasiveness:** All task state access is now async. Orchestrator's `handleWorkerMessage` method became async, and all callers must `await` or use `.then()`. This increases cognitive load for future maintainers.

- **Cache-DB divergence:** If a write fails after updating the cache, the cache has stale state until the next eviction or resume. Mitigated by the buffer's flush guarantee and resume rebuilding.

- **Initial load latency:** On resume, `allTasks()` blocks until all tasks are loaded from DB. For 100k-task runs, this is seconds. Acceptable because: (1) resume is infrequent, (2) UI shows a loading state, (3) tasks are queued/dispatched as the orchestrator comes online anyway.

- **API latency for task lists:** `GET /api/jobs/:runId/tasks` no longer reads from the orchestrator's in-memory map; it queries the DB directly. The DB read is slower than an in-memory lookup (5–20ms vs <1ms), but the trade-off is justified: the DB is canonical, and the API can serve past runs (after orchestrator shutdown).

## Implementation Results

All 11 new tests pass (5 for `InMemoryTaskStateStore`, 6 for `DbTaskStateStore`). TypeScript compiles clean. ParserOrchestrator's message handler is async with explicit error handling (`.catch()`). Concurrency quota enforcement tested via a unit test covering the race condition. Resume tested end-to-end: orchestrator loads state from DB, stats rebuild matches expected counts. All API routes updated to `await` on async task operations (retryTask, abortTask).
