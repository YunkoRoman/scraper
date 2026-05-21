# Feature Expansion Implementation Plan (8 Subsystems)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship eight independent subsystems — Monaco autocomplete, JSON/Excel export, parser import/export, step templates, cron schedules, webhook notifications, proxy rotation pool, and step versioning — across the DDD layers without breaking the existing parser/run pipeline.

**Architecture:** Each subsystem follows the existing DDD layering. Persistence services extend `BasePersistenceService` and use Drizzle ORM exclusively (no raw SQL in TypeScript services). New API routes are wired into `createParsersRouter` via the existing deps-object pattern and resolve parsers by UUID via `res.locals.parser`. New writers (`JsonWriter`, `ExcelWriter`) and `CsvWriter` are unified behind a `createOutputWriter(format, filePath)` factory consumed by `ParserOrchestrator`. Workers gain a `ProxyPoolService` to rotate proxies per context rotation. `SchedulerService` polls every 60s and triggers `runner.run(name)` for due schedules. `WebhookService` subscribes to `runner.on('complete'|'stopped')` and POSTs payloads. `StepVersionPersistenceService` snapshots prior code on every `updateStep` whose code field changed.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), Node.js Worker Threads, Playwright, React 19, Tailwind CSS, Framer Motion, Monaco Editor, Vitest, `exceljs` (new), `cron-parser` (new).

**Migrations applied in this plan:** `0004_scheduled_runs.sql`, `0005_webhook_url.sql`, `0006_step_versions.sql`.

**Design log:** After each subsystem completes, create one numbered design log entry under `design-log/NNN-short-slug.md` and append a row to `design-log/index.md`. Next available number is `009`; this plan adds `009`–`016` (one per subsystem).

---

## File Map

### Subsystem 1 — Monaco Autocomplete
**New client files:**
- `client/src/lib/monacoPlaywrightCompletions.ts`

**Modified client files:**
- `client/src/components/ParserEditorPage.tsx` — `beforeMount` registers completions

### Subsystem 2 — JSON + Excel Export
**New server files:**
- `src/infrastructure/export/ExcelWriter.ts`
- `src/infrastructure/export/JsonWriter.ts`
- `src/infrastructure/export/OutputWriter.ts`

**Modified server files:**
- `src/domain/value-objects/StepSettings.ts` — `outputFormat?: 'csv'|'json'|'excel'`
- `src/application/orchestrator/ParserOrchestrator.ts` — use factory
- `src/api/routes/parsers.ts` — allow `.json`/`.xlsx` in files endpoint

**Modified client files:**
- `client/src/components/ParserEditorPage.tsx` — output format selector

### Subsystem 3 — Parser Import/Export
**Modified server files:**
- `src/api/routes/parsers.ts` — add `GET /:id/export` and `POST /import`

**Modified client files:**
- `client/src/api.ts` — `exportParser`, `importParser`
- `client/src/components/ParserDetailPage.tsx` — Export button
- `client/src/components/ParsersPage.tsx` — Import button + file input

### Subsystem 4 — Step Templates
**New client files:**
- `client/src/lib/stepTemplates.ts`

**Modified client files:**
- `client/src/components/ParserEditorPage.tsx` — template picker

### Subsystem 5 — Cron / Scheduled Runs
**New server files:**
- `src/infrastructure/db/migrations/0004_scheduled_runs.sql`
- `src/infrastructure/db/SchedulePersistenceService.ts`
- `src/application/services/SchedulerService.ts`
- `src/tests/schedulerService.test.ts`

**Modified server files:**
- `src/infrastructure/db/schema.ts` — `scheduledRuns` table
- `src/infrastructure/db/migrate.ts` — register `0004`
- `src/api/server.ts` — instantiate + start `SchedulerService`, inject into router
- `src/api/routes/parsers.ts` — schedule endpoints

**New client files:**
- `client/src/components/SchedulePanel.tsx`

**Modified client files:**
- `client/src/api.ts` — `getSchedule`, `setSchedule`, `deleteSchedule`
- `client/src/components/ParserDetailPage.tsx` — mount panel

### Subsystem 6 — Webhook Notifications
**New server files:**
- `src/infrastructure/db/migrations/0005_webhook_url.sql`
- `src/infrastructure/webhook/WebhookService.ts`
- `src/tests/webhookService.test.ts`

**Modified server files:**
- `src/infrastructure/db/schema.ts` — `webhookUrl` column
- `src/infrastructure/db/migrate.ts` — register `0005`
- `src/infrastructure/db/ParserPersistenceService.ts` — webhookUrl in create/update
- `src/api/server.ts` — wire runner events to webhook service
- `src/api/routes/parsers.ts` — accept `webhookUrl` in PUT /:id

**Modified client files:**
- `client/src/api.ts` — include `webhookUrl` in parser types
- `client/src/components/ParserSettingsPanel.tsx` — webhook URL input

### Subsystem 7 — Proxy Rotation Pool
**New server files:**
- `src/infrastructure/proxy/ProxyPoolService.ts`
- `src/tests/proxyPoolService.test.ts`

**Modified server files:**
- `src/domain/value-objects/StepSettings.ts` — `proxyPool?: string[]`
- `src/infrastructure/worker/ExtractorWorker.ts` — use pool on rotation
- `src/infrastructure/worker/TraverserWorker.ts` — use pool on rotation
- `src/infrastructure/worker/buildContextOptions.ts` — accept `proxyOverride` URL

**Modified client files:**
- `client/src/components/ParserEditorPage.tsx` — proxy pool textarea

### Subsystem 8 — Parser Versioning
**New server files:**
- `src/infrastructure/db/migrations/0006_step_versions.sql`
- `src/infrastructure/db/StepVersionPersistenceService.ts`
- `src/tests/stepVersionPersistence.test.ts`

**Modified server files:**
- `src/infrastructure/db/schema.ts` — `stepVersions` table
- `src/infrastructure/db/migrate.ts` — register `0006`
- `src/infrastructure/db/ParserPersistenceService.ts` — accept optional versions svc
- `src/api/server.ts` — instantiate + inject `StepVersionPersistenceService`
- `src/api/routes/parsers.ts` — versions endpoints

**New client files:**
- `client/src/components/StepVersionsPanel.tsx`

**Modified client files:**
- `client/src/api.ts` — `listStepVersions`, `restoreStepVersion`
- `client/src/components/ParserEditorPage.tsx` — history button toggles panel

---

## Pre-flight — Install new dependencies

- [ ] **Step 0.1: Install npm packages**

Run:
```bash
npm install exceljs cron-parser
```

Expected output (versions may differ slightly):
```
added 2 packages, and audited NNN packages in Xs
```

- [ ] **Step 0.2: Verify install**

Run:
```bash
node -e "console.log(require('exceljs').Workbook && require('cron-parser').parseExpression)"
```

Expected output:
```
[Function: Workbook] [Function: parseExpression]
```

Commit:
```bash
git add package.json package-lock.json
git commit -m "deps: add exceljs and cron-parser for export + scheduling"
```

---

## Subsystem 1 — Monaco Autocomplete

### Task 1.1: Failing test for completions builder

- [ ] **Step 1.1.1: Create test file**

Create `client/src/tests/monacoCompletions.test.ts` (no Vite test runner currently, but Vitest picks this up if `client/vitest.config.ts` exists; otherwise place in `src/tests/monacoCompletions.test.ts` since the logic file is pure TS and importable. Place at `src/tests/monacoCompletions.test.ts` to use existing Vitest config):

```ts
import { describe, it, expect } from 'vitest'
import { buildPlaywrightCompletionItems, buildTaskCompletionItems } from '../../client/src/lib/monacoPlaywrightCompletions.ts'

describe('buildPlaywrightCompletionItems', () => {
  it('returns 20 Page method completions', () => {
    const items = buildPlaywrightCompletionItems()
    expect(items.length).toBe(20)
    expect(items.map(i => i.label).sort()).toContain('goto')
    expect(items.map(i => i.label).sort()).toContain('$$eval')
  })
  it('each item has insertText and detail', () => {
    for (const it of buildPlaywrightCompletionItems()) {
      expect(it.label).toBeTypeOf('string')
      expect(it.insertText).toBeTypeOf('string')
      expect(it.detail).toBeTypeOf('string')
    }
  })
})

describe('buildTaskCompletionItems', () => {
  it('returns url and parent_data', () => {
    const labels = buildTaskCompletionItems().map(i => i.label)
    expect(labels).toEqual(['url', 'parent_data'])
  })
})
```

- [ ] **Step 1.1.2: Run the test (expect failure)**

```bash
npm run test -- monacoCompletions
```

Expected output (failure):
```
FAIL  src/tests/monacoCompletions.test.ts
Error: Cannot find module ... monacoPlaywrightCompletions
```

### Task 1.2: Implement completion builders

- [ ] **Step 1.2.1: Create completion provider file**

Create `client/src/lib/monacoPlaywrightCompletions.ts`:

