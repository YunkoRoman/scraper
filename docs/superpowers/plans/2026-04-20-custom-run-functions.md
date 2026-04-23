# Custom Run Functions Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Replace declarative CSS-selector step config with user-defined `run` async functions, add per-step browser selection (playwright/puppeteer), and support per-step dynamic link routing via `page_type`.

**Architecture:**
- Each step (Traverser/Extractor) has a `run(page, task)` async function written by the developer.
- Traverser `run` returns `TraverserResult[]` — each item has `link`, `page_type` (next step name), and optional `parent_data`.
- Extractor `run` returns `Record<string, unknown>[]` — array of data rows written to CSV.
- Workers receive `{ parserFilePath, stepName }` via workerData and dynamically import the parser to get the `run` function (functions cannot be structured-cloned).
- Each step can specify `settings.browser_type: 'playwright' | 'puppeteer'`. Default: `'playwright'`.

**Tech Stack:** TypeScript, Node.js Worker Threads, Playwright, fast-csv

---

### Task 1: Types, value objects, and updated messages

**Files:**
- Create: `src/domain/value-objects/StepSettings.ts`
- Create: `src/domain/value-objects/TraverserResult.ts`
- Modify: `src/domain/entities/PageTask.ts` — `parentData: Record<string, unknown>`
- Modify: `src/infrastructure/worker/messages.ts`

- [ ] **Step 1: Create StepSettings**

```ts
// src/domain/value-objects/StepSettings.ts
export type BrowserType = 'playwright' | 'puppeteer'

export interface StepSettings {
  browser_type?: BrowserType
}
```

- [ ] **Step 2: Create TraverserResult**

```ts
// src/domain/value-objects/TraverserResult.ts
export interface TraverserResult {
  link: string
  page_type: string
  parent_data?: Record<string, unknown>
}
```

- [ ] **Step 3: Update PageTask — parentData to Record<string, unknown>**

In `src/domain/entities/PageTask.ts`, change:
```ts
readonly parentData?: Record<string, string>
```
to:
```ts
readonly parentData?: Record<string, unknown>
```
Same change in the `createPageTask` function parameter.

- [ ] **Step 4: Update messages.ts**

Replace the current `LINKS_DISCOVERED` and `DATA_EXTRACTED` shapes:

```ts
// src/infrastructure/worker/messages.ts
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'

export type WorkerInMessage =
  | { type: 'PROCESS_PAGE'; task: PageTask }
  | { type: 'STOP' }

export type WorkerOutMessage =
  | { type: 'LINKS_DISCOVERED'; taskId: string; items: TraverserResult[] }
  | { type: 'DATA_EXTRACTED'; taskId: string; rows: Record<string, unknown>[]; outputFile: string }
  | { type: 'PAGE_SUCCESS'; taskId: string }
  | { type: 'PAGE_FAILED'; taskId: string; error: string }
```

- [ ] **Step 5: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -40
```
Expected: errors only in files not yet updated (workers, orchestrator, parsers) — no errors in the files changed in this task.

- [ ] **Step 6: Commit**
```bash
git add src/domain/value-objects/StepSettings.ts src/domain/value-objects/TraverserResult.ts src/domain/entities/PageTask.ts src/infrastructure/worker/messages.ts
git commit -m "feat(types): add StepSettings, TraverserResult, update messages and PageTask"
```

---

### Task 2: Browser abstraction

**Files:**
- Create: `src/infrastructure/browser/BrowserAdapter.ts`
- Create: `src/infrastructure/browser/PlaywrightAdapter.ts` (moved + updated)
- Create: `src/infrastructure/browser/PuppeteerAdapter.ts` (stub)
- Keep: `src/infrastructure/playwright/PlaywrightAdapter.ts` — DELETE this file after creating the new one

- [ ] **Step 1: Create BrowserAdapter interface + factory**

```ts
// src/infrastructure/browser/BrowserAdapter.ts
import type { Page } from 'playwright'
import type { BrowserType } from '../../domain/value-objects/StepSettings.js'

