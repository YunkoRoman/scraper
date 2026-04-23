# Scraper Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal Playwright-based web scraping platform with DDD architecture, Worker Thread parallelism, named step graphs, and CSV output with post-processing.

**Architecture:** Each parser defines a named graph of Steps (Traverser | Extractor). ParserOrchestrator spawns one Worker Thread per step; workers process pages and send messages back to the orchestrator which routes links, tracks PageTask states, and triggers CSV post-processing on completion.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Playwright, Worker Threads (built-in), fast-csv, commander, tsx, vitest

---

## File Map

```
/Users/ryunko/Desktop/Projects/scraper/
├── package.json
├── tsconfig.json
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── Step.ts              # abstract Step base class
│   │   │   ├── Traverser.ts         # Traverser extends Step
│   │   │   ├── Extractor.ts         # Extractor extends Step
│   │   │   ├── PageTask.ts          # PageTask interface + factory
│   │   │   ├── ParserRun.ts         # ParserRun aggregate (tracks all tasks)
│   │   │   └── Parser.ts            # ParserConfig interface + defineParser()
│   │   ├── value-objects/
│   │   │   ├── StepName.ts          # branded string type
│   │   │   ├── PageState.ts         # enum + transitions
│   │   │   └── RetryConfig.ts       # RetryConfig interface + defaults
│   │   ├── events/
│   │   │   └── index.ts             # all domain event types (union)
│   │   └── services/
│   │       └── LinkDeduplicator.ts  # Set-based URL deduplication
│   ├── application/
│   │   ├── orchestrator/
│   │   │   └── ParserOrchestrator.ts  # spawns workers, routes messages, tracks state
│   │   ├── services/
│   │   │   └── ParserRunnerService.ts # concurrent parser queue
│   │   └── use-cases/
│   │       ├── RunParser.ts
│   │       ├── StopParser.ts
│   │       └── GetParserStatus.ts
│   ├── infrastructure/
│   │   ├── worker/
│   │   │   ├── messages.ts          # WorkerInMessage | WorkerOutMessage types
│   │   │   ├── TraverserWorker.ts   # runs inside Worker Thread
│   │   │   └── ExtractorWorker.ts   # runs inside Worker Thread
│   │   ├── playwright/
│   │   │   └── PlaywrightAdapter.ts # browser lifecycle inside worker
│   │   ├── csv/
│   │   │   ├── CsvWriter.ts         # append rows to CSV via fast-csv
│   │   │   └── CsvPostProcessor.ts  # compression + byte-offset indexing
│   │   └── loader/
│   │       └── FileParserLoader.ts  # dynamic import of parser TS file
│   ├── cli/
│   │   ├── ConsoleReporter.ts       # live stats display
│   │   └── index.ts                 # commander entry point
│   └── parsers/
│       └── example/
│           └── index.ts             # working example parser
└── tests/
    ├── domain/
    │   ├── ParserRun.test.ts
    │   ├── LinkDeduplicator.test.ts
    │   └── PageState.test.ts
    ├── infrastructure/
    │   ├── CsvWriter.test.ts
    │   └── CsvPostProcessor.test.ts
    └── application/
        └── ParserOrchestrator.test.ts
```

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "scraper-platform",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "fast-csv": "^5.0.1",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
npx playwright install chromium
```

Expected: `node_modules/` created, playwright browser downloaded.

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json
git commit -m "chore: initialize project with TypeScript and Playwright"
```

---

### Task 2: Domain Value Objects

**Files:**
- Create: `src/domain/value-objects/StepName.ts`
- Create: `src/domain/value-objects/PageState.ts`
- Create: `src/domain/value-objects/RetryConfig.ts`
- Test: `tests/domain/PageState.test.ts`

- [ ] **Step 1: Write failing test for PageState transitions**

Create `tests/domain/PageState.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PageState, isTerminal } from '../../src/domain/value-objects/PageState.js'

describe('PageState', () => {
  it('pending, success, failed, aborted are terminal', () => {
    expect(isTerminal(PageState.Success)).toBe(true)
    expect(isTerminal(PageState.Failed)).toBe(true)
    expect(isTerminal(PageState.Aborted)).toBe(true)
    expect(isTerminal(PageState.Pending)).toBe(false)
    expect(isTerminal(PageState.Retry)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/domain/PageState.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create StepName value object**

Create `src/domain/value-objects/StepName.ts`:
```ts
export type StepName = string & { readonly __brand: 'StepName' }

export function stepName(value: string): StepName {
  if (!value.trim()) throw new Error('StepName cannot be empty')
  return value as StepName
}
```

- [ ] **Step 4: Create PageState value object**

Create `src/domain/value-objects/PageState.ts`:
```ts
export enum PageState {
  Pending = 'pending',
  Retry = 'retry',
  Success = 'success',
  Failed = 'failed',
  Aborted = 'aborted',
}

const TERMINAL_STATES = new Set([PageState.Success, PageState.Failed, PageState.Aborted])