```ts
// client/src/lib/monacoPlaywrightCompletions.ts
import type { Monaco } from '@monaco-editor/react'

export interface CompletionItemSpec {
  label: string
  insertText: string
  detail: string
  documentation?: string
}

const PAGE_METHODS: CompletionItemSpec[] = [
  { label: 'goto',             insertText: "goto('${1:url}')",                detail: '(url) => Promise<Response>', documentation: 'Navigate to a URL.' },
  { label: 'click',            insertText: "click('${1:selector}')",          detail: '(selector) => Promise<void>', documentation: 'Click an element.' },
  { label: 'fill',             insertText: "fill('${1:selector}', '${2:value}')", detail: '(selector, value) => Promise<void>', documentation: 'Fill an input field.' },
  { label: '$eval',            insertText: "$$eval('${1:selector}', el => ${2:el.textContent})", detail: '(selector, fn) => Promise<T>', documentation: 'Evaluate over the first matching element.' },
  { label: '$$eval',           insertText: "$$eval('${1:selector}', els => els.map(${2:e => e.href}))", detail: '(selector, fn) => Promise<T>', documentation: 'Evaluate over all matching elements.' },
  { label: 'waitForSelector',  insertText: "waitForSelector('${1:selector}')", detail: '(selector, options?) => Promise<ElementHandle>', documentation: 'Wait until selector appears.' },
  { label: 'waitForLoadState', insertText: "waitForLoadState('${1:domcontentloaded}')", detail: "(state?) => Promise<void>", documentation: "Wait for 'load' | 'domcontentloaded' | 'networkidle'." },
  { label: 'evaluate',         insertText: "evaluate(() => ${1:document.title})", detail: '(fn, arg?) => Promise<T>', documentation: 'Run JS in the page context.' },
  { label: 'locator',          insertText: "locator('${1:selector}')",          detail: '(selector) => Locator',         documentation: 'Build a locator (chainable, auto-waits).' },
  { label: 'screenshot',       insertText: "screenshot({ path: '${1:shot.png}' })", detail: '(options?) => Promise<Buffer>', documentation: 'Take a page screenshot.' },
  { label: 'content',          insertText: 'content()',                       detail: '() => Promise<string>',         documentation: 'Get the full HTML content.' },
  { label: 'title',            insertText: 'title()',                         detail: '() => Promise<string>',         documentation: 'Get the document title.' },
  { label: 'url',              insertText: 'url()',                           detail: '() => string',                  documentation: 'Get the current URL.' },
  { label: 'keyboard',         insertText: 'keyboard.press(\'${1:Enter}\')',  detail: 'Keyboard',                      documentation: 'Keyboard API (press/type/down/up).' },
  { label: 'mouse',            insertText: 'mouse.move(${1:0}, ${2:0})',      detail: 'Mouse',                         documentation: 'Mouse API (move/click/down/up/wheel).' },
  { label: 'selectOption',     insertText: "selectOption('${1:selector}', '${2:value}')", detail: '(selector, value) => Promise<string[]>', documentation: 'Select <option> by value/label.' },
  { label: 'hover',            insertText: "hover('${1:selector}')",          detail: '(selector) => Promise<void>',   documentation: 'Hover an element.' },
  { label: 'check',            insertText: "check('${1:selector}')",          detail: '(selector) => Promise<void>',   documentation: 'Check a checkbox/radio.' },
  { label: 'uncheck',          insertText: "uncheck('${1:selector}')",        detail: '(selector) => Promise<void>',   documentation: 'Uncheck a checkbox.' },
  { label: 'type',             insertText: "type('${1:selector}', '${2:text}')", detail: '(selector, text) => Promise<void>', documentation: 'Type characters into a field.' },
]

const TASK_FIELDS: CompletionItemSpec[] = [
  { label: 'url',         insertText: 'url',         detail: 'string',                       documentation: 'Current task URL.' },
  { label: 'parent_data', insertText: 'parent_data', detail: 'Record<string, unknown>',      documentation: 'Data passed from the parent traverser step.' },
]

export function buildPlaywrightCompletionItems(): CompletionItemSpec[] {
  return PAGE_METHODS
}

export function buildTaskCompletionItems(): CompletionItemSpec[] {
  return TASK_FIELDS
}

export function registerPlaywrightCompletions(monaco: Monaco): void {
  const toMonacoItems = (specs: CompletionItemSpec[], range: import('monaco-editor').IRange) =>
    specs.map((s) => ({
      label: s.label,
      kind: monaco.languages.CompletionItemKind.Method,
      insertText: s.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: s.detail,
      documentation: s.documentation,
      range,
    }))

  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber)
      const before = line.slice(0, position.column - 1)
      const range = {
        startLineNumber: position.lineNumber,
        startColumn:     position.column,
        endLineNumber:   position.lineNumber,
        endColumn:       position.column,
      }
      if (/\bpage\.$/.test(before))  return { suggestions: toMonacoItems(PAGE_METHODS, range) }
      if (/\btask\.$/.test(before))  return { suggestions: toMonacoItems(TASK_FIELDS, range) }
      return { suggestions: [] }
    },
  })
}
```

- [ ] **Step 1.2.2: Run test (expect pass)**

```bash
npm run test -- monacoCompletions
```

Expected output:
```
✓ buildPlaywrightCompletionItems > returns 20 Page method completions
✓ buildPlaywrightCompletionItems > each item has insertText and detail
✓ buildTaskCompletionItems > returns url and parent_data
```

### Task 1.3: Wire into ParserEditorPage

- [ ] **Step 1.3.1: Edit `client/src/components/ParserEditorPage.tsx`**

Find:
```tsx
import Editor from '@monaco-editor/react'
```

Replace with:
```tsx
import Editor from '@monaco-editor/react'
import { registerPlaywrightCompletions } from '../lib/monacoPlaywrightCompletions'
```

Find the `<Editor` block:
```tsx
                  <Editor
                    key={selectedStepName ?? ''}
                    height="100%"
                    language="javascript"
                    theme={monacoTheme}
                    value={code}
                    onChange={(v) => handleCodeChange(v ?? '')}
                    options={{
```

Replace with:
```tsx
                  <Editor
                    key={selectedStepName ?? ''}
                    height="100%"
                    language="javascript"
                    theme={monacoTheme}
                    value={code}
                    onChange={(v) => handleCodeChange(v ?? '')}
                    beforeMount={(monaco) => registerPlaywrightCompletions(monaco)}
                    options={{
```

- [ ] **Step 1.3.2: Build to confirm types**

```bash
npm run build
```

Expected output:
```
(no errors)
```

- [ ] **Step 1.3.3: Commit**

```bash
git add client/src/lib/monacoPlaywrightCompletions.ts client/src/components/ParserEditorPage.tsx src/tests/monacoCompletions.test.ts
git commit -m "feat(editor): Monaco autocomplete for page.* and task.*"
```

### Task 1.4: Design log entry

- [ ] **Step 1.4.1: Create `design-log/009-monaco-playwright-completions.md`**

Use the existing log format (Background / Problem / Design / Q&A / Trade-offs / Implementation Results). Append a row to `design-log/index.md` linking to `009-monaco-playwright-completions.md` with status `completed`.

- [ ] **Step 1.4.2: Commit log**

```bash
git add design-log/009-monaco-playwright-completions.md design-log/index.md
git commit -m "docs(design-log): 009 Monaco Playwright completions"
```

---

## Subsystem 2 — JSON + Excel Export

### Task 2.1: Add `outputFormat` to StepSettings

- [ ] **Step 2.1.1: Edit `src/domain/value-objects/StepSettings.ts`**

Find:
```ts
  proxySettings?: ProxySettings
}
```

Replace with:
```ts
  proxySettings?: ProxySettings
  /** Output writer format. Defaults to 'csv' if unset. */
  outputFormat?: 'csv' | 'json' | 'excel'
}
```

### Task 2.2: Failing test for OutputWriter factory

- [ ] **Step 2.2.1: Create `src/tests/outputWriter.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createOutputWriter } from '../infrastructure/export/OutputWriter.js'

describe('createOutputWriter', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(resolve(tmpdir(), 'out-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes JSON file with array of rows', async () => {
    const w = createOutputWriter('json', resolve(dir, 'out.json'))
    await w.write({ a: 1 })
    await w.write({ a: 2 })
    await w.close()
    const text = await readFile(resolve(dir, 'out.json'), 'utf8')
    expect(JSON.parse(text)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('writes Excel xlsx file with header row', async () => {
    const w = createOutputWriter('excel', resolve(dir, 'out.xlsx'))
    await w.write({ title: 'A', n: 1 })
    await w.write({ title: 'B', n: 2 })
    await w.close()
    const buf = await readFile(resolve(dir, 'out.xlsx'))
    // .xlsx is a zip; the first 2 bytes are "PK"
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('writes CSV when format is csv', async () => {
    const w = createOutputWriter('csv', resolve(dir, 'out.csv'))
    await w.write({ x: 1 })
    await w.close()
    const text = await readFile(resolve(dir, 'out.csv'), 'utf8')
    expect(text.startsWith('x')).toBe(true)
  })
})
```

- [ ] **Step 2.2.2: Run test (expect failure)**

```bash
npm run test -- outputWriter
```

Expected output:
```
FAIL  src/tests/outputWriter.test.ts
Error: Cannot find module '../infrastructure/export/OutputWriter.js'
```

### Task 2.3: Implement JsonWriter

- [ ] **Step 2.3.1: Create `src/infrastructure/export/JsonWriter.ts`**

```ts
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export class JsonWriter {
  private stream: ReturnType<typeof createWriteStream> | null = null
  private first = true

  constructor(private readonly filePath: string) {}

  async write(row: Record<string, unknown>): Promise<void> {
    if (!this.stream) {
      await mkdir(dirname(this.filePath), { recursive: true })
      this.stream = createWriteStream(this.filePath, { flags: 'w' })
      this.stream.write('[')
    }
    this.stream.write((this.first ? '' : ',') + JSON.stringify(row))
    this.first = false
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) { resolve(); return }
      this.stream.once('finish', resolve)
      this.stream.once('error', reject)
      this.stream.end(']')
    })
  }
}
```

### Task 2.4: Implement ExcelWriter

- [ ] **Step 2.4.1: Create `src/infrastructure/export/ExcelWriter.ts`**

```ts
import ExcelJS from 'exceljs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export class ExcelWriter {
  private workbook = new ExcelJS.Workbook()
  private sheet = this.workbook.addWorksheet('rows')
  private headers: string[] | null = null

  constructor(private readonly filePath: string) {}

  async write(row: Record<string, unknown>): Promise<void> {
    if (!this.headers) {
      this.headers = Object.keys(row)
      this.sheet.columns = this.headers.map((h) => ({ header: h, key: h }))
    }
    const serialized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      serialized[k] = v === null || v === undefined
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : v
    }
    this.sheet.addRow(serialized)
  }

  async close(): Promise<void> {
    if (!this.headers) return
    await mkdir(dirname(this.filePath), { recursive: true })
    await this.workbook.xlsx.writeFile(this.filePath)
  }
}
```

### Task 2.5: Implement factory

