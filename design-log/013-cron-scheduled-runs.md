# 013 — Cron scheduled runs

## Background

Parser runs were exclusively triggered manually — via the UI or a direct API call to `POST /api/parsers/:name/start`. Users running nightly data pipelines had to either trigger runs by hand or build their own external cron systems. Keeping schedules in an external cron daemon (OS cron, GitHub Actions) fragmented configuration across systems.

## Problem

No scheduling mechanism existed inside the platform. Users with recurring scraping needs maintained external scripts with timing logic that had no visibility or management surface inside the UI.

## Design

**DB — `scheduledRuns` table** (migration `0004_scheduled_runs.sql`):

```
id (uuid PK), parserId (FK → parsers), cronExpression (text)
enabled (boolean, default true)
lastRunAt (timestamptz, nullable), nextRunAt (timestamptz, nullable)
UNIQUE (parserId)
```

One row per parser; a parser can have at most one schedule.

**`SchedulePersistenceService`** — extends `BasePersistenceService`; adds `findByParserId`, `upsertForParser`, `deleteByParserId`, `listEnabled`. The `upsertForParser` method checks for an existing row and either updates or creates, keeping the one-schedule-per-parser invariant without requiring `ON CONFLICT` syntax across all Drizzle adapters.

**`SchedulerService`** — application-layer service, instantiated in `server.ts`:

- `start()` calls `tick()` immediately then sets a `setInterval` at 60 s.
- `stop()` calls `clearInterval` on shutdown.
- `tick()` loads all enabled schedules, filters those whose `nextRunAt ≤ now`, looks up the parser, skips if the parser is already running (`runner.isRunning`), updates `lastRunAt` / `nextRunAt`, then calls `runner.run(name)` (fire-and-forget, errors logged).
- `nextFireAt(cronExpression, from)` is a static helper that parses the expression via `cron-parser` and returns the next `Date`. Returns `null` for invalid expressions.

**API routes** (wired into `createParsersRouter`):

| Method | Path | Action |
|---|---|---|
| GET | `/api/parsers/:id/schedule` | Fetch schedule for a parser |
| PUT | `/api/parsers/:id/schedule` | Upsert schedule (body: `{ cronExpression, enabled }`) |
| DELETE | `/api/parsers/:id/schedule` | Remove schedule |

On PUT, the server calls `SchedulerService.nextFireAt` to compute and persist `nextRunAt` alongside the expression.

**`SchedulePanel`** — React component mounted on `ParserDetailPage`:

- Fetches the current schedule on mount.
- Shows a cron expression input, an enable/disable toggle, and next-fire preview (computed client-side via `cron-parser`).
- Save calls PUT; delete calls DELETE.

## Questions and Answers

- **Q1 — Why 60 s poll instead of precise timer per schedule?** A single interval is simpler and cheaper than N timers (one per enabled schedule). With a 60 s granularity, schedules fire within one minute of their intended time — acceptable for all real-world scraping cadences (hourly, daily, weekly).
- **Q2 — Why one schedule per parser?** Simplicity. Multiple concurrent schedules for the same parser would require merge logic to avoid double-firing. One row per parser makes the constraint enforceable at the DB level with a UNIQUE constraint on `parserId`.
- **Q3 — Why skip the run if the parser is already running?** A slow parser triggered on a tight cron (e.g. hourly) could overlap with itself. Skipping avoids resource multiplication; the schedule just waits for the next tick.
- **Q4 — Why `cron-parser` rather than a custom implementation?** Full cron syntax (including step values, ranges, and month/weekday names) is non-trivial to parse correctly. `cron-parser` is battle-tested and handles all standard expressions including non-standard ones (seconds-based).

## Trade-offs

| Decision | Trade-off |
|---|---|
| 60 s poll granularity | Schedules can fire up to 60 s late. Sub-minute cadences are not possible. |
| One schedule per parser | Users who want multiple different run windows (e.g. 08:00 and 20:00) must set up two separate parsers. |
| `nextRunAt` stored in DB | Accurate preview without re-parsing the expression; can drift if the server restarts mid-interval. Drift is bounded to one poll cycle. |
| Fire-and-forget run | Scheduler does not track whether the triggered run completed successfully. Run outcome is tracked separately in `parserRuns`. |

## Implementation Results

- Migration `0004_scheduled_runs.sql` applied; UNIQUE constraint on `parserId` added via supplementary migration `0004b_scheduled_runs_unique.sql`.
- `SchedulePersistenceService` and `SchedulerService` implemented and unit-tested.
- `SchedulerService.start()` called in `server.ts` on startup; `stop()` called in the shutdown handler.
- Schedule GET/PUT/DELETE routes wired into the parsers router.
- `SchedulePanel` component mounted on `ParserDetailPage`; cron preview computed client-side.
- `runner.isRunning` guard verified to prevent overlapping runs.
