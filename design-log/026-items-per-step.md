# 026 — Items Per Step

## Background

The JobDetailPage showed task-level status counts (total / success / failed) but gave no insight into how many data items each task produced. Users had no way to gauge scrape yield without downloading CSV output files.

## Problem

- No per-task item count in the task table
- No aggregate "total items extracted" in the job header
- Both live (orchestrator in-memory) and completed (DB) run paths needed to provide this data

## Design

### Data Model

`PageTask` domain entity is unchanged — item count is a result, not task input state.

Two new fields on existing types:

**`RunStats`** (domain):
```ts
totalItems: number  // extractor rows only; traverser links excluded (already reflected as task counts)
```

**`TaskRow`** (client API type):
```ts
itemCount: number | null  // null = pending, failed with no result, or traverser with no children yet
```

### Backend — Live Runs

`ParserOrchestrator` tracks two private maps:
- `extractorItemCounts: Map<taskId, number>` — set on `DATA_EXTRACTED` (overwrite, rows.length)
- `traverserItemCounts: Map<taskId, number>` — incremented on `LINKS_DISCOVERED` (accumulates across batches, uses `validItems.length` post-dedup)

`getItemCounts()` merges both maps for the tasks API. `getStats()` overrides the store's `getStats()` to inject `totalItems` by summing extractor counts.

All `emit('stats', ...)` and `emit('complete', ...)` call sites were updated to call `this.getStats()` so SSE events carry real `totalItems`.

### Backend — Completed Runs

`RunPersistenceService` gains:

- `getTaskItemCounts(taskIds, stepTypes)` — two separate Drizzle queries:
  - Extractor: `jsonb_array_length(task_results.rows)` joined via `inArray(taskResults.taskId, extractorIds)`
  - Traverser: `COUNT(*)` from `run_tasks` grouped by `parent_task_id` via `inArray(runTasks.parentTaskId, traverserIds)`
  - Returns `Map<taskId, number>`
- `_computeStats()` gains a second SQL pass: `SUM(jsonb_array_length(tr.rows))` over extractor tasks in the run to populate `totalItems`

### Frontend

**Header stat strip** — "Total Items" chip shown after Failed, hidden when `stats.totalItems === 0` (clean for traverser-only runs).

**Task table** — "Items" column between Attempts and Error. Display: `"N rows"` (extractor), `"N links"` (traverser), `"—"` (pending/failed/no result).

## Questions and Answers

**Q: Should `totalItems` include traverser links?**
A: No. Traverser links become tasks and are already counted in Total Tasks. Including them would conflate two different signals.

**Q: What about future steps combining traverser + extractor?**
A: Scoped out. The current design can be extended by splitting `itemCount` into `extractedCount` / `traversedCount` without breaking the existing API contract.

## Trade-offs

- Orchestrator maps grow proportionally with task count — acceptable since all tasks are already held in memory.
- DB lateral child-count query for traversers requires pagination to stay fast (50 rows/page default).
- `totalItems` deliberately excludes traverser links (design choice, not a limitation).

## Implementation Results

- `RunStats.totalItems` added to domain entity `ParserRun.ts`
- `InMemoryTaskStateStore` and `DbTaskStateStore` both return `totalItems: 0` from `emptyStats()`; orchestrator overwrites for live runs; `_computeStats()` SQL pass fills it for completed runs
- Critical bug during implementation: raw `db.execute(sql\`WHERE task_id = ANY(${ids}::uuid[])\`)` caused PostgreSQL `malformed array literal` error. Fixed by switching to Drizzle's `inArray()` operator which correctly parameterizes arrays.
- All 116 tests pass; lint clean.