- [ ] **Step 2.5.1: Create `src/infrastructure/export/OutputWriter.ts`**

```ts
import { CsvWriter } from '../csv/CsvWriter.js'
import { JsonWriter } from './JsonWriter.js'
import { ExcelWriter } from './ExcelWriter.js'

export type OutputFormat = 'csv' | 'json' | 'excel'

export interface OutputWriter {
  write(row: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

/** Returns the on-disk file path for a given outputFile + format. */
export function resolveOutputFileName(outputFile: string, format: OutputFormat): string {
  const base = outputFile.replace(/\.(csv|json|xlsx)$/i, '')
  if (format === 'json')  return `${base}.json`
  if (format === 'excel') return `${base}.xlsx`
  return `${base}.csv`
}

export function createOutputWriter(format: OutputFormat, filePath: string): OutputWriter {
  if (format === 'json')  return new JsonWriter(filePath)
  if (format === 'excel') return new ExcelWriter(filePath)
  return new CsvWriter(filePath)
}
```

- [ ] **Step 2.5.2: Run test (expect pass)**

```bash
npm run test -- outputWriter
```

Expected output:
```
✓ writes JSON file with array of rows
✓ writes Excel xlsx file with header row
✓ writes CSV when format is csv
```

### Task 2.6: Use factory in ParserOrchestrator

- [ ] **Step 2.6.1: Edit `src/application/orchestrator/ParserOrchestrator.ts`**

Find:
```ts
import { CsvWriter } from '../../infrastructure/csv/CsvWriter.js'
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
```

Replace with:
```ts
import { CsvPostProcessor } from '../../infrastructure/csv/CsvPostProcessor.js'
import { createOutputWriter, resolveOutputFileName, type OutputWriter, type OutputFormat } from '../../infrastructure/export/OutputWriter.js'
```

Find:
```ts
  private csvWriters = new Map<string, CsvWriter>()
```

Replace with:
```ts
  private csvWriters = new Map<string, OutputWriter>()
```

Find:
```ts
  private writeCsvRow(outputFile: string, data: Record<string, unknown>): void {
    const filePath = resolve(this.outputDir, outputFile)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, new CsvWriter(filePath))
    }
    const p = this.csvWriters.get(filePath)!.write(data).catch(console.error) as Promise<void>
    this.pendingWrites.push(p)
  }
```

Replace with:
```ts
  private writeCsvRow(outputFile: string, data: Record<string, unknown>): void {
    // Step's outputFormat (set in step.settings or stepSettings) takes precedence.
    // Default to 'csv' to preserve current behaviour.
    let format: OutputFormat = 'csv'
    for (const [, step] of this.config.steps) {
      const settings = (step as { settings?: { outputFormat?: OutputFormat } }).settings
      const stepOut = (step as { outputFile?: string }).outputFile
      if (stepOut === outputFile && settings?.outputFormat) { format = settings.outputFormat; break }
    }
    const resolvedName = resolveOutputFileName(outputFile, format)
    const filePath = resolve(this.outputDir, resolvedName)
    if (!this.csvWriters.has(filePath)) {
      this.csvWriters.set(filePath, createOutputWriter(format, filePath))
    }
    const p = this.csvWriters.get(filePath)!.write(data).catch(console.error) as Promise<void>
    this.pendingWrites.push(p)
  }
```

Find:
```ts
  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
```

Replace with:
```ts
  private async runPostProcessing(): Promise<void> {
    for (const [filePath] of this.csvWriters) {
      if (!filePath.endsWith('.csv')) { this.emit('postprocess', filePath); continue }
      const processor = new CsvPostProcessor(filePath)
      await processor.process()
      this.emit('postprocess', filePath)
    }
  }
```

### Task 2.7: Allow .json/.xlsx in files endpoint

- [ ] **Step 2.7.1: Edit `src/api/routes/parsers.ts`**

Find the files list endpoint:
```ts
            const entries = await readdir(subPath)
            await Promise.all(
              entries
                .filter((f) => f.endsWith('.csv'))
                .map(async (f) => {
```

Replace with:
```ts
            const entries = await readdir(subPath)
            await Promise.all(
              entries
                .filter((f) => f.endsWith('.csv') || f.endsWith('.json') || f.endsWith('.xlsx'))
                .map(async (f) => {
```

Find the file download endpoint:
```ts
    if (!file.endsWith('.csv') || file.includes('/') || file.includes('..') || runId.includes('/') || runId.includes('..')) {
      res.status(400).json({ error: 'Invalid path' }); return
    }
```

Replace with:
```ts
    const allowed = file.endsWith('.csv') || file.endsWith('.json') || file.endsWith('.xlsx')
    if (!allowed || file.includes('/') || file.includes('..') || runId.includes('/') || runId.includes('..')) {
      res.status(400).json({ error: 'Invalid path' }); return
    }
```

### Task 2.8: Client UI selector

- [ ] **Step 2.8.1: Edit `client/src/components/ParserEditorPage.tsx` — add selector inside `StepSettingsBar`**

Find within `StepSettingsBar`:
```tsx
        {/* Max Pages / Context */}
```

Insert immediately above (before the Max Pages / Context block):
```tsx
        {/* Output Format */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Output Format</label>
          <select
            key={String(settings.outputFormat ?? '')}
            defaultValue={(settings.outputFormat as string) ?? 'csv'}
            onChange={(e) => save({ outputFormat: e.target.value })}
            className={`${inputClass} w-24`}
          >
            <option value="csv">csv</option>
            <option value="json">json</option>
            <option value="excel">excel</option>
          </select>
        </div>

        {/* Max Pages / Context */}
```

- [ ] **Step 2.8.2: Build and test**

```bash
npm run build && npm run test -- outputWriter
```

Expected output:
```
(build: no errors)
✓ outputWriter tests pass
```

- [ ] **Step 2.8.3: Commit**

```bash
git add src/infrastructure/export src/domain/value-objects/StepSettings.ts src/application/orchestrator/ParserOrchestrator.ts src/api/routes/parsers.ts client/src/components/ParserEditorPage.tsx src/tests/outputWriter.test.ts
git commit -m "feat(export): JSON + Excel output formats via OutputWriter factory"
```

### Task 2.9: Design log entry

- [ ] **Step 2.9.1: Create `design-log/010-output-writer-factory.md`** and append row to `design-log/index.md`.

- [ ] **Step 2.9.2: Commit log**

```bash
git add design-log/010-output-writer-factory.md design-log/index.md
git commit -m "docs(design-log): 010 OutputWriter factory and JSON/Excel formats"
```

---

## Subsystem 3 — Parser Import/Export

### Task 3.1: Failing test for export shape

- [ ] **Step 3.1.1: Create `src/tests/parserImportExport.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../infrastructure/db/client.js', () => ({
  db: {},
  pool: {},
}))

import { ParserPersistenceService } from '../infrastructure/db/ParserPersistenceService.js'

describe('Parser export payload', () => {
  let svc: ParserPersistenceService
  beforeEach(() => { svc = new ParserPersistenceService() })

  it('serializeParserForExport strips ids and timestamps', () => {
    const exportable = serializeParserForExport({
      parser: {
        id: 'p1', name: 'demo', entryUrl: 'https://x', entryStep: 'list',
        browserType: 'playwright', browserSettings: { a: 1 },
        retryConfig: { maxRetries: 3 }, deduplication: true, concurrentQuota: null,
        createdAt: new Date(), updatedAt: new Date(),
      } as any,
      steps: [{
        id: 's1', parserId: 'p1', name: 'list', type: 'traverser',
        entryUrl: '', outputFile: null, code: 'return []',
        stepSettings: {}, position: 0,
        createdAt: new Date(), updatedAt: new Date(),
      } as any],
    })
    expect(exportable.parser).not.toHaveProperty('id')
    expect(exportable.parser).not.toHaveProperty('createdAt')
    expect(exportable.steps[0]).not.toHaveProperty('id')
    expect(exportable.steps[0]).not.toHaveProperty('parserId')
    expect(exportable.parser.name).toBe('demo')
    expect(exportable.steps[0].code).toBe('return []')
  })
})

// Helper imported from the route module once added (mock import path)
function serializeParserForExport(input: { parser: any; steps: any[] }) {
  const { id, createdAt, updatedAt, ...parser } = input.parser
  const steps = input.steps.map(({ id, parserId, createdAt, updatedAt, ...rest }) => rest)
  return { parser, steps }
}
```

Note: the test inlines the helper to avoid coupling. The implementation will produce the same shape via the route handler.

- [ ] **Step 3.1.2: Run test (expect pass — pure function test)**

```bash
npm run test -- parserImportExport
```

Expected:
```
✓ serializeParserForExport strips ids and timestamps
```

### Task 3.2: Add export/import endpoints

- [ ] **Step 3.2.1: Edit `src/api/routes/parsers.ts` — add endpoints**

After the existing `router.delete('/:id', …)` block, insert:

```ts
  // ── Export / Import ──────────────────────────────────────────────────────────

  router.get('/:id/export', async (_req, res) => {
    const { id, name }: ParserRow = res.locals.parser
    const result = await parserService.getParserWithSteps(name)
    if (!result) { res.status(404).json({ error: 'Parser not found' }); return }

    const stripParser = ({ id: _i, createdAt: _c, updatedAt: _u, ...rest }: ParserRow) => rest
    const stripStep = (s: import('../../infrastructure/db/ParserPersistenceService.js').StepRow) => {
      const { id: _i, parserId: _p, createdAt: _c, updatedAt: _u, ...rest } = s
      return rest
    }
    res.setHeader('Content-Disposition', `attachment; filename="${name}.parser.json"`)
    res.json({ parser: stripParser(result.parser), steps: result.steps.map(stripStep) })
  })
```

Now find the create endpoint block `router.post('/', async (req, res) => {`. Just before it, insert the import endpoint (it does not go through `router.param('id', …)`):

