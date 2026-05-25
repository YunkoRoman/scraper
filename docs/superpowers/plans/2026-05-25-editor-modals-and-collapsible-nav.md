# Editor Modals + Collapsible Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move parser and step settings from inline expanding panels into modal overlays, and add a collapsible icon-rail sidebar to the app layout.

**Architecture:** Part A creates a shared `Modal.tsx` base component (portal + Framer Motion, same pattern as existing `SchemaModal`), then `ParserSettingsModal` and `StepSettingsModal` wrap it. `ParserEditorPage` wires the modals and strips the inline header fields. Part B adds `navCollapsed` to `useSettings` and collapses the sidebar in `Layout.tsx` with a chevron toggle. The two parts are independent.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Framer Motion, `@monaco-editor/react`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `client/src/components/Modal.tsx` | Shared portal + backdrop + animation shell |
| Create | `client/src/components/ParserSettingsModal.tsx` | Parser-level settings modal (Entry URL, Entry Step, Browser, retries, quota, dedup, webhook, browser JSON) |
| Create | `client/src/components/StepSettingsModal.tsx` | Step-level settings modal (entry URL, output file, delays, max pages, output format, proxy pool, step JSON) |
| Modify | `client/src/components/ParserEditorPage.tsx` | Strip inline header fields + StepSettingsBar fn; wire modals |
| Delete | `client/src/components/ParserSettingsPanel.tsx` | Replaced by ParserSettingsModal |
| Modify | `client/src/hooks/useSettings.ts` | Add `navCollapsed: boolean` |
| Modify | `client/src/components/Layout.tsx` | Collapsible sidebar with chevron toggle |

---

## Task 1 — Create `Modal.tsx` shared base

**Files:**
- Create: `client/src/components/Modal.tsx`

- [ ] **Step 1.1 — Create the file**

```tsx
// client/src/components/Modal.tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: string
}

export function Modal({ title, onClose, children, width = 'max-w-xl' }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <motion.div
      ref={backdropRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={`relative w-full ${width} max-h-[85vh] flex flex-col rounded-lg shadow-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden`}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5 flex flex-col gap-4">
          {children}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
```

- [ ] **Step 1.2 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors on the new file.

---

## Task 2 — Create `ParserSettingsModal.tsx`

Replaces `ParserSettingsPanel.tsx`. The `SchemaModal` component (currently inside `ParserSettingsPanel.tsx`) moves here.

**Files:**
- Create: `client/src/components/ParserSettingsModal.tsx`

Key types from `client/src/api.ts`:
- `ParserRow` — `{ id, name, entryUrl, entryStep, browserType, browserSettings, retryConfig: { maxRetries }, deduplication, concurrentQuota, webhookUrl }`
- `StepRow` — `{ name, type, ... }`
- `UpdateParserInput` — `{ entryUrl?, entryStep?, browserType?, browserSettings?, retryConfig?, deduplication?, concurrentQuota?, webhookUrl? }`

- [ ] **Step 2.1 — Create the file**

