# Debug Step Runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow running a single parser step against a specific URL for debugging, with a dedicated client page showing live logs and results as JSON.

**Architecture:** A new `DebugStepRunner` use-case spawns exactly one Worker Thread for the chosen step, sends a single task, and streams `LOG` / result / done events to the caller via EventEmitter. The API exposes this as a `POST` SSE endpoint. The client page uses a `fetch` + readable-stream consumer (no EventSource, since EventSource is GET-only) to display live logs and final JSON results.

**Tech Stack:** Node.js Worker Threads, Express SSE, React 19 + Tailwind CSS, no new dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/application/use-cases/DebugStepRunner.ts` | Spawns one worker, runs one task, emits log/result/done/error |
| Modify | `src/api/server.ts` | Add `GET /api/parsers/:name/steps` + `POST /api/parsers/:name/steps/:step/debug` |
| Modify | `client/src/api.ts` | Add `listSteps()`, `StepInfo`, `TraverserResult` types |
| Create | `client/src/hooks/useDebugRun.ts` | Fetch POST + stream parse, state: logs/result/status |
| Create | `client/src/components/JsonEditor.tsx` | Textarea with inline JSON validation error |
| Create | `client/src/components/DebugPage.tsx` | Full debug UI: selectors, editor, console, results |
| Modify | `client/src/App.tsx` | Hash-based routing (`#/` parsers, `#/debug`), nav tabs |

---

## Task 1: `DebugStepRunner` use-case

**Files:**
- Create: `src/application/use-cases/DebugStepRunner.ts`

- [ ] **Step 1: Create the file**

