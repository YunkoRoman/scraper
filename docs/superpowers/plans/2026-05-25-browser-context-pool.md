# Browser Context Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "one browser process per worker" model with a per-worker context pool so a single browser process hosts N concurrent contexts. Cuts browser process count from ~200 (100 parsers × 2 steps) to ~100 and RAM footprint by 3-5x, while keeping the `BrowserAdapter` interface unchanged.

**Architecture:** Introduce a `BrowserContextPool<P>` that owns a single browser process and a fixed-size queue of `BrowserContext` slots. A new `PlaywrightPooledAdapter` implements `BrowserAdapter<Page>` by leasing a context per `newPage()` call and releasing it when the page closes. Workers swap `createBrowserAdapter()` for `createPooledBrowserAdapter()` and gain a context-pool size knob; everything downstream (context rotation, init scripts, proxy) keeps working unchanged.

**Tech Stack:** TypeScript, Node.js Worker Threads, Playwright (chromium), Vitest.

---

## File Structure

**New files:**
- `src/infrastructure/browser/BrowserContextPool.ts` — generic FIFO pool of `BrowserContext` slots over a single `Browser`
- `src/infrastructure/browser/PlaywrightPooledAdapter.ts` — `BrowserAdapter<Page>` implementation backed by `BrowserContextPool`
- `src/infrastructure/browser/PlaywrightStealthPooledAdapter.ts` — same pattern, stealth chromium
- `src/__tests__/infrastructure/browser/BrowserContextPool.test.ts` — Vitest tests for the pool

**Modified files:**
- `src/domain/value-objects/StepSettings.ts` — add `contextPoolSize?: number`
- `src/infrastructure/browser/BrowserAdapter.ts` — add `createPooledBrowserAdapter()` factory + `PooledBrowserAdapter` marker type
- `src/infrastructure/worker/ExtractorWorker.ts` — switch to `createPooledBrowserAdapter()`, pass `contextPoolSize`
- `src/infrastructure/worker/TraverserWorker.ts` — same change as ExtractorWorker
- `src/infrastructure/worker/mergeWorkerSettings.ts` — propagate `contextPoolSize`

---

### Task 1: Add `contextPoolSize` to `StepSettings`

**Files:**
- Modify: `src/domain/value-objects/StepSettings.ts`
- Modify: `src/infrastructure/worker/mergeWorkerSettings.ts`

- [ ] **Step 1: Add the field to `StepSettings`**

Open `src/domain/value-objects/StepSettings.ts` and add a `contextPoolSize` field next to `maxPagesPerContext`:

```ts
export interface StepSettings {
  browser_type?: BrowserType
  concurrency?: number
  pageDelayMin?: number
  pageDelayMax?: number
  maxPagesPerContext?: number
  /** Number of BrowserContext slots reused per browser process. Defaults to `concurrency`. */
  contextPoolSize?: number
  launchOptions?: LaunchOptions
  contextOptions?: BrowserContextOptions
  initScripts?: string[]
  userAgent?: string
  proxySettings?: ProxySettings
  outputFormat?: 'csv' | 'json' | 'ndjson'
}
```

(Keep existing fields verbatim — only add `contextPoolSize`. If `outputFormat` does not exist in your tree, leave it untouched.)

- [ ] **Step 2: Verify merge passes `contextPoolSize` through**

`mergeWorkerSettings` uses object spread so the field flows naturally, but add an explicit comment so reviewers see it:

```ts
// src/infrastructure/worker/mergeWorkerSettings.ts
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'
import { buildContextOptions } from './buildContextOptions.js'

export function mergeWorkerSettings(
  browserSettings: StepSettings | undefined,
  stepSettings: StepSettings | undefined,
): StepSettings {
  return {
    ...browserSettings,
    ...stepSettings, // step-level wins for contextPoolSize, concurrency, etc.
    contextOptions: buildContextOptions(browserSettings, stepSettings),
    initScripts: [
      ...(browserSettings?.initScripts ?? []),
      ...(stepSettings?.initScripts ?? []),
    ],
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/domain/value-objects/StepSettings.ts src/infrastructure/worker/mergeWorkerSettings.ts
git commit -m "feat(domain): add contextPoolSize to StepSettings"
```

