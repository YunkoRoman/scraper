# Project Instructions

## Project Overview

Universal web scraping platform built with TypeScript, DDD layering, Node.js Worker Threads, Playwright/Puppeteer, PostgreSQL, and a React + Vite client.

Users define multi-step **parsers** (traverser → extractor pipelines) via a code DSL or through the React UI. The orchestrator spawns one Worker Thread per step; workers run concurrently and communicate via message-passing.

## Running the Project

| Command | What it does |
|---|---|
| `npm run start` | API server (port 3001) + React client (port 5173) concurrently |
| `npm run api:dev` | API server only, with hot reload |
| `npm run client` | Vite dev server only |
| `npm run build` | TypeScript compilation |
| `npm run test` | Vitest |
| `npm run db:migrate` | Run DB migrations |
| `npm run db:seed` | Seed example parsers |
| `npm run dev` | CLI entry point |

## Architecture

Four DDD layers:

```
domain/          — pure business logic, no I/O
application/     — orchestration, use cases
infrastructure/  — browser adapters, DB, workers, CSV
api/ + cli/      — thin entry points
```

### Domain (`src/domain/`)

**Entities:**
- `Parser.ts` — `defineParser()` DSL, `ParserConfig` interface
- `Step.ts` — abstract `Step<P>` base class
- `Extractor.ts` — extends Step; `run()` returns `Record<string, unknown>[]`
- `Traverser.ts` — extends Step; `run()` returns `TraverserResult[]`
- `PageTask.ts` — task payload (url, state, stepName, parentTaskId, parent_data)
- `ParserRun.ts` — run statistics and state

**Value Objects:**
- `StepSettings.ts` — browser config: `browser_type`, `concurrency`, `pageDelayMin`, `pageDelayMax`, `maxPagesPerContext`, `launchOptions`, `contextOptions`, `initScripts`, `userAgent`, `proxySettings`
- `StepName.ts` — branded string
- `RetryConfig.ts` — `{ maxRetries: number }`
- `TraverserResult.ts` — `{ link, page_type, parent_data? }`

### Application (`src/application/`)

- `ParserOrchestrator.ts` — main execution engine; spawns workers, routes tasks, handles retries, deduplication, concurrency quota, SSE events
- `ParserRunnerService.ts` — run lifecycle: start, stop, resume
- `RunParser.ts`, `StopParser.ts`, `GetParserStatus.ts` — use cases
- `DebugStepRunner.ts` — single-step debug mode (runs one URL in the main thread)

### Infrastructure (`src/infrastructure/`)

**Browser adapters** (`browser/`):
- `BrowserAdapter.ts` — interface: `launch()`, `newPage()`, `close()`; `createBrowserAdapter(type?, settings?)` factory
- `PlaywrightAdapter.ts` — default; supports `addInitScript()`
- `PlaywrightStealthAdapter.ts` — Playwright + stealth plugin
- `PuppeteerAdapter.ts` — Puppeteer + stealth plugin

**Workers** (`worker/`):
- `ExtractorWorker.ts` — runs extractor steps; queue/concurrency model, random delay, context rotation
- `TraverserWorker.ts` — runs traverser steps; same queue/delay/rotation model
- `messages.ts` — shared message types (see Worker Protocol below)
- `buildContextOptions.ts` — merges parser-level and step-level browser context options
- `pipeConsole.ts` — forwards worker `console.*` to main thread as `LOG` messages

**Database** (`db/`):
- `schema.ts` — Drizzle table definitions (parsers, steps, parserRuns, runTasks, taskResults)
- `client.ts` — PostgreSQL connection via `pg`
- `ParserPersistenceService.ts` — CRUD for parsers and steps
- `RunPersistenceService.ts` — persist runs, tasks, results; resume support
- `migrations/` — raw SQL migration files

**Loader** (`loader/`):
- `DbParserLoader.ts` — loads parser + steps from DB, assembles a `ParserConfig` at runtime

**CSV** (`csv/`):
- `CsvWriter.ts` — writes extracted rows to `output/<parser-name>/<step>.csv`

### API (`src/api/`)