export interface BrowserAdapter {
  launch(): Promise<void>
  newPage(): Promise<Page>
  close(): Promise<void>
}

export function createBrowserAdapter(browserType?: BrowserType): BrowserAdapter {
  if (browserType === 'puppeteer') {
    const { PuppeteerAdapter } = require('./PuppeteerAdapter.js')
    return new PuppeteerAdapter()
  }
  const { PlaywrightAdapter } = require('./PlaywrightAdapter.js')
  return new PlaywrightAdapter()
}
```

Wait — this is an ESM project. Use dynamic import pattern instead. Actually for a factory that needs to be synchronous, use direct imports:

```ts
// src/infrastructure/browser/BrowserAdapter.ts
import type { Page } from 'playwright'
import type { BrowserType } from '../../domain/value-objects/StepSettings.js'
import { PlaywrightAdapter } from './PlaywrightAdapter.js'
import { PuppeteerAdapter } from './PuppeteerAdapter.js'

export interface BrowserAdapter {
  launch(): Promise<void>
  newPage(): Promise<Page>
  close(): Promise<void>
}

export function createBrowserAdapter(browserType?: BrowserType): BrowserAdapter {
  if (browserType === 'puppeteer') return new PuppeteerAdapter()
  return new PlaywrightAdapter()
}
```

- [ ] **Step 2: Create PlaywrightAdapter (new location)**

Copy content from `src/infrastructure/playwright/PlaywrightAdapter.ts` to `src/infrastructure/browser/PlaywrightAdapter.ts`. No changes to logic needed.

```ts
// src/infrastructure/browser/PlaywrightAdapter.ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'

export class PlaywrightAdapter implements BrowserAdapter {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true })
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    })
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('PlaywrightAdapter not launched')
    return this.context.newPage()
  }

  async close(): Promise<void> {
    await this.context?.close()
    await this.browser?.close()
    this.context = null
    this.browser = null
  }
}
```

- [ ] **Step 3: Create PuppeteerAdapter stub**

```ts
// src/infrastructure/browser/PuppeteerAdapter.ts
import type { Page } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'

export class PuppeteerAdapter implements BrowserAdapter {
  async launch(): Promise<void> {
    throw new Error(
      'PuppeteerAdapter not implemented. Install puppeteer and implement this adapter.'
    )
  }

  async newPage(): Promise<Page> {
    throw new Error('PuppeteerAdapter not implemented.')
  }

  async close(): Promise<void> {}
}
```

- [ ] **Step 4: Delete old PlaywrightAdapter location**

```bash
rm /Users/ryunko/Desktop/Projects/scraper/src/infrastructure/playwright/PlaywrightAdapter.ts
rmdir /Users/ryunko/Desktop/Projects/scraper/src/infrastructure/playwright 2>/dev/null || true
```

- [ ] **Step 5: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -40
```
Expected: errors only in workers (old import paths) — not in the new browser files themselves.

- [ ] **Step 6: Commit**
```bash
git add src/infrastructure/browser/ && git rm src/infrastructure/playwright/PlaywrightAdapter.ts
git commit -m "feat(browser): add BrowserAdapter abstraction with PlaywrightAdapter and PuppeteerAdapter stub"
```

---

### Task 3: Domain entities and Parser update

**Files:**
- Modify: `src/domain/entities/Step.ts`
- Modify: `src/domain/entities/Traverser.ts`
- Modify: `src/domain/entities/Extractor.ts`
- Modify: `src/domain/entities/Parser.ts`
- Modify: `src/infrastructure/loader/FileParserLoader.ts`

**Context:** Functions cannot be passed via `workerData` (structured clone). Workers will receive `parserFilePath` + `stepName` and dynamically import the parser file to access `run`. So `Traverser` and `Extractor` store the `run` function — it's used by workers after dynamic import, not serialized.

- [ ] **Step 1: Update Step.ts — add settings**

```ts
// src/domain/entities/Step.ts
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'

export type StepType = 'traverser' | 'extractor'

export abstract class Step {
  abstract readonly type: StepType
  constructor(
    readonly name: StepName,
    readonly settings?: StepSettings,
  ) {}
}
```