---

### Task 2: Implement `BrowserContextPool`

**Files:**
- Create: `src/infrastructure/browser/BrowserContextPool.ts`
- Create: `src/__tests__/infrastructure/browser/BrowserContextPool.test.ts`

- [ ] **Step 1: Write the pool**

```ts
// src/infrastructure/browser/BrowserContextPool.ts
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright'

export interface PageLease {
  page: Page
  /** Releases the underlying context back to the pool. Closes the page first. */
  release(): Promise<void>
}

/**
 * Owns one Browser process and a fixed number of BrowserContext slots.
 * Callers call `acquirePage()` to get a `{ page, release }` pair.
 * Releasing returns the context to the pool; the page is closed automatically.
 *
 * Init scripts are added once per context the first time the slot is created
 * and re-added if a context is recycled.
 */
export class BrowserContextPool {
  private contexts: BrowserContext[] = []
  private waiters: ((ctx: BrowserContext) => void)[] = []
  private initScripts: string[] = []
  private closed = false

  constructor(
    private readonly browser: Browser,
    private readonly size: number,
    private readonly contextOptions: BrowserContextOptions = {},
  ) {
    if (size < 1) throw new Error(`BrowserContextPool size must be >= 1, got ${size}`)
  }

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script)
    for (const ctx of this.contexts) {
      await ctx.addInitScript(script)
    }
  }

  private async createContext(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(this.contextOptions)
    for (const script of this.initScripts) {
      await ctx.addInitScript(script)
    }
    return ctx
  }

  private async acquireContext(): Promise<BrowserContext> {
    if (this.closed) throw new Error('BrowserContextPool is closed')
    if (this.contexts.length > 0) {
      return this.contexts.shift()!
    }
    // Lazy-fill: total ever created tracked implicitly via waiters length
    const inFlight = this.size - this.contexts.length - this.waiters.length
    if (inFlight > 0) {
      return this.createContext()
    }
    return new Promise<BrowserContext>((resolve) => this.waiters.push(resolve))
  }

  private releaseContext(ctx: BrowserContext): void {
    if (this.closed) {
      ctx.close().catch(() => {})
      return
    }
    const next = this.waiters.shift()
    if (next) {
      next(ctx)
    } else {
      this.contexts.push(ctx)
    }
  }

  async acquirePage(): Promise<PageLease> {
    const ctx = await this.acquireContext()
    let page: Page
    try {
      page = await ctx.newPage()
    } catch (err) {
      // If the context is dead, replace it and retry once.
      await ctx.close().catch(() => {})
      const fresh = await this.createContext()
      page = await fresh.newPage()
      return {
        page,
        release: async () => {
          await page.close().catch(() => {})
          this.releaseContext(fresh)
        },
      }
    }
    return {
      page,
      release: async () => {
        await page.close().catch(() => {})
        this.releaseContext(ctx)
      },
    }
  }

  async close(): Promise<void> {
    this.closed = true
    // Wake any waiters so they don't hang
    for (const w of this.waiters) {
      w(null as unknown as BrowserContext)
    }
    this.waiters = []
    await Promise.all(this.contexts.map((c) => c.close().catch(() => {})))
    this.contexts = []
    await this.browser.close().catch(() => {})
  }

  /** Current number of idle contexts. Exposed for tests. */
  get idle(): number {
    return this.contexts.length
  }

  /** Number of pending acquirers. Exposed for tests. */
  get pending(): number {
    return this.waiters.length
  }
}
```

- [ ] **Step 2: Write Vitest tests**

