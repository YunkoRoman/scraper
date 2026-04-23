# Scraper Platform — Documentation

Universal web scraping platform built on Playwright (Node.js + TypeScript). Parsers are TypeScript files that define a graph of steps — each step is a user-written async function that receives a browser page and returns structured data.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Writing a Parser](#writing-a-parser)
4. [Step Types](#step-types)
5. [Parser Options](#parser-options)
6. [Step Settings](#step-settings)
7. [Browser Settings](#browser-settings)
8. [Data Flow](#data-flow)
9. [API Reference](#api-reference)
10. [REST API & UI](#rest-api--ui)
11. [Worker Thread Model](#worker-thread-model)
12. [Debugging](#debugging)
13. [CSV Output](#csv-output)
14. [Project Structure](#project-structure)

---

## Architecture Overview

The platform follows Domain-Driven Design (DDD) with four layers:

```
CLI / API  →  Application  →  Domain  →  Infrastructure
```

| Layer | Responsibility |
|---|---|
| **domain** | Core entities, value objects, business logic. No I/O. |
| **application** | Orchestrator, use cases, services. Coordinates domain + infra. |
| **infrastructure** | Playwright, Worker Threads, CSV, file loader. |
| **cli** | `commander`-based entry point + console reporter. |
| **api** | Express REST API + SSE events for the web UI. |

**Thread model:** One Node.js Worker Thread per step. All workers run concurrently. The main thread (orchestrator) routes tasks between workers via message passing.

```
Main Thread (ParserOrchestrator)
│
├── Worker Thread: step "index"       (Traverser)
├── Worker Thread: step "category"    (Traverser)
└── Worker Thread: step "product"     (Extractor)
```

---

## Quick Start

```bash
# Install dependencies
npm install
npx playwright install chromium

# Start API server + web UI together
npm run start

# Or separately:
npm run api:dev     # API server with hot reload (port 3001)
npm run client      # Vite frontend (port 5173)

# CLI mode
npm run dev -- run example
npm run dev -- run example bauer
```

Output files are written to `output/<parser-name>/`.

---

## Writing a Parser

Create a directory `src/parsers/<name>/` with an `index.ts` that exports a `defineParser()` result as default.

For large parsers, split step logic into `steps/` subfolder:

```
src/parsers/myparser/
├── index.ts          ← defineParser() — wires steps together
└── steps/
    ├── listing.ts    ← traverser step
    └── product.ts    ← extractor step
```

### Minimal example

```ts
import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'my-parser',
  entryUrl: 'https://example.com/products',
  steps: {
    product: {
      type: 'extractor',
      outputFile: 'products.csv',
      run: async (page: Page, task: PageTask) => {
        const title = await page.$eval('h1', el => el.textContent?.trim() ?? '')
        return [{ title, url: task.url }]
      },
    },
  },
})
```

### Multi-step example (traverser → extractor)

```ts
export default defineParser({
  name: 'shop',
  entryUrl: 'https://shop.example.com/categories',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  concurrentQuota: 50,
  deduplication: true,
  browserSettings: {
    contextOptions: { locale: 'en-US', viewport: { width: 1440, height: 900 } },
    initScripts: [
      `Object.defineProperty(navigator, 'webdriver', { get: () => undefined })`,
    ],
  },
  steps: {
    categoryList: {
      type: 'traverser',
      run: async (page, task) => {
        const items = await page.$$eval('a.category', els =>
          els.map(el => ({ href: (el as HTMLAnchorElement).href, name: el.textContent?.trim() ?? '' }))
        )
        return items.map(({ href, name }) => ({
          link: href,
          page_type: 'productDetail',
          parent_data: { ...task.parentData, category: name },
        }))
      },
    },
    productDetail: {
      type: 'extractor',
      outputFile: 'products.csv',
      run: async (page, task) => {
        const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
        const price = await page.$eval('.price', el => el.textContent?.trim() ?? '').catch(() => '')
        return [{ title, price, category: String(task.parentData?.category ?? ''), url: task.url }]
      },
    },
  },
})
```

---

## Step Types

### Traverser

Navigates to a URL, collects links, routes them to the next step.

```ts
run: (page: Page, task: PageTask) => Promise<TraverserResult[]>
```

**`TraverserResult`:**
```ts
{
  link: string                          // URL to enqueue as new task
  page_type: string                     // step name that will process this URL
  parent_data?: Record<string, unknown> // passed to that step's task as parentData
}
```

- Return `[]` if no links found — that's fine, task will be marked success.
- `page_type` can vary per item — one traverser can route to multiple steps.
- For **pagination**: return the next-page URL with `page_type` pointing to the current step name.
- For **API-only steps** (no DOM needed): use Node `fetch` directly — `_page` can be ignored.

```ts
// Pagination example
run: async (page, task) => {
  const links = await page.$$eval('a.item', els => els.map(el => (el as HTMLAnchorElement).href))
  const next = await page.$eval('a.next', el => (el as HTMLAnchorElement).href).catch(() => null)
  const results = links.map(link => ({ link, page_type: 'detail', parent_data: { ...task.parentData } }))
  if (next) results.push({ link: next, page_type: 'listing', parent_data: { ...task.parentData } })
  return results
}

// API-only traverser (no browser needed)
run: async (_page, task) => {
  const data = await fetch(task.url).then(r => r.json())
  return data.items.map((item: any) => ({
    link: `https://example.com/product/${item.id}`,
    page_type: 'product',
    parent_data: { ...task.parentData },
  }))
}
```

### Extractor

Navigates to a URL, extracts data, writes rows to CSV.

```ts
run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>
```

- Returns an array of rows. Each row → one CSV line.
- All values are coerced to `string` when written (`null`/`undefined` → `''`).
- `task.parentData` contains data from the parent Traverser.
- Include `__url: task.url` for traceability.

```ts
// Reading from window.__INITIAL_STATE__
run: async (page, task) => {
  const state = await page.evaluate(() => (window as any).__INITIAL_STATE__)
  return [{ title: state.product.title, price: state.product.price, __url: task.url }]
}
```

---

## Parser Options

```ts
defineParser({
  name: string               // unique name — also the output directory
  entryUrl: string           // starting URL
  entryStep?: string         // step for entryUrl (default: first step key)
  retryConfig?: {
    maxRetries: number       // default: 5. Retries before marking task failed.
  }
  deduplication?: boolean    // deduplicate URLs across the run (default: true)
  concurrentQuota?: number   // max total concurrent tasks across all workers (default: unlimited)
  browserSettings?: BrowserSettings  // applied to all steps (see Browser Settings)
  steps: Record<string, TraverserDef | ExtractorDef>
})
```

### `concurrentQuota`

Global cap on how many pages are being processed across **all workers at once**. When the quota is reached, new tasks wait in the orchestrator's dispatch queue and are released one-by-one as tasks complete.

```ts
concurrentQuota: 50  // max 50 concurrent pages across all steps
```

Without a quota, each step worker runs up to `settings.concurrency` (default 3) pages concurrently, so total = workers × 3.

---

## Step Settings

Per-step configuration via `settings`. Step settings override `browserSettings` from the parser level.

```ts
{
  type: 'traverser',
  settings: {
    browser_type: 'playwright',   // 'playwright' (default) | 'puppeteer'
    concurrency: 5,               // concurrent pages in this step's worker (default: 3)
    launchOptions: { ... },       // Playwright LaunchOptions — overrides parser browserSettings
    contextOptions: { ... },      // Playwright BrowserContextOptions — merged with parser browserSettings
    initScripts: [ ... ],         // JS strings injected before each page load — appended to parser initScripts
  },
  run: async (page, task) => { ... },
}
```

---

## Browser Settings

Apply Playwright launch/context options and init scripts to **all steps** in the parser. Useful for anti-bot configuration that should be consistent across the whole run.

```ts
browserSettings: {
  launchOptions?: LaunchOptions          // Playwright chromium.launch() options
  contextOptions?: BrowserContextOptions // Playwright browser.newContext() options
  initScripts?: string[]                 // JS strings injected on every page before load
}
```

**Anti-bot example (applied parser-wide):**

```ts
browserSettings: {
  contextOptions: {
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 900 },
  },
  initScripts: [
    `Object.defineProperty(navigator, 'webdriver', { get: () => undefined })`,
    `window.chrome = { runtime: {} }`,
    `Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })`,
    `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })`,
  ],
},
```

**Merge rules:**
- `contextOptions`: step-level is shallow-merged over parser-level (step wins on conflict)
- `initScripts`: parser-level scripts run first, step-level appended
- `launchOptions`: step-level overrides parser-level entirely

---

## Data Flow

```
entryUrl
    │
    ▼
[Task created: entryStep]
    │
    ▼
Worker Thread (TraverserWorker)
  page.goto(task.url)
  items = await step.run(page, task)
  → LINKS_DISCOVERED { items }
    │
    ▼
ParserOrchestrator
  deduplicates links
  checks concurrentQuota → dispatches or queues
  creates PageTask per item → routes to correct worker
    │
    ▼
Worker Thread (ExtractorWorker)
  page.goto(task.url)
  rows = await step.run(page, task)
  → DATA_EXTRACTED { rows, outputFile }
  → PAGE_SUCCESS
    │
    ▼
ParserOrchestrator
  writes rows to CsvWriter
  marks task success → flushes dispatch queue
  all tasks terminal → post-processing
    │
    ▼
CsvPostProcessor → output/<parser-name>/<outputFile>.csv
```

**Retry flow:**
```
PAGE_FAILED
  attempts < maxAttempts  →  markRetry → re-dispatch (respects concurrentQuota)
  attempts >= maxAttempts →  markFailed → checkCompletion
```

---

## API Reference

### `defineParser(definition)` → `ParserConfig`

### `PageTask`

```ts
{
  id: string
  url: string
  stepName: StepName
  state: 'pending' | 'retry' | 'success' | 'failed' | 'aborted'
  attempts: number
  maxAttempts: number
  error?: string
  parentTaskId?: string
  parentData?: Record<string, unknown>
}
```

### `RunStats`

```ts
{
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
  traversers: { total: number; success: number; failed: number }
  extractors:  { total: number; success: number; failed: number }
}
```

### Message Protocol (Worker ↔ Main)

```
Main → Worker:
  { type: 'PROCESS_PAGE', task: PageTask }
  { type: 'STOP' }

Worker → Main:
  { type: 'LINKS_DISCOVERED', taskId, items: TraverserResult[] }
  { type: 'DATA_EXTRACTED',   taskId, rows, outputFile }
  { type: 'PAGE_SUCCESS',     taskId }
  { type: 'PAGE_FAILED',      taskId, error }
  { type: 'LOG',              stepName, level: 'log'|'error', args: string[] }
```

---

## REST API & UI

The platform includes an Express REST API and a React/Vite web UI.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/parsers` | List available parsers |
| `POST` | `/api/parsers/:name/start` | Start a parser run |
| `POST` | `/api/parsers/:name/stop` | Stop a running parser |
| `GET` | `/api/parsers/:name/status` | Get current stats |
| `GET` | `/api/parsers/:name/events` | SSE stream of live stats |
| `GET` | `/api/parsers/:name/files` | List output CSV files |
| `GET` | `/api/parsers/:name/files/:file` | Download a CSV file |

### SSE Events

Connect to `/api/parsers/:name/events` to receive real-time updates:

```
data: {"type":"init",    "running":false, "stats":null}
data: {"type":"stats",   "stats": RunStats}
data: {"type":"complete","stats": RunStats}
data: {"type":"stopped"}
data: {"type":"error",   "message":"..."}
```

---

## Worker Thread Model

Each step gets exactly one Worker Thread, spawned at parser start, alive until completion or stop.

**Dev mode (`tsx watch`):** Workers are loaded via `worker-bootstrap.js` which registers tsx ESM hooks via `tsx/esm/api` before dynamically importing the `.ts` worker file.

**Prod mode (compiled JS):** Workers load their `.js` files directly.

**Why dynamic import?** The `run` function cannot be serialized via `workerData` (structured clone doesn't support functions). Workers receive `{ parserFilePath, stepName, browserSettings }` and dynamically import the parser to access `step.run`.

**Console logging from steps:** `console.log`/`console.error` inside `run()` are intercepted and forwarded to the main process via `LOG` messages, then printed with a `[stepName]` prefix:

```
[index] { items: [...] }
[product] [FAIL] https://example.com/product/123
```

---

## Debugging

Add `console.log()` anywhere in a step's `run()` function — output appears in the server terminal prefixed with the step name.

```ts
run: async (page, task) => {
  console.log('title:', await page.title())
  console.log('url:', task.url)
  // ...
}
```

**Taking a screenshot:**

```ts
await page.screenshot({ path: `/tmp/debug-${Date.now()}.png` })
```

**Checking if a selector exists:**

```ts
console.log('nav:', await page.$("nav.main") !== null)
```

**Common issues:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `TimeoutError` on `waitForSelector` | Selector wrong or page not rendered yet | Screenshot + log `page.title()` to diagnose |
| `403 Restricted Access` | Bot detection blocking headless Chrome | Add `browserSettings.initScripts` + `contextOptions` |
| Step produces 0 results | Wrong selector or JS not loaded | Log `await page.content()` to inspect HTML |
| Nothing in terminal | Old server process still running on the port | `lsof -i :3001` to find and kill stale process |

---

## CSV Output

Output is written to `output/<parser-name>/<outputFile>`.

**During the run:** Rows are written incrementally via `CsvWriter` (fast-csv stream, append mode). Headers are inferred from the keys of the first row.

**After completion:** `CsvPostProcessor` runs:

1. **Compress** — removes empty lines, rewrites the file.
2. **Build index** — records byte offset of every line → `<file>.csv.index`:
   ```json
   { "0": 0, "1": 42, "2": 89 }
   ```
   Enables O(1) random-access reads by line number.

---

## Project Structure

```
src/
├── domain/
│   ├── entities/
│   │   ├── Parser.ts           defineParser() + ParserConfig + ParserDefinition
│   │   ├── Step.ts             Abstract base for Traverser/Extractor
│   │   ├── Traverser.ts        Step subclass — run() returns TraverserResult[]
│   │   ├── Extractor.ts        Step subclass — run() returns data rows[]
│   │   ├── ParserRun.ts        Session aggregate — tracks PageTasks + stats
│   │   └── PageTask.ts         Immutable task value object
│   ├── value-objects/
│   │   ├── StepName.ts         Branded string type
│   │   ├── PageState.ts        pending|retry|success|failed|aborted
│   │   ├── RetryConfig.ts      { maxRetries: number }
│   │   ├── StepSettings.ts     browser_type, concurrency, launchOptions, contextOptions, initScripts
│   │   └── TraverserResult.ts  { link, page_type, parent_data? }
│   └── services/
│       └── LinkDeduplicator.ts URL normalization + seen-set deduplication
├── application/
│   ├── orchestrator/
│   │   └── ParserOrchestrator.ts  Spawns workers, routes messages, manages concurrentQuota
│   ├── services/
│   │   └── ParserRunnerService.ts Manages active parser runs by name
│   └── use-cases/
│       ├── RunParser.ts
│       ├── StopParser.ts
│       └── GetParserStatus.ts
├── infrastructure/
│   ├── browser/
│   │   ├── BrowserAdapter.ts      Interface + createBrowserAdapter(type, settings) factory
│   │   ├── PlaywrightAdapter.ts   Chromium — accepts launchOptions, contextOptions, addInitScript()
│   │   └── PuppeteerAdapter.ts    Puppeteer stub
│   ├── worker/
│   │   ├── messages.ts            WorkerInMessage / WorkerOutMessage types (incl. LOG)
│   │   ├── TraverserWorker.ts     Worker: merges browserSettings → launches adapter → runs step
│   │   ├── ExtractorWorker.ts     Worker: merges browserSettings → launches adapter → runs step
│   │   ├── pipeConsole.ts         Overrides console.log/error to forward via parentPort LOG messages
│   │   └── worker-bootstrap.js    Dev mode: registers tsx ESM hooks → imports .ts worker
│   ├── csv/
│   │   ├── CsvWriter.ts           Lazy-init fast-csv stream, append mode
│   │   └── CsvPostProcessor.ts    Compress + build byte-offset index
│   └── loader/
│       └── FileParserLoader.ts    Dynamic import of parser file, sets filePath
├── parsers/
│   ├── example/index.ts           books.toscrape.com — 3-step pipeline demo
│   ├── bauer/index.ts             Single-page extractor demo
│   └── westelm/
│       ├── index.ts               West Elm parser — concurrentQuota + browserSettings
│       └── steps/
│           ├── index.ts           Nav traverser
│           ├── category.ts        Category/subcategory DOM traverser
│           ├── subcategory.ts     Constructor API facet traverser
│           ├── productList.ts     Constructor API pagination traverser
│           ├── product.ts         Product extractor (uses __INITIAL_STATE__)
│           └── product-validator.ts  Schema validation for product data
├── api/
│   └── server.ts                  Express REST API + SSE events
└── cli/
    ├── index.ts                   commander entry point
    └── ConsoleReporter.ts         Live stats + completion summary
client/                            React + Vite web UI (port 5173)
```