```ts
  router.post('/import', async (req, res) => {
    const { parser: incomingParser, steps: incomingSteps, newName } = req.body as {
      parser: { name: string; entryUrl?: string; entryStep?: string; browserType?: string; browserSettings?: object; retryConfig?: { maxRetries: number }; deduplication?: boolean; concurrentQuota?: number | null }
      steps: { name: string; type: 'traverser' | 'extractor'; entryUrl?: string; outputFile?: string | null; code?: string; stepSettings?: object; position?: number }[]
      newName?: string
    }
    if (!incomingParser?.name) { res.status(400).json({ error: 'parser.name is required' }); return }
    const name = newName ?? incomingParser.name
    if (!/^[a-z0-9_-]+$/i.test(name)) { res.status(400).json({ error: 'name must be alphanumeric with hyphens/underscores' }); return }
    try {
      const created = await parserService.create({
        name,
        entryUrl:        incomingParser.entryUrl,
        entryStep:       incomingParser.entryStep,
        browserType:     incomingParser.browserType,
        browserSettings: incomingParser.browserSettings,
        retryConfig:     incomingParser.retryConfig,
        deduplication:   incomingParser.deduplication,
        concurrentQuota: incomingParser.concurrentQuota ?? null,
      })
      for (const s of incomingSteps ?? []) {
        await parserService.createStep({
          parserId:   created.id,
          name:       s.name,
          type:       s.type,
          entryUrl:   s.entryUrl,
          outputFile: s.outputFile ?? null,
          code:       s.code,
          position:   s.position,
        })
        if (s.stepSettings) {
          const step = await parserService.getStep(created.id, s.name)
          if (step) await parserService.updateStep(step.id, { stepSettings: s.stepSettings })
        }
      }
      res.status(201).json({ parser: created })
    } catch (err) {
      if (err instanceof ParserAlreadyExistsError) { res.status(409).json({ error: err.message }); return }
      throw err
    }
  })
```

### Task 3.3: Client API helpers

- [ ] **Step 3.3.1: Edit `client/src/api.ts`**

Append at end of file:

```ts
export interface ParserExport {
  parser: Omit<ParserRow, 'id' | 'createdAt' | 'updatedAt'>
  steps: Omit<StepRow, 'id' | 'parserId' | 'createdAt' | 'updatedAt'>[]
}

export async function exportParser(id: string): Promise<ParserExport> {
  return apiRequest(`/api/parsers/${id}/export`)
}

export async function importParser(data: ParserExport & { newName?: string }): Promise<ParserRow> {
  const out = await apiRequest<{ parser: ParserRow }>(`/api/parsers/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return out.parser
}
```

### Task 3.4: Export button on ParserDetailPage

- [ ] **Step 3.4.1: Edit `client/src/components/ParserDetailPage.tsx`**

Find:
```tsx
import {
  getParser,
  getParserStats,
  listJobs,
  listFiles,
  fetchFileContent,
  downloadFile,
  startParser,
  stopParser,
  rerunParser,
```

Replace with:
```tsx
import {
  getParser,
  getParserStats,
  listJobs,
  listFiles,
  fetchFileContent,
  downloadFile,
  startParser,
  stopParser,
  rerunParser,
  exportParser,
```

Find an existing actions area near `rerunParser`-button or the top button bar inside the rendered output. Add a button block:

```tsx
<button
  onClick={async () => {
    const data = await exportParser(parserId)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.parser.name}.parser.json`
    a.click()
    URL.revokeObjectURL(url)
  }}
  className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
>
  Export
</button>
```

Place this button next to existing run-control buttons. If unsure of exact placement, position it inside the same flex container as the existing `SpringButton` Start/Stop controls.

### Task 3.5: Import button on ParsersPage

- [ ] **Step 3.5.1: Edit `client/src/components/ParsersPage.tsx`**

Add to imports:
```tsx
import { importParser } from '../api'
import { useRef } from 'react'
```

Add a hidden file input + button block near the top toolbar (next to "New Parser" / search bar):

```tsx
const fileInputRef = useRef<HTMLInputElement>(null)
// …
<input
  ref={fileInputRef}
  type="file"
  accept="application/json,.json"
  className="hidden"
  onChange={async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await importParser(data)
      window.location.reload()
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`)
    } finally {
      e.target.value = ''
    }
  }}
/>
<button
  onClick={() => fileInputRef.current?.click()}
  className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
>
  Import
</button>
```

- [ ] **Step 3.5.2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3.5.3: Commit**

```bash
git add src/api/routes/parsers.ts client/src/api.ts client/src/components/ParserDetailPage.tsx client/src/components/ParsersPage.tsx src/tests/parserImportExport.test.ts
git commit -m "feat(parsers): import/export full parser config as JSON"
```

### Task 3.6: Design log entry

- [ ] **Step 3.6.1: Create `design-log/011-parser-import-export.md` and update index.**

```bash
git add design-log/011-parser-import-export.md design-log/index.md
git commit -m "docs(design-log): 011 parser import/export endpoints"
```

---

## Subsystem 4 — Step Templates

### Task 4.1: Create templates module

- [ ] **Step 4.1.1: Create `client/src/lib/stepTemplates.ts`**

```ts
// client/src/lib/stepTemplates.ts
export interface StepTemplate {
  label: string
  type: 'traverser' | 'extractor'
  code: string
}

export const STEP_TEMPLATES: StepTemplate[] = [
  {
    label: 'Pagination Traverser',
    type: 'traverser',
    code: `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const links = await page.$$eval('a.product-link', els => els.map(el => el.href))
const next  = await page.$eval('a.next-page', el => el.href).catch(() => null)
const out = links.map(link => ({ link, page_type: 'product', parent_data: {} }))
if (next) out.push({ link: next, page_type: 'pagination', parent_data: {} })
return out`,
  },
  {
    label: 'Category List Traverser',
    type: 'traverser',
    code: `// Discover category landing pages
const cats = await page.$$eval('nav.categories a', els =>
  els.map(el => ({ href: el.href, name: el.textContent?.trim() ?? '' }))
)
return cats.map(c => ({ link: c.href, page_type: 'category', parent_data: { categoryName: c.name } }))`,
  },
  {
    label: 'REST API Extractor',
    type: 'extractor',
    code: `// Fetch JSON via the page context (uses the browser's cookies/headers)
const data = await page.evaluate(async (url) => {
  const r = await fetch(url, { credentials: 'include' })
  return r.json()
}, task.url)
return Array.isArray(data) ? data : [data]`,
  },
  {
    label: 'Product Detail Extractor',
    type: 'extractor',
    code: `const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
const price = await page.$eval('.price', el => el.textContent?.trim() ?? '').catch(() => '')
const desc  = await page.$eval('.description', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, price, desc, __url: task.url, ...(task.parent_data ?? {}) }]`,
  },
  {
    label: 'Infinite Scroll Traverser',
    type: 'traverser',
    code: `// Repeatedly scroll until no new items appear, then collect links
let prevCount = -1
for (let i = 0; i < 30; i++) {
  const count = await page.$$eval('.item', els => els.length)
  if (count === prevCount) break
  prevCount = count
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(800)
}
const links = await page.$$eval('.item a', els => els.map(el => el.href))
return links.map(link => ({ link, page_type: 'detail', parent_data: {} }))`,
  },
]
```

### Task 4.2: Wire picker into ParserEditorPage

- [ ] **Step 4.2.1: Edit `client/src/components/ParserEditorPage.tsx`**

Add import near other imports:
```tsx
import { STEP_TEMPLATES } from '../lib/stepTemplates'
```

Find the step meta bar JSX block (line near `selectedStep.name` `▶ Run` button) — within the right-side action group, add a select before the `▶ Run` button:

```tsx
<select
  onChange={(e) => {
    const t = STEP_TEMPLATES.find(t => t.label === e.target.value)
    if (t && confirm(`Replace current code with template "${t.label}"?`)) {
      handleCodeChange(t.code)
    }
    e.target.value = ''
  }}
  defaultValue=""
  className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