- [ ] **Step 2: Update Traverser.ts**

```ts
// src/domain/entities/Traverser.ts
import type { Page } from 'playwright'
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { TraverserResult } from '../value-objects/TraverserResult.js'
import type { PageTask } from './PageTask.js'

export class Traverser extends Step {
  readonly type = 'traverser' as const

  constructor(
    name: StepName,
    readonly run: (page: Page, task: PageTask) => Promise<TraverserResult[]>,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
```

- [ ] **Step 3: Update Extractor.ts**

```ts
// src/domain/entities/Extractor.ts
import type { Page } from 'playwright'
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { PageTask } from './PageTask.js'

export class Extractor extends Step {
  readonly type = 'extractor' as const

  constructor(
    name: StepName,
    readonly run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>,
    readonly outputFile: string,
    settings?: StepSettings,
  ) {
    super(name, settings)
  }
}
```

- [ ] **Step 4: Update Parser.ts — new defineParser API + parserFilePath**

```ts
// src/domain/entities/Parser.ts
import type { Page } from 'playwright'
import type { StepName } from '../value-objects/StepName.js'
import { stepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import type { StepSettings } from '../value-objects/StepSettings.js'
import type { TraverserResult } from '../value-objects/TraverserResult.js'
import { Traverser } from './Traverser.js'
import { Extractor } from './Extractor.js'
import type { Step } from './Step.js'
import type { PageTask } from './PageTask.js'

type TraverserDef = {
  type: 'traverser'
  settings?: StepSettings
  run: (page: Page, task: PageTask) => Promise<TraverserResult[]>
}

type ExtractorDef = {
  type: 'extractor'
  outputFile?: string   // defaults to "<stepName>.csv"
  settings?: StepSettings
  run: (page: Page, task: PageTask) => Promise<Record<string, unknown>[]>
}

type StepDef = TraverserDef | ExtractorDef

export interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  steps: Map<StepName, Step>
  retryConfig: RetryConfig
  deduplication: boolean
  filePath?: string   // set by FileParserLoader after loading
}

export interface ParserDefinition {
  name: string
  entryUrl: string
  entryStep?: string   // optional — defaults to first step
  retryConfig?: Partial<RetryConfig>
  deduplication?: boolean
  steps: Record<string, StepDef>
}

export function defineParser(def: ParserDefinition): ParserConfig {
  const steps = new Map<StepName, Step>()
  const stepKeys = Object.keys(def.steps)

  for (const [name, stepDef] of Object.entries(def.steps)) {
    const sn = stepName(name)
    if (stepDef.type === 'traverser') {
      steps.set(sn, new Traverser(sn, stepDef.run, stepDef.settings))
    } else {
      const outFile = stepDef.outputFile ?? `${name}.csv`
      steps.set(sn, new Extractor(sn, stepDef.run, outFile, stepDef.settings))
    }
  }

  const entry = def.entryStep ?? stepKeys[0]
  if (!entry) throw new Error('Parser must have at least one step')

  return {
    name: def.name,
    entryUrl: def.entryUrl,
    entryStep: stepName(entry),
    steps,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...def.retryConfig },
    deduplication: def.deduplication ?? true,
  }
}
```

- [ ] **Step 5: Update FileParserLoader — set filePath**

```ts
// src/infrastructure/loader/FileParserLoader.ts
import { resolve } from 'node:path'
import type { ParserConfig } from '../../domain/entities/Parser.js'

export class FileParserLoader {
  constructor(private readonly parsersDir: string) {}

  async load(parserName: string): Promise<ParserConfig> {
    const filePath = resolve(this.parsersDir, parserName, 'index.ts')
    const module = await import(filePath)
    const config: ParserConfig = module.default
    if (!config || !config.name) {
      throw new Error(`Parser "${parserName}" did not export a valid ParserConfig as default`)
    }
    config.filePath = filePath
    return config
  }
}
```