export function isTerminal(state: PageState): boolean {
  return TERMINAL_STATES.has(state)
}
```

- [ ] **Step 5: Create RetryConfig value object**

Create `src/domain/value-objects/RetryConfig.ts`:
```ts
export interface RetryConfig {
  maxRetries: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/domain/PageState.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/value-objects/ tests/domain/PageState.test.ts
git commit -m "feat(domain): add StepName, PageState, RetryConfig value objects"
```

---

### Task 3: Domain Entities — Step, Traverser, Extractor

**Files:**
- Create: `src/domain/entities/Step.ts`
- Create: `src/domain/entities/Traverser.ts`
- Create: `src/domain/entities/Extractor.ts`

- [ ] **Step 1: Create abstract Step**

Create `src/domain/entities/Step.ts`:
```ts
import type { StepName } from '../value-objects/StepName.js'

export type StepType = 'traverser' | 'extractor'

export abstract class Step {
  abstract readonly type: StepType
  constructor(readonly name: StepName) {}
}
```

- [ ] **Step 2: Create Traverser**

Create `src/domain/entities/Traverser.ts`:
```ts
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'

export class Traverser extends Step {
  readonly type = 'traverser' as const

  constructor(
    name: StepName,
    readonly linkSelector: string,
    readonly nextStep: StepName | StepName[],
    readonly parentDataSelectors?: Record<string, string>,
    readonly nextPageSelector?: string,
  ) {
    super(name)
  }
}
```

- [ ] **Step 3: Create Extractor**

Create `src/domain/entities/Extractor.ts`:
```ts
import { Step } from './Step.js'
import type { StepName } from '../value-objects/StepName.js'

export class Extractor extends Step {
  readonly type = 'extractor' as const

  constructor(
    name: StepName,
    readonly dataSelectors: Record<string, string>,
    readonly outputFile: string,
  ) {
    super(name)
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/Step.ts src/domain/entities/Traverser.ts src/domain/entities/Extractor.ts
git commit -m "feat(domain): add Step, Traverser, Extractor entities"
```

---

### Task 4: Domain Entities — PageTask and ParserRun

**Files:**
- Create: `src/domain/entities/PageTask.ts`
- Create: `src/domain/entities/ParserRun.ts`
- Test: `tests/domain/ParserRun.test.ts`

- [ ] **Step 1: Write failing tests for ParserRun**

Create `tests/domain/ParserRun.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ParserRun } from '../../src/domain/entities/ParserRun.js'
import { PageState } from '../../src/domain/value-objects/PageState.js'
import { stepName } from '../../src/domain/value-objects/StepName.js'

describe('ParserRun', () => {
  it('adds a task and tracks it', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'))
    expect(run.getTask(task.id)).toBeDefined()
    expect(task.state).toBe(PageState.Pending)
  })

  it('transitions task to retry and increments attempts', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'), { maxRetries: 3 })
    run.markRetry(task.id, 'timeout')
    const updated = run.getTask(task.id)!
    expect(updated.state).toBe(PageState.Retry)
    expect(updated.attempts).toBe(1)
    expect(updated.error).toBe('timeout')
  })

  it('transitions to failed when attempts exhausted', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'), { maxRetries: 1 })
    run.markRetry(task.id, 'err')
    run.markFailed(task.id, 'err')
    expect(run.getTask(task.id)!.state).toBe(PageState.Failed)
  })

  it('isComplete returns true when all tasks terminal', () => {
    const run = new ParserRun('my-parser')
    const t1 = run.addTask('https://a.com', stepName('step1'))
    const t2 = run.addTask('https://b.com', stepName('step1'))
    run.markSuccess(t1.id)
    run.markSuccess(t2.id)
    expect(run.isComplete()).toBe(true)
  })