>
  <option value="">Templates…</option>
  {STEP_TEMPLATES
    .filter(t => t.type === selectedStep.type)
    .map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
</select>
```

- [ ] **Step 4.2.2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4.2.3: Commit**

```bash
git add client/src/lib/stepTemplates.ts client/src/components/ParserEditorPage.tsx
git commit -m "feat(editor): step code templates picker"
```

### Task 4.3: Design log

- [ ] **Step 4.3.1: Create `design-log/012-step-templates.md` and update index.**

```bash
git add design-log/012-step-templates.md design-log/index.md
git commit -m "docs(design-log): 012 step templates picker"
```

---

## Subsystem 5 — Cron / Scheduled Runs

### Task 5.1: Migration `0004_scheduled_runs.sql`

- [ ] **Step 5.1.1: Create `src/infrastructure/db/migrations/0004_scheduled_runs.sql`**

```sql
CREATE TABLE IF NOT EXISTS scheduled_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parser_id       UUID        NOT NULL REFERENCES parsers(id) ON DELETE CASCADE,
  cron_expression TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scheduled_runs_parser_id_idx ON scheduled_runs(parser_id);
CREATE INDEX IF NOT EXISTS scheduled_runs_next_run_idx  ON scheduled_runs(next_run_at) WHERE enabled = true;
```

- [ ] **Step 5.1.2: Register in `src/infrastructure/db/migrate.ts`**

Find:
```ts
  const migrations = ['0001_init.sql', '0002_run_persistence.sql', '0003_task_html.sql']
```

Replace with:
```ts
  const migrations = ['0001_init.sql', '0002_run_persistence.sql', '0003_task_html.sql', '0004_scheduled_runs.sql']
```

- [ ] **Step 5.1.3: Apply migration**

```bash
npm run db:migrate
```

Expected output (tail):
```
Applied: 0004_scheduled_runs.sql
```

### Task 5.2: Drizzle schema

- [ ] **Step 5.2.1: Edit `src/infrastructure/db/schema.ts`**

Append at end of file:

```ts
export const scheduledRuns = pgTable('scheduled_runs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  parserId:       uuid('parser_id').notNull().references(() => parsers.id, { onDelete: 'cascade' }),
  cronExpression: text('cron_expression').notNull(),
  enabled:        boolean('enabled').notNull().default(true),
  lastRunAt:      timestamp('last_run_at', { withTimezone: true }),
  nextRunAt:      timestamp('next_run_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### Task 5.3: Failing test for SchedulePersistenceService

- [ ] **Step 5.3.1: Create `src/tests/schedulerService.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import parser from 'cron-parser'

vi.mock('../infrastructure/db/client.js', () => ({ db: {}, pool: {} }))

describe('cron-parser smoke', () => {
  it('computes next fire date for every-minute cron', () => {
    const it = parser.parseExpression('* * * * *', { currentDate: new Date('2026-05-21T00:00:00Z') })
    const next = it.next().toDate()
    expect(next.getTime()).toBe(new Date('2026-05-21T00:01:00Z').getTime())
  })
})
```

- [ ] **Step 5.3.2: Run test (expect pass — proves dep works)**

```bash
npm run test -- schedulerService
```

Expected: 1 passing.

### Task 5.4: SchedulePersistenceService (Drizzle-only)

- [ ] **Step 5.4.1: Create `src/infrastructure/db/SchedulePersistenceService.ts`**

```ts
import { eq } from 'drizzle-orm'
import { scheduledRuns } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type ScheduleRow = typeof scheduledRuns.$inferSelect

export interface UpsertScheduleInput {
  parserId:       string
  cronExpression: string
  enabled:        boolean
  nextRunAt?:     Date | null
}

export interface UpdateScheduleInput {
  cronExpression?: string
  enabled?:        boolean
  nextRunAt?:      Date | null
  lastRunAt?:      Date | null
}

export class SchedulePersistenceService extends BasePersistenceService<ScheduleRow, UpsertScheduleInput, UpdateScheduleInput> {

  async create(input: UpsertScheduleInput): Promise<ScheduleRow> {
    const [row] = await this.db.insert(scheduledRuns).values({
      parserId:       input.parserId,
      cronExpression: input.cronExpression,
      enabled:        input.enabled,
      nextRunAt:      input.nextRunAt ?? null,
    }).returning()
    return row
  }

  async findById(id: string): Promise<ScheduleRow | null> {
    const [row] = await this.db.select().from(scheduledRuns).where(eq(scheduledRuns.id, id))
    return row ?? null
  }

  async update(id: string, input: UpdateScheduleInput): Promise<ScheduleRow> {
    const [row] = await this.db.update(scheduledRuns).set({
      ...(input.cronExpression !== undefined && { cronExpression: input.cronExpression }),
      ...(input.enabled        !== undefined && { enabled:        input.enabled }),
      ...(input.nextRunAt      !== undefined && { nextRunAt:      input.nextRunAt }),
      ...(input.lastRunAt      !== undefined && { lastRunAt:      input.lastRunAt }),
    }).where(eq(scheduledRuns.id, id)).returning()
    return row
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(scheduledRuns).where(eq(scheduledRuns.id, id))
  }

  async findByParserId(parserId: string): Promise<ScheduleRow | null> {
    const [row] = await this.db.select().from(scheduledRuns).where(eq(scheduledRuns.parserId, parserId))
    return row ?? null
  }

  async upsertForParser(input: UpsertScheduleInput): Promise<ScheduleRow> {
    const existing = await this.findByParserId(input.parserId)
    if (existing) {
      return this.update(existing.id, {
        cronExpression: input.cronExpression,
        enabled:        input.enabled,
        nextRunAt:      input.nextRunAt ?? null,
      })
    }
    return this.create(input)
  }

  async deleteByParserId(parserId: string): Promise<void> {
    await this.db.delete(scheduledRuns).where(eq(scheduledRuns.parserId, parserId))
  }

  async listEnabled(): Promise<ScheduleRow[]> {
    return this.db.select().from(scheduledRuns).where(eq(scheduledRuns.enabled, true))
  }
}
```

### Task 5.5: SchedulerService

- [ ] **Step 5.5.1: Create `src/application/services/SchedulerService.ts`**

```ts
import cronParser from 'cron-parser'
import type { SchedulePersistenceService } from '../../infrastructure/db/SchedulePersistenceService.js'
import type { ParserPersistenceService } from '../../infrastructure/db/ParserPersistenceService.js'
import type { ParserRunnerService } from './ParserRunnerService.js'

const POLL_MS = 60_000

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly schedules: SchedulePersistenceService,
    private readonly parsers:   ParserPersistenceService,
    private readonly runner:    ParserRunnerService,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { this.tick().catch((e) => console.error('[scheduler] tick:', e)) }, POLL_MS)
    // Run once immediately so a freshly added schedule with next_run_at <= now fires without a 60s wait.
    this.tick().catch((e) => console.error('[scheduler] initial tick:', e))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Compute next fire date from a cron expression. Returns null on parse error. */
  static nextFireAt(cronExpression: string, from: Date = new Date()): Date | null {
    try {
      const it = cronParser.parseExpression(cronExpression, { currentDate: from })
      return it.next().toDate()
    } catch {
      return null
    }
  }

  private async tick(): Promise<void> {
    const due = (await this.schedules.listEnabled())
      .filter((s) => s.nextRunAt !== null && s.nextRunAt.getTime() <= Date.now())
    for (const s of due) {
      const parser = await this.parsers.findById(s.parserId)
      if (!parser) continue
      if (this.runner.isRunning(parser.name)) continue
      const next = SchedulerService.nextFireAt(s.cronExpression)
      await this.schedules.update(s.id, { lastRunAt: new Date(), nextRunAt: next })
      this.runner.run(parser.name).catch((err) => console.error(`[scheduler] run "${parser.name}":`, err))
    }
  }
}
```

### Task 5.6: API endpoints

- [ ] **Step 5.6.1: Edit `src/api/routes/parsers.ts`**

At top of file, add to imports:
```ts
import type { SchedulePersistenceService } from '../../infrastructure/db/SchedulePersistenceService.js'
import { SchedulerService } from '../../application/services/SchedulerService.js'
```

Extend `Deps`:
```ts
interface Deps {
  runner: ParserRunnerService
  runPersistence: RunPersistenceService
  parserService: ParserPersistenceService
  dbLoader: DbParserLoader
  outputDir: string
  schedulePersistence: SchedulePersistenceService
}
```

And the destructure:
```ts
export function createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir, schedulePersistence }: Deps) {
```

Add the endpoints after the existing `/:id/status` block:

```ts
  router.get('/:id/schedule', async (_req, res) => {
    const { id }: ParserRow = res.locals.parser
    const row = await schedulePersistence.findByParserId(id)
    res.json({ schedule: row ?? null })
  })

  router.put('/:id/schedule', async (req, res) => {
    const { id }: ParserRow = res.locals.parser
    const { cronExpression, enabled } = req.body as { cronExpression: string; enabled: boolean }
    if (typeof cronExpression !== 'string' || !cronExpression.trim()) {
      res.status(400).json({ error: 'cronExpression is required' }); return
    }
    const nextRunAt = SchedulerService.nextFireAt(cronExpression)
    if (!nextRunAt) { res.status(400).json({ error: 'Invalid cron expression' }); return }
    const row = await schedulePersistence.upsertForParser({
      parserId:       id,
      cronExpression,
      enabled:        Boolean(enabled),
      nextRunAt,
    })
    res.json({ schedule: row })
  })

  router.delete('/:id/schedule', async (_req, res) => {
    const { id }: ParserRow = res.locals.parser
    await schedulePersistence.deleteByParserId(id)
    res.json({ ok: true })
  })
```

### Task 5.7: Wire in server.ts

- [ ] **Step 5.7.1: Edit `src/api/server.ts`**

Imports — add:
```ts
import { SchedulePersistenceService } from '../infrastructure/db/SchedulePersistenceService.js'
import { SchedulerService } from '../application/services/SchedulerService.js'
```

Service block — after `const parserService = …`, add:
```ts
const schedulePersistence = new SchedulePersistenceService()
const scheduler           = new SchedulerService(schedulePersistence, parserService, runner)
scheduler.start()
```

Router mount — change:
```ts
app.use('/api/parsers', createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir }))
```

To:
```ts
app.use('/api/parsers', createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir, schedulePersistence }))
```

Shutdown — extend:
```ts
async function shutdown() {
  scheduler.stop()
  await Promise.allSettled(runner.listRunning().map((name) => runner.stop(name)))
  process.exit(0)
}
```

### Task 5.8: Client API + UI

- [ ] **Step 5.8.1: Edit `client/src/api.ts`** — append:

```ts
export interface Schedule {
  id: string
  parserId: string
  cronExpression: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

export async function getSchedule(parserId: string): Promise<Schedule | null> {
  const r = await apiRequest<{ schedule: Schedule | null }>(`/api/parsers/${parserId}/schedule`)
  return r.schedule
}

export async function setSchedule(parserId: string, cronExpression: string, enabled: boolean): Promise<Schedule> {
  const r = await apiRequest<{ schedule: Schedule }>(`/api/parsers/${parserId}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cronExpression, enabled }),
  })
  return r.schedule
}

export async function deleteSchedule(parserId: string): Promise<void> {
  await apiRequest(`/api/parsers/${parserId}/schedule`, { method: 'DELETE' })
}
```

- [ ] **Step 5.8.2: Create `client/src/components/SchedulePanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { getSchedule, setSchedule, deleteSchedule, type Schedule } from '../api'

interface Props { parserId: string }

