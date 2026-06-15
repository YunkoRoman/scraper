# FlareSolverr `solveCF` Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a `solveCF(url)` async helper inside every step's execution context so users can bypass Cloudflare blocks by calling FlareSolverr on demand, without FlareSolverr being the primary browser.

**Architecture:** A `makeSolveCFSnippet(url)` function generates a self-contained JS function declaration string that is prepended to step code before `AsyncFunction` construction in both workers. `FLARESOLVERR_URL` is read from env at worker boot; if unset, calling `solveCF` throws a descriptive error. DebugStepRunner spawns the same workers, so it gets `solveCF` for free. The UI shows a helper hint banner above the Monaco editor and updates the step code templates.

**Tech Stack:** Node.js `fetch` (built-in ≥18), FlareSolverr REST API (`POST /v1`), TypeScript, Vitest, React + Tailwind

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/infrastructure/flaresolverr/FlareSolverrService.ts` | `makeSolveCFSnippet(url)` — generates JS string defining `solveCF` |
| Create | `tests/infrastructure/FlareSolverrService.test.ts` | Unit tests for snippet generation |
| Modify | `src/infrastructure/worker/TraverserWorker.ts:162` | Prepend snippet to step code |
| Modify | `src/infrastructure/worker/ExtractorWorker.ts:167` | Prepend snippet to step code |
| Modify | `.env.example` | Document `FLARESOLVERR_URL` |
| Modify | `client/src/pages/ParserEditorPage/index.tsx` | Update templates + add helper hint banner |

---

## Task 1: FlareSolverrService — snippet generator

**Files:**
- Create: `src/infrastructure/flaresolverr/FlareSolverrService.ts`
- Create: `tests/infrastructure/FlareSolverrService.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/infrastructure/FlareSolverrService.test.ts
import { describe, it, expect } from 'vitest'
import { makeSolveCFSnippet } from '../../src/infrastructure/flaresolverr/FlareSolverrService'