  it('stats returns correct counts', () => {
    const run = new ParserRun('my-parser')
    const t1 = run.addTask('https://a.com', stepName('step1'))
    const t2 = run.addTask('https://b.com', stepName('step1'))
    run.markSuccess(t1.id)
    run.markFailed(t2.id, 'err')
    const stats = run.getStats()
    expect(stats.total).toBe(2)
    expect(stats.success).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.pending).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/domain/ParserRun.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create PageTask**

Create `src/domain/entities/PageTask.ts`:
```ts
import type { StepName } from '../value-objects/StepName.js'
import { PageState } from '../value-objects/PageState.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { randomUUID } from 'node:crypto'

export interface PageTask {
  readonly id: string
  readonly url: string
  readonly stepName: StepName
  readonly state: PageState
  readonly attempts: number
  readonly maxAttempts: number
  readonly error?: string
  readonly parentTaskId?: string
  readonly parentData?: Record<string, string>
}

export function createPageTask(
  url: string,
  step: StepName,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  parentTaskId?: string,
  parentData?: Record<string, string>,
): PageTask {
  return {
    id: randomUUID(),
    url,
    stepName: step,
    state: PageState.Pending,
    attempts: 0,
    maxAttempts: retryConfig.maxRetries,
    parentTaskId,
    parentData,
  }
}
```

- [ ] **Step 4: Create ParserRun**

Create `src/domain/entities/ParserRun.ts`:
```ts
import { createPageTask, type PageTask } from './PageTask.js'
import { PageState, isTerminal } from '../value-objects/PageState.js'
import type { StepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'

export interface RunStats {
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
}

export class ParserRun {
  private tasks = new Map<string, PageTask>()
  readonly startedAt = new Date()

  constructor(readonly parserName: string) {}

  addTask(
    url: string,
    step: StepName,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
    parentTaskId?: string,
    parentData?: Record<string, string>,
  ): PageTask {
    const task = createPageTask(url, step, retryConfig, parentTaskId, parentData)
    this.tasks.set(task.id, task)
    return task
  }

  getTask(id: string): PageTask | undefined {
    return this.tasks.get(id)
  }

  markRetry(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Retry, attempts: task.attempts + 1, error })
  }

  markSuccess(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Success, error: undefined })
  }

  markFailed(id: string, error: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Failed, error })
  }

  markAborted(id: string): void {
    const task = this.requireTask(id)
    this.tasks.set(id, { ...task, state: PageState.Aborted })
  }

  isComplete(): boolean {
    if (this.tasks.size === 0) return false
    return [...this.tasks.values()].every((t) => isTerminal(t.state))
  }

  allTasks(): PageTask[] {
    return [...this.tasks.values()]
  }

  getStats(): RunStats {
    const tasks = [...this.tasks.values()]
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.state === PageState.Pending).length,
      retry: tasks.filter((t) => t.state === PageState.Retry).length,
      success: tasks.filter((t) => t.state === PageState.Success).length,
      failed: tasks.filter((t) => t.state === PageState.Failed).length,
      aborted: tasks.filter((t) => t.state === PageState.Aborted).length,
      inProgress: tasks.filter((t) => t.state === PageState.Pending || t.state === PageState.Retry).length,
    }
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt.getTime()
  }

  private requireTask(id: string): PageTask {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/domain/ParserRun.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/entities/PageTask.ts src/domain/entities/ParserRun.ts tests/domain/ParserRun.test.ts
git commit -m "feat(domain): add PageTask and ParserRun aggregate"
```

---

### Task 5: Domain Entities — Parser + defineParser

**Files:**
- Create: `src/domain/entities/Parser.ts`

- [ ] **Step 1: Create Parser.ts**

Create `src/domain/entities/Parser.ts`:
```ts
import type { StepName } from '../value-objects/StepName.js'
import { stepName } from '../value-objects/StepName.js'
import type { RetryConfig } from '../value-objects/RetryConfig.js'
import { DEFAULT_RETRY_CONFIG } from '../value-objects/RetryConfig.js'
import { Traverser } from './Traverser.js'
import { Extractor } from './Extractor.js'
import type { Step } from './Step.js'

type TraverserDef = {
  type: 'traverser'
  linkSelector: string
  nextStep: string | string[]
  parentDataSelectors?: Record<string, string>
  nextPageSelector?: string
}

type ExtractorDef = {
  type: 'extractor'
  dataSelectors: Record<string, string>
  outputFile: string
}

type StepDef = TraverserDef | ExtractorDef

export interface ParserConfig {
  name: string
  entryUrl: string
  entryStep: StepName
  steps: Map<StepName, Step>
  retryConfig: RetryConfig
  deduplication: boolean
}

export interface ParserDefinition {
  name: string
  entryUrl: string
  entryStep: string
  retryConfig?: Partial<RetryConfig>
  deduplication?: boolean
  steps: Record<string, StepDef>
}

export function defineParser(def: ParserDefinition): ParserConfig {
  const steps = new Map<StepName, Step>()

  for (const [name, stepDef] of Object.entries(def.steps)) {
    const sn = stepName(name)
    if (stepDef.type === 'traverser') {
      const nextSteps = Array.isArray(stepDef.nextStep)
        ? stepDef.nextStep.map(stepName)
        : stepName(stepDef.nextStep)
      steps.set(
        sn,
        new Traverser(
          sn,
          stepDef.linkSelector,
          nextSteps,
          stepDef.parentDataSelectors,
          stepDef.nextPageSelector,
        ),
      )
    } else {
      steps.set(sn, new Extractor(sn, stepDef.dataSelectors, stepDef.outputFile))
    }
  }

  return {
    name: def.name,
    entryUrl: def.entryUrl,
    entryStep: stepName(def.entryStep),
    steps,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...def.retryConfig },
    deduplication: def.deduplication ?? true,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domain/entities/Parser.ts
git commit -m "feat(domain): add Parser aggregate and defineParser factory"
```

---

### Task 6: Domain Events

**Files:**
- Create: `src/domain/events/index.ts`

- [ ] **Step 1: Create domain events**

Create `src/domain/events/index.ts`:
```ts
import type { StepName } from '../value-objects/StepName.js'

export interface LinksDiscovered {
  type: 'LinksDiscovered'
  taskId: string
  links: string[]
  nextStep: StepName
  parentData?: Record<string, string>
}

export interface DataExtracted {
  type: 'DataExtracted'
  taskId: string
  data: Record<string, string>
  outputFile: string
}

export interface PageSucceeded {
  type: 'PageSucceeded'
  taskId: string
}

export interface PageFailed {
  type: 'PageFailed'
  taskId: string
  error: string
}

export interface PageRetried {
  type: 'PageRetried'
  taskId: string
  attempt: number
}

export type DomainEvent =
  | LinksDiscovered
  | DataExtracted
  | PageSucceeded
  | PageFailed
  | PageRetried
```

- [ ] **Step 2: Commit**

```bash
git add src/domain/events/index.ts
git commit -m "feat(domain): add domain event types"
```

---

### Task 7: Domain Service — LinkDeduplicator

**Files:**
- Create: `src/domain/services/LinkDeduplicator.ts`
- Test: `tests/domain/LinkDeduplicator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/domain/LinkDeduplicator.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { LinkDeduplicator } from '../../src/domain/services/LinkDeduplicator.js'

describe('LinkDeduplicator', () => {
  it('returns all links on first call', () => {
    const dedup = new LinkDeduplicator()
    expect(dedup.filter(['https://a.com', 'https://b.com'])).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  it('filters already-seen links', () => {
    const dedup = new LinkDeduplicator()
    dedup.filter(['https://a.com'])
    expect(dedup.filter(['https://a.com', 'https://b.com'])).toEqual(['https://b.com'])
  })

  it('normalizes trailing slash', () => {
    const dedup = new LinkDeduplicator()
    dedup.filter(['https://a.com/page'])
    expect(dedup.filter(['https://a.com/page/'])).toEqual([])
  })

  it('when disabled returns all links', () => {
    const dedup = new LinkDeduplicator(false)
    dedup.filter(['https://a.com'])
    expect(dedup.filter(['https://a.com'])).toEqual(['https://a.com'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/domain/LinkDeduplicator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement LinkDeduplicator**

Create `src/domain/services/LinkDeduplicator.ts`:
```ts
export class LinkDeduplicator {
  private seen = new Set<string>()

  constructor(private readonly enabled: boolean = true) {}

  filter(urls: string[]): string[] {
    if (!this.enabled) return urls
    const result: string[] = []
    for (const url of urls) {
      const normalized = this.normalize(url)
      if (!this.seen.has(normalized)) {
        this.seen.add(normalized)
        result.push(url)
      }
    }
    return result
  }

  private normalize(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      parsed.searchParams.sort()
      return parsed.toString()
    } catch {
      return url
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/domain/LinkDeduplicator.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/services/LinkDeduplicator.ts tests/domain/LinkDeduplicator.test.ts
git commit -m "feat(domain): add LinkDeduplicator service"
```

---

### Task 8: Infrastructure — Worker Message Types

**Files:**
- Create: `src/infrastructure/worker/messages.ts`

- [ ] **Step 1: Create worker message types**

Create `src/infrastructure/worker/messages.ts`:
```ts
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Messages sent from Main → Worker
export type WorkerInMessage =
  | { type: 'PROCESS_PAGE'; task: PageTask }
  | { type: 'STOP' }

// Messages sent from Worker → Main
export type WorkerOutMessage =
  | {
      type: 'LINKS_DISCOVERED'
      taskId: string
      links: string[]
      nextStep: StepName
      parentData?: Record<string, string>
    }
  | { type: 'DATA_EXTRACTED'; taskId: string; data: Record<string, string>; outputFile: string }
  | { type: 'PAGE_SUCCESS'; taskId: string }
  | { type: 'PAGE_FAILED'; taskId: string; error: string }
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/worker/messages.ts
git commit -m "feat(infra): add worker message protocol types"
```

---

### Task 9: Infrastructure — PlaywrightAdapter

**Files:**
- Create: `src/infrastructure/playwright/PlaywrightAdapter.ts`

- [ ] **Step 1: Create PlaywrightAdapter**

Create `src/infrastructure/playwright/PlaywrightAdapter.ts`:
```ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

export class PlaywrightAdapter {
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

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/playwright/PlaywrightAdapter.ts
git commit -m "feat(infra): add PlaywrightAdapter"
```

---

### Task 10: Infrastructure — TraverserWorker

**Files:**
- Create: `src/infrastructure/worker/TraverserWorker.ts`

- [ ] **Step 1: Create TraverserWorker**

Create `src/infrastructure/worker/TraverserWorker.ts`:
```ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { PlaywrightAdapter } from '../playwright/PlaywrightAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Plain object (class instance loses methods through structured clone)
interface TraverserData {
  name: StepName
  type: 'traverser'
  linkSelector: string
  nextStep: StepName | StepName[]
  parentDataSelectors?: Record<string, string>
  nextPageSelector?: string
}

const playwright = new PlaywrightAdapter()
let running = true

async function processPage(task: PageTask, step: TraverserData): Promise<void> {
  const page = await playwright.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const links = await page.$$eval(step.linkSelector, (els) =>
      els
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => href.startsWith('http')),
    )

    const parentData: Record<string, string> = {}
    if (step.parentDataSelectors) {
      for (const [key, selector] of Object.entries(step.parentDataSelectors)) {
        parentData[key] = (await page.$eval(selector, (el) => el.textContent ?? '').catch(() => ''))
      }
    }

    const nextSteps = Array.isArray(step.nextStep) ? step.nextStep : [step.nextStep]

    for (const nextStep of nextSteps) {
      const msg: WorkerOutMessage = {
        type: 'LINKS_DISCOVERED',
        taskId: task.id,
        links,
        nextStep,
        parentData: Object.keys(parentData).length > 0 ? parentData : undefined,
      }
      parentPort!.postMessage(msg)
    }

    if (step.nextPageSelector) {
      const nextUrl = await page
        .$eval(step.nextPageSelector, (el) => (el as HTMLAnchorElement).href)
        .catch(() => null)

      if (nextUrl && nextUrl !== task.url) {
        const paginationMsg: WorkerOutMessage = {
          type: 'LINKS_DISCOVERED',
          taskId: task.id,
          links: [nextUrl],
          nextStep: step.name,
        }
        parentPort!.postMessage(paginationMsg)
      }
    }

    const successMsg: WorkerOutMessage = { type: 'PAGE_SUCCESS', taskId: task.id }
    parentPort!.postMessage(successMsg)
  } catch (err) {
    const failMsg: WorkerOutMessage = {
      type: 'PAGE_FAILED',
      taskId: task.id,
      error: String(err),
    }
    parentPort!.postMessage(failMsg)
  } finally {
    await page.close()
  }
}

async function main() {
  const step: TraverserData = workerData.step
  await playwright.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await playwright.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/worker/TraverserWorker.ts
git commit -m "feat(infra): add TraverserWorker"
```

---

### Task 11: Infrastructure — ExtractorWorker

**Files:**
- Create: `src/infrastructure/worker/ExtractorWorker.ts`

- [ ] **Step 1: Create ExtractorWorker**

Create `src/infrastructure/worker/ExtractorWorker.ts`:
```ts
import { parentPort, workerData } from 'node:worker_threads'
import type { WorkerInMessage, WorkerOutMessage } from './messages.js'
import { PlaywrightAdapter } from '../playwright/PlaywrightAdapter.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

// Plain object (class instance loses methods through structured clone)
interface ExtractorData {
  name: StepName
  type: 'extractor'
  dataSelectors: Record<string, string>
  outputFile: string
}

const playwright = new PlaywrightAdapter()
let running = true

async function processPage(task: PageTask, step: ExtractorData): Promise<void> {
  const page = await playwright.newPage()
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const data: Record<string, string> = {}

    if (task.parentData) {
      Object.assign(data, task.parentData)
    }

    for (const [key, selector] of Object.entries(step.dataSelectors)) {
      data[key] = await page
        .$eval(selector, (el) => el.textContent?.trim() ?? '')
        .catch(() => '')
    }

    data['__url'] = task.url

    const extractMsg: WorkerOutMessage = {
      type: 'DATA_EXTRACTED',
      taskId: task.id,
      data,
      outputFile: step.outputFile,
    }
    parentPort!.postMessage(extractMsg)

    const successMsg: WorkerOutMessage = { type: 'PAGE_SUCCESS', taskId: task.id }
    parentPort!.postMessage(successMsg)
  } catch (err) {
    const failMsg: WorkerOutMessage = {
      type: 'PAGE_FAILED',
      taskId: task.id,
      error: String(err),
    }
    parentPort!.postMessage(failMsg)
  } finally {
    await page.close()
  }
}

async function main() {
  const step: ExtractorData = workerData.step
  await playwright.launch()

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type === 'STOP') {
      running = false
      await playwright.close()
      return
    }
    if (msg.type === 'PROCESS_PAGE' && running) {
      await processPage(msg.task, step)
    }
  })
}