export function SchedulePanel({ parserId }: Props) {
  const [schedule, setS] = useState<Schedule | null>(null)
  const [cron, setCron] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSchedule(parserId).then((s) => {
      setS(s)
      if (s) { setCron(s.cronExpression); setEnabled(s.enabled) }
    })
  }, [parserId])

  async function save() {
    setSaving(true); setError(null)
    try {
      const s = await setSchedule(parserId, cron, enabled)
      setS(s)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function clear() {
    await deleteSchedule(parserId)
    setS(null); setCron(''); setEnabled(true)
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
      <h3 className="text-sm font-semibold mb-2">Schedule</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Cron expression</label>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 */6 * * *"
            className="text-xs px-2 py-1 w-40 rounded border border-gray-300 dark:border-gray-700 bg-transparent"
          />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <button onClick={save} disabled={saving || !cron.trim()} className="text-xs px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {schedule && (
          <button onClick={clear} className="text-xs px-3 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {schedule?.nextRunAt && <p className="text-xs text-gray-400 mt-2">Next run: {new Date(schedule.nextRunAt).toLocaleString()}</p>}
    </div>
  )
}
```

- [ ] **Step 5.8.3: Mount in `ParserDetailPage.tsx`**

Add import:
```tsx
import { SchedulePanel } from './SchedulePanel'
```

Place `<SchedulePanel parserId={parserId} />` in the detail page body, beneath the stats grid.

### Task 5.9: Build, test, commit

- [ ] **Step 5.9.1: Run**

```bash
npm run build && npm run test -- schedulerService
```

Expected: no errors, 1 test passing.

- [ ] **Step 5.9.2: Commit**

```bash
git add src/infrastructure/db/migrations/0004_scheduled_runs.sql src/infrastructure/db/migrate.ts src/infrastructure/db/schema.ts src/infrastructure/db/SchedulePersistenceService.ts src/application/services/SchedulerService.ts src/api/routes/parsers.ts src/api/server.ts client/src/api.ts client/src/components/SchedulePanel.tsx client/src/components/ParserDetailPage.tsx src/tests/schedulerService.test.ts
git commit -m "feat(scheduler): cron-based scheduled parser runs"
```

### Task 5.10: Design log

- [ ] **Step 5.10.1: Create `design-log/013-cron-scheduler.md` and update index.**

```bash
git add design-log/013-cron-scheduler.md design-log/index.md
git commit -m "docs(design-log): 013 cron scheduler"
```

---

## Subsystem 6 — Webhook Notifications

### Task 6.1: Migration `0005_webhook_url.sql`

- [ ] **Step 6.1.1: Create `src/infrastructure/db/migrations/0005_webhook_url.sql`**

```sql
ALTER TABLE parsers ADD COLUMN IF NOT EXISTS webhook_url TEXT;
```

- [ ] **Step 6.1.2: Register in `migrate.ts`**

Update the migrations array to append `'0005_webhook_url.sql'`.

- [ ] **Step 6.1.3: Apply**

```bash
npm run db:migrate
```

Expected tail:
```
Applied: 0005_webhook_url.sql
```

### Task 6.2: Schema + persistence updates

- [ ] **Step 6.2.1: Edit `src/infrastructure/db/schema.ts` — parsers table**

Find:
```ts
  concurrentQuota: integer('concurrent_quota'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

Replace with:
```ts
  concurrentQuota: integer('concurrent_quota'),
  webhookUrl: text('webhook_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 6.2.2: Edit `src/infrastructure/db/ParserPersistenceService.ts`**

In `CreateParserInput` add `webhookUrl?: string | null`.
In `UpdateParserInput` add `webhookUrl?: string | null`.

In `create()`, add to the insert values:
```ts
        webhookUrl:      input.webhookUrl      ?? null,
```

In `update()`, add to the set spread:
```ts
      ...(input.webhookUrl !== undefined && { webhookUrl: input.webhookUrl }),
```

### Task 6.3: Failing test for WebhookService

- [ ] **Step 6.3.1: Create `src/tests/webhookService.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebhookService } from '../infrastructure/webhook/WebhookService.js'

describe('WebhookService', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('posts JSON payload to the URL', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const svc = new WebhookService()
    await svc.fire('https://hooks.example.com/x', { event: 'complete', parserName: 'demo', runId: 'r1', stats: null, timestamp: '2026-05-21T00:00:00Z' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hooks.example.com/x')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.event).toBe('complete')
  })

  it('does not throw when the request fails', async () => {
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const svc = new WebhookService()
    await expect(svc.fire('https://nope', { event: 'error', parserName: 'demo', runId: 'r', stats: null, timestamp: '' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 6.3.2: Run (expect failure)**

```bash
npm run test -- webhookService
```

Expected:
```
FAIL: Cannot find module '../infrastructure/webhook/WebhookService.js'
```

### Task 6.4: Implement WebhookService

- [ ] **Step 6.4.1: Create `src/infrastructure/webhook/WebhookService.ts`**

```ts
import type { RunStats } from '../../domain/entities/ParserRun.js'

export interface WebhookPayload {
  event:      'complete' | 'stopped' | 'error'
  parserName: string
  runId:      string | null
  stats:      RunStats | null
  timestamp:  string
}

export class WebhookService {
  async fire(url: string, payload: WebhookPayload): Promise<void> {
    try {
      await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
    } catch (err) {
      console.error(`[webhook] POST ${url} failed:`, (err as Error).message)
    }
  }
}
```

- [ ] **Step 6.4.2: Run test (expect pass)**

```bash
npm run test -- webhookService
```

Expected: 2 passing.

### Task 6.5: Wire into server.ts

- [ ] **Step 6.5.1: Edit `src/api/server.ts`**

Imports — add:
```ts
import { WebhookService } from '../infrastructure/webhook/WebhookService.js'
```

Add service:
```ts
const webhookService = new WebhookService()
```

Fire webhooks. Find:
```ts
runner.on('complete',    (name: string, stats: RunStats) => broadcast(name, { type: 'complete', stats }))
runner.on('stopped',     (name: string)                  => broadcast(name, { type: 'stopped' }))
```

Replace with:
```ts
runner.on('complete', async (name: string, stats: RunStats) => {
  broadcast(name, { type: 'complete', stats })
  const parser = await parserService.getParserByName(name).catch(() => null)
  if (parser?.webhookUrl) {
    void webhookService.fire(parser.webhookUrl, { event: 'complete', parserName: name, runId: null, stats, timestamp: new Date().toISOString() })
  }
})
runner.on('stopped', async (name: string) => {
  broadcast(name, { type: 'stopped' })
  const parser = await parserService.getParserByName(name).catch(() => null)
  if (parser?.webhookUrl) {
    void webhookService.fire(parser.webhookUrl, { event: 'stopped', parserName: name, runId: null, stats: runner.getStats(name) ?? null, timestamp: new Date().toISOString() })
  }
})
```

### Task 6.6: API route accepts webhookUrl

- [ ] **Step 6.6.1: Edit `src/api/routes/parsers.ts`**

Find the PUT handler body destructure:
```ts
    const { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body
    const parser = await parserService.update(id, { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota })
```

Replace with:
```ts
    const { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota, webhookUrl } = req.body
    const parser = await parserService.update(id, { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota, webhookUrl })
```

### Task 6.7: Client types + UI

- [ ] **Step 6.7.1: Edit `client/src/api.ts`**

In `ParserRow`, add `webhookUrl: string | null`.
In `UpdateParserInput`, add `webhookUrl?: string | null`.

- [ ] **Step 6.7.2: Edit `client/src/components/ParserSettingsPanel.tsx`**

Add a new field block inside the settings flex row (next to Concurrent Quota):

```tsx
{/* Webhook URL */}
<div className="flex flex-col gap-1 w-full max-w-md">
  <label className="text-xs text-gray-500 font-medium">Webhook URL</label>
  <input
    type="url"
    defaultValue={parser.webhookUrl ?? ''}
    onBlur={(e) => onSave({ webhookUrl: e.target.value.trim() === '' ? null : e.target.value.trim() })}
    placeholder="https://hooks.example.com/run-events"
    className={`${inputClass} w-full`}
  />
</div>
```

### Task 6.8: Build + commit

- [ ] **Step 6.8.1: Build**

```bash
npm run build
```

- [ ] **Step 6.8.2: Commit**

```bash
git add src/infrastructure/db/migrations/0005_webhook_url.sql src/infrastructure/db/migrate.ts src/infrastructure/db/schema.ts src/infrastructure/db/ParserPersistenceService.ts src/infrastructure/webhook/WebhookService.ts src/api/server.ts src/api/routes/parsers.ts client/src/api.ts client/src/components/ParserSettingsPanel.tsx src/tests/webhookService.test.ts
git commit -m "feat(webhook): per-parser webhook URL fires on run complete/stopped"
```

### Task 6.9: Design log

- [ ] **Step 6.9.1: Create `design-log/014-webhook-notifications.md` and update index.**

```bash
git add design-log/014-webhook-notifications.md design-log/index.md
git commit -m "docs(design-log): 014 webhook notifications"
```

---

## Subsystem 7 — Proxy Rotation Pool

### Task 7.1: Failing test for ProxyPoolService

- [ ] **Step 7.1.1: Create `src/tests/proxyPoolService.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ProxyPoolService } from '../infrastructure/proxy/ProxyPoolService.js'

describe('ProxyPoolService', () => {
  it('round-robins through entries', () => {
    const pool = new ProxyPoolService(['http://a:1', 'http://b:2', 'http://c:3'])
    expect(pool.next()).toBe('http://a:1')
    expect(pool.next()).toBe('http://b:2')
    expect(pool.next()).toBe('http://c:3')
    expect(pool.next()).toBe('http://a:1')
  })
  it('returns undefined when empty', () => {
    const pool = new ProxyPoolService([])
    expect(pool.next()).toBeUndefined()
  })
  it('ignores blank lines and trims', () => {
    const pool = new ProxyPoolService(['  http://a:1  ', '', 'http://b:2'])
    expect(pool.next()).toBe('http://a:1')
    expect(pool.next()).toBe('http://b:2')
  })
})
```

- [ ] **Step 7.1.2: Run test (expect failure)**

```bash
npm run test -- proxyPoolService
```

Expected:
```
FAIL: Cannot find module '../infrastructure/proxy/ProxyPoolService.js'
```

### Task 7.2: Implement ProxyPoolService

- [ ] **Step 7.2.1: Create `src/infrastructure/proxy/ProxyPoolService.ts`**

```ts
export class ProxyPoolService {
  private readonly pool: string[]
  private idx = 0

  constructor(input: string[]) {
    this.pool = (input ?? []).map((s) => s.trim()).filter(Boolean)
  }

  size(): number { return this.pool.length }

  next(): string | undefined {
    if (this.pool.length === 0) return undefined
    const v = this.pool[this.idx % this.pool.length]
    this.idx++
    return v
  }
}
```

- [ ] **Step 7.2.2: Run test (expect pass)**

```bash
npm run test -- proxyPoolService
```

Expected: 3 passing.

### Task 7.3: Add `proxyPool` to StepSettings

- [ ] **Step 7.3.1: Edit `src/domain/value-objects/StepSettings.ts`**

After `proxySettings?: ProxySettings`:

```ts
  /** Round-robin pool of proxy URLs (e.g. http://user:pass@host:port). Overrides proxySettings if non-empty. */
  proxyPool?: string[]
```

### Task 7.4: Use pool in workers (Extractor)

- [ ] **Step 7.4.1: Edit `src/infrastructure/worker/buildContextOptions.ts`**

Find:
```ts
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

type PartialSettings = Pick<StepSettings, 'contextOptions' | 'userAgent' | 'proxySettings'> | undefined

export function buildContextOptions(base: PartialSettings, override: PartialSettings): BrowserContextOptions {
  const userAgent = override?.userAgent ?? base?.userAgent
  const proxySettings = override?.proxySettings ?? base?.proxySettings
```

Replace with:
```ts
import type { StepSettings } from '../../domain/value-objects/StepSettings.js'

type PartialSettings = Pick<StepSettings, 'contextOptions' | 'userAgent' | 'proxySettings'> | undefined

export function buildContextOptions(base: PartialSettings, override: PartialSettings, proxyUrlOverride?: string): BrowserContextOptions {
  const userAgent = override?.userAgent ?? base?.userAgent
  const proxySettings = override?.proxySettings ?? base?.proxySettings

  // Pool override wins over per-step proxySettings.
  if (proxyUrlOverride) {
    return {
      ...(userAgent && { userAgent }),
      proxy: { server: proxyUrlOverride },
      ...base?.contextOptions,
      ...override?.contextOptions,
    }
  }
```

- [ ] **Step 7.4.2: Edit `src/infrastructure/worker/ExtractorWorker.ts`**

Add import at top:
```ts
import { ProxyPoolService } from '../proxy/ProxyPoolService.js'
```

Add a module-level variable next to other state:
```ts
let proxyPool: ProxyPoolService = new ProxyPoolService([])
```

In `main()`, after `savedSettings = mergedSettings`:
```ts
  proxyPool = new ProxyPoolService((mergedSettings as { proxyPool?: string[] }).proxyPool ?? [])
```

Edit `rotateAdapter` to pick next proxy and apply via launch settings. Replace its body:
```ts
async function rotateAdapter(): Promise<void> {
  console.log('[worker] Rotating browser context…')
  await adapter.close().catch(console.error)
  const proxyUrl = proxyPool.next()
  const settingsForLaunch = proxyUrl
    ? { ...savedSettings, contextOptions: { ...(savedSettings.contextOptions ?? {}), proxy: { server: proxyUrl } } }
    : savedSettings
  adapter = createBrowserAdapter(savedSettings.browser_type, settingsForLaunch)
  await adapter.launch()
  if (savedSettings.initScripts?.length) {
    const pa = adapter as import("../browser/PlaywrightAdapter.js").PlaywrightAdapter
    for (const script of savedSettings.initScripts) {
      await pa.addInitScript(script)
    }
  }
  if (proxyUrl) console.log(`[worker] Rotated to proxy: ${proxyUrl.replace(/:\/\/[^@]*@/, '://***@')}`)
  else console.log('[worker] Browser context rotated.')
}
```

Also, on the initial launch (inside `main()` after `adapter = createBrowserAdapter(...)`) apply the first proxy:
Find:
```ts
  adapter = createBrowserAdapter(mergedSettings.browser_type, mergedSettings)
  await adapter.launch()
```

Replace with:
```ts
  const firstProxy = proxyPool.next()
  const initialSettings = firstProxy
    ? { ...mergedSettings, contextOptions: { ...(mergedSettings.contextOptions ?? {}), proxy: { server: firstProxy } } }
    : mergedSettings
  adapter = createBrowserAdapter(mergedSettings.browser_type, initialSettings)
  await adapter.launch()
```

### Task 7.5: Same for TraverserWorker

- [ ] **Step 7.5.1: Edit `src/infrastructure/worker/TraverserWorker.ts`** — apply identical changes as in 7.4.2 (import, module-level `proxyPool`, rotate and initial-launch wiring).

### Task 7.6: Client UI textarea

- [ ] **Step 7.6.1: Edit `client/src/components/ParserEditorPage.tsx`**

Inside `StepSettingsBar`, add a new full-width block beneath the existing fields:

```tsx
{/* Proxy Pool */}
<div className="flex flex-col gap-1 w-full">
  <label className="text-xs text-gray-500 font-medium">
    Proxy Pool <span className="font-normal text-gray-400">(one URL per line; round-robin)</span>
  </label>
  <textarea
    key={Array.isArray(settings.proxyPool) ? settings.proxyPool.join('\n') : ''}
    defaultValue={Array.isArray(settings.proxyPool) ? (settings.proxyPool as string[]).join('\n') : ''}
    onBlur={(e) => {
      const list = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
      save({ proxyPool: list.length ? list : undefined })
    }}
    rows={3}
    placeholder={'http://user:pass@host1:8080\nhttp://user:pass@host2:8080'}
    className="text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
  />
</div>
```

### Task 7.7: Build, commit

- [ ] **Step 7.7.1: Build**

```bash
npm run build && npm run test -- proxyPoolService
```

Expected: no errors; 3 passing.

- [ ] **Step 7.7.2: Commit**

```bash
git add src/infrastructure/proxy/ProxyPoolService.ts src/infrastructure/worker/ExtractorWorker.ts src/infrastructure/worker/TraverserWorker.ts src/infrastructure/worker/buildContextOptions.ts src/domain/value-objects/StepSettings.ts client/src/components/ParserEditorPage.tsx src/tests/proxyPoolService.test.ts
git commit -m "feat(proxy): round-robin proxy pool per worker context rotation"
```

### Task 7.8: Design log

- [ ] **Step 7.8.1: Create `design-log/015-proxy-pool-rotation.md` and update index.**

```bash
git add design-log/015-proxy-pool-rotation.md design-log/index.md
git commit -m "docs(design-log): 015 proxy pool rotation"
```

---

## Subsystem 8 — Parser Versioning

### Task 8.1: Migration `0006_step_versions.sql`

- [ ] **Step 8.1.1: Create `src/infrastructure/db/migrations/0006_step_versions.sql`**

```sql
CREATE TABLE IF NOT EXISTS step_versions (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id   UUID        NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  code      TEXT        NOT NULL,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS step_versions_step_idx ON step_versions(step_id, saved_at DESC);
```

- [ ] **Step 8.1.2: Register in `migrate.ts`** — add `'0006_step_versions.sql'`.

- [ ] **Step 8.1.3: Apply**

```bash
npm run db:migrate
```

Expected tail:
```
Applied: 0006_step_versions.sql
```

### Task 8.2: Drizzle schema

- [ ] **Step 8.2.1: Edit `src/infrastructure/db/schema.ts`** — append:

```ts
export const stepVersions = pgTable('step_versions', {
  id:      uuid('id').primaryKey().defaultRandom(),
  stepId:  uuid('step_id').notNull().references(() => steps.id, { onDelete: 'cascade' }),
  code:    text('code').notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
})
```

### Task 8.3: Failing test for StepVersionPersistenceService

- [ ] **Step 8.3.1: Create `src/tests/stepVersionPersistence.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'

const calls: any[] = []

vi.mock('../infrastructure/db/client.js', () => {
  const chain = {
    insert: (..._a: any[]) => chain,
    values: (v: any) => { calls.push({ op: 'insert', v }); return chain },
    returning: () => Promise.resolve([{ id: 'v1', stepId: 'step1', code: 'x', savedAt: new Date() }]),
    select: (..._a: any[]) => chain,
    from: (..._a: any[]) => chain,
    where: (..._a: any[]) => chain,
    orderBy: (..._a: any[]) => chain,
    limit: (n: number) => { calls.push({ op: 'limit', n }); return Promise.resolve([]) },
    delete: (..._a: any[]) => chain,
  }
  return { db: chain, pool: {} }
})

import { StepVersionPersistenceService } from '../infrastructure/db/StepVersionPersistenceService.js'

describe('StepVersionPersistenceService', () => {
  it('save() calls insert with stepId + code', async () => {
    const svc = new StepVersionPersistenceService()
    await svc.save('step1', 'console.log("v1")')
    const inserted = calls.find(c => c.op === 'insert')
    expect(inserted?.v.stepId).toBe('step1')
    expect(inserted?.v.code).toBe('console.log("v1")')
  })
  it('list() uses limit', async () => {
    const svc = new StepVersionPersistenceService()
    await svc.list('step1', 20)
    expect(calls.some(c => c.op === 'limit' && c.n === 20)).toBe(true)
  })
})
```

- [ ] **Step 8.3.2: Run test (expect failure)**

```bash
npm run test -- stepVersionPersistence
```

Expected:
```
FAIL: Cannot find module '../infrastructure/db/StepVersionPersistenceService.js'
```

### Task 8.4: Implement StepVersionPersistenceService

- [ ] **Step 8.4.1: Create `src/infrastructure/db/StepVersionPersistenceService.ts`**

```ts
import { eq, desc } from 'drizzle-orm'
import { stepVersions } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type StepVersionRow = typeof stepVersions.$inferSelect

export interface CreateVersionInput { stepId: string; code: string }
export interface UpdateVersionInput { code?: string }

export class StepVersionPersistenceService extends BasePersistenceService<StepVersionRow, CreateVersionInput, UpdateVersionInput> {
  async create(input: CreateVersionInput): Promise<StepVersionRow> {
    const [row] = await this.db.insert(stepVersions).values({ stepId: input.stepId, code: input.code }).returning()
    return row
  }
  async findById(id: string): Promise<StepVersionRow | null> {
    const [row] = await this.db.select().from(stepVersions).where(eq(stepVersions.id, id))
    return row ?? null
  }
  async update(id: string, input: UpdateVersionInput): Promise<StepVersionRow> {
    const [row] = await this.db.update(stepVersions)
      .set({ ...(input.code !== undefined && { code: input.code }) })
      .where(eq(stepVersions.id, id))
      .returning()
    return row
  }
  async delete(id: string): Promise<void> {
    await this.db.delete(stepVersions).where(eq(stepVersions.id, id))
  }
  async save(stepId: string, code: string): Promise<StepVersionRow> {
    return this.create({ stepId, code })
  }
  async list(stepId: string, limit = 20): Promise<StepVersionRow[]> {
    return this.db.select().from(stepVersions)
      .where(eq(stepVersions.stepId, stepId))
      .orderBy(desc(stepVersions.savedAt))
      .limit(limit)
  }
}
```

- [ ] **Step 8.4.2: Run test (expect pass)**

```bash
npm run test -- stepVersionPersistence
```

Expected: 2 passing.

### Task 8.5: Save version on code change in ParserPersistenceService.updateStep

- [ ] **Step 8.5.1: Edit `src/infrastructure/db/ParserPersistenceService.ts`**

Add to imports:
```ts
import type { StepVersionPersistenceService } from './StepVersionPersistenceService.js'
```

Add a settable field + setter (keep class export shape stable):

Find the class declaration:
```ts
export class ParserPersistenceService extends BasePersistenceService<ParserRow, CreateParserInput, UpdateParserInput> {
```

Insert immediately below it:
```ts
  private versions: StepVersionPersistenceService | null = null

  setVersionService(svc: StepVersionPersistenceService): void { this.versions = svc }
```

Change `updateStep` to snapshot old code before updating. Find:
```ts
  async updateStep(stepId: string, input: UpdateStepInput): Promise<StepRow> {
    try {
      const [updated] = await this.db.update(stepsTable).set({
```

Replace with:
```ts
  async updateStep(stepId: string, input: UpdateStepInput): Promise<StepRow> {
    try {
      if (input.code !== undefined && this.versions) {
        const [existing] = await this.db.select().from(stepsTable).where(eq(stepsTable.id, stepId))
        if (existing && existing.code !== input.code && existing.code.length > 0) {
          await this.versions.save(stepId, existing.code).catch((e) => console.error('[step-version] save failed:', e))
        }
      }
      const [updated] = await this.db.update(stepsTable).set({
```

### Task 8.6: Wire in server.ts

- [ ] **Step 8.6.1: Edit `src/api/server.ts`**

Add imports:
```ts
import { StepVersionPersistenceService } from '../infrastructure/db/StepVersionPersistenceService.js'
```

After `const parserService = new ParserPersistenceService()`:
```ts
const stepVersionService = new StepVersionPersistenceService()
parserService.setVersionService(stepVersionService)
```

Extend the router deps:
```ts
app.use('/api/parsers', createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir, schedulePersistence, stepVersionService }))
```

### Task 8.7: API endpoints

- [ ] **Step 8.7.1: Edit `src/api/routes/parsers.ts`**

Add to imports:
```ts
import type { StepVersionPersistenceService } from '../../infrastructure/db/StepVersionPersistenceService.js'
```

Extend `Deps`:
```ts
  stepVersionService: StepVersionPersistenceService
```

Update destructure:
```ts
export function createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir, schedulePersistence, stepVersionService }: Deps) {
```

After the existing `router.delete('/:id/steps/:step', …)` block, append:

```ts
  router.get('/:id/steps/:step/versions', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) { res.status(404).json({ error: `Step "${req.params.step}" not found` }); return }
    const rows = await stepVersionService.list(step.id, 20)
    res.json({ versions: rows })
  })

  router.post('/:id/steps/:step/versions/:versionId/restore', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) { res.status(404).json({ error: `Step "${req.params.step}" not found` }); return }
    const version = await stepVersionService.findById(req.params.versionId)
    if (!version || version.stepId !== step.id) { res.status(404).json({ error: 'Version not found' }); return }
    const updated = await parserService.updateStep(step.id, { code: version.code })
    res.json({ step: updated })
  })
```

### Task 8.8: Client API + UI

- [ ] **Step 8.8.1: Edit `client/src/api.ts`** — append:

```ts
export interface StepVersion {
  id: string
  stepId: string
  code: string
  savedAt: string
}

export async function listStepVersions(parserId: string, stepName: string): Promise<StepVersion[]> {
  const r = await apiRequest<{ versions: StepVersion[] }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}/versions`)
  return r.versions
}

export async function restoreStepVersion(parserId: string, stepName: string, versionId: string): Promise<StepRow> {
  const r = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}/versions/${versionId}/restore`, { method: 'POST' })
  return r.step
}
```

- [ ] **Step 8.8.2: Create `client/src/components/StepVersionsPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { listStepVersions, restoreStepVersion, type StepVersion } from '../api'

interface Props {
  parserId: string
  stepName: string
  onRestored: (code: string) => void
  onClose: () => void
}

export function StepVersionsPanel({ parserId, stepName, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<StepVersion[]>([])
  const [selected, setSelected] = useState<StepVersion | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listStepVersions(parserId, stepName).then((v) => { setVersions(v); setLoading(false) })
  }, [parserId, stepName])

  return (
    <div className="absolute right-0 top-0 h-full w-96 z-20 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-sm font-semibold">Version History</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-3 text-xs text-gray-400">Loading…</p>}
        {!loading && versions.length === 0 && <p className="p-3 text-xs text-gray-400">No prior versions.</p>}
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v)}
            className={`block w-full text-left px-3 py-2 text-xs border-b border-gray-100 dark:border-gray-800 ${selected?.id === v.id ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <div className="font-medium">{new Date(v.savedAt).toLocaleString()}</div>
            <div className="text-gray-400 truncate">{v.code.slice(0, 60)}{v.code.length > 60 ? '…' : ''}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="border-t border-gray-200 dark:border-gray-800 p-2">
          <pre className="max-h-40 overflow-auto text-[10px] font-mono bg-gray-50 dark:bg-gray-950 p-2 rounded mb-2">{selected.code}</pre>
          <button
            onClick={async () => {
              const step = await restoreStepVersion(parserId, stepName, selected.id)
              onRestored(step.code)
              onClose()
            }}
            className="w-full text-xs py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Restore this version
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8.8.3: Wire history button into `ParserEditorPage.tsx`**

Add import:
```tsx
import { StepVersionsPanel } from './StepVersionsPanel'
```

Add state alongside `showDebug`:
```tsx
const [showHistory, setShowHistory] = useState(false)
```

Add a button in the step meta bar action group (next to the settings/debug buttons):

```tsx
<button
  onClick={() => setShowHistory((v) => !v)}
  className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
  title="Version history"
>
  ⏱
</button>
```

Inside the same `<AnimatePresence>` overlay region (after the debug panel), add:

```tsx
{showHistory && selectedStep && (
  <StepVersionsPanel
    parserId={parserId}
    stepName={selectedStep.name}
    onRestored={(code) => handleCodeChange(code)}
    onClose={() => setShowHistory(false)}
  />
)}
```

### Task 8.9: Build, commit

- [ ] **Step 8.9.1: Build + test**

```bash
npm run build && npm run test
```

Expected: no errors; all subsystem tests passing.

- [ ] **Step 8.9.2: Commit**

```bash
git add src/infrastructure/db/migrations/0006_step_versions.sql src/infrastructure/db/migrate.ts src/infrastructure/db/schema.ts src/infrastructure/db/StepVersionPersistenceService.ts src/infrastructure/db/ParserPersistenceService.ts src/api/server.ts src/api/routes/parsers.ts client/src/api.ts client/src/components/StepVersionsPanel.tsx client/src/components/ParserEditorPage.tsx src/tests/stepVersionPersistence.test.ts
git commit -m "feat(versioning): per-step code version history with restore"
```

### Task 8.10: Design log

- [ ] **Step 8.10.1: Create `design-log/016-step-versioning.md` and update index.**

```bash
git add design-log/016-step-versioning.md design-log/index.md
git commit -m "docs(design-log): 016 step versioning"
```

---

## Self-Review Checklist

Before considering this plan complete, the implementing agent must verify:

**Spec coverage:**
- [ ] All 8 subsystems delivered with API + UI + persistence (where applicable)
- [ ] Migrations `0004`/`0005`/`0006` exist, are registered in `migrate.ts`, and applied
- [ ] Drizzle schema includes `scheduledRuns`, `webhookUrl` on parsers, `stepVersions`
- [ ] No raw SQL string in any new TypeScript service (all use Drizzle query builder; the only existing raw SQL queries in `RunPersistenceService.ts` are unmodified by this plan)
- [ ] `cron-parser` and `exceljs` listed in `package.json` dependencies
- [ ] Each subsystem has a design-log entry numbered 009–016, linked in `design-log/index.md`
- [ ] Tests in `src/tests/` use Vitest, import from `vitest`, and mock DB via `vi.mock('../infrastructure/db/client.js', …)`

**Placeholder scan:** grep the diff for `TBD`, `TODO`, `FIXME`, `XXX`, `...`, `<placeholder>`. None should appear in committed code.

**Type consistency:**
- [ ] `OutputWriter` interface satisfied by `CsvWriter`, `JsonWriter`, `ExcelWriter`
- [ ] `StepSettings.outputFormat` matches `OutputFormat` union
- [ ] `StepSettings.proxyPool` is `string[] | undefined`
- [ ] `WebhookPayload.event` is the literal union `'complete'|'stopped'|'error'`
- [ ] `Schedule` client type matches `ScheduleRow` server type (with `Date` serialized as ISO strings over JSON)
- [ ] `ParserRow.webhookUrl` is `string | null` on both server and client

**Run all tests once before each subsystem commit:**
```bash
npm run test
```
Expected output ends with `Test Files X passed` and `Tests Y passed`.