```tsx
// client/src/components/ParserSettingsModal.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ParserRow, StepRow, UpdateParserInput } from '../api'
import { JsonEditor } from './JsonEditor'
import { Modal } from './Modal'

const BROWSER_SETTINGS_SCHEMA = `{
  // Random delay between page requests (ms)
  "pageDelayMin": 3000,
  "pageDelayMax": 8000,

  // Relaunch browser context after N pages (0 = never) — defeats session tracking
  "maxPagesPerContext": 10,

  // Custom user-agent string
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",

  // Playwright BrowserContextOptions
  "contextOptions": {
    "locale": "en-US",
    "timezoneId": "Europe/Zurich",
    "viewport": { "width": 1280, "height": 800 },
    "extraHTTPHeaders": { "Accept-Language": "en-US,en;q=0.9" },
    "ignoreHTTPSErrors": true
  },

  // Playwright LaunchOptions
  "launchOptions": {
    "headless": true,
    "args": ["--no-sandbox", "--disable-dev-shm-usage"]
  },

  // JS snippets injected into every page before load
  "initScripts": [
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
  ],

  // HTTP proxy (applied to every request)
  "proxySettings": {
    "host": "proxy.example.com",
    "port": "8080",
    "username": "user",
    "password": "pass"
  }
}`

function SchemaModal({ onClose }: { onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <motion.div
      ref={backdropRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-xl max-h-[80vh] flex flex-col rounded-lg shadow-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            Browser Settings — available fields
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <pre className="text-[11.5px] leading-relaxed font-mono text-gray-700 dark:text-gray-300 whitespace-pre">
            {BROWSER_SETTINGS_SCHEMA}
          </pre>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

interface Props {
  parser: ParserRow
  steps: StepRow[]
  onSave: (input: UpdateParserInput) => Promise<void>
  onClose: () => void
}

export function ParserSettingsModal({ parser, steps, onSave, onClose }: Props) {
  const [browserJson, setBrowserJson] = useState('')
  const [schemaOpen, setSchemaOpen] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setBrowserJson(
      Object.keys(parser.browserSettings).length
        ? JSON.stringify(parser.browserSettings, null, 2)
        : '',
    )
  }, [parser.id])

  function saveRetries(raw: string) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 0) onSave({ retryConfig: { maxRetries: n } })
  }

  function saveBrowserSettings() {
    const s = browserJson.trim()
    if (!s) { onSave({ browserSettings: {} }); return }
    try { onSave({ browserSettings: JSON.parse(s) }) } catch { /* invalid json */ }
  }

  const inputClass =
    'text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

  return (
    <>
      <Modal title="Parser Settings" onClose={onClose} width="max-w-2xl">
        {/* Entry URL */}
        <div>
          <label className={labelClass}>Entry URL</label>
          <input
            type="text"
            key={parser.entryUrl}
            defaultValue={parser.entryUrl}
            onBlur={(e) => onSave({ entryUrl: e.target.value })}
            placeholder="https://example.com"
            className={`${inputClass} w-full`}
          />
        </div>

        {/* Entry Step */}
        <div>
          <label className={labelClass}>Entry Step</label>
          <select
            value={parser.entryStep ?? ''}
            onChange={(e) => onSave({ entryStep: e.target.value })}
            className={`${inputClass} w-full`}
          >
            {steps.length === 0 && <option value="">— none —</option>}
            {steps.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Browser */}
        <div>
          <label className={labelClass}>Browser</label>
          <select
            value={parser.browserType ?? 'playwright'}
            onChange={(e) => onSave({ browserType: e.target.value })}
            className={`${inputClass} w-full`}
          >
            <option value="playwright">Playwright</option>
            <option value="playwright-stealth">Playwright Stealth</option>
            <option value="puppeteer">Puppeteer</option>
          </select>
        </div>

        {/* Max Retries + Concurrent Quota */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Max Retries</label>
            <input
              type="number"
              min={0}
              max={20}
              key={parser.retryConfig.maxRetries}
              defaultValue={parser.retryConfig.maxRetries}
              onBlur={(e) => saveRetries(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>
              Concurrent Quota <span className="font-normal text-gray-400">(blank = unlimited)</span>
            </label>
            <input
              type="number"
              min={1}
              key={String(parser.concurrentQuota)}
              defaultValue={parser.concurrentQuota ?? ''}
              placeholder="unlimited"
              onBlur={(e) => {
                const raw = e.target.value.trim()
                onSave({ concurrentQuota: raw === '' ? null : parseInt(raw, 10) })
              }}
              className={`${inputClass} w-full`}
            />
          </div>
        </div>

        {/* Deduplication */}
        <div>
          <label className={labelClass}>Deduplication</label>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={parser.deduplication}
              onChange={(e) => onSave({ deduplication: e.target.checked })}
              className="accent-emerald-600 w-3.5 h-3.5"
            />
            {parser.deduplication ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {/* Webhook URL */}
        <div>
          <label className={labelClass}>Webhook URL</label>
          <input
            type="url"
            key={parser.webhookUrl ?? ''}
            defaultValue={parser.webhookUrl ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim()
              onSave({ webhookUrl: v === '' ? null : v })
            }}
            placeholder="https://hooks.example.com/run-events"
            className={`${inputClass} w-full`}
          />
        </div>

        {/* Browser Settings JSON */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              Browser Settings{' '}
              <span className="font-normal text-gray-400">(userAgent, contextOptions, initScripts…)</span>
            </label>
            <button
              type="button"
              onClick={() => setSchemaOpen(true)}
              title="Show available fields"
              className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold border border-gray-400 text-gray-400 hover:border-emerald-500 hover:text-emerald-500 transition-colors flex-shrink-0"
            >
              ?
            </button>
          </div>
          <JsonEditor
            value={browserJson}
            onChange={setBrowserJson}
            onBlur={saveBrowserSettings}
            rows={6}
            placeholder={'{\n  "userAgent": "Mozilla/5.0 ...",\n  "contextOptions": { "locale": "en-US" }\n}'}
          />
        </div>
      </Modal>

      <AnimatePresence>
        {schemaOpen && <SchemaModal onClose={() => setSchemaOpen(false)} />}
      </AnimatePresence>
    </>
  )
}
```

