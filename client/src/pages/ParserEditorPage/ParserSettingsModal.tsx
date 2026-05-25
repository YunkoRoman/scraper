// client/src/components/ParserSettingsModal.tsx
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ParserRow, StepRow, UpdateParserInput } from '../../api'
import { JsonEditor } from '../../components/JsonEditor'
import { Modal } from '../../components/Modal'

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
  const [entryStep, setEntryStep] = useState(parser.entryStep ?? '')
  const [browserType, setBrowserType] = useState(parser.browserType ?? 'playwright')
  const [maxRetries, setMaxRetries] = useState(String(parser.retryConfig.maxRetries))
  const [concurrentQuota, setConcurrentQuota] = useState(
    parser.concurrentQuota != null ? String(parser.concurrentQuota) : ''
  )
  const [deduplication, setDeduplication] = useState(parser.deduplication)
  const [proxyPool, setProxyPool] = useState(
    Array.isArray(parser.browserSettings.proxyPool)
      ? (parser.browserSettings.proxyPool as string[]).join('\n')
      : ''
  )
  const [browserJson, setBrowserJson] = useState(() => {
    const { proxyPool: _p, ...rest } = parser.browserSettings
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
  })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)

  async function handleSave() {
    let browserSettings: Record<string, unknown> = {}
    const jsonStr = browserJson.trim()
    if (jsonStr) {
      try {
        browserSettings = JSON.parse(jsonStr)
      } catch {
        setSaveError('Browser Settings JSON is invalid')
        return
      }
    }

    const retriesNum = parseInt(maxRetries, 10)
    if (isNaN(retriesNum) || retriesNum < 0) {
      setSaveError('Max Retries must be a non-negative number')
      return
    }

    const proxyList = proxyPool.split('\n').map((s) => s.trim()).filter(Boolean)
    if (proxyList.length) browserSettings.proxyPool = proxyList

    setSaveError(null)
    setSaving(true)
    try {
      await onSave({
        entryStep,
        browserType,
        retryConfig: { maxRetries: retriesNum },
        concurrentQuota: concurrentQuota.trim() === '' ? null : parseInt(concurrentQuota, 10),
        deduplication,
        browserSettings,
      })
      onClose()
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

  return (
    <>
      <Modal title="Parser Settings" onClose={onClose} width="max-w-2xl">
        {/* Entry Step */}
        <div>
          <label className={labelClass}>Entry Step</label>
          <select
            value={entryStep}
            onChange={(e) => setEntryStep(e.target.value)}
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
            value={browserType}
            onChange={(e) => setBrowserType(e.target.value)}
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
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
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
              value={concurrentQuota}
              onChange={(e) => setConcurrentQuota(e.target.value)}
              placeholder="unlimited"
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
              checked={deduplication}
              onChange={(e) => setDeduplication(e.target.checked)}
              className="accent-emerald-600 w-3.5 h-3.5"
            />
            {deduplication ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {/* Proxy Pool */}
        <div>
          <label className={labelClass}>
            Proxy Pool <span className="font-normal text-gray-400">(one URL per line, round-robin)</span>
          </label>
          <textarea
            value={proxyPool}
            onChange={(e) => setProxyPool(e.target.value)}
            rows={3}
            placeholder={'http://user:pass@host1:8080\nhttp://user:pass@host2:8080'}
            className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
          />
        </div>

        {/* Browser Settings JSON */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={`${labelClass} mb-0`}>
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
            rows={6}
            placeholder={'{\n  "userAgent": "Mozilla/5.0 ...",\n  "contextOptions": { "locale": "en-US" }\n}'}
          />
        </div>

        {/* Error + Save / Cancel */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
          {saveError
            ? <span className="text-xs text-rose-500">{saveError}</span>
            : <span />
          }
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <AnimatePresence>
        {schemaOpen && <SchemaModal onClose={() => setSchemaOpen(false)} />}
      </AnimatePresence>
    </>
  )
}