```ts
// src/__tests__/infrastructure/browser/BrowserContextPool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserContextPool } from '../../../infrastructure/browser/BrowserContextPool.js'

function makeFakePage() {
  return { close: vi.fn(async () => {}) }
}

function makeFakeContext(opts?: { failNewPage?: boolean }) {
  const pages: ReturnType<typeof makeFakePage>[] = []
  return {
    newPage: vi.fn(async () => {
      if (opts?.failNewPage) throw new Error('context dead')
      const p = makeFakePage()
      pages.push(p)
      return p
    }),
    addInitScript: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    pages,
  }
}

function makeFakeBrowser() {
  const contexts: ReturnType<typeof makeFakeContext>[] = []
  return {
    newContext: vi.fn(async () => {
      const c = makeFakeContext()
      contexts.push(c)
      return c
    }),
    close: vi.fn(async () => {}),
    contexts,
  }
}

describe('BrowserContextPool', () => {
  let browser: ReturnType<typeof makeFakeBrowser>

  beforeEach(() => {
    browser = makeFakeBrowser()
  })

  it('throws if size < 1', () => {
    expect(() => new BrowserContextPool(browser as never, 0)).toThrow(/size must be >= 1/)
  })

  it('lazy-creates contexts up to size', async () => {
    const pool = new BrowserContextPool(browser as never, 2)
    const a = await pool.acquirePage()
    const b = await pool.acquirePage()
    expect(browser.newContext).toHaveBeenCalledTimes(2)
    await a.release()
    await b.release()
  })

  it('reuses released contexts', async () => {
    const pool = new BrowserContextPool(browser as never, 1)
    const a = await pool.acquirePage()
    await a.release()
    const b = await pool.acquirePage()
    expect(browser.newContext).toHaveBeenCalledTimes(1)
    await b.release()
  })

  it('queues acquirers when pool is exhausted', async () => {
    const pool = new BrowserContextPool(browser as never, 1)
    const a = await pool.acquirePage()
    const pendingB = pool.acquirePage()
    expect(pool.pending).toBe(1)
    await a.release()
    const b = await pendingB
    expect(browser.newContext).toHaveBeenCalledTimes(1)
    await b.release()
  })

  it('replays init scripts on fresh contexts', async () => {
    const pool = new BrowserContextPool(browser as never, 2)
    await pool.addInitScript('window.__x = 1')
    const a = await pool.acquirePage()
    const b = await pool.acquirePage()
    expect(browser.contexts[0].addInitScript).toHaveBeenCalledWith('window.__x = 1')
    expect(browser.contexts[1].addInitScript).toHaveBeenCalledWith('window.__x = 1')
    await a.release()
    await b.release()
  })

  it('replaces a dead context on newPage failure', async () => {
    // Make the first context throw on newPage, the second succeed.
    let call = 0
    browser.newContext = vi.fn(async () => {
      call++
      if (call === 1) return makeFakeContext({ failNewPage: true }) as never
      return makeFakeContext() as never
    })
    const pool = new BrowserContextPool(browser as never, 1)
    const lease = await pool.acquirePage()
    expect(browser.newContext).toHaveBeenCalledTimes(2)
    await lease.release()
  })

  it('closes all contexts and the browser on close()', async () => {
    const pool = new BrowserContextPool(browser as never, 2)
    const a = await pool.acquirePage()
    await a.release()
    await pool.close()
    expect(browser.close).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/__tests__/infrastructure/browser/BrowserContextPool.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/browser/BrowserContextPool.ts src/__tests__/infrastructure/browser/BrowserContextPool.test.ts
git commit -m "feat(browser): add BrowserContextPool for multi-context reuse"
```

---

### Task 3: Implement `PlaywrightPooledAdapter`

**Files:**
- Create: `src/infrastructure/browser/PlaywrightPooledAdapter.ts`
- Create: `src/infrastructure/browser/PlaywrightStealthPooledAdapter.ts`

- [ ] **Step 1: Write the Playwright pooled adapter**

