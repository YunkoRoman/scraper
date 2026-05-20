# 008 — Enriched parser list: per-parser stats in a single query

## Background

The parsers page rebuild requires a list view that shows each parser's current status, last run date, and task success rate. Previously `GET /api/parsers` returned only parser names; the client would need N+1 round-trips to fetch run info for each parser.

## Problem

N+1 queries (one per parser to fetch the latest run, then one more per run to count tasks) would be slow and noisy. The list also needs a live "running" status that is tracked in-memory by the orchestrator, not reliably reflected in the DB until the run finishes.

## Design

**Single SQL query with two CTEs** added as `listParsersWithLatestRun` on `RunPersistenceService`:

1. `latest_runs` — `DISTINCT ON (parser_name)` ordered by `started_at DESC` gives the latest run per parser efficiently.
2. `run_stats` — `COUNT` with conditional aggregation over `run_tasks` for only the latest-run IDs, giving `success_count` and `total_count` per run.

The main select left-joins both CTEs onto `parsers`, so parsers with no runs still appear (all NULLs for run columns).

**Status derivation** — the DB `status` column is mapped to `dbStatus` (`running | stopped | idle`). The API layer overrides `dbStatus` with the in-memory runner's live status for any actively running parser, ensuring callers see `running` even before the DB is updated.

**Performance chart** — `getPerformanceLast7Days` groups `parser_runs` by UTC date for the past 7 days, counting completed vs failed runs. Dates with zero runs are omitted (sparse result).

## Questions and Answers

- **Q1 — Why DISTINCT ON instead of a subquery or window function?** DISTINCT ON is idiomatic PostgreSQL for "latest row per group" and compiles to an efficient index scan when `(parser_name, started_at DESC)` is indexed. The alternatives (ROW_NUMBER window or correlated subquery) are more verbose with similar plans.
- **Q2 — Why derive status in the API layer rather than SQL?** The authoritative "running" state lives in the orchestrator's in-memory map; writing it back to DB synchronously on every tick would be expensive. The DB status is updated on stop/complete, so in-memory override is the right seam.

## Trade-offs

| Decision | Trade-off |
|---|---|
| `DISTINCT ON` CTE | PostgreSQL-specific syntax; efficient and readable. Not portable to other DBs, but this project is PostgreSQL-only. |
| Status from in-memory runner | Slight inconsistency if the server restarts mid-run without updating the DB (run stays `running` in DB). Acceptable: restarts are manual and runs can be stopped/resumed. |
| Omit zero-count dates from performance chart | Simpler query and smaller payload; client fills gaps if needed. |

## Implementation Results

- Added `listParsersWithLatestRun(search: string): Promise<RawParserEnriched[]>` to `RunPersistenceService`.
- Added `getPerformanceLast7Days(): Promise<{date, successful, failed}[]>` to `RunPersistenceService`.
- `RawParserEnriched` interface exported for use by the API route and client types.
- New `GET /api/dashboard/performance` route mounted at `/api/dashboard`; calls `getPerformanceLast7Days`.
- Extended `GET /api/jobs` to accept `?status=running`: when `status=running`, returns only in-flight runs from the orchestrator's in-memory list (enriched with live stats and elapsed seconds). Other status values fall through to the existing paginated `getAllRuns` path unchanged.