main().catch(console.error)
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/worker/ExtractorWorker.ts
git commit -m "feat(infra): add ExtractorWorker"
```

---

### Task 12: Infrastructure — CsvWriter

**Files:**
- Create: `src/infrastructure/csv/CsvWriter.ts`
- Test: `tests/infrastructure/CsvWriter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/infrastructure/CsvWriter.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { CsvWriter } from '../../src/infrastructure/csv/CsvWriter.js'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testFile = join(tmpdir(), `test-${Date.now()}.csv`)

afterEach(() => {
  if (existsSync(testFile)) rmSync(testFile)
})

describe('CsvWriter', () => {
  it('writes header and rows to CSV', async () => {
    const writer = new CsvWriter(testFile)
    await writer.write({ name: 'Alice', age: '30' })
    await writer.write({ name: 'Bob', age: '25' })
    await writer.close()

    const content = readFileSync(testFile, 'utf-8')
    expect(content).toContain('name,age')
    expect(content).toContain('Alice,30')
    expect(content).toContain('Bob,25')
  })

  it('appends rows on multiple writes without duplicating header', async () => {
    const writer = new CsvWriter(testFile)
    await writer.write({ x: '1' })
    await writer.write({ x: '2' })
    await writer.close()

    const lines = readFileSync(testFile, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/infrastructure/CsvWriter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CsvWriter**

Create `src/infrastructure/csv/CsvWriter.ts`:
```ts
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { format } from 'fast-csv'

export class CsvWriter {
  private stream: ReturnType<typeof format> | null = null
  private headers: string[] | null = null
  private writeStream: ReturnType<typeof createWriteStream> | null = null

  constructor(private readonly filePath: string) {}

  async write(row: Record<string, string>): Promise<void> {
    if (!this.stream) {
      await mkdir(dirname(this.filePath), { recursive: true })
      this.writeStream = createWriteStream(this.filePath, { flags: 'a' })
      const isNew = !existsSync(this.filePath) || (existsSync(this.filePath) && this.headers === null)
      this.headers = Object.keys(row)
      this.stream = format({ headers: this.headers, includeEndRowDelimiter: true, writeBOM: false })
      this.stream.pipe(this.writeStream)
    }
    this.stream.write(row)
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream || !this.writeStream) {
        resolve()
        return
      }
      this.writeStream.on('finish', resolve)
      this.writeStream.on('error', reject)
      this.stream.end()
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/infrastructure/CsvWriter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/csv/CsvWriter.ts tests/infrastructure/CsvWriter.test.ts
git commit -m "feat(infra): add CsvWriter with fast-csv"
```

---

### Task 13: Infrastructure — CsvPostProcessor

**Files:**
- Create: `src/infrastructure/csv/CsvPostProcessor.ts`
- Test: `tests/infrastructure/CsvPostProcessor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/infrastructure/CsvPostProcessor.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { CsvPostProcessor } from '../../src/infrastructure/csv/CsvPostProcessor.js'
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = tmpdir()
const csvFile = join(dir, `test-${Date.now()}.csv`)
const indexFile = `${csvFile}.index`

afterEach(() => {
  if (existsSync(csvFile)) rmSync(csvFile)
  if (existsSync(indexFile)) rmSync(indexFile)
})

describe('CsvPostProcessor', () => {
  it('creates an index file with byte offsets', async () => {
    writeFileSync(csvFile, 'name,age\nAlice,30\nBob,25\n')
    const processor = new CsvPostProcessor(csvFile)
    await processor.process()
    expect(existsSync(indexFile)).toBe(true)
    const index = JSON.parse(readFileSync(indexFile, 'utf-8'))
    expect(Object.keys(index).length).toBeGreaterThan(0)
  })

  it('removes empty lines during compression', async () => {
    writeFileSync(csvFile, 'name,age\nAlice,30\n\nBob,25\n\n')
    const processor = new CsvPostProcessor(csvFile)
    await processor.process()
    const content = readFileSync(csvFile, 'utf-8')
    expect(content).not.toMatch(/\n\n/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/infrastructure/CsvPostProcessor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CsvPostProcessor**

Create `src/infrastructure/csv/CsvPostProcessor.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs'

export class CsvPostProcessor {
  constructor(private readonly filePath: string) {}

  async process(): Promise<void> {
    await this.compress()
    await this.buildIndex()
  }

  private async compress(): Promise<void> {
    const content = readFileSync(this.filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    writeFileSync(this.filePath, lines.join('\n') + '\n')
  }

  private async buildIndex(): Promise<void> {
    const content = readFileSync(this.filePath, 'utf-8')
    const lines = content.split('\n')
    const index: Record<number, number> = {}
    let offset = 0

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        index[i] = offset
      }
      offset += Buffer.byteLength(lines[i] + '\n', 'utf-8')
    }

    writeFileSync(`${this.filePath}.index`, JSON.stringify(index, null, 2))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/infrastructure/CsvPostProcessor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/csv/CsvPostProcessor.ts tests/infrastructure/CsvPostProcessor.test.ts
git commit -m "feat(infra): add CsvPostProcessor with compression and byte-offset indexing"
```

---

### Task 14: Infrastructure — FileParserLoader

**Files:**
- Create: `src/infrastructure/loader/FileParserLoader.ts`

- [ ] **Step 1: Create FileParserLoader**

Create `src/infrastructure/loader/FileParserLoader.ts`:
```ts
import { resolve } from 'node:path'
import type { ParserConfig } from '../../domain/entities/Parser.js'

export class FileParserLoader {
  constructor(private readonly parsersDir: string) {}

  async load(parserName: string): Promise<ParserConfig> {
    const path = resolve(this.parsersDir, parserName, 'index.ts')
    const module = await import(path)
    const config: ParserConfig = module.default
    if (!config || !config.name) {
      throw new Error(`Parser "${parserName}" did not export a valid ParserConfig as default`)
    }
    return config
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/loader/FileParserLoader.ts
git commit -m "feat(infra): add FileParserLoader"
```

---

### Task 15: Application — ParserOrchestrator

**Files:**
- Create: `src/application/orchestrator/ParserOrchestrator.ts`

- [ ] **Step 1: Create ParserOrchestrator**

Create `src/application/orchestrator/ParserOrchestrator.ts`:
```ts
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ParserConfig } from '../../domain/entities/Parser.js'
import { ParserRun, type RunStats } from '../../domain/entities/ParserRun.js'
import type { Step } from '../../domain/entities/Step.js'
import { LinkDeduplicator } from '../../domain/services/LinkDeduplicator.js'
import { CsvWriter } from '../../infrastructure/csv/CsvWriter.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { StepName } from '../../domain/value-objects/StepName.js'
import { mkdir } from 'node:fs/promises'
import { PageState } from '../../domain/value-objects/PageState.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// Detect tsx (dev) vs compiled JS to resolve worker file extension correctly
const isTsx = __filename.endsWith('.ts')
const workerExt = isTsx ? '.ts' : '.js'
const workerExecArgv = isTsx ? ['--import', 'tsx/esm'] : []

export class ParserOrchestrator extends EventEmitter {
  private run: ParserRun
  private workers = new Map<StepName, Worker>()
  private csvWriters = new Map<string, CsvWriter>()
  private deduplicator: LinkDeduplicator
  private outputDir: string
  private stopped = false
  private completionPromise!: Promise<void>
  private resolveCompletion!: () => void

  constructor(
    private readonly config: ParserConfig,
    outputBaseDir: string,
  ) {
    super()
    this.run = new ParserRun(config.name)
    this.deduplicator = new LinkDeduplicator(config.deduplication)
    this.outputDir = resolve(outputBaseDir, config.name)
  }

  async start(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })

    for (const [, step] of this.config.steps) {
      this.spawnWorker(step)
    }

    const initialUrls = this.deduplicator.filter([this.config.entryUrl])
    for (const url of initialUrls) {
      const task = this.run.addTask(url, this.config.entryStep, this.config.retryConfig)
      this.dispatchTask(task.id)
    }

    this.emit('stats', this.run.getStats())

    return this.completionPromise
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const [, task] of this.run.allTasks().entries()) {
      if (task.state === PageState.Pending || task.state === PageState.Retry) {
        this.run.markAborted(task.id)
      }
    }
    for (const [, worker] of this.workers) {
      worker.postMessage({ type: 'STOP' })
    }
    await this.closeAllWriters()
    this.resolveCompletion()
  }

  getStats(): RunStats {
    return this.run.getStats()
  }

  private spawnWorker(step: Step): void {
    const workerFile =
      step.type === 'traverser'
        ? resolve(__dirname, `../../infrastructure/worker/TraverserWorker${workerExt}`)
        : resolve(__dirname, `../../infrastructure/worker/ExtractorWorker${workerExt}`)

    // Pass plain serializable object (class instances lose methods via structured clone)
    const worker = new Worker(workerFile, {
      workerData: { step: { ...step } },
      execArgv: workerExecArgv,
    })

    worker.on('message', (msg: WorkerOutMessage) => this.handleWorkerMessage(msg))
    worker.on('error', (err) => this.emit('error', err))

    this.workers.set(step.name, worker)
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case 'LINKS_DISCOVERED': {
        const sourceTask = this.run.getTask(msg.taskId)
        const newLinks = this.deduplicator.filter(msg.links)
        for (const url of newLinks) {
          const task = this.run.addTask(
            url,
            msg.nextStep,
            this.config.retryConfig,
            msg.taskId,
            msg.parentData,
          )
          this.dispatchTask(task.id)
        }
        this.emit('stats', this.run.getStats())
        break
      }
      case 'DATA_EXTRACTED': {
        this.writeCsvRow(msg.outputFile, msg.data)
        break
      }
      case 'PAGE_SUCCESS': {
        this.run.markSuccess(msg.taskId)
        this.emit('stats', this.run.getStats())
        this.checkCompletion()
        break
      }
      case 'PAGE_FAILED': {
        const task = this.run.getTask(msg.taskId)!
        if (task.attempts < task.maxAttempts) {
          this.run.markRetry(msg.taskId, msg.error)
          this.emit('stats', this.run.getStats())
          this.dispatchTask(msg.taskId)
        } else {
          this.run.markFailed(msg.taskId, msg.error)
          this.emit('stats', this.run.getStats())
          this.checkCompletion()
        }
        break
      }
    }
  }

  private dispatchTask(taskId: string): void {
    if (this.stopped) return
    const task = this.run.getTask(taskId)
    if (!task) return
    const worker = this.workers.get(task.stepName)
    if (!worker) return
    worker.postMessage({ type: 'PROCESS_PAGE', task })
  }

  private writeCsvRow(outputFile: string, data: Record<string, string>): void {
    const filePath = resolve(this.outputDir, outputFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, new CsvWriter(filePath))
    }
    this.csvWriters.get(filePath)!.write(data).catch(console.error)
  }

  private async checkCompletion(): Promise<void> {
    if (this.stopped || !this.run.isComplete()) return
    await this.closeAllWriters()
    await this.runPostProcessing()
    this.emit('complete', this.run.getStats())
    this.resolveCompletion()
  }

  private async closeAllWriters(): Promise<void> {
    await Promise.all([...this.csvWriters.values()].map((w) => w.close()))
  }

  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/application/orchestrator/ParserOrchestrator.ts
git commit -m "feat(application): add ParserOrchestrator"
```

---

### Task 16: Application — Use Cases

**Files:**
- Create: `src/application/use-cases/RunParser.ts`
- Create: `src/application/use-cases/StopParser.ts`
- Create: `src/application/use-cases/GetParserStatus.ts`
- Create: `src/application/services/ParserRunnerService.ts`

- [ ] **Step 1: Create RunParser use case**

Create `src/application/use-cases/RunParser.ts`:
```ts
import { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import { FileParserLoader } from '../../infrastructure/loader/FileParserLoader.js'

export class RunParser {
  constructor(
    private readonly loader: FileParserLoader,
    private readonly outputDir: string,
  ) {}

  async execute(
    parserName: string,
    onStats: (stats: unknown) => void,
    onComplete: (stats: unknown) => void,
    onPostProcess: (filePath: string) => void,
  ): Promise<ParserOrchestrator> {
    const config = await this.loader.load(parserName)
    const orchestrator = new ParserOrchestrator(config, this.outputDir)
    orchestrator.on('stats', onStats)
    orchestrator.on('complete', onComplete)
    orchestrator.on('postprocess', onPostProcess)
    orchestrator.start().catch(console.error)
    return orchestrator
  }
}
```

- [ ] **Step 2: Create StopParser use case**

Create `src/application/use-cases/StopParser.ts`:
```ts
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'

export class StopParser {
  async execute(orchestrator: ParserOrchestrator): Promise<void> {
    await orchestrator.stop()
  }
}
```

- [ ] **Step 3: Create GetParserStatus use case**

Create `src/application/use-cases/GetParserStatus.ts`:
```ts
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'

export class GetParserStatus {
  execute(orchestrator: ParserOrchestrator): RunStats {
    return orchestrator.getStats()
  }
}
```

- [ ] **Step 4: Create ParserRunnerService**

Create `src/application/services/ParserRunnerService.ts`:
```ts
import { RunParser } from '../use-cases/RunParser.js'
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'

export class ParserRunnerService {
  private activeRuns = new Map<string, ParserOrchestrator>()

  constructor(private readonly runParser: RunParser) {}

  async run(
    parserName: string,
    onStats: (name: string, stats: unknown) => void,
    onComplete: (name: string, stats: unknown) => void,
    onPostProcess: (name: string, filePath: string) => void,
  ): Promise<void> {
    const orchestrator = await this.runParser.execute(
      parserName,
      (stats) => onStats(parserName, stats),
      (stats) => {
        onComplete(parserName, stats)
        this.activeRuns.delete(parserName)
      },
      (filePath) => onPostProcess(parserName, filePath),
    )
    this.activeRuns.set(parserName, orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.stop()
    this.activeRuns.delete(parserName)
  }

  getStatus(parserName: string): unknown {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    return orchestrator.getStats()
  }

  isRunning(parserName: string): boolean {
    return this.activeRuns.has(parserName)
  }
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/ src/application/services/
git commit -m "feat(application): add use cases and ParserRunnerService"
```

---

### Task 17: CLI — ConsoleReporter

**Files:**
- Create: `src/cli/ConsoleReporter.ts`

- [ ] **Step 1: Create ConsoleReporter**

Create `src/cli/ConsoleReporter.ts`:
```ts
import type { RunStats } from '../domain/entities/ParserRun.js'

export class ConsoleReporter {
  private startTimes = new Map<string, number>()

  start(parserName: string): void {
    this.startTimes.set(parserName, Date.now())
    process.stdout.write(`\n[${parserName}] Starting...\n`)
  }

  update(parserName: string, stats: RunStats): void {
    process.stdout.write(
      `\r[${parserName}] Pages: Total ${stats.total} | ` +
        `Success ${stats.success} | Failed ${stats.failed} | ` +
        `Retry ${stats.retry} | In Progress ${stats.inProgress}  `,
    )
  }

  complete(parserName: string, stats: RunStats): void {
    const elapsed = this.formatElapsed(parserName)
    process.stdout.write(
      `\n[${parserName}] Completed in ${elapsed}\n` +
        `  Pages: Total ${stats.total} | Success ${stats.success} | Failed ${stats.failed}\n`,
    )
  }

  postProcess(parserName: string, filePath: string): void {
    process.stdout.write(`  CSV post-processed: ${filePath}\n`)
  }

  error(parserName: string, err: Error): void {
    process.stderr.write(`\n[${parserName}] ERROR: ${err.message}\n`)
  }

  private formatElapsed(parserName: string): string {
    const startTime = this.startTimes.get(parserName)
    if (!startTime) return '?'
    const ms = Date.now() - startTime
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/ConsoleReporter.ts
git commit -m "feat(cli): add ConsoleReporter with live stats"
```

---

### Task 18: CLI — Entry Point

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Create CLI entry point**

Create `src/cli/index.ts`:
```ts
import { program } from 'commander'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import { ConsoleReporter } from './ConsoleReporter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const parsersDir = resolve(__dirname, '../../src/parsers')
const outputDir = resolve(process.cwd(), 'output')

const loader = new FileParserLoader(parsersDir)
const runParser = new RunParser(loader, outputDir)
const runner = new ParserRunnerService(runParser)
const reporter = new ConsoleReporter()

program.name('scraper').description('Universal Playwright scraping platform').version('0.1.0')

program
  .command('run <parsers...>')
  .description('Run one or more parsers concurrently')
  .action(async (parserNames: string[]) => {
    const promises = parserNames.map((name) => {
      reporter.start(name)
      return runner.run(
        name,
        (n, stats) => reporter.update(n, stats as any),
        (n, stats) => reporter.complete(n, stats as any),
        (n, filePath) => reporter.postProcess(n, filePath),
      )
    })

    await Promise.all(promises)

    process.on('SIGINT', async () => {
      for (const name of parserNames) {
        if (runner.isRunning(name)) {
          await runner.stop(name)
        }
      }
      process.exit(0)
    })
  })

program
  .command('stop <parser>')
  .description('Stop a running parser')
  .action(async (parserName: string) => {
    await runner.stop(parserName)
    console.log(`[${parserName}] Stopped.`)
  })

program.parse()
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add commander entry point with run and stop commands"
```

---

### Task 19: Example Parser

**Files:**
- Create: `src/parsers/example/index.ts`

- [ ] **Step 1: Create example parser**

Create `src/parsers/example/index.ts`:
```ts
import { defineParser } from '../../domain/entities/Parser.js'

export default defineParser({
  name: 'example',
  entryUrl: 'https://books.toscrape.com/',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      linkSelector: 'div.side_categories ul li ul li a',
      parentDataSelectors: {
        category: 'div.side_categories ul li ul li a',
      },
      nextStep: 'bookList',
    },
    bookList: {
      type: 'traverser',
      linkSelector: 'article.product_pod h3 a',
      nextPageSelector: 'li.next a',
      nextStep: 'bookDetail',
    },
    bookDetail: {
      type: 'extractor',
      outputFile: 'books.csv',
      dataSelectors: {
        title: 'h1',
        price: 'p.price_color',
        availability: 'p.availability',
        rating: 'p.star-rating',
      },
    },
  },
})
```

- [ ] **Step 2: Run the example parser**

```bash
npx tsx src/cli/index.ts run example
```

Expected: console shows live stats, `output/example/books.csv` is created, `output/example/books.csv.index` is created after completion.

- [ ] **Step 3: Verify output**

```bash
head -5 output/example/books.csv
cat output/example/books.csv.index | head -20
```

Expected: CSV has header + rows with title/price/availability/rating, index has byte offsets.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/example/index.ts
git commit -m "feat(parsers): add example parser targeting books.toscrape.com"
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npx vitest run` — all tests pass
- [ ] `npx tsx src/cli/index.ts run example` — parser runs, console updates live
- [ ] `output/example/books.csv` exists with data rows
- [ ] `output/example/books.csv.index` exists with byte offsets
- [ ] Ctrl+C mid-run — graceful shutdown, no crash
- [ ] `npx tsx src/cli/index.ts run example example` — two instances run concurrently (should warn/handle same name)
