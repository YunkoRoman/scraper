# Scraper Platform — Design & Implementation Plan

## Context

Universal web scraping platform built on Playwright (Node.js + TypeScript) with multi-threading support. Parsers are defined as TypeScript code files (future: loaded from DB dynamically). Each parser is a named graph of steps — Traversers collect links and route to next steps, Extractors pull data and write to CSV. The platform tracks page states, supports configurable retries, deduplicates URLs, and post-processes CSV after each run.

---

## Architecture: Domain-Driven Design

```
src/
├── domain/
│   ├── entities/
│   │   ├── Parser.ts
│   │   ├── Step.ts           # abstract base
│   │   ├── Traverser.ts
│   │   ├── Extractor.ts
│   │   ├── ParserRun.ts      # session aggregate
│   │   └── PageTask.ts
│   ├── value-objects/
│   │   ├── StepName.ts
│   │   ├── Url.ts
│   │   ├── RetryConfig.ts
│   │   └── PageState.ts      # enum: pending|retry|success|failed|aborted
│   ├── events/
│   │   ├── LinksDiscovered.ts
│   │   ├── DataExtracted.ts
│   │   ├── PageSucceeded.ts
│   │   ├── PageFailed.ts
│   │   └── PageRetried.ts
│   └── services/
│       └── LinkDeduplicator.ts
├── application/
│   ├── orchestrator/
│   │   └── ParserOrchestrator.ts   # main broker, routes messages between workers
│   ├── services/
│   │   └── ParserRunnerService.ts  # manages concurrent parsers, configurable limit
│   └── use-cases/
│       ├── RunParser.ts
│       ├── StopParser.ts
│       └── GetParserStatus.ts
├── infrastructure/
│   ├── playwright/
│   │   └── PlaywrightAdapter.ts    # browser + page management inside Worker Thread
│   ├── worker/
│   │   ├── WorkerThreadAdapter.ts  # spawn/destroy/message threads
│   │   ├── TraverserWorker.ts      # runs inside Worker Thread
│   │   └── ExtractorWorker.ts      # runs inside Worker Thread
│   ├── csv/
│   │   ├── CsvWriter.ts
│   │   └── CsvPostProcessor.ts     # compression + byte-offset indexing
│   └── loader/
│       └── ParserLoader.ts         # loads parser from file (future: from DB)
├── parsers/                        # user-defined parser files
│   └── example-parser/
│       └── index.ts
└── cli/
    ├── index.ts                    # entry point
    └── ConsoleReporter.ts          # live stats: Total | Success | Failed | In Progress
```

---

## Domain Model

### Parser (Aggregate)
```ts
interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  steps: Map<StepName, Step>
  retryConfig: RetryConfig       // default: { maxRetries: 5 }
  deduplication: boolean         // default: true
  concurrentParsers?: number     // for ParserRunnerService
}
```

### Step (Abstract)
```ts
abstract class Step {
  readonly name: StepName
  abstract readonly type: 'traverser' | 'extractor'
}
```

### Traverser
```ts
class Traverser extends Step {
  type = 'traverser'
  // Selectors for extracting links from page
  linkSelector: string
  // Data extracted on this page and passed down to child steps as parent_data
  parentDataSelectors?: Record<string, string>
  // Name of next step (can reference self for pagination)
  nextStep: StepName | StepName[]
  // Optional: selector for "next page" link (self-reference shortcut)
  nextPageSelector?: string
}
```

### Extractor
```ts
class Extractor extends Step {
  type = 'extractor'
  // Selectors mapping field name → CSS selector
  dataSelectors: Record<string, string>
  // CSV file to write results into
  outputFile: string
}
```

### PageTask (Value Object)
```ts
interface PageTask {
  id: string
  url: string
  stepName: StepName
  state: PageState       // pending | retry | success | failed | aborted
  attempts: number
  maxAttempts: number    // from RetryConfig
  error?: string
  parentTaskId?: string
  parentData?: Record<string, string>  // data passed from parent Traverser
}
```

### PageState (Enum)
```
pending  → retry    (on failure, attempts < maxAttempts)
pending  → success  (processed OK)
pending  → failed   (attempts exhausted)
retry    → success
retry    → failed
*        → aborted  (parser manually stopped)
```

---

## Worker Thread Model

One Worker Thread per named Step. All workers run concurrently.

```
Main Process (ParserOrchestrator)
│
├── Worker: Traverser "categoryList"   ← processes pages, sends LinksDiscovered
├── Worker: Traverser "productList"    ← processes pages, sends LinksDiscovered
└── Worker: Extractor "productDetail"  ← processes pages, sends DataExtracted
```

**Message Protocol (Main ↔ Worker):**
```ts
// Main → Worker
{ type: 'PROCESS_PAGE', task: PageTask }
{ type: 'STOP' }

// Worker → Main
{ type: 'LINKS_DISCOVERED', taskId, links: string[], stepName: StepName, parentData?: Record<string, string> }
{ type: 'DATA_EXTRACTED', taskId, data: Record<string, string> }
{ type: 'PAGE_SUCCESS', taskId }
{ type: 'PAGE_FAILED', taskId, error: string }
```

