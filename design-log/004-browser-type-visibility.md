# 004 — Browser type visibility and DbParserLoader fix

## Background

The platform supports three browser adapters: `playwright`, `playwright-stealth`, and `puppeteer`. The adapter is selected per-parser via a dropdown in the editor UI, which writes a `browser_type` column on the `parsers` table. When a parser is blocked by bot detection, the operator switches to `playwright-stealth` — but after doing so and re-running, the stealth adapter was not being used. The browser type was also invisible anywhere in the Task Detail UI, making it impossible to confirm which adapter a task actually ran under.

## Problems

1. **DbParserLoader silently dropped `browserType`**: the loader read `row.browserSettings` (JSONB) into `ParserConfig.browserSettings` but never read the separate `browserType` column. The worker always received `browser_type: undefined` and fell back to the plain Playwright adapter regardless of what the UI showed.

2. **Task Detail shows no browser info**: operators had no way to confirm which adapter a given task used.

3. **Misleading "Not captured" fallback message**: the Response HTML section showed "task may have been recorded before this feature was added" — but the feature is now always active, so the message was factually wrong when HTML was missing for other reasons (browser crash, `page.content()` throwing).

## Questions and Answers

- **Q1 — Why two separate fields (`browserType` column vs `browserSettings` JSONB)?** The `browserType` column predates `browserSettings`. `browserSettings` is a catch-all JSONB bag for advanced options (userAgent, contextOptions, initScripts). `browser_type` also appears inside `StepSettings` so it can be overridden per-step. The two fields coexist by design; the DB column is the parser-level default.
- **Q2 — Fix location?** `DbParserLoader.load()`. It builds `ParserConfig` from DB rows; this is the single place where both fields are available.
- **Q3 — Merge order?** `browser_type` from the DB column is the base; `browserSettings` JSONB spreads on top, so an explicit `browser_type` inside the JSONB can still override it (consistent with the existing spread order for other fields).
- **Q4 — Where to surface `browserType` in the UI?** The Task Detail page already fetches `RunInfo` via `GET /api/jobs/:runId`. Adding `browserType` to that response is zero-cost for the client.
- **Q5 — Where does `browserType` live at query time?** On the `parsers` table, joined by `parserName`. The `parserRuns` table has `parserName` but not `browserType`. A `leftJoin` on `parsers` is the cleanest approach; no migration needed.
- **Q6 — Does `getAllRuns` need the join too?** Yes — `RunInfo` now requires `browserType`. A separate bulk select on `parsers` keyed by parser name is cleaner than restructuring the multi-level stats aggregation that `getAllRuns` already performs.
- **Q7 — What about the "Not captured" message?** Reworded to describe the actual failure mode (browser crash / `page.content()` threw) rather than implying the feature didn't exist yet.

## Design

### DbParserLoader fix

```ts
// Before — browserType column was never read:
browserSettings: Object.keys(row.browserSettings as object).length
  ? (row.browserSettings as ParserConfig['browserSettings'])
  : undefined

// After — DB column is the base; JSONB overrides:
browserSettings: {
  browser_type: row.browserType as BrowserType,
  ...(row.browserSettings as ParserConfig['browserSettings']),
}
```

The spread means a `browser_type` key inside the JSONB bag (if a user set one manually) still wins. The `browserSettings` object is always defined now — `undefined` is no longer returned — which is safe because the worker already spreads it with `...data.browserSettings` and handles an empty object gracefully.

### RunInfo — browserType field

```ts
// RunPersistenceService.RunInfo
export interface RunInfo {
  id: string
  parserName: string
  browserType: string   // added
  ...
}
```

`findById` and `getLatestRunInfo` use a `leftJoin` on `parsers`:

```ts
const [row] = await this.db
  .select({ run: parserRuns, browserType: parsers.browserType })
  .from(parserRuns)
  .leftJoin(parsers, eq(parsers.name, parserRuns.parserName))
  .where(eq(parserRuns.id, id))
return { ...row.run, browserType: row.browserType ?? 'playwright', stats }
```

`getAllRuns` does a single bulk lookup after fetching runs, to avoid restructuring its multi-step stats aggregation:

```ts
const parserNames = [...new Set(rows.map((r) => r.parserName))]
const parserRows = await this.db.select({ name: parsers.name, browserType: parsers.browserType })
  .from(parsers).where(inArray(parsers.name, parserNames))
const browserTypeByParser = new Map(parserRows.map((p) => [p.name, p.browserType]))
// merged per run in the map step
```

`create` and `update` return `RunInfo` for interface compliance; both default `browserType` to `'playwright'` since those paths don't require a join (create is internal bookkeeping, update's return value is unused by callers).

### Task Detail UI

A **Browser** field is added to the info grid in `TaskDetailPage`, alongside Job:

```tsx
<div>
  <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Browser</p>
  <p className="text-gray-800 dark:text-gray-200 text-xs font-mono">{run?.browserType ?? '…'}</p>
</div>
```

### "Not captured" message

```
// Before:
Not captured (task may have been recorded before this feature was added)

// After:
Not captured — page may have crashed before content could be read
```

## Trade-offs

- **Current parser config, not run-time snapshot**: `browserType` is read from `parsers` at query time. If an operator changes the parser's browser type after a run completes, the shown type will reflect the new setting. Storing `browserType` on `parserRuns` at run-start would give an exact snapshot, but requires a migration. Acceptable at current scale — browser type changes are intentional and infrequent.
- **leftJoin vs inner join**: `leftJoin` is used so that runs whose parser was deleted still appear (with a `null` `browserType`, defaulting to `'playwright'`). An inner join would silently drop such runs from list views.
- **`create`/`update` defaults**: these paths don't query the parser table, so `browserType` is hard-coded to `'playwright'`. This is safe because `create` is only used for internal bookkeeping and `update`'s return value is not consumed by any caller today.

## Implementation Results

Four files changed:

- `src/infrastructure/loader/DbParserLoader.ts` — read `row.browserType` into `browserSettings.browser_type`; import `BrowserType`
- `src/infrastructure/db/RunPersistenceService.ts` — `browserType` on `RunInfo`; `leftJoin` in `findById` and `getLatestRunInfo`; bulk lookup in `getAllRuns`; `parsers` import
- `client/src/api.ts` — `browserType: string` on `RunInfo`
- `client/src/components/TaskDetailPage.tsx` — Browser field in info grid; reworded "Not captured" message

No DB migration. `tsc --noEmit` clean on both backend and client.