```ts
// src/infrastructure/browser/PlaywrightPooledAdapter.ts
import { chromium, type Browser, type LaunchOptions, type BrowserContextOptions, type Page } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'
import { BrowserContextPool } from './BrowserContextPool.js'

/**
 * BrowserAdapter implementation that fronts a `BrowserContextPool`.
 * `newPage()` returns a Playwright Page whose `close()` is monkey-patched
 * to also release the underlying context back to the pool. This keeps
 * existing worker code (`page.close()` in finally blocks) unchanged.
 */
export class PlaywrightPooledAdapter implements BrowserAdapter<Page> {
  private browser: Browser | null = null
  private pool: BrowserContextPool | null = null

  constructor(
    private readonly poolSize: number,
    private readonly launchOptions: LaunchOptions = {},
    private readonly contextOptions: BrowserContextOptions = {},
  ) {}

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true, ...this.launchOptions })
    this.pool = new BrowserContextPool(this.browser, this.poolSize, {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...this.contextOptions,
    })
  }

  async addInitScript(script: string): Promise<void> {
    if (!this.pool) throw new Error('PlaywrightPooledAdapter not launched')
    await this.pool.addInitScript(script)
  }

  async newPage(): Promise<Page> {
    if (!this.pool) throw new Error('PlaywrightPooledAdapter not launched')
    const lease = await this.pool.acquirePage()
    const originalClose = lease.page.close.bind(lease.page)
    // Wrap close() so workers releasing the page also release the context.
    ;(lease.page as Page & { close: () => Promise<void> }).close = async () => {
      // Swallow double-close: release() already closes the page.
      void originalClose
      await lease.release()
    }
    return lease.page
  }

  async close(): Promise<void> {
    await this.pool?.close()
    this.pool = null
    this.browser = null
  }
}
```

- [ ] **Step 2: Write the stealth variant**

```ts
// src/infrastructure/browser/PlaywrightStealthPooledAdapter.ts
import type { Browser, LaunchOptions, BrowserContextOptions, Page } from 'playwright'
import type { BrowserAdapter } from './BrowserAdapter.js'
import { BrowserContextPool } from './BrowserContextPool.js'

export class PlaywrightStealthPooledAdapter implements BrowserAdapter<Page> {
  private browser: Browser | null = null
  private pool: BrowserContextPool | null = null

  constructor(
    private readonly poolSize: number,
    private readonly launchOptions: LaunchOptions = {},
    private readonly contextOptions: BrowserContextOptions = {},
  ) {}

  async launch(): Promise<void> {
    const { chromium } = await import('playwright-extra')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth' as any)
    chromium.use(StealthPlugin())
    this.browser = (await chromium.launch({ headless: true, ...this.launchOptions })) as Browser
    this.pool = new BrowserContextPool(this.browser, this.poolSize, {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...this.contextOptions,
    })
  }

  async addInitScript(script: string): Promise<void> {
    if (!this.pool) throw new Error('PlaywrightStealthPooledAdapter not launched')
    await this.pool.addInitScript(script)
  }

  async newPage(): Promise<Page> {
    if (!this.pool) throw new Error('PlaywrightStealthPooledAdapter not launched')
    const lease = await this.pool.acquirePage()
    const originalClose = lease.page.close.bind(lease.page)
    ;(lease.page as Page & { close: () => Promise<void> }).close = async () => {
      void originalClose
      await lease.release()
    }
    return lease.page
  }

  async close(): Promise<void> {
    await this.pool?.close()
    this.pool = null
    this.browser = null
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/browser/PlaywrightPooledAdapter.ts src/infrastructure/browser/PlaywrightStealthPooledAdapter.ts
git commit -m "feat(browser): add pooled Playwright adapters backed by BrowserContextPool"
```

---

### Task 4: Add `createPooledBrowserAdapter` factory

**Files:**
- Modify: `src/infrastructure/browser/BrowserAdapter.ts`

