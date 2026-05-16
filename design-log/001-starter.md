# 001 — Starter: DDD scraper platform + Express API + React client

## Background

Greenfield project. Universal web scraping platform where parsers are TypeScript files that define a graph of steps — each step is a user-written async function that receives a browser page and returns structured data.

Goal: run multiple parsers concurrently, collect structured output to CSV, persist run history to Postgres, and expose a web UI for monitoring and debugging.

## Problem

Build a scraping platform that:

- Isolates per-step execution so one failing step doesn't crash others.
- Supports multiple browser adapters (Playwright, Puppeteer, stealth variants) without coupling domain logic to any one.
- Persists parsers, steps, and run history in a DB so they survive restarts and can be managed from a UI.
- Streams real-time run status to the browser without polling.
- Allows live step debugging without running a full parser.

## Questions and Answers

- **Q1 — Architecture pattern?** Domain-Driven Design (DDD). Four layers: `domain` (entities, value objects, no I/O), `application` (use cases, orchestrator, services), `infrastructure` (browser, worker, DB, CSV), `cli`/`api` (entry points). Domain stays pure; infrastructure implements interfaces defined by domain.
- **Q2 — Concurrency model?** One Node.js Worker Thread per step. All workers run concurrently; the main thread (orchestrator) routes tasks via message passing. Isolates step crashes and avoids shared-state bugs.
- **Q3 — Browser automation?** Playwright as the primary adapter. Puppeteer and `playwright-extra` + stealth plugin as alternatives. All adapters implement a `BrowserAdapter` interface so domain code is adapter-agnostic.
- **Q4 — Database?** PostgreSQL with Drizzle ORM. Raw SQL migrations (`0001_init.sql`, `0002_run_persistence.sql`) applied via `npm run db:migrate`. No ORM-managed schema sync.
- **Q5 — Output format?** CSV via `fast-csv`. A `CsvWriter` in infrastructure handles row buffering and flushing. A `CsvPostProcessor` handles post-run transformations (e.g. JSON column serialization).
- **Q6 — API?** Express REST + SSE. REST routes under `/api/parsers` and `/api/jobs`. SSE endpoint pushes run events to the browser without polling.
- **Q7 — Client?** React + Vite SPA in `client/`. TypeScript strict mode. Fetches from the Express API. Runs as a separate dev server in development; served as static files in production.
- **Q8 — Deduplication?** Link deduplicator in the domain layer (`LinkDeduplicator`). Per-run in-memory set; configurable per parser via `deduplication` flag.
- **Q9 — Retry logic?** Configurable `RetryConfig` value object (default `maxRetries: 5`). Applied per page task by the orchestrator.
- **Q10 — Debug mode?** `DebugStepRunner` use case runs a single step against a given URL outside the normal run pipeline. Exposed via REST and the UI debug panel.

## Design

### Repo layout

```
/
├── design-log/            # this log system
├── src/
│   ├── domain/
│   │   ├── entities/      # Parser, Step, Traverser, Extractor, ParserRun, PageTask
│   │   ├── value-objects/ # RetryConfig, StepName, PageState, StepSettings, TraverserResult
│   │   └── services/      # LinkDeduplicator
│   ├── application/
│   │   ├── use-cases/     # RunParser, StopParser, GetParserStatus, DebugStepRunner
│   │   ├── services/      # ParserRunnerService
│   │   └── orchestrator/  # ParserOrchestrator
│   ├── infrastructure/
│   │   ├── browser/       # BrowserAdapter (interface), PlaywrightAdapter, PuppeteerAdapter, PlaywrightStealthAdapter
│   │   ├── worker/        # TraverserWorker, ExtractorWorker, messages, worker-bootstrap.js
│   │   ├── db/            # schema, migrations, client, BasePersistenceService, ParserPersistenceService, RunPersistenceService
│   │   ├── csv/           # CsvWriter, CsvPostProcessor
│   │   └── loader/        # IParserLoader, DbParserLoader
│   ├── api/               # Express server, REST routes (parsers, jobs), SSE
│   └── cli/               # commander entry point, ConsoleReporter
├── client/                # React + Vite SPA
├── tests/
├── package.json
└── tsconfig.json
```

### Layer dependency rules

```
cli / api
    ↓
application  (orchestrates domain + infrastructure)
    ↓
domain       (pure — no I/O, no imports from infra)
    ↑
infrastructure  (implements domain interfaces)
```

### Thread model

```
Main Thread (ParserOrchestrator)
│
├── Worker Thread: step "index"     → TraverserWorker (discovers links)
├── Worker Thread: step "category"  → TraverserWorker
└── Worker Thread: step "product"   → ExtractorWorker (extracts data)
```

Workers communicate with the orchestrator via `postMessage`. Each worker owns one Playwright browser context for its lifetime.

### Database schema

Three migration files applied in order:

- **`0001_init.sql`** — `parsers` + `steps` tables. Parsers hold config (entryUrl, entryStep, browserType, retryConfig, etc.); steps hold user code + settings.
- **`0002_run_persistence.sql`** — `parser_runs` + `run_tasks` + `task_results`. Run tracks overall status; tasks track per-URL state (pending/running/done/failed) with retry counts; results hold extracted rows as JSONB.

### API surface

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/parsers` | List all parsers |
| POST | `/api/parsers` | Create parser |
| PATCH | `/api/parsers/:id` | Update parser |
| DELETE | `/api/parsers/:id` | Delete parser |
| POST | `/api/jobs` | Start a parser run |
| GET | `/api/jobs` | List runs |
| GET | `/api/jobs/:id` | Get run status + tasks |
| POST | `/api/jobs/:id/stop` | Stop a running job |
| GET | `/api/sse` | SSE stream of run events |

### Browser adapter interface

All adapters implement `BrowserAdapter` so the orchestrator never imports Playwright or Puppeteer directly. Adapter is selected at run time from the parser's `browserType` field (`playwright` / `puppeteer` / `playwright-stealth`).

## Trade-offs

- **Worker Threads over child processes**: lower spawn overhead, shared memory possible (not used yet), but harder to kill a hung worker — mitigated by per-task timeouts.
- **Drizzle ORM over raw SQL**: type-safe queries, schema-as-code via `schema.ts`, but migrations are raw SQL files (not Drizzle-generated) — deliberate choice to keep migration control explicit.
- **SSE over WebSockets**: simpler server-side (no upgrade handling, works through HTTP/1.1 proxies), unidirectional — sufficient for read-only run status streaming.
- **Single Express process**: simple; no message broker. Bottleneck if the platform needs to distribute across machines — acceptable for single-node use.

## Implementation Results

Platform scaffolded and operational.

- DDD layer structure in place; domain has no infrastructure imports.
- Three browser adapters functional: `PlaywrightAdapter`, `PuppeteerAdapter`, `PlaywrightStealthAdapter`.
- Worker thread model running with `TraverserWorker` and `ExtractorWorker`.
- Postgres schema live via two SQL migrations applied by `npm run db:migrate`.
- Express API operational with REST routes and SSE.
- React + Vite client served in development via `npm run client`; full stack via `npm run start`.
- CLI entry point via `commander` (`npm run dev`).
- Debug panel in the UI allows single-step execution against arbitrary URLs.