- [ ] **Step 6: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -50
```
Expected: errors only in workers, orchestrator, parsers — not in domain entities.

- [ ] **Step 7: Commit**
```bash
git add src/domain/entities/ src/infrastructure/loader/
git commit -m "feat(domain): replace selector-based steps with run() functions, add StepSettings and parserFilePath"
```

---

### Task 4: Rewrite TraverserWorker

**Files:**
- Modify: `src/infrastructure/worker/TraverserWorker.ts`

**Context:**
- `workerData` now contains `{ parserFilePath: string, stepName: string }` (no `step` object)
- Worker dynamically imports the parser, gets the Traverser step by name
- Calls `step.run(page, task)` which returns `TraverserResult[]`
- Sends `LINKS_DISCOVERED` with `items: TraverserResult[]`
- Uses `createBrowserAdapter(step.settings?.browser_type)` from `src/infrastructure/browser/BrowserAdapter.ts`

```ts
// src/infrastructure/worker/TraverserWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Traverser } from '../../domain/entities/Traverser.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'

const { parserFilePath, stepName } = workerData as { parserFilePath: string; stepName: string }

let adapter = createBrowserAdapter()  // temporary, replaced after import
let running = true

async function processPage(task: PageTask, step: Traverser): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const items = await step.run(page, task)
    const msg: WorkerOutMessage = { type: 'LINKS_DISCOVERED', taskId: task.id, items }
    parentPort!.postMessage(msg)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