- [ ] **Step 1: Add the factory**

Replace the contents of `src/infrastructure/browser/BrowserAdapter.ts` with:

```ts
import type { BrowserType, StepSettings } from '../../domain/value-objects/StepSettings.js'
import { PlaywrightAdapter } from './PlaywrightAdapter.js'
import { PlaywrightStealthAdapter } from './PlaywrightStealthAdapter.js'
import { PuppeteerAdapter } from './PuppeteerAdapter.js'
import { PlaywrightPooledAdapter } from './PlaywrightPooledAdapter.js'
import { PlaywrightStealthPooledAdapter } from './PlaywrightStealthPooledAdapter.js'

export interface BrowserAdapter<P> {
  launch(): Promise<void>
  newPage(): Promise<P>
  close(): Promise<void>
}

// ── Legacy single-context factory (kept for Puppeteer and back-compat) ──
export function createBrowserAdapter(browserType: 'puppeteer', settings?: StepSettings): BrowserAdapter<import('puppeteer').Page>
export function createBrowserAdapter(browserType?: 'playwright' | 'playwright-stealth' | undefined, settings?: StepSettings): BrowserAdapter<import('playwright').Page>
export function createBrowserAdapter(browserType?: BrowserType, settings?: StepSettings): BrowserAdapter<import('playwright').Page | import('puppeteer').Page>
export function createBrowserAdapter(browserType?: BrowserType, settings?: StepSettings): BrowserAdapter<unknown> {
  if (browserType === 'puppeteer') return new PuppeteerAdapter()
  if (browserType === 'playwright-stealth') return new PlaywrightStealthAdapter(settings?.launchOptions, settings?.contextOptions)
  return new PlaywrightAdapter(settings?.launchOptions, settings?.contextOptions)
}

// ── Pooled factory ──
/**
 * Build a context-pooled adapter. `poolSize` defaults to `settings.contextPoolSize`,
 * falling back to `settings.concurrency`, then 3.
 * For Puppeteer (no context support in this codebase), falls back to the legacy single-browser adapter.
 */
export function createPooledBrowserAdapter(
  browserType?: BrowserType,
  settings?: StepSettings,
): BrowserAdapter<unknown> {
  const poolSize = settings?.contextPoolSize ?? settings?.concurrency ?? 3
  if (browserType === 'puppeteer') return new PuppeteerAdapter()
  if (browserType === 'playwright-stealth') {
    return new PlaywrightStealthPooledAdapter(poolSize, settings?.launchOptions, settings?.contextOptions)
  }
  return new PlaywrightPooledAdapter(poolSize, settings?.launchOptions, settings?.contextOptions)
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/browser/BrowserAdapter.ts
git commit -m "feat(browser): add createPooledBrowserAdapter factory"
```

---

### Task 5: Switch workers to the pooled adapter

**Files:**
- Modify: `src/infrastructure/worker/ExtractorWorker.ts`
- Modify: `src/infrastructure/worker/TraverserWorker.ts`

- [ ] **Step 1: Update ExtractorWorker imports and adapter creation**

In `src/infrastructure/worker/ExtractorWorker.ts`:

Change the import:

```ts
import {createBrowserAdapter, createPooledBrowserAdapter} from "../browser/BrowserAdapter.js";
```

Change the initial adapter assignment near the top of the file from:

```ts
let adapter: BrowserAdapter<any> = createBrowserAdapter();
```

to:

```ts
let adapter: BrowserAdapter<any> = createPooledBrowserAdapter();
```

Change the launch in `main()` from:

```ts
adapter = createBrowserAdapter(mergedSettings.browser_type, initialSettings);
```

to:

```ts
adapter = createPooledBrowserAdapter(mergedSettings.browser_type, initialSettings);
```

And inside `rotateAdapter()`, change:

```ts
adapter = createBrowserAdapter(savedSettings.browser_type, settingsForLaunch);
```

to:

