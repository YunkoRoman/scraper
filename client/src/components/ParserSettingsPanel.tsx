// client/src/components/ParserSettingsPanel.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ParserRow, UpdateParserInput } from '../api'
import { JsonEditor } from './JsonEditor'

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
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-xl max-h-[80vh] flex flex-col rounded-lg shadow-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        {/* Header */}
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

        {/* Body */}
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
  onSave: (input: UpdateParserInput) => Promise<void>
}

export function ParserSettingsPanel({ parser, onSave }: Props) {
  const [browserJson, setBrowserJson] = useState('')
  const [schemaOpen, setSchemaOpen] = useState(false)

  // Sync from parser when it changes (e.g. after a save)
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setBrowserJson(
      Object.keys(parser.browserSettings).length
        ? JSON.stringify(parser.browserSettings, null, 2)
        : '',
    )
  }, [parser.id])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function saveRetries(raw: string) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 0) onSave({ retryConfig: { maxRetries: n } })
  }

  function saveBrowserSettings() {
    const s = browserJson.trim()
    if (!s) { onSave({ browserSettings: {} }); return }
    try {
      onSave({ browserSettings: JSON.parse(s) })
    } catch {
      // JsonEditor shows the inline error; skip the save
    }
  }

  const inputClass =
    'text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 px-4 py-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3 items-start">

        {/* Max Retries */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Max Retries</label>
          <input
            type="number"
            min={0}
            max={20}
            key={parser.retryConfig.maxRetries}
            defaultValue={parser.retryConfig.maxRetries}
            onBlur={(e) => saveRetries(e.target.value)}
            className={`${inputClass} w-20`}
          />
        </div>

        {/* Concurrent Quota */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">
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
            className={`${inputClass} w-32`}
          />
        </div>

        {/* Deduplication */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Deduplication</label>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300 mt-1">
            <input
              type="checkbox"
              checked={parser.deduplication}
              onChange={(e) => onSave({ deduplication: e.target.checked })}
              className="accent-emerald-600 w-3.5 h-3.5"
            />
            {parser.deduplication ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {/* Browser Settings JSON */}
        <div className="flex flex-col gap-1 w-full max-w-lg">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium">
              Browser Settings{' '}
              <span className="font-normal text-gray-400">
                (userAgent, contextOptions, initScripts, proxySettings…)
              </span>
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

        <AnimatePresence>
          {schemaOpen && <SchemaModal onClose={() => setSchemaOpen(false)} />}
        </AnimatePresence>

      </div>
    </div>
  )
}