async function main() {
  const mod = await import(parserFilePath) as { default: ParserConfig }
  const config = mod.default
  const step = config.steps.get(stepName as any) as Traverser
  if (!step) throw new Error(`Step "${stepName}" not found in parser "${config.name}"`)

  adapter = createBrowserAdapter(step.settings?.browser_type)
  await adapter.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await adapter.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 1: Write the updated TraverserWorker.ts** (content above)

- [ ] **Step 2: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 3: Commit**
```bash
git add src/infrastructure/worker/TraverserWorker.ts
git commit -m "feat(worker): rewrite TraverserWorker to use dynamic parser import and run()"
```

---

### Task 5: Rewrite ExtractorWorker

**Files:**
- Modify: `src/infrastructure/worker/ExtractorWorker.ts`

**Context:**
- Same pattern as TraverserWorker: `workerData` has `{ parserFilePath, stepName }`
- Calls `step.run(page, task)` → returns `Record<string, unknown>[]`
- Sends `DATA_EXTRACTED` with `rows` array and `outputFile` from `step.outputFile`

```ts
// src/infrastructure/worker/ExtractorWorker.ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { createBrowserAdapter } from '../browser/BrowserAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { Extractor } from '../../domain/entities/Extractor.js'
import type { ParserConfig } from '../../domain/entities/Parser.js'

const { parserFilePath, stepName } = workerData as { parserFilePath: string; stepName: string }

let adapter = createBrowserAdapter()
let running = true

async function processPage(task: PageTask, step: Extractor): Promise<void> {
  const page = await adapter.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const rows = await step.run(page, task)
    parentPort!.postMessage({
      type: 'DATA_EXTRACTED',
      taskId: task.id,
      rows,
      outputFile: step.outputFile,
    } satisfies WorkerOutMessage)
    parentPort!.postMessage({ type: 'PAGE_SUCCESS', taskId: task.id } satisfies WorkerOutMessage)
  } catch (err) {
    parentPort!.postMessage({ type: 'PAGE_FAILED', taskId: task.id, error: String(err) } satisfies WorkerOutMessage)
  } finally {
    await page.close()
  }
}

async function main() {
  const mod = await import(parserFilePath) as { default: ParserConfig }
  const config = mod.default
  const step = config.steps.get(stepName as any) as Extractor
  if (!step) throw new Error(`Step "${stepName}" not found in parser "${config.name}"`)

  adapter = createBrowserAdapter(step.settings?.browser_type)
  await adapter.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await adapter.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 1: Write ExtractorWorker.ts** (content above)

- [ ] **Step 2: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 3: Commit**
```bash
git add src/infrastructure/worker/ExtractorWorker.ts
git commit -m "feat(worker): rewrite ExtractorWorker to use dynamic parser import and run()"
```

---

### Task 6: Update ParserOrchestrator

**Files:**
- Modify: `src/application/orchestrator/ParserOrchestrator.ts`

**Context:** Key changes:
1. `spawnWorker` passes `{ parserFilePath, stepName }` instead of `{ step: {...} }`
2. `handleWorkerMessage` LINKS_DISCOVERED: iterate `msg.items`, each item has `link`, `page_type`, `parent_data`
3. `handleWorkerMessage` DATA_EXTRACTED: iterate `msg.rows`, write each row to CSV
4. CsvWriter.write() accepts `Record<string, unknown>` — values serialized to string before writing
5. `config.filePath` must be set — throw if missing

```ts
// Key changes in spawnWorker:
private spawnWorker(step: Step): void {
  if (!this.config.filePath) throw new Error('ParserConfig.filePath not set — use FileParserLoader')

  const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
  const tsWorkerFile =
    step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
  const jsWorkerFile =
    step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

  const entryFile = isTsx ? bootstrapFile : jsWorkerFile
  const workerData = {
    parserFilePath: this.config.filePath,
    stepName: step.name,
    ...(isTsx ? { __workerPath: tsWorkerFile } : {}),
  }

  const worker = new Worker(entryFile, { workerData })
  worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
  worker.on('error', (err) => this.emit('error', err))
  this.workers.set(step.name, worker)
}

// Key changes in handleWorkerMessage LINKS_DISCOVERED:
case 'LINKS_DISCOVERED': {
  const newLinks = this.deduplicator.filter(msg.items.map(i => i.link))
  const newItems = msg.items.filter(i => newLinks.includes(i.link))
  for (const item of newItems) {
    const task = this.run.addTask(
      item.link,
      item.page_type as StepName,
      this.config.retryConfig,
      msg.taskId,
      item.parent_data as Record<string, string> | undefined,
    )
    this.dispatchTask(task.id)
  }
  this.emit('stats', this.run.getStats())
  break
}

// Key changes in DATA_EXTRACTED:
case 'DATA_EXTRACTED': {
  for (const row of msg.rows) {
    const stringRow: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) {
      stringRow[k] = v == null ? '' : String(v)
    }
    this.writeCsvRow(msg.outputFile, stringRow)
  }
  break
}
```

- [ ] **Step 1: Update `spawnWorker`** — new workerData with `parserFilePath` and `stepName`
- [ ] **Step 2: Update `LINKS_DISCOVERED` handler** — iterate items, use `item.page_type` as step name
- [ ] **Step 3: Update `DATA_EXTRACTED` handler** — iterate rows, serialize values to string
- [ ] **Step 4: Run TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1 | head -50
```
Expected: 0 errors (or errors only in parsers not yet updated).
- [ ] **Step 5: Commit**
```bash
git add src/application/orchestrator/ParserOrchestrator.ts
git commit -m "feat(orchestrator): update to handle run()-based workers and new message shapes"
```

---

### Task 7: Update parsers

**Files:**
- Modify: `src/parsers/bauer/index.ts`
- Modify: `src/parsers/example/index.ts`

**Context:** Rewrite both parsers to use `run()` functions. No CSS selector config anymore.

**bauer parser** — single extractor step, extract all h1 text:

```ts
// src/parsers/bauer/index.ts
import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'bauer',
  entryUrl: 'https://www.bauer.com/products/bauer-vapor-flylite-skate-juinor',
  retryConfig: { maxRetries: 3 },
  deduplication: false,
  steps: {
    product: {
      type: 'extractor',
      outputFile: 'bauer-headings.csv',
      run: async (page: Page, task: PageTask) => {
        const h1 = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
        return [{ h1, __url: task.url }]
      },
    },
  },
})
```

**example parser** — books.toscrape.com 3-step pipeline rewritten with run():