- [ ] **Step 2.2 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors on the new file.

---

## Task 3 — Create `StepSettingsModal.tsx`

Replaces the `StepSettingsBar` function that currently lives inside `ParserEditorPage.tsx`.

**Files:**
- Create: `client/src/components/StepSettingsModal.tsx`

Key type from `client/src/api.ts`:
- `StepRow` — `{ name, type, entryUrl, outputFile, stepSettings: Record<string, unknown>, ... }`

The `save(patch)` function merges: dedicated fields from props + local json state + the specific patch. This preserves unsaved json edits when a number input is blurred, identical to the original `StepSettingsBar` logic.

- [ ] **Step 3.1 — Create the file**

```tsx
// client/src/components/StepSettingsModal.tsx
import { useState } from 'react'
import type { StepRow } from '../api'
import { JsonEditor } from './JsonEditor'
import { Modal } from './Modal'

interface Props {
  step: StepRow
  onSaveSettings: (settings: Record<string, unknown>) => void
  onSaveMeta: (meta: { entryUrl?: string; outputFile?: string }) => void
  onClose: () => void
}

export function StepSettingsModal({ step, onSaveSettings, onSaveMeta, onClose }: Props) {
  const settings = step.stepSettings as Record<string, unknown>

  const [json, setJson] = useState(() => {
    const { pageDelayMin: _a, pageDelayMax: _b, maxPagesPerContext: _c, outputFormat: _d, proxyPool: _e, ...rest } = settings
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
  })

  function dedicated(): Record<string, unknown> {
    return {
      ...(settings.pageDelayMin != null && { pageDelayMin: settings.pageDelayMin }),
      ...(settings.pageDelayMax != null && { pageDelayMax: settings.pageDelayMax }),
      ...(settings.maxPagesPerContext != null && { maxPagesPerContext: settings.maxPagesPerContext }),
      ...(settings.outputFormat != null && { outputFormat: settings.outputFormat }),
      ...(settings.proxyPool != null && { proxyPool: settings.proxyPool }),
    }
  }

  function save(patch: Record<string, unknown>) {
    const base: Record<string, unknown> = {}
    const s = json.trim()
    if (s) {
      try { Object.assign(base, JSON.parse(s)) } catch { /* invalid json */ }
    }
    onSaveSettings({ ...dedicated(), ...base, ...patch })
  }

  function handleJsonBlur() {
    const s = json.trim()
    if (!s) { onSaveSettings(dedicated()); return }
    try { onSaveSettings({ ...dedicated(), ...JSON.parse(s) }) } catch { /* invalid json */ }
  }

  const inputClass =
    'text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

  return (
    <Modal title={`Step Settings — ${step.name}`} onClose={onClose} width="max-w-lg">
      {/* Entry URL */}
      <div>
        <label className={labelClass}>Entry URL</label>
        <input
          type="text"
          key={step.name + step.entryUrl}
          defaultValue={step.entryUrl}
          onBlur={(e) => onSaveMeta({ entryUrl: e.target.value })}
          placeholder="https://..."
          className={`${inputClass} w-full`}
        />
      </div>

      {/* Output file (extractors only) */}
      {step.type === 'extractor' && (
        <div>
          <label className={labelClass}>Output File</label>
          <input
            type="text"
            key={`out-${step.name}`}
            defaultValue={step.outputFile ?? ''}
            onBlur={(e) => onSaveMeta({ outputFile: e.target.value })}
            placeholder="output.csv"
            className={`${inputClass} w-full`}
          />
        </div>
      )}

      {/* Delay Min + Delay Max */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Delay Min <span className="font-normal text-gray-400">ms</span></label>
          <input
            type="number"
            min={0}
            step={500}
            key={String(settings.pageDelayMin ?? '')}
            defaultValue={settings.pageDelayMin != null ? Number(settings.pageDelayMin) : ''}
            placeholder="0"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              save({ pageDelayMin: raw === '' ? undefined : parseInt(raw, 10) })
            }}
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>Delay Max <span className="font-normal text-gray-400">ms</span></label>
          <input
            type="number"
            min={0}
            step={500}
            key={String(settings.pageDelayMax ?? '')}
            defaultValue={settings.pageDelayMax != null ? Number(settings.pageDelayMax) : ''}
            placeholder="0"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              save({ pageDelayMax: raw === '' ? undefined : parseInt(raw, 10) })
            }}
            className={`${inputClass} w-full`}
          />
        </div>
      </div>

      {/* Max Pages/Context */}
      <div>
        <label className={labelClass}>
          Max Pages/Context <span className="font-normal text-gray-400">(0 = off)</span>
        </label>
        <input
          type="number"
          min={0}
          step={1}
          key={String(settings.maxPagesPerContext ?? '')}
          defaultValue={settings.maxPagesPerContext != null ? Number(settings.maxPagesPerContext) : ''}
          placeholder="0"
          onBlur={(e) => {
            const raw = e.target.value.trim()
            save({ maxPagesPerContext: raw === '' ? undefined : parseInt(raw, 10) })
          }}
          className={`${inputClass} w-32`}
        />
      </div>

      {/* Output Format */}
      <div>
        <label className={labelClass}>Output Format</label>
        <select
          key={String(settings.outputFormat ?? '')}
          defaultValue={(settings.outputFormat as string) ?? 'csv'}
          onChange={(e) => save({ outputFormat: e.target.value })}
          className={`${inputClass} w-full`}
        >
          <option value="csv">csv</option>
          <option value="json">json</option>
          <option value="excel">excel</option>
        </select>
      </div>

      {/* Proxy Pool */}
      <div>
        <label className={labelClass}>
          Proxy Pool <span className="font-normal text-gray-400">(one URL per line, round-robin)</span>
        </label>
        <textarea
          key={Array.isArray(settings.proxyPool) ? (settings.proxyPool as string[]).join('\n') : ''}
          defaultValue={Array.isArray(settings.proxyPool) ? (settings.proxyPool as string[]).join('\n') : ''}
          onBlur={(e) => {
            const list = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean)
            save({ proxyPool: list.length ? list : undefined })
          }}
          rows={3}
          placeholder={'http://user:pass@host1:8080\nhttp://user:pass@host2:8080'}
          className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
        />
      </div>

      {/* Other settings JSON */}
      <div>
        <label className={labelClass}>
          Step Settings <span className="font-normal text-gray-400">(concurrency, userAgent, initScripts…)</span>
        </label>
        <JsonEditor
          value={json}
          onChange={setJson}
          onBlur={handleJsonBlur}
          rows={3}
          placeholder={'{\n  "concurrency": 3\n}'}
        />
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3.2 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors on the new file.

---

## Task 4 — Wire `ParserEditorPage.tsx`

Remove the inline `StepSettingsBar` function, strip Entry URL / Entry Step / Browser from the header bar, and mount both modals.

**Files:**
- Modify: `client/src/components/ParserEditorPage.tsx`

- [ ] **Step 4.1 — Remove the `StepSettingsBar` function**

Find the block that starts with `function StepSettingsBar(` and ends with the closing `}` of that function (the entire function body including its inner `save`, `handleBlur`, `dedicated`, and the `return` statement). Delete it entirely — it is replaced by `StepSettingsModal`. The function is defined before the `interface Props` block and is not exported.

- [ ] **Step 4.2 — Add imports for the two new modals**

At the top of the file, after the existing imports, add:

```ts
import { ParserSettingsModal } from './ParserSettingsModal'
import { StepSettingsModal } from './StepSettingsModal'
```

Remove the import of `ParserSettingsPanel` (it will be deleted in Task 5).

- [ ] **Step 4.3 — Strip the parser header bar**

Find the parser header bar `<div>` (currently contains Entry URL input, Entry Step select, Browser select inline). Replace it with a simplified header. The existing `showSettings` boolean now controls `ParserSettingsModal` instead of `ParserSettingsPanel`.

Replace the entire header bar `<div className="border-b ... flex items-center gap-4 flex-wrap">` block with:

```tsx
{/* Parser header bar */}
<div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 flex items-center gap-3">
  <button onClick={onNavigateToParsers} className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">←</button>
  <span className="font-semibold text-sm">{parser?.name}</span>
  <div className="ml-auto flex items-center gap-2">
    <button
      onClick={() => setShowSettings((v) => !v)}
      className={[
        'px-2.5 py-1 text-xs rounded font-medium transition-colors',
        showSettings
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
      ].join(' ')}
    >
      ⚙ Parser Settings
    </button>
    <AnimatePresence mode="wait">
      {saveStatusLabel && (
        <motion.span
          key={saveStatusLabel}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className={`text-xs ${saveStatus === 'error' ? 'text-rose-400' : saveStatus === 'saved' ? 'text-emerald-500' : 'text-gray-400'}`}
        >
          {saveStatusLabel}
        </motion.span>
      )}
    </AnimatePresence>
    <SpringButton
      variant="primary"
      onClick={saveNow}
      loading={saveStatus === 'saving'}
      className="px-3 py-1 text-xs"
    >
      Save
    </SpringButton>
  </div>