```ts
// src/application/use-cases/DebugStepRunner.ts
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { FileParserLoader } from '../../infrastructure/loader/FileParserLoader.js'
import { createPageTask } from '../../domain/entities/PageTask.js'
import type { WorkerOutMessage } from '../../infrastructure/worker/messages.js'
import type { TraverserResult } from '../../domain/value-objects/TraverserResult.js'
import type { StepName } from '../../domain/value-objects/StepName.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isTsx = __filename.endsWith('.ts')

export type DebugResult =
  | { type: 'links'; items: TraverserResult[] }
  | { type: 'data'; rows: Record<string, unknown>[]; outputFile: string }

export class DebugStepRunner extends EventEmitter {
  private worker: Worker | null = null
  private pendingReject: ((reason: string) => void) | null = null

  constructor(private readonly loader: FileParserLoader) {
    super()
  }

  async run(
    parserName: string,
    stepName: string,
    url: string,
    parentData?: Record<string, unknown>,
  ): Promise<void> {
    const config = await this.loader.load(parserName)
    const step = config.steps.get(stepName as StepName)
    if (!step) throw new Error(`Step "${stepName}" not found in parser "${parserName}"`)
    if (!config.filePath) throw new Error('filePath missing — use FileParserLoader')

    const task = createPageTask(url, stepName as StepName, step.type, config.retryConfig, undefined, parentData)

    const bootstrapFile = resolve(__dirname, '../../infrastructure/worker/worker-bootstrap.js')
    const tsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.ts')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.ts')
    const jsFile = step.type === 'traverser'
      ? resolve(__dirname, '../../infrastructure/worker/TraverserWorker.js')
      : resolve(__dirname, '../../infrastructure/worker/ExtractorWorker.js')

    const entryFile = isTsx ? bootstrapFile : jsFile
    const workerData = isTsx
      ? { parserFilePath: config.filePath, stepName, __workerPath: tsFile, browserSettings: config.browserSettings }
      : { parserFilePath: config.filePath, stepName, browserSettings: config.browserSettings }

    return new Promise((resolve, reject) => {
      this.pendingReject = reject
      const worker = new Worker(entryFile, { workerData })
      this.worker = worker

      worker.on('message', (msg: WorkerOutMessage) => {
        switch (msg.type) {
          case 'LOG':
            this.emit('log', { level: msg.level, stepName: msg.stepName, args: msg.args })
            break
          case 'LINKS_DISCOVERED':
            this.emit('result', { type: 'links', items: msg.items } satisfies DebugResult)
            break
          case 'DATA_EXTRACTED':
            this.emit('result', { type: 'data', rows: msg.rows, outputFile: msg.outputFile } satisfies DebugResult)
            break
          case 'PAGE_SUCCESS':
            this._cleanup()
            resolve()
            break
          case 'PAGE_FAILED':
            this._cleanup()
            reject(msg.error)
            break
        }
      })

      worker.on('error', (err) => {
        this._cleanup()
        reject(err.message)
      })

      worker.postMessage({ type: 'PROCESS_PAGE', task })
    })
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate()
      this._cleanup()
    }
  }

  private _cleanup(): void {
    this.worker = null
    this.pendingReject?.('aborted')
    this.pendingReject = null
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors for `DebugStepRunner.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/application/use-cases/DebugStepRunner.ts
git commit -m "feat(debug): add DebugStepRunner use-case — spawns one worker, runs one URL"
```

---

## Task 2: API endpoints

**Files:**
- Modify: `src/api/server.ts`

Add two endpoints after the existing `/files/:file` route, before the `PORT` declaration.

- [ ] **Step 1: Add `GET /api/parsers/:name/steps`**

Insert after line `app.get('/api/parsers/:name/files/:file', ...` block (around line 129):

```ts
app.get('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  try {
    const config = await loader.load(name)
    const steps = [...config.steps.entries()].map(([sName, step]) => ({
      name: sName,
      type: step.type,
    }))
    res.json({ steps })
  } catch (err) {
    res.status(404).json({ error: (err as Error).message })
  }
})
```

- [ ] **Step 2: Add import for `DebugStepRunner` at top of server.ts**

After the existing imports (after line 11 `import type { Response } from 'express'`):

```ts
import { DebugStepRunner } from '../application/use-cases/DebugStepRunner.js'
```

- [ ] **Step 3: Add `POST /api/parsers/:name/steps/:step/debug` SSE endpoint**

Insert after the `/steps` endpoint:

```ts
app.post('/api/parsers/:name/steps/:step/debug', async (req, res) => {
  const { name, step } = req.params
  const { url, parentData } = req.body as { url: string; parentData?: Record<string, unknown> }

  if (!url) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (payload: object) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

  const debugRunner = new DebugStepRunner(loader)
  debugRunner.on('log', (log) => send({ type: 'log', ...log }))
  debugRunner.on('result', (result) => send({ type: 'result', result }))
  req.on('close', () => debugRunner.stop())

  try {
    await debugRunner.run(name, step, url, parentData)
    send({ type: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message !== 'aborted') send({ type: 'error', error: message })
  } finally {
    res.end()
  }
})
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Smoke test the steps endpoint manually**

```bash
# Start server in one terminal:
npx tsx src/api/server.ts &
sleep 3
curl http://localhost:3001/api/parsers/example/steps
# Expected: {"steps":[{"name":"categoryList","type":"traverser"},{"name":"bookList","type":"traverser"},{"name":"bookDetail","type":"extractor"}]}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts
git commit -m "feat(api): add GET /steps and POST /steps/:step/debug SSE endpoints"
```

---

## Task 3: Client API types + `listSteps`

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add types and `listSteps` function**

Add at the end of `client/src/api.ts`:

```ts
export interface StepInfo {
  name: string
  type: 'traverser' | 'extractor'
}

export interface TraverserResult {
  link: string
  page_type: string
  parent_data?: Record<string, unknown>
}

export async function listSteps(parserName: string): Promise<StepInfo[]> {
  const res = await fetch(`/api/parsers/${parserName}/steps`)
  if (!res.ok) throw new Error('Failed to load steps')
  const data = await res.json()
  return data.steps as StepInfo[]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat(client/api): add StepInfo, TraverserResult types and listSteps()"
```

---

## Task 4: `JsonEditor` component

**Files:**
- Create: `client/src/components/JsonEditor.tsx`

- [ ] **Step 1: Create the file**

```tsx
// client/src/components/JsonEditor.tsx
import { useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export function JsonEditor({ value, onChange, placeholder, disabled }: Props) {
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    if (!v.trim()) {
      setError(null)
      return
    }
    try {
      JSON.parse(v)
      setError(null)
    } catch {
      setError('Invalid JSON')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        rows={5}
        spellCheck={false}
        className={[
          'w-full rounded-lg border px-3 py-2 font-mono text-xs resize-y',
          'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100',
          'placeholder-gray-400 dark:placeholder-gray-600',
          error
            ? 'border-red-400 dark:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-400'
            : 'border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/JsonEditor.tsx
git commit -m "feat(client): add JsonEditor component with inline JSON validation"
```

---

## Task 5: `useDebugRun` hook

**Files:**
- Create: `client/src/hooks/useDebugRun.ts`

- [ ] **Step 1: Create the file**

```ts
// client/src/hooks/useDebugRun.ts
import { useEffect, useRef, useState } from 'react'
import type { TraverserResult } from '../api'

export interface LogLine {
  level: 'log' | 'error'
  stepName: string
  args: string[]
}

export type DebugResult =
  | { type: 'links'; items: TraverserResult[] }
  | { type: 'data'; rows: Record<string, unknown>[]; outputFile: string }

export interface DebugRunState {
  status: 'idle' | 'running' | 'done' | 'error'
  logs: LogLine[]
  result: DebugResult | null
  error: string | null
}

export function useDebugRun() {
  const [state, setState] = useState<DebugRunState>({
    status: 'idle',
    logs: [],
    result: null,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function run(
    parserName: string,
    stepName: string,
    url: string,
    parentData?: Record<string, unknown>,
  ) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'running', logs: [], result: null, error: null })

    try {
      const res = await fetch(`/api/parsers/${parserName}/steps/${stepName}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, parentData }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => 'Unknown error')
        setState((prev) => ({ ...prev, status: 'error', error: text }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE events are separated by double newline
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          const msg = JSON.parse(dataLine.slice(6)) as {
            type: string
            level?: 'log' | 'error'
            stepName?: string
            args?: string[]
            result?: DebugResult
            error?: string
          }
          switch (msg.type) {
            case 'log':
              setState((prev) => ({
                ...prev,
                logs: [
                  ...prev.logs,
                  { level: msg.level!, stepName: msg.stepName!, args: msg.args! },
                ],
              }))
              break
            case 'result':
              setState((prev) => ({ ...prev, result: msg.result! }))
              break
            case 'done':
              setState((prev) => ({ ...prev, status: 'done' }))
              break
            case 'error':
              setState((prev) => ({ ...prev, status: 'error', error: msg.error! }))
              break
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState((prev) => ({ ...prev, status: 'error', error: (err as Error).message }))
    }
  }

  function reset() {
    abortRef.current?.abort()
    setState({ status: 'idle', logs: [], result: null, error: null })
  }

  return { ...state, run, reset }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useDebugRun.ts
git commit -m "feat(client): add useDebugRun hook — streams SSE debug results via fetch"
```

---

## Task 6: `DebugPage` component

**Files:**
- Create: `client/src/components/DebugPage.tsx`

- [ ] **Step 1: Create the file**

```tsx
// client/src/components/DebugPage.tsx
import { useEffect, useRef, useState } from 'react'
import { listParsers, listSteps } from '../api'
import type { StepInfo } from '../api'
import { JsonEditor } from './JsonEditor'
import { useDebugRun } from '../hooks/useDebugRun'
import type { DebugResult } from '../hooks/useDebugRun'

function parseJsonSafe(s: string): Record<string, unknown> | undefined {
  if (!s.trim()) return undefined
  try {
    const v = JSON.parse(s)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* ignore */ }
  return undefined
}

function ResultPanel({ result }: { result: DebugResult }) {
  if (result.type === 'links') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          Links discovered ({result.items.length})
        </p>
        <pre className="text-xs font-mono bg-gray-950 text-emerald-400 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap">
          {JSON.stringify(result.items, null, 2)}
        </pre>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
        Data extracted — {result.outputFile} ({result.rows.length} rows)
      </p>
      <pre className="text-xs font-mono bg-gray-950 text-emerald-400 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap">
        {JSON.stringify(result.rows, null, 2)}
      </pre>
    </div>
  )
}