```ts
// src/parsers/example/index.ts
import { defineParser } from '../../domain/entities/Parser.js'
import type { Page } from 'playwright'
import type { PageTask } from '../../domain/entities/PageTask.js'

export default defineParser({
  name: 'example',
  entryUrl: 'https://books.toscrape.com/',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      run: async (page: Page, task: PageTask) => {
        const items = await page.$$eval('div.side_categories ul li ul li a', els =>
          els.map(el => ({
            link: (el as HTMLAnchorElement).href,
            category: el.textContent?.trim() ?? '',
          }))
        )
        return items.map(({ link, category }) => ({
          link,
          page_type: 'bookList',
          parent_data: { ...task.parentData, category },
        }))
      },
    },
    bookList: {
      type: 'traverser',
      run: async (page: Page, task: PageTask) => {
        const bookLinks = await page.$$eval('article.product_pod h3 a', els =>
          els.map(el => (el as HTMLAnchorElement).href)
        )
        const nextPage = await page
          .$eval('li.next a', el => (el as HTMLAnchorElement).href)
          .catch(() => null)

        const results = bookLinks.map(link => ({
          link,
          page_type: 'bookDetail',
          parent_data: { ...task.parentData },
        }))

        if (nextPage && nextPage !== task.url) {
          results.push({ link: nextPage, page_type: 'bookList', parent_data: { ...task.parentData } })
        }

        return results
      },
    },
    bookDetail: {
      type: 'extractor',
      outputFile: 'books.csv',
      run: async (page: Page, task: PageTask) => {
        const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
        const price = await page.$eval('p.price_color', el => el.textContent?.trim() ?? '').catch(() => '')
        const availability = await page.$eval('p.availability', el => el.textContent?.trim() ?? '').catch(() => '')
        const rating = await page.$eval('p.star-rating', el => el.className.replace('star-rating ', '') ?? '').catch(() => '')
        return [{
          title,
          price,
          availability,
          rating,
          category: String(task.parentData?.category ?? ''),
          __url: task.url,
        }]
      },
    },
  },
})
```

- [ ] **Step 1: Update bauer parser**
- [ ] **Step 2: Update example parser**
- [ ] **Step 3: Run TypeScript check — must be 0 errors**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1
```
- [ ] **Step 4: Run tests**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx vitest run 2>&1
```
Expected: all tests pass (domain tests don't depend on parsers/workers)
- [ ] **Step 5: Smoke test bauer parser**

First delete old output, then delete and recreate so FileParserLoader can set filePath:
```bash
rm -rf /Users/ryunko/Desktop/Projects/scraper/output/bauer
cd /Users/ryunko/Desktop/Projects/scraper && npx tsx src/cli/index.ts run bauer 2>&1
```
Expected: "Completed", CSV created at `output/bauer/bauer-headings.csv`

- [ ] **Step 6: Verify CSV output**
```bash
cat /Users/ryunko/Desktop/Projects/scraper/output/bauer/bauer-headings.csv
```
Expected: row with h1 value for Bauer skate page

- [ ] **Step 7: Commit**
```bash
git add src/parsers/
git commit -m "feat(parsers): rewrite bauer and example parsers with run() functions"
```

---

### Task 8: Update tests for new API

**Files:**
- Check `tests/domain/ParserRun.test.ts` — `parentData` type changed to `Record<string, unknown>`, should still pass
- Check `tests/infrastructure/CsvWriter.test.ts` — CsvWriter still takes `Record<string, string>`, no change
- Run all tests and fix any failures

- [ ] **Step 1: Run all tests**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx vitest run 2>&1
```
- [ ] **Step 2: Fix any failures** — most tests test domain logic (ParserRun, LinkDeduplicator, CsvWriter, PageState) which haven't changed structurally
- [ ] **Step 3: Run full TypeScript check**
```bash
cd /Users/ryunko/Desktop/Projects/scraper && npx tsc --noEmit 2>&1
```
Expected: 0 errors
- [ ] **Step 4: Commit any test fixes**
```bash
git add tests/
git commit -m "fix(tests): update tests for new run()-based step API"
```
