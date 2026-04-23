# Scraper Platform — Documentation

Universal web scraping platform built on Playwright (Node.js + TypeScript). Parsers are TypeScript files that define a graph of steps — each step is a user-written async function that receives a browser page and returns structured data.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Writing a Parser](#writing-a-parser)
4. [Step Types](#step-types)
5. [Data Flow](#data-flow)
6. [API Reference](#api-reference)
7. [Worker Thread Model](#worker-thread-model)
8. [CSV Output](#csv-output)
9. [Configuration](#configuration)
10. [Project Structure](#project-structure)

---

## Architecture Overview

The platform follows Domain-Driven Design (DDD) with four layers:

```
CLI  →  Application  →  Domain  →  Infrastructure
```

| Layer | Responsibility |
|---|---|
| **domain** | Core entities, value objects, business logic. No I/O. |
| **application** | Orchestrator, use cases, services. Coordinates domain + infra. |
| **infrastructure** | Playwright, Worker Threads, CSV, file loader. |
| **cli** | `commander`-based entry point + console reporter. |

**Thread model:** One Node.js Worker Thread per step. All workers run concurrently. The main thread (orchestrator) routes tasks between workers via message passing.

```
Main Thread (ParserOrchestrator)
│
├── Worker Thread: step "categoryList"   (Traverser)
├── Worker Thread: step "productList"    (Traverser)
└── Worker Thread: step "productDetail"  (Extractor)
```

---

## Quick Start

```bash
# Run a parser
npx tsx src/cli/index.ts run example

# Run multiple parsers concurrently
npx tsx src/cli/index.ts run example bauer

# Stop a running parser
npx tsx src/cli/index.ts stop example
```

Output files are written to `output/<parser-name>/`.

---

## Writing a Parser

Create a file at `src/parsers/<name>/index.ts` that exports a `defineParser()` result as default.

### Minimal example (single-page extractor)

```ts
import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'my-parser',
  entryUrl: 'https://example.com/product',
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
import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'shop',
  entryUrl: 'https://shop.example.com/categories',
  entryStep: 'categoryList',   // optional — defaults to first step
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      run: async (page: Page, task: PageTask) => {
        const items = await page.$$eval('a.category', els =>
          els.map(el => ({
            href: (el as HTMLAnchorElement).href,
            name: el.textContent?.trim() ?? '',
          }))
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
      run: async (page: Page, task: PageTask) => {
        const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
        const price = await page.$eval('.price', el => el.textContent?.trim() ?? '').catch(() => '')
        return [{
          title,
          price,
          category: String(task.parentData?.category ?? ''),
          url: task.url,
        }]
      },
    },
  },
})
```

---

## Step Types

### Traverser

Navigates to a URL, collects links, routes them to the next step.

**`run` signature:**
```ts
run: (page: Page, task: PageTask) => Promise<TraverserResult[]>
```

**`TraverserResult`:**
```ts
{
  link: string            // URL to add as new task
  page_type: string       // name of the step that will process this link
  parent_data?: Record<string, unknown>  // data passed to that step's task
}
```

**Usage notes:**
- Return an empty array if no links found — that's fine.
- `page_type` can differ per item — one traverser can route to multiple different steps.
- For pagination: return the next-page URL with `page_type` set to the current step's name (self-reference).
- `task.parentData` contains data inherited from the parent step — spread it into `parent_data` to pass it further down.

```ts
// Pagination example
run: async (page, task) => {
  const links = await page.$$eval('a.product', els =>
    els.map(el => (el as HTMLAnchorElement).href)
  )
  const nextPage = await page.$eval('a.next', el => (el as HTMLAnchorElement).href).catch(() => null)

  const results = links.map(link => ({ link, page_type: 'productDetail', parent_data: { ...task.parentData } }))
  if (nextPage) results.push({ link: nextPage, page_type: 'productList', parent_data: { ...task.parentData } })
  return results
}
```

### Extractor

Navigates to a URL, extracts data, writes rows to CSV.

**`run` signature:**
```ts
run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>
```

**Returns an array of rows.** Each row is written as a CSV line. Returning multiple rows from one page is valid (e.g., when a page contains a list).

**Usage notes:**
- All values are coerced to `string` when written to CSV (`null`/`undefined` → `''`).
- `task.parentData` contains data from the parent Traverser.
- `task.url` is the current page URL — include it as `__url` for traceability.
- Can call external APIs, read page scripts, evaluate JS — any async code is valid.

```ts
// Reading from window.__PRELOADED_STATE__
run: async (page, task) => {
  const data = await page.evaluate(() => (window as any).__PRELOADED_STATE__)
  return data.products.map((p: any) => ({
    title: p.title,
    price: p.price,
    sku: p.sku,
    category: task.parentData?.category,
    __url: task.url,
  }))
}
```

### Step Settings

Both step types accept an optional `settings` object:

```ts
{
  type: 'extractor',
  settings: {
    browser_type: 'playwright',  // 'playwright' (default) or 'puppeteer'
  },
  run: async (page, task) => { ... },
}
```

`browser_type` selects which browser adapter launches for that step's Worker Thread. Default is `'playwright'`. `'puppeteer'` requires installing puppeteer and implementing `PuppeteerAdapter`.

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
  → sends LINKS_DISCOVERED { items }
    │
    ▼
ParserOrchestrator
  deduplicates links
  creates new PageTask per item (with item.page_type as stepName, item.parent_data)
  dispatches tasks to correct workers
    │
    ▼
Worker Thread (ExtractorWorker)
  page.goto(task.url)
  rows = await step.run(page, task)
  → sends DATA_EXTRACTED { rows, outputFile }
  → sends PAGE_SUCCESS
    │
    ▼
ParserOrchestrator
  writes rows to CsvWriter
  marks task success
  checks if all tasks terminal → triggers post-processing
    │
    ▼
CsvPostProcessor
  removes empty lines (compress)
  writes byte-offset index → <file>.csv.index
    │
    ▼
output/<parser-name>/<outputFile>.csv
output/<parser-name>/<outputFile>.csv.index
```

**Retry flow:**
```
PAGE_FAILED received
  task.attempts < task.maxAttempts  →  markRetry → re-dispatch
  task.attempts >= task.maxAttempts →  markFailed → checkCompletion
```

**Abort flow (SIGINT / manual stop):**
```
orchestrator.stop()
  → marks all pending/retry tasks as Aborted
  → sends STOP to each worker
  → closes CSV writers
  → resolves completion promise
```

---

## API Reference

### `defineParser(definition)`

Factory function that validates the definition and returns a `ParserConfig`.

```ts
defineParser({
  name: string              // unique parser name — also the output directory name
  entryUrl: string          // URL where the run starts
  entryStep?: string        // step to process entryUrl (default: first step key)
  retryConfig?: {
    maxRetries: number      // default: 5
  }
  deduplication?: boolean   // deduplicate URLs across the run (default: true)
  steps: Record<string, TraverserDef | ExtractorDef>
})
```

### `PageTask`

Object passed to `run(page, task)`. Read-only.

```ts
{
  id: string                          // UUID
  url: string                         // URL being processed
  stepName: StepName                  // name of the step handling this task
  state: PageState                    // pending | retry | success | failed | aborted
  attempts: number                    // how many times this task has been attempted
  maxAttempts: number                 // max before marking failed
  error?: string                      // last error message (if any)
  parentTaskId?: string               // ID of the task that discovered this URL
  parentData?: Record<string, unknown> // data from parent traverser
}
```

### `TraverserResult`

Returned by each item from a Traverser `run`.

```ts
{
  link: string                         // URL to enqueue
  page_type: string                    // step name to assign this URL to
  parent_data?: Record<string, unknown> // inherited by child task as parentData
}
```

### `RunStats`

Emitted on every state change, available via `orchestrator.getStats()`.

```ts
{
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
}
```

### `StepSettings`

```ts
{
  browser_type?: 'playwright' | 'puppeteer'  // default: 'playwright'
}
```

---

## Worker Thread Model

Each step gets exactly one Worker Thread. Workers are spawned when the parser starts and live until it completes or is stopped.

**Dev mode (tsx):** Workers are loaded via `worker-bootstrap.js` which registers tsx ESM hooks via `tsx/esm/api` before dynamically importing the actual `.ts` worker file. This is necessary because `--import tsx/esm` in `execArgv` does not correctly propagate module resolution hooks into sub-imports inside workers in Node.js v22+.

**Prod mode (compiled JS):** Workers load their `.js` files directly.

**Why dynamic import?** The `run` function defined in a parser file cannot be serialized via `workerData` (structured clone does not support functions). Workers instead receive `{ parserFilePath, stepName }` and dynamically import the parser file to access the step's `run` function.

**Message protocol:**

```
Main → Worker:
  { type: 'PROCESS_PAGE', task: PageTask }
  { type: 'STOP' }

Worker → Main:
  { type: 'LINKS_DISCOVERED', taskId, items: TraverserResult[] }
  { type: 'DATA_EXTRACTED',   taskId, rows: Record<string,unknown>[], outputFile }
  { type: 'PAGE_SUCCESS',     taskId }
  { type: 'PAGE_FAILED',      taskId, error }
```

---

## CSV Output

Output is written to `output/<parser-name>/<outputFile>`.

**During the run:** Rows are written incrementally via `CsvWriter` (fast-csv stream, append mode). Headers are inferred from the keys of the first row.

**After completion:** `CsvPostProcessor` runs two phases:

1. **Compress** — removes empty lines, rewrites the file.
2. **Build index** — reads the compressed file, records the byte offset of every non-empty line, writes `<file>.csv.index`:
   ```json
   { "0": 0, "1": 42, "2": 89, "3": 136 }
   ```
   This enables O(1) random-access reads (seek to byte offset without scanning the full file).

---

## Configuration

### `retryConfig`

```ts
retryConfig: { maxRetries: 3 }
```

Default is `{ maxRetries: 5 }`. Each failed page is retried up to `maxRetries` times before being marked `failed`.

### `deduplication`

```ts
deduplication: true  // default
```

When enabled, the `LinkDeduplicator` normalizes URLs (strips trailing slash, sorts query params) and skips any URL already seen in this run. Disable when you intentionally need to visit the same URL multiple times (e.g., paginated APIs with the same base URL but different state).

### `outputFile`

On an `extractor` step, `outputFile` defaults to `<stepName>.csv`. To override:

```ts
{
  type: 'extractor',
  outputFile: 'custom-name.csv',
  run: async (page, task) => { ... },
}
```

---

## Project Structure

```
src/
├── domain/
│   ├── entities/
│   │   ├── Parser.ts          defineParser() factory + ParserConfig interface
│   │   ├── Step.ts            Abstract base class for steps
│   │   ├── Traverser.ts       Step subclass — run() returns TraverserResult[]
│   │   ├── Extractor.ts       Step subclass — run() returns data rows[]
│   │   ├── ParserRun.ts       Session aggregate — tracks all PageTasks + stats
│   │   └── PageTask.ts        Immutable task value object + createPageTask()
│   ├── value-objects/
│   │   ├── StepName.ts        Branded string type for step names
│   │   ├── PageState.ts       Enum: pending|retry|success|failed|aborted
│   │   ├── RetryConfig.ts     { maxRetries: number }
│   │   ├── StepSettings.ts    { browser_type?: 'playwright'|'puppeteer' }
│   │   └── TraverserResult.ts { link, page_type, parent_data? }
│   ├── events/
│   │   └── index.ts           Domain event types (LinksDiscovered, DataExtracted, …)
│   └── services/
│       └── LinkDeduplicator.ts  URL normalization + seen-set deduplication
├── application/
│   ├── orchestrator/
│   │   └── ParserOrchestrator.ts  Main broker: spawns workers, routes messages
│   ├── services/
│   │   └── ParserRunnerService.ts  Manages active parser runs by name
│   └── use-cases/
│       ├── RunParser.ts           Load config → create orchestrator → start
│       ├── StopParser.ts          Stop a named parser
│       └── GetParserStatus.ts     Return current RunStats
├── infrastructure/
│   ├── browser/
│   │   ├── BrowserAdapter.ts      Interface + createBrowserAdapter() factory
│   │   ├── PlaywrightAdapter.ts   Playwright chromium implementation
│   │   └── PuppeteerAdapter.ts    Stub — throws "not implemented"
│   ├── worker/
│   │   ├── messages.ts            WorkerInMessage / WorkerOutMessage types
│   │   ├── TraverserWorker.ts     Worker Thread: import parser → call run() → send items
│   │   ├── ExtractorWorker.ts     Worker Thread: import parser → call run() → send rows
│   │   └── worker-bootstrap.js   Dev mode: register tsx hooks → import .ts worker
│   ├── csv/
│   │   ├── CsvWriter.ts           Lazy-init fast-csv stream, append mode
│   │   └── CsvPostProcessor.ts    Compress empty lines + build byte-offset index
│   └── loader/
│       └── FileParserLoader.ts    Dynamic import of parser file, sets filePath
├── parsers/
│   ├── example/index.ts           books.toscrape.com — 3-step pipeline
│   └── bauer/index.ts             Single-page extractor example
└── cli/
    ├── index.ts                   commander entry point (run / stop commands)
    └── ConsoleReporter.ts         Live \r stats updates + completion summary
```