export function DebugPage() {
  const [parsers, setParsers] = useState<string[]>([])
  const [selectedParser, setSelectedParser] = useState('')
  const [steps, setSteps] = useState<StepInfo[]>([])
  const [selectedStep, setSelectedStep] = useState('')
  const [url, setUrl] = useState('')
  const [parentDataJson, setParentDataJson] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)

  const { status, logs, result, error, run, reset } = useDebugRun()
  const isRunning = status === 'running'

  useEffect(() => {
    listParsers().then(setParsers).catch(() => setParsers([]))
  }, [])

  useEffect(() => {
    if (!selectedParser) {
      setSteps([])
      setSelectedStep('')
      return
    }
    listSteps(selectedParser)
      .then((s) => {
        setSteps(s)
        setSelectedStep(s[0]?.name ?? '')
      })
      .catch(() => setSteps([]))
  }, [selectedParser])

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  function handleRun() {
    const parentData = parseJsonSafe(parentDataJson)
    run(selectedParser, selectedStep, url, parentData)
  }

  const parentDataError =
    parentDataJson.trim() !== '' && parseJsonSafe(parentDataJson) === undefined
  const canRun = !isRunning && !!selectedParser && !!selectedStep && !!url.trim() && !parentDataError

  const selectClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 text-sm px-3 py-2 font-mono placeholder-gray-400 dark:placeholder-gray-600 ' +
    'focus:outline-none focus:ring-1 focus:ring-emerald-400'

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 flex flex-col gap-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Debug Step Runner</h2>

      {/* Config panel */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 flex flex-col gap-4 shadow-sm">

        {/* Parser + Step row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Parser</label>
            <select
              value={selectedParser}
              onChange={(e) => { setSelectedParser(e.target.value); reset() }}
              disabled={isRunning}
              className={selectClass}
            >
              <option value="">— select —</option>
              {parsers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Step</label>
            <select
              value={selectedStep}
              onChange={(e) => { setSelectedStep(e.target.value); reset() }}
              disabled={isRunning || !steps.length}
              className={selectClass}
            >
              {steps.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* URL */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            placeholder="https://example.com/page"
            className={inputClass}
          />
        </div>

        {/* parentData */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            parentData <span className="font-normal text-gray-400">(optional JSON object)</span>
          </label>
          <JsonEditor
            value={parentDataJson}
            onChange={setParentDataJson}
            disabled={isRunning}
            placeholder={'{\n  "category": "Travel"\n}'}
          />
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="self-start bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors active:scale-95"
        >
          {isRunning ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Output — only when there's something to show */}
      {(status !== 'idle' || logs.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Console */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Console</p>
            <div
              ref={consoleRef}
              className="bg-gray-950 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              {logs.length === 0 && (
                <span className="text-gray-600">Waiting for output…</span>
              )}
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={line.level === 'error' ? 'text-red-400' : 'text-gray-300'}
                >
                  <span className="text-emerald-500 mr-1">[{line.stepName}]</span>
                  {line.args.join(' ')}
                </div>
              ))}
              {status === 'done' && (
                <div className="text-emerald-400 mt-1">✓ Done</div>
              )}
              {status === 'error' && (
                <div className="text-red-400 mt-1">✗ {error}</div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Result</p>
            <div className="bg-gray-950 rounded-xl p-4 h-80 overflow-y-auto">
              {!result && (
                <span className="text-gray-600 font-mono text-xs">
                  {isRunning ? 'Waiting for result…' : 'No result yet.'}
                </span>
              )}
              {result && <ResultPanel result={result} />}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DebugPage.tsx
git commit -m "feat(client): add DebugPage component with live console and JSON results"
```

---

## Task 7: App.tsx — nav tabs + routing

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

The new App.tsx adds hash-based routing and a two-tab nav bar.

```tsx
// client/src/App.tsx
import { useEffect, useState } from 'react'
import { listParsers } from './api'
import { ParserCard } from './components/ParserCard'
import { DebugPage } from './components/DebugPage'
import { useTheme } from './hooks/useTheme'

function SunIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )
}

type Page = 'parsers' | 'debug'

function getPageFromHash(): Page {
  return window.location.hash === '#/debug' ? 'debug' : 'parsers'
}

export default function App() {
  const [parsers, setParsers] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(getPageFromHash)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    listParsers()
      .then(setParsers)
      .catch(() => setApiError('Could not connect to API. Is the server running?'))
  }, [])

  useEffect(() => {
    const handler = () => setPage(getPageFromHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(p: Page) {
    window.location.hash = p === 'debug' ? '#/debug' : '#/'
    setPage(p)
  }

  const tabClass = (p: Page) =>
    [
      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
      page === p
        ? 'bg-emerald-600 text-white'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800',
    ].join(' ')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center gap-3">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight m-0 text-gray-900 dark:text-white">
            Scraper Platform
          </h1>

          {/* Nav tabs */}
          <nav className="flex items-center gap-1 ml-4">
            <button onClick={() => navigate('parsers')} className={tabClass('parsers')}>
              Parsers
            </button>
            <button onClick={() => navigate('debug')} className={tabClass('debug')}>
              Debug
            </button>
          </nav>

          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
            {parsers.length} parser{parsers.length !== 1 ? 's' : ''} found
          </span>
          <button
            onClick={toggle}
            className="ml-2 sm:ml-3 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="w-full">
        {apiError ? (
          <div className="px-4 sm:px-6 lg:px-8 py-5">
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
              <p className="text-red-500 dark:text-red-400 font-medium">{apiError}</p>
              <p className="text-gray-500 text-sm mt-2">
                Run:{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-700 dark:text-gray-300 text-xs font-mono">
                  npm run api
                </code>
              </p>
            </div>
          </div>
        ) : page === 'debug' ? (
          <DebugPage />
        ) : parsers.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-600">
            <p className="text-lg">No parsers found</p>
            <p className="text-sm mt-1">
              Add a parser directory under{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-500 dark:text-gray-400 text-xs font-mono">
                src/parsers/
              </code>
            </p>
          </div>
        ) : (
          <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
            <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {parsers.map((name) => (
                <ParserCard key={name} name={name} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Start client dev server and verify UI**

```bash
cd /Users/ryunko/Desktop/Projects/scraper/client
npm run dev &
# Open http://localhost:5173 — verify "Parsers" and "Debug" tabs exist
# Click Debug tab — verify form renders (parser/step dropdowns, URL input, parentData editor, Run button)
# Click Parsers tab — verify existing parser cards still work
# Navigate back/forward — verify hash routing works
kill %1
```

- [ ] **Step 4: End-to-end test**

Start both server and client, run a real debug step:

```bash
# Terminal 1
cd /Users/ryunko/Desktop/Projects/scraper
npx tsx src/api/server.ts

# Terminal 2
cd /Users/ryunko/Desktop/Projects/scraper/client
npm run dev
```

In browser:
1. Go to `http://localhost:5173/#/debug`
2. Select parser: `example`, step: `bookDetail`
3. URL: `https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html`
4. Click Run
5. Verify: console shows logs, result panel shows JSON with `title`, `price`, `availability`, `rating`, `__url`
6. Test `categoryList` step with `https://books.toscrape.com/` — verify result shows array of links

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): add nav tabs and hash-based routing for Debug page"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Run a single step with specific URL | Task 1 (DebugStepRunner) + Task 2 (endpoint) |
| GET steps endpoint for client | Task 2 |
| Debug page on client | Tasks 4–7 |
| Parser dropdown | Task 6 (DebugPage) |
| Step dropdown per parser | Task 6 (DebugPage + useEffect on selectedParser) |
| JSON editor for parentData | Task 4 (JsonEditor) |
| Show all results as JSON | Task 6 (ResultPanel) |
| Run button blocks while running | Task 6 (`canRun` + `isRunning`) |
| Live console logs | Task 5 (useDebugRun log state) + Task 6 (console panel) |
| No history | No persistence — state resets on new run ✓ |

### Placeholder scan

No TBD/TODO/placeholder patterns in plan — all code is complete.

### Type consistency

- `DebugResult` defined in `DebugStepRunner.ts` (backend) and `useDebugRun.ts` (frontend) independently — no sharing needed across process boundary.
- `TraverserResult` exported from `client/src/api.ts`, imported in `useDebugRun.ts`.
- `StepInfo` exported from `client/src/api.ts`, imported in `DebugPage.tsx`.
- `LogLine`, `DebugResult`, `DebugRunState` all defined in `useDebugRun.ts`, imported in `DebugPage.tsx`.
- Worker message types in `messages.ts` are backend-only, not referenced on client.
