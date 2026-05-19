# Scraper Platform

A developer-focused web scraping platform built with TypeScript and Playwright. Define multi-step scraping pipelines in code — traversers discover links, extractors pull structured data — then run and monitor them from a React UI or the CLI.

**Key features:**
- **Visual editor** — build and edit parsers with a Monaco code editor, live debug runner, and real-time job monitoring
- **Concurrent workers** — each step runs in its own Node.js Worker Thread with configurable concurrency, delays, and browser context rotation
- **Bot evasion** — stealth adapters (Playwright + Puppeteer), init scripts, proxy support, randomised delays
- **Persistent runs** — stop and resume jobs; retry failed tasks; full run history in PostgreSQL
- **CSV output** — per-run files with post-processing (column normalisation, byte-offset index)

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