**ParserOrchestrator responsibilities:**
1. Spawn one Worker Thread per step on parser start
2. Receive `LINKS_DISCOVERED` → deduplicate → create new `PageTask`s → route to correct step worker
3. Receive `PAGE_FAILED` → increment attempts → if attempts < max: requeue as `retry`, else mark `failed`
4. Track all `PageTask` states in `ParserRun` aggregate
5. Detect completion (all tasks in terminal state) → trigger CSV post-processing
6. Emit progress events → `ConsoleReporter`

---

## URL Deduplication

- `LinkDeduplicator` domain service: holds a `Set<string>` per parser run
- Applied in orchestrator when `LINKS_DISCOVERED` received
- Configurable per parser: `deduplication: true | false`
- Normalizes URLs before checking (trailing slash, query param order)

---

## CSV Post-Processing

Runs after all steps complete. Two phases:

### 1. Compression (Reducing)
- Remove empty rows, normalize whitespace
- Deduplicate rows by configurable key column

### 2. Indexing
- Scan CSV file, record byte offset of each row
- Write separate `.index` file: `{ rowNumber: byteOffset }`
- Enables O(1) random access to any row without full file read

```
output/
└── example-parser/
    ├── products.csv
    └── products.csv.index    # JSON: { "1": 0, "2": 145, "3": 312, ... }
```

---

## Console Reporter

Live output during parser run (updates in-place via `\r`):

```
[example-parser] Running...
Pages: Total 248 | Success 201 | Failed 3 | Retry 12 | In Progress 32
Steps: categoryList(done) → productList(running) → productDetail(running)
```

After completion:
```
[example-parser] Completed in 4m 32s
Pages: Total 248 | Success 243 | Failed 5
CSV: output/example-parser/products.csv (indexing done)
```

---

## Parser Definition (User Code)

```ts
// parsers/example-parser/index.ts
import { defineParser } from '../../domain/entities/Parser'

export default defineParser({
  name: 'example-parser',
  entryUrl: 'https://example.com/categories',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      linkSelector: 'a.category-link',
      nextStep: 'productList',
    },
    productList: {
      type: 'traverser',
      linkSelector: 'a.product-link',
      nextPageSelector: 'a.next-page',  // self-reference for pagination
      nextStep: 'productDetail',
    },
    productDetail: {
      type: 'extractor',
      outputFile: 'products.csv',
      dataSelectors: {
        title: 'h1.product-title',
        price: 'span.price',
        sku: '[data-sku]',
      },
    },
  },
})
```

---

## Future: Dynamic Parser Loading

`ParserLoader` infrastructure service abstracts the loading source:
```ts
interface ParserLoader {
  load(parserName: string): Promise<ParserConfig>
}

// Today: FileParserLoader — imports TS file
// Future: DbParserLoader — fetches code string from DB, executes via vm.runInNewContext
```

---

## Multiple Concurrent Parsers

`ParserRunnerService` manages a queue of parser runs:
```ts
interface RunnerConfig {
  maxConcurrent: number   // default: 3
}
```
Each parser gets its own `ParserOrchestrator` instance, isolated Worker Threads, and separate output directory.

---

## CLI Entry Point

```bash
npx ts-node src/cli/index.ts run example-parser
npx ts-node src/cli/index.ts run example-parser another-parser   # concurrent
npx ts-node src/cli/index.ts status example-parser
npx ts-node src/cli/index.ts stop example-parser
```

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript 5.x |
| Runtime | Node.js 20+ |
| Browser automation | Playwright |
| Multi-threading | Node.js Worker Threads (built-in) |
| CSV | fast-csv |
| CLI args | commander |
| Console UI | cli-progress / custom \r updates |
| Future DB loader | vm module (built-in) |

---

## Key Files to Create

1. `package.json` — dependencies + scripts
2. `tsconfig.json` — strict mode, paths
3. `src/domain/entities/` — Parser, Step, Traverser, Extractor, ParserRun, PageTask
4. `src/domain/value-objects/` — StepName, Url, RetryConfig, PageState
5. `src/domain/events/` — domain events
6. `src/domain/services/LinkDeduplicator.ts`
7. `src/application/orchestrator/ParserOrchestrator.ts`
8. `src/application/services/ParserRunnerService.ts`
9. `src/application/use-cases/` — RunParser, StopParser, GetParserStatus
10. `src/infrastructure/playwright/PlaywrightAdapter.ts`
11. `src/infrastructure/worker/WorkerThreadAdapter.ts`
12. `src/infrastructure/worker/TraverserWorker.ts`
13. `src/infrastructure/worker/ExtractorWorker.ts`
14. `src/infrastructure/csv/CsvWriter.ts`
15. `src/infrastructure/csv/CsvPostProcessor.ts`
16. `src/infrastructure/loader/ParserLoader.ts`
17. `src/cli/index.ts`
18. `src/cli/ConsoleReporter.ts`
19. `parsers/example-parser/index.ts` — working example

---

## Verification

1. `npm run build` — no TypeScript errors
2. `npx ts-node src/cli/index.ts run example-parser` — runs against a real site
3. Console shows live stats updating
4. `output/example-parser/products.csv` created with data
5. `output/example-parser/products.csv.index` created with byte offsets
6. Kill mid-run → pages show `aborted` state
7. Force a page to fail → verify retry logic hits maxRetries then marks `failed`
8. Run two parsers simultaneously → both complete independently