Express app on port 3001.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/parsers` | List all parsers |
| POST | `/api/parsers` | Create parser |
| GET | `/api/parsers/:name` | Get parser + steps |
| PUT | `/api/parsers/:name` | Update parser settings |
| DELETE | `/api/parsers/:name` | Delete parser |
| POST | `/api/parsers/:name/start` | Start a run |
| POST | `/api/parsers/:name/stop` | Stop a run |
| POST | `/api/parsers/:name/resume` | Resume a stopped run |
| GET | `/api/parsers/:name/status` | Run stats |
| GET | `/api/parsers/:name/steps` | List steps |
| POST | `/api/parsers/:name/steps` | Create step |
| PUT | `/api/parsers/:name/steps/:step` | Update step (code, settings, meta) |
| DELETE | `/api/parsers/:name/steps/:step` | Delete step |
| GET | `/api/jobs` | List all runs (paginated) |
| GET | `/api/jobs/:runId` | Get run info |
| GET | `/api/jobs/:runId/tasks` | List tasks (paginated, filterable by status) |
| GET | `/api/jobs/:runId/tasks/:taskId` | Get task |
| GET | `/api/jobs/:runId/tasks/:taskId/result` | Task extracted rows |
| POST | `/api/jobs/:runId/tasks/:taskId/retry` | Retry a failed task |
| POST | `/api/jobs/:runId/tasks/:taskId/abort` | Abort a task |
| POST | `/api/jobs/:runId/retry-failed` | Retry all failed tasks in a run |
| POST | `/api/jobs/:runId/stop` | Stop a run |
| POST | `/api/jobs/:runId/resume` | Resume a run |
| GET | `/api/parsers/:name/files` | List output CSV files |
| GET | `/api/parsers/:name/files/:file` | Download a CSV file |
| GET | `/events` | SSE stream for run events |

### Client (`client/src/`)

React 19 + Vite, TailwindCSS, Framer Motion, Monaco Editor.

Key pages:
- `JobsPage` — list of all parser runs
- `JobDetailPage` — run details, task list, retry/abort controls
- `TaskDetailPage` — single task detail, failed HTML viewer
- `ParserEditorPage` — create/edit parsers and steps (Monaco code editor), `StepSettingsBar`
- `DebugPage` — single-step debug runner with live log output
- `ParserSettingsPanel` — parser-level settings (retries, concurrency quota, browser settings JSON + schema modal)

Key hooks:
- `useParserSSE` — subscribes to SSE stream for live run stats
- `useParserEditor` — parser/step state, save logic
- `useDebugRun` — debug execution lifecycle

## Database Schema

```
parsers
  id (uuid PK), name (unique), entryUrl, entryStep
  browserType, browserSettings (jsonb)
  retryConfig (jsonb), deduplication, concurrentQuota
  createdAt, updatedAt

steps
  id (uuid PK), parserId (FK → parsers), name
  type ('traverser' | 'extractor')
  entryUrl, outputFile, code, stepSettings (jsonb)
  position, createdAt, updatedAt
  UNIQUE (parserId, name)

parserRuns
  id (uuid PK), parserName, status
  startedAt, stoppedAt

runTasks
  id (uuid PK), runId (FK → parserRuns)
  url, stepName, stepType
  state ('pending'|'in_progress'|'retry'|'success'|'failed'|'aborted')
  attempts, maxAttempts, error
  parentTaskId, parent_data (jsonb)
  updatedAt

taskResults
  taskId (uuid PK+FK → runTasks), rows (jsonb[])
```

## Worker Message Protocol

**Main → Worker** (`WorkerInMessage`):
- `{ type: 'PROCESS_PAGE', task: PageTask }` — dispatch a task
- `{ type: 'STOP' }` — shut down the worker

**Worker → Main** (`WorkerOutMessage`):
- `{ type: 'LINKS_DISCOVERED', taskId, items }` — traverser found links
- `{ type: 'DATA_EXTRACTED', taskId, rows, outputFile }` — extractor produced rows
- `{ type: 'PAGE_SUCCESS', taskId }` — page completed successfully
- `{ type: 'PAGE_FAILED', taskId, error, html? }` — page failed (HTML captured for last attempt)
- `{ type: 'LOG', level, stepName, args }` — console output forwarded to main thread

## Settings Merge Order

Step-level `stepSettings` overrides parser-level `browserSettings`. Merging happens in worker `main()`:

```ts
mergedSettings = {
  ...data.browserSettings,   // parser-level
  ...stepSettings,           // step-level (wins)
  contextOptions: buildContextOptions(browserSettings, stepSettings),
  initScripts: [...browserSettings.initScripts, ...stepSettings.initScripts],
}
```

## Design Log

After every change that touches architecture — new entities, new worker behaviour, new persistence patterns, new API contracts, UI component patterns, cross-cutting concerns — update `design-log/`:

1. Create a new numbered log file (`NNN-short-slug.md`) following the format of existing entries: Background, Problem, Design, Questions and Answers, Trade-offs, Implementation Results.
2. Append a row to `design-log/index.md` with the log number, title (linked), status, and a one-line description.

What counts as architectural:
- Adding or removing domain entities, value objects, or services
- Changes to worker message protocol or worker lifecycle
- New persistence patterns (new tables, new query patterns, new services)
- New API endpoints or changes to existing contracts
- New React component patterns or cross-cutting UI concerns
- New settings or configuration fields that affect runtime behaviour

What does not require a log entry:
- Bug fixes that don't change the design (add to Implementation Results of the relevant existing log instead)
- Cosmetic/style-only changes
- Renaming without behaviour change
