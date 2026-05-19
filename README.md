# Scraper Platform

Universal web scraping platform. Parsers are multi-step pipelines (traversers → extractors) running in Worker Threads, with a React UI for building, running, and monitoring jobs.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # edit DATABASE_URL if needed
npm run db:migrate
```

## Running

```bash
npm run start       # API (port 3001) + UI (port 5173)
npm run api:dev     # API only, hot reload
npm run client      # UI only
```

## Commands

| Command | Description |
|---|---|
| `npm run start` | Start API + UI |
| `npm run build` | TypeScript compile |
| `npm run test` | Vitest |
| `npm run db:migrate` | Run DB migrations |
| `npm run db:seed` | Seed example parsers |
| `npm run dev` | CLI entry point |

## Output

CSV files are written to `output/<parser-name>/<run-id>/`.

## Architecture

Four DDD layers: `domain` → `application` → `infrastructure` → `api/cli`.
One Worker Thread per step; the orchestrator routes tasks via message passing.

See `design-log/` for architectural decisions.