describe('makeSolveCFSnippet', () => {
  it('returns a string containing an async solveCF function declaration', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('async function solveCF')
  })

  it('embeds the provided URL into the snippet', () => {
    const snippet = makeSolveCFSnippet('http://localhost:8191')
    expect(snippet).toContain('http://localhost:8191')
  })

  it('snippet defines a callable function when evaluated', async () => {
    const snippet = makeSolveCFSnippet('')
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => () => Promise<unknown>
    // Should not throw on construction
    expect(() => new AsyncFunction(snippet + '\nreturn typeof solveCF')).not.toThrow()
  })

  it('calling solveCF with no FLARESOLVERR_URL throws descriptive error', async () => {
    const snippet = makeSolveCFSnippet('')  // empty URL = not configured
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => () => Promise<unknown>
    const fn = new AsyncFunction(snippet + '\nreturn await solveCF("https://example.com")')
    await expect(fn()).rejects.toThrow('FLARESOLVERR_URL')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ryunko/Desktop/Projects/scraper
npm run test -- tests/infrastructure/FlareSolverrService.test.ts
```

Expected: FAIL — `FlareSolverrService` not found.

- [ ] **Step 3: Implement the service**

```ts
// src/infrastructure/flaresolverr/FlareSolverrService.ts

/**
 * Generates a self-contained JS snippet that defines solveCF(url) for injection
 * into step execution context. The snippet is prepended to user step code before
 * AsyncFunction construction so `solveCF` is available without any signature change.
 *
 * FlareSolverr API: POST /v1  { cmd: 'request.get', url, maxTimeout }
 * Returns solution.response (full page HTML string).
 */
export function makeSolveCFSnippet(flareSolverrUrl: string): string {
  return `
async function solveCF(url) {
  const __fsUrl = ${JSON.stringify(flareSolverrUrl)};
  if (!__fsUrl) throw new Error('solveCF: FLARESOLVERR_URL env var not set — start FlareSolverr and add it to .env');
  const __res = await fetch(__fsUrl + '/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 })
  });
  if (!__res.ok) throw new Error('solveCF: FlareSolverr HTTP error ' + __res.status);
  const __data = await __res.json();
  if (__data.solution?.status !== 'ok') throw new Error('solveCF: ' + (__data.message ?? 'FlareSolverr returned non-ok status'));
  return __data.solution.response;
}
`
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npm run test -- tests/infrastructure/FlareSolverrService.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/flaresolverr/FlareSolverrService.ts tests/infrastructure/FlareSolverrService.test.ts
git commit -m "feat(flaresolverr): add makeSolveCFSnippet service with tests"
```

---

## Task 2: Inject `solveCF` into TraverserWorker

**Files:**
- Modify: `src/infrastructure/worker/TraverserWorker.ts` (around line 162)

- [ ] **Step 1: Read the current AsyncFunction call**

Open `src/infrastructure/worker/TraverserWorker.ts` and locate:
```ts
const run = new AsyncFunction('page', 'task', data.stepCode)
```
This is in the `else` branch of the `if ('parserFilePath' in data)` block (around line 162).

- [ ] **Step 2: Add the import and modify the AsyncFunction call**

At the top of the file, add the import after the existing imports:
```ts
import { makeSolveCFSnippet } from '../flaresolverr/FlareSolverrService.js'
```

Then replace the `AsyncFunction` call in the `else` branch:
```ts
// Before:
const run = new AsyncFunction('page', 'task', data.stepCode)

// After:
const solveCFSnippet = makeSolveCFSnippet(process.env.FLARESOLVERR_URL ?? '')
const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/worker/TraverserWorker.ts
git commit -m "feat(flaresolverr): inject solveCF into TraverserWorker step context"
```

---

## Task 3: Inject `solveCF` into ExtractorWorker

**Files:**
- Modify: `src/infrastructure/worker/ExtractorWorker.ts` (around line 167)

- [ ] **Step 1: Read the current AsyncFunction call**

Open `src/infrastructure/worker/ExtractorWorker.ts` and locate:
```ts
const run = new AsyncFunction('page', 'task', data.stepCode)
```
This is in the `else` branch (around line 167).

- [ ] **Step 2: Add import and modify AsyncFunction call**

At the top of the file, add the import after existing imports:
```ts
import { makeSolveCFSnippet } from '../flaresolverr/FlareSolverrService.js'
```

Replace the `AsyncFunction` call in the `else` branch:
```ts
// Before:
const run = new AsyncFunction('page', 'task', data.stepCode)

// After:
const solveCFSnippet = makeSolveCFSnippet(process.env.FLARESOLVERR_URL ?? '')
const run = new AsyncFunction('page', 'task', solveCFSnippet + '\n' + data.stepCode)
```

- [ ] **Step 3: Build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/worker/ExtractorWorker.ts
git commit -m "feat(flaresolverr): inject solveCF into ExtractorWorker step context"
```

---

## Task 4: Document env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add FLARESOLVERR_URL to .env.example**

Open `.env.example` and add at the end:
```
# FlareSolverr — bypass Cloudflare managed challenges in step code via solveCF(url)
# Start with: docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr
FLARESOLVERR_URL=http://localhost:8191
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add FLARESOLVERR_URL to .env.example"
```

---

## Task 5: UI — helper hint in editor + update step templates

**Files:**
- Modify: `client/src/pages/ParserEditorPage/index.tsx`

- [ ] **Step 1: Update step code templates (lines 19-27)**

Replace the existing `TRAVERSER_TEMPLATE` and `EXTRACTOR_TEMPLATE` constants:

```ts
const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
// solveCF(url): bypasses Cloudflare — returns HTML string (requires FLARESOLVERR_URL env)
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
// solveCF(url): bypasses Cloudflare — returns HTML string (requires FLARESOLVERR_URL env)
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`
```

- [ ] **Step 2: Add helper hint banner above Monaco editor**

Find the `<div className="relative flex flex-1 overflow-hidden min-h-0">` (around line 520) and add a hint banner just before it:

```tsx
{/* Helper hint */}
<div className="px-3 py-1.5 bg-blue-950/40 border-b border-blue-800/30 text-xs text-blue-300 flex items-center gap-2 flex-shrink-0">
  <span className="font-mono font-semibold text-blue-200">solveCF(url)</span>
  <span className="text-blue-400">—</span>
  <span>bypasses Cloudflare via FlareSolverr and returns the page HTML.</span>
  <span className="text-blue-500 ml-1">Usage:</span>
  <code className="font-mono text-blue-200 bg-blue-900/40 px-1 rounded">
    const html = await solveCF(task.url); await page.setContent(html);
  </code>
  <a
    href="https://github.com/FlareSolverr/FlareSolverr"
    target="_blank"
    rel="noopener noreferrer"
    className="ml-auto text-blue-500 hover:text-blue-300 transition-colors"
  >
    Setup ↗
  </a>
</div>
```

The placement should be inside the step editor panel, directly above the `<div className="relative flex flex-1 overflow-hidden min-h-0">` that wraps the Monaco `<Editor>`.

- [ ] **Step 3: Verify the UI renders correctly**

```bash
npm run start
```

Open `http://localhost:5173`, navigate to a parser's editor, select a step. Confirm:
- Blue hint banner is visible above the Monaco editor
- Banner shows `solveCF(url)` and usage example
- "Setup ↗" link is clickable

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ParserEditorPage/index.tsx
git commit -m "feat(flaresolverr): add solveCF helper hint in step editor UI"
```

---

## Self-Review

**Spec coverage:**
- ✅ `solveCF(url)` available in traverser step code (Task 2)
- ✅ `solveCF(url)` available in extractor step code (Task 3)
- ✅ `FLARESOLVERR_URL` env var configures the endpoint (Task 1)
- ✅ Descriptive error when env var not set (Task 1 — tested)
- ✅ HTML returned directly from FlareSolverr (Task 1 — `solution.response`)
- ✅ UI instructions in editor (Task 5)
- ✅ Docker start command documented (Task 4)
- ✅ DebugStepRunner covered — it spawns the same workers, inherits for free

**Placeholder scan:** None found.

**Type consistency:** `makeSolveCFSnippet` called consistently with `process.env.FLARESOLVERR_URL ?? ''` in both workers. Import path `'../flaresolverr/FlareSolverrService.js'` correct for both worker locations inside `src/infrastructure/worker/`.