```ts
adapter = createPooledBrowserAdapter(savedSettings.browser_type, settingsForLaunch);
```

- [ ] **Step 2: Mirror the changes in TraverserWorker**

Apply the exact same four substitutions in `src/infrastructure/worker/TraverserWorker.ts`.

- [ ] **Step 3: Update `addInitScript` casts**

The `addInitScript` cast `as import("../browser/PlaywrightAdapter.js").PlaywrightAdapter` still works at runtime because both pooled adapters expose the same method shape, but the type assertion is misleading. In both workers, replace the two occurrences:

```ts
const pa = adapter as import("../browser/PlaywrightAdapter.js").PlaywrightAdapter;
```

with:

```ts
const pa = adapter as { addInitScript: (script: string) => Promise<void> };
```

- [ ] **Step 4: Run typecheck and existing tests**

```bash
npx tsc --noEmit
npm run test -- --run
```

Expected: typecheck clean; existing tests still green.

- [ ] **Step 5: Smoke-test end-to-end**

```bash
npm run db:migrate
npm run start
```

In another shell, start a small seeded parser via the API:

```bash
curl -X POST http://localhost:3001/api/parsers/example/start
```

Expected logs include `[worker] Rotating browser context…` once `maxPagesPerContext` is reached (if configured); only **one** `chromium.launch()` per worker (visible by counting child chromium processes with `pgrep -af "chrome.*--type=" | wc -l` before/after — should be roughly half what it was previously for the same parser).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/worker/ExtractorWorker.ts src/infrastructure/worker/TraverserWorker.ts
git commit -m "refactor(worker): use pooled browser adapter to share one browser across contexts"
```

---

### Task 6: Document the new pattern in design-log

**Files:**
- Create: `design-log/NNN-browser-context-pool.md` (replace `NNN` with the next available number)
- Modify: `design-log/index.md`

- [ ] **Step 1: Pick the next log number**

```bash
ls design-log | grep -E '^[0-9]+-' | sort | tail -5
```

Use the next free integer (zero-padded to 3 digits).

- [ ] **Step 2: Write the entry**

Sections required (per project CLAUDE.md): Background, Problem, Design, Questions and Answers, Trade-offs, Implementation Results. Cover:
- Background: per-worker browser process model and its RAM/process-count cost.
- Problem: 100+ parsers ⇒ 200+ chromium processes ⇒ 40-80 GB RAM.
- Design: `BrowserContextPool` + `PlaywrightPooledAdapter` + `createPooledBrowserAdapter` factory. Page `close()` monkey-patched to release the context.
- Q&A: why per-worker pool and not main-thread pool (worker_threads can't share object refs without `MessageChannel`; per-worker is achievable without IPC churn). Note the main-thread pool option as future work.
- Trade-offs: contexts share storage state across tasks within a worker but not across workers; one bad page can take down a context (mitigated by `acquirePage`'s replace-on-failure path).
- Implementation Results: file paths touched, test coverage, observed RAM reduction in smoke test.

- [ ] **Step 3: Append a row to `design-log/index.md`**

Add a row matching the existing table format:

```md
| NNN | [Browser Context Pool](NNN-browser-context-pool.md) | Implemented | Per-worker context pool replaces one-browser-per-worker model |
```

- [ ] **Step 4: Commit**

```bash
git add design-log/
git commit -m "docs(design-log): add browser context pool entry"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full test run**

```bash
npm run test -- --run
```

Expected: all tests green, including the new `BrowserContextPool` suite.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Sanity check process count**

Run a parser with 4 steps and `contextPoolSize: 5`:

```bash
pgrep -af "Helper.*Renderer|chrome.*--type=renderer" | wc -l
```

Expected: roughly `4 × (1 browser process + ~5 renderer processes)` instead of the previous `4 × (1 browser × concurrency renderers)`. The dominant savings are the browser parent processes (one per worker instead of one per `rotateAdapter()` cycle in legacy mode).