</div>
```

- [ ] **Step 4.4 — Replace the inline `ParserSettingsPanel` block with `ParserSettingsModal`**

Find and remove:
```tsx
{/* Parser settings panel */}
{showSettings && parser && (
  <ParserSettingsPanel parser={parser} onSave={saveParserSettings} />
)}
```

Replace with (placed just before the `{/* Two-panel body */}` div):
```tsx
<AnimatePresence>
  {showSettings && parser && (
    <ParserSettingsModal
      parser={parser}
      steps={steps}
      onSave={saveParserSettings}
      onClose={() => setShowSettings(false)}
    />
  )}
</AnimatePresence>
```

- [ ] **Step 4.5 — Simplify the step meta bar**

Find the step meta bar `<div className="border-b ... flex items-center gap-3 text-xs text-gray-500 flex-wrap">`.

Replace the entire block with a simplified version that removes the inline Entry URL and Output file inputs, and renames the ⚙ button to "Step Settings":

```tsx
{/* Step meta bar */}
<div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-1.5 flex items-center gap-3 text-xs text-gray-500">
  <span className="font-medium text-gray-700 dark:text-gray-300">{selectedStep.name}</span>
  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{selectedStep.type}</span>
  <div className="ml-auto flex items-center gap-2">
    <select
      onChange={(e) => {
        const t = STEP_TEMPLATES.find(tmpl => tmpl.label === e.target.value)
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
        .map(t => <option key={t.label} value={t.label}>{t.label}</option>)
      }
    </select>
    <button
      onClick={() => setShowStepSettings((v) => !v)}
      className={[
        'px-2 py-0.5 rounded text-xs transition-colors',
        showStepSettings
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
          : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
      ].join(' ')}
    >
      ⚙ Step Settings
    </button>
    <button
      onClick={() => setShowHistory((v) => !v)}
      className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
    >
      History
    </button>
    <button
      onClick={() => setShowDebug((v) => !v)}
      className={[
        'px-2.5 py-1 rounded text-xs font-semibold transition-colors',
        showDebug
          ? 'bg-emerald-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 hover:text-emerald-700 dark:hover:text-emerald-300',
      ].join(' ')}
    >
      ▶ Run
    </button>
  </div>
</div>
```

- [ ] **Step 4.6 — Replace the inline `StepSettingsBar` block with `StepSettingsModal`**

Find and remove:
```tsx
{/* Step settings JSON */}
{showStepSettings && (
  <StepSettingsBar
    key={selectedStep.name}
    step={selectedStep}
    onSave={(settings) => saveStepMeta(selectedStep.name, { stepSettings: settings })}
  />
)}
```

Replace with (inside the `selectedStep ?` branch, after the step meta bar div):
```tsx
<AnimatePresence>
  {showStepSettings && (
    <StepSettingsModal
      key={selectedStep.name}
      step={selectedStep}
      onSaveSettings={(settings) => saveStepMeta(selectedStep.name, { stepSettings: settings })}
      onSaveMeta={(meta) => saveStepMeta(selectedStep.name, meta)}
      onClose={() => setShowStepSettings(false)}
    />
  )}
</AnimatePresence>
```

- [ ] **Step 4.7 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 4.8 — Manual smoke test**

Run: `npm run start`

1. Open http://localhost:5173, navigate to a parser.
2. Click "⚙ Parser Settings" — modal opens. Verify Entry URL, Entry Step, Browser, retries, quota, dedup, webhook, browser JSON are all present. Change Entry URL, blur — field saves. Press Escape — modal closes.
3. Select a step. Click "⚙ Step Settings" — modal opens. Verify entry URL, delay fields, proxy pool, JSON editor present. Change delay min, blur — saves. Click ✕ — modal closes.
4. Click backdrop — modal closes.
5. Verify Monaco editor occupies full height with no inline panel pushing it down.

- [ ] **Step 4.9 — Commit**

```bash
git add client/src/components/Modal.tsx \
        client/src/components/ParserSettingsModal.tsx \
        client/src/components/StepSettingsModal.tsx \
        client/src/components/ParserEditorPage.tsx
git commit -m "feat: move parser and step settings into modals"
```

---

## Task 5 — Delete `ParserSettingsPanel.tsx`

**Files:**
- Delete: `client/src/components/ParserSettingsPanel.tsx`

- [ ] **Step 5.1 — Delete the file**

```bash
rm client/src/components/ParserSettingsPanel.tsx
```

- [ ] **Step 5.2 — Verify no remaining imports**

```bash
grep -r "ParserSettingsPanel" client/src/
```

Expected: no output (zero references).

- [ ] **Step 5.3 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 5.4 — Commit**

```bash
git add -u client/src/components/ParserSettingsPanel.tsx
git commit -m "chore: delete ParserSettingsPanel replaced by ParserSettingsModal"
```

---

## Task 6 — Add `navCollapsed` to `useSettings`

**Files:**
- Modify: `client/src/hooks/useSettings.ts`

- [ ] **Step 6.1 — Add `navCollapsed` to `AppSettings` interface and defaults**

Open `client/src/hooks/useSettings.ts`. Make these two changes:

1. Add `navCollapsed: boolean` to the `AppSettings` interface:

```ts
export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  pageLimit: 10 | 25 | 50
  defaultBrowserType: 'playwright' | 'playwright-stealth' | 'puppeteer'
  defaultRetryCount: number
  defaultConcurrentQuota: number | null
  defaultDeduplication: boolean
  navCollapsed: boolean
}
```

2. Add `navCollapsed: false` to the `DEFAULTS` object:

```ts
const DEFAULTS: AppSettings = {
  theme: 'system',
  pageLimit: 10,
  defaultBrowserType: 'playwright',
  defaultRetryCount: 5,
  defaultConcurrentQuota: null,
  defaultDeduplication: true,
  navCollapsed: false,
}
```

No other changes needed — `updateSettings`, `load`, and localStorage sync already handle any new field automatically.

- [ ] **Step 6.2 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors.

---

## Task 7 — Collapsible sidebar in `Layout.tsx`

**Files:**
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 7.1 — Read `navCollapsed` from settings**

In the `Layout` component body, destructure `navCollapsed` from `settings`:

```ts
const { settings, updateSettings } = useSettings()
const collapsed = settings.navCollapsed
```

- [ ] **Step 7.2 — Add the chevron toggle button**

After the theme toggle `<div className="px-3 py-3 border-t ...">` block, add a second bottom div:

```tsx
{/* Collapse toggle */}
<div className="px-3 pb-3 shrink-0">
  <button
    onClick={() => updateSettings({ navCollapsed: !collapsed })}
    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    className="w-full flex items-center justify-center px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
  >
    {collapsed ? '›' : '‹'}
  </button>
