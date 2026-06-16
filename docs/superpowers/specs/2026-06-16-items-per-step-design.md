# Items Per Step — Design Spec

**Date:** 2026-06-16  
**Status:** Approved

## Background

The JobDetailPage shows task counts (total/success/failed) per step but gives no visibility into how many data items each task or step produced. Users have no way to gauge scrape yield without downloading CSV output.

## Problem

- No per-task item count visible in the task table
- No aggregate "total items extracted" in the job header
- Both the live (orchestrator in-memory) and completed (DB) paths need to provide this data

## Design

### Data Model

`PageTask` (domain entity) is unchanged — item count is a result, not task state.

Two new fields on existing types:

**`client/src/api.ts`**
```ts
interface TaskRow {
  // ... existing ...
  itemCount: number | null  // null = pending / failed with no result
}

interface RunStats {
  // ... existing ...
  totalItems: number  // extractor rows only
}
```

`totalItems` counts extracted rows only. Traverser item counts (links discovered) are visible per-task in the Items column. Showing traverser output in totalItems would double-count work already reflected in task counts.

### Backend

**1. Orchestrator item tracking (`ParserOrchestrator.ts`)**

Add `private itemCounts = new Map<string, number>()`.

In `handleWorkerMessage`:
- `DATA_EXTRACTED`: `itemCounts.set(taskId, rows.length)`
- `LINKS_DISCOVERED`: `itemCounts.set(parentTaskId, (itemCounts.get(parentTaskId) ?? 0) + validItems.length)`  
  (increment after deduplication so the count matches what was actually dispatched)

`getAllTasks()` merges item counts into returned task objects via object spread — no domain entity mutation.

**2. `RunStats.totalItems` for active runs**

`ParserOrchestrator.getStats()` calls `store.getStats()` then appends `totalItems` by summing `itemCounts` values for tasks whose `stepType === 'extractor'`.

`RunStats` in `src/domain/entities/ParserRun.ts` gains `totalItems: number`.  
`InMemoryTaskStateStore.getStats()` returns `totalItems: 0` (orchestrator always overwrites it).

**3. DB path — `getRunTasks` extended**

`RunPersistenceService.getRunTasks()` adds `itemCount` via raw SQL:
- Extractor: `LEFT JOIN task_results tr ON tr.task_id = rt.id` → `COALESCE(jsonb_array_length(tr.rows), 0)`
- Traverser: correlated subcount `(SELECT COUNT(*) FROM run_tasks c WHERE c.parent_task_id = rt.id)`
- Combined via `CASE WHEN rt.step_type = 'extractor' THEN ... ELSE ... END AS item_count`

**4. `getStepStats` extended for totalItems on completed runs**

`RunPersistenceService.getStepStats()` gains a `totalItems` field via `SUM(jsonb_array_length(tr.rows))` join. The jobs status endpoint includes this in `RunStats` for completed/stopped runs.

### Frontend

**Header stat strip**

Add "Total Items" chip after Failed:
```
Total Tasks: 1  |  Success: 1  |  Failed: 0  |  Total Items: 42
```
Hidden when `stats.totalItems === 0` (clean for traverser-only runs).

**Task table — "Items" column**

New column between Attempts and Error:

| State | Display |
|---|---|
| Extractor with result | `42 rows` |
| Traverser with result | `5 links` |
| Pending / in-progress | `—` |
| Failed with no result | `—` |

Label ("rows" vs "links") derived from `task.stepType`. Column header: **Items**.

## Trade-offs

- Orchestrator `itemCounts` map grows proportionally with task count — acceptable since the orchestrator already holds all tasks in memory.
- DB lateral subquery for traverser child counts adds a correlated scan. Mitigated by pagination (50 rows per page) and an index on `run_tasks.parent_task_id` (should be verified/added).
- `totalItems` does not count traverser links because they are already surfaced as task counts. This is a deliberate design choice, not a limitation.

## Questions and Answers

**Q: Should totalItems include traverser links?**  
A: No. Traverser links become tasks and are already counted in Total Tasks. Including them in totalItems would conflate two different signals.

**Q: What about future steps that combine traverser + extractor?**  
A: The separate ERs/TRs column approach (inspired by a reference screenshot) was scoped out. This design can be extended later by splitting itemCount into extractedCount + traversedCount without breaking the existing contract.