</div>
```

- [ ] **Step 7.3 — Make the sidebar width dynamic**

Replace the static `className` on `<aside>`:

Before:
```tsx
<aside className="w-[220px] shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
```

After:
```tsx
<aside className={[
  'shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 transition-all duration-200',
  collapsed ? 'w-[48px]' : 'w-[220px]',
].join(' ')}>
```

- [ ] **Step 7.4 — Shrink the logo area when collapsed**

Replace the logo `<div className="flex items-center gap-2.5 ...">` block:

```tsx
{/* Logo */}
<div className={[
  'flex items-center h-14 border-b border-gray-200 dark:border-gray-800 shrink-0 overflow-hidden',
  collapsed ? 'justify-center px-0' : 'gap-2.5 px-4',
].join(' ')}>
  <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
    <BoltIcon />
  </div>
  {!collapsed && (
    <span className="font-extrabold text-base tracking-tight text-gray-900 dark:text-white">
      Parser
    </span>
  )}
</div>
```

- [ ] **Step 7.5 — Hide nav labels when collapsed**

Replace the nav `<button>` inside the `{NAV.map(...)}` loop:

```tsx
<button
  key={item.id}
  onClick={() => onNavigate(item.id)}
  title={collapsed ? item.label : undefined}
  className={[
    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
    collapsed ? 'justify-center' : '',
    activePage === item.id
      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
  ].join(' ')}
>
  {item.icon}
  {!collapsed && item.label}
</button>
```

- [ ] **Step 7.6 — Hide theme toggle label when collapsed**

Replace the theme toggle `<button>`:

```tsx
<button
  onClick={cycleTheme}
  title={collapsed ? `Theme: ${settings.theme}` : undefined}
  className={[
    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400',
    'hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors',
    collapsed ? 'justify-center' : '',
  ].join(' ')}
>
  <ThemeIcon />
  {!collapsed && <span className="capitalize">{settings.theme}</span>}
</button>
```

- [ ] **Step 7.7 — Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 7.8 — Manual smoke test**

Run: `npm run start`

1. Click `‹` at the bottom of the sidebar — it collapses to ~48px, only icons visible.
2. Hover a nav icon — tooltip with label appears.
3. Click the `›` — expands back to 220px.
4. Refresh the page — collapsed state persists.
5. Click a nav icon while collapsed — navigates correctly.
6. Toggle theme while collapsed — icon-only button works.

- [ ] **Step 7.9 — Commit**

```bash
git add client/src/hooks/useSettings.ts client/src/components/Layout.tsx
git commit -m "feat: collapsible icon-rail sidebar with localStorage persistence"
```
