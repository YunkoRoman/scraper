// client/src/components/ParserEditorPage.tsx
import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { useParserEditor } from '../hooks/useParserEditor'
import { StepDebugPanel } from './StepDebugPanel'
import { ParserSettingsPanel } from './ParserSettingsPanel'
import { JsonEditor } from './JsonEditor'
import { createParser, type CreateParserInput } from '../api'
import { useSettings } from '../hooks/useSettings'
import { AnimatePresence, motion } from 'framer-motion'
import { SpringButton } from './motion/SpringButton'
import { staggerItemVariants } from './motion/StaggerList'

const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parent_data?: Record<string, unknown> }
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`

function StepSettingsBar({
  step,
  onSave,
}: {
  step: import('../api').StepRow
  onSave: (settings: Record<string, unknown>) => void
}) {
  const [json, setJson] = useState(
    () => {
      const { pageDelayMin: _a, pageDelayMax: _b, maxPagesPerContext: _c, ...rest } = step.stepSettings as Record<string, unknown>
      return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
    }
  )

  function dedicated(): Record<string, unknown> {
    const { pageDelayMin, pageDelayMax, maxPagesPerContext } = step.stepSettings as Record<string, unknown>
    return {
      ...(pageDelayMin != null && { pageDelayMin }),
      ...(pageDelayMax != null && { pageDelayMax }),
      ...(maxPagesPerContext != null && { maxPagesPerContext }),
    }
  }

  function save(patch: Record<string, unknown>) {
    const base: Record<string, unknown> = {}
    const s = json.trim()
    if (s) {
      try { Object.assign(base, JSON.parse(s)) } catch { /* invalid json, skip */ }
    }
    onSave({ ...dedicated(), ...base, ...patch })
  }

  function handleBlur() {
    const s = json.trim()
    if (!s) { onSave(dedicated()); return }
    try {
      onSave({ ...dedicated(), ...JSON.parse(s) })
    } catch {
      // JsonEditor shows the inline error; skip the save
    }
  }

  const inputClass =
    'text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-24'

  const settings = step.stepSettings as Record<string, unknown>

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 px-4 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-2 items-start">

        {/* Delay Min */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">
            Delay Min <span className="font-normal text-gray-400">ms</span>
          </label>
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
            className={inputClass}
          />
        </div>

        {/* Delay Max */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">
            Delay Max <span className="font-normal text-gray-400">ms</span>
          </label>
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
            className={inputClass}
          />
        </div>

        {/* Max Pages / Context */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">
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
            className={inputClass}
          />
        </div>

        {/* Other settings JSON */}
        <div className="flex flex-col gap-1 flex-1 min-w-48">
          <label className="text-xs text-gray-500 font-medium">
            Step Settings{' '}
            <span className="font-normal text-gray-400">(concurrency, userAgent, initScripts…)</span>
          </label>
          <JsonEditor
            value={json}
            onChange={setJson}
            onBlur={handleBlur}
            rows={3}
            placeholder={'{\n  "concurrency": 3\n}'}
          />
        </div>

      </div>
    </div>
  )
}

interface Props {
  parserId: string
  onNavigateToParsers: () => void
  onParserSelect: (id: string) => void
}

export function ParserEditorPage({ parserId, onNavigateToParsers, onParserSelect }: Props) {
  const { settings } = useSettings()
  const monacoTheme = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'vs-dark' : 'light'

  const {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings, saveStepMeta,
  } = useParserEditor(parserId)

  const [newParserName, setNewParserName] = useState('')
  const [newParserEntryUrl, setNewParserEntryUrl] = useState('')
  const [newParserBrowser, setNewParserBrowser] = useState('playwright')
  const [newParserRetries, setNewParserRetries] = useState(5)
  const [newParserDedup, setNewParserDedup] = useState(true)
  const [newParserQuota, setNewParserQuota] = useState('')
  const [newParserBrowserJson, setNewParserBrowserJson] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [addingStep, setAddingStep] = useState(false)
  const [newStepName, setNewStepName] = useState('')
  const [newStepType, setNewStepType] = useState<'traverser' | 'extractor'>('traverser')
  const [showDebug, setShowDebug] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showStepSettings, setShowStepSettings] = useState(false)

  const saveStatusLabel = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : ''

  // New parser creation form
  if (!parserId) {
    const fieldClass =
      'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm ' +
      'text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-400'
    const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

    async function handleCreate() {
      if (!newParserName) return
      let browserSettings: Record<string, unknown> | undefined
      if (newParserBrowserJson.trim()) {
        try {
          browserSettings = JSON.parse(newParserBrowserJson)
        } catch {
          return // JsonEditor shows the inline error
        }
      }
      setCreating(true)
      setCreateError(null)
      try {
        const p = await createParser({
          name: newParserName,
          entryUrl: newParserEntryUrl || undefined,
          browserType: newParserBrowser,
          retryConfig: { maxRetries: newParserRetries },
          deduplication: newParserDedup,
          concurrentQuota: newParserQuota ? parseInt(newParserQuota, 10) : null,
          browserSettings,
        } satisfies CreateParserInput)
        onParserSelect(p.id)
      } catch (e) {
        setCreateError((e as Error).message)
      } finally {
        setCreating(false)
      }
    }

    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-lg">
        <h2 className="text-lg font-semibold mb-5">New Parser</h2>
        {createError && <p className="text-red-500 text-sm mb-3">{createError}</p>}
        <motion.div
          className="flex flex-col gap-4"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          initial="hidden"
          animate="show"
        >

          {/* Name */}
          <motion.div variants={staggerItemVariants}>
            <label className={labelClass}>Name <span className="text-red-500">*</span></label>
            <input
              value={newParserName}
              onChange={(e) => setNewParserName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="my-parser"
              className={fieldClass}
            />
            <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers, hyphens</p>
          </motion.div>

          {/* Entry URL */}
          <motion.div variants={staggerItemVariants}>
            <label className={labelClass}>Entry URL</label>
            <input
              type="url"
              value={newParserEntryUrl}
              onChange={(e) => setNewParserEntryUrl(e.target.value)}
              placeholder="https://example.com"
              className={fieldClass}
            />
          </motion.div>

          {/* Browser */}
          <motion.div variants={staggerItemVariants}>
            <label className={labelClass}>Browser</label>
            <select
              value={newParserBrowser}
              onChange={(e) => setNewParserBrowser(e.target.value)}
              className={fieldClass}
            >
              <option value="playwright">Playwright</option>
              <option value="playwright-stealth">Playwright Stealth</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </motion.div>

          {/* Retries + Quota row */}
          <motion.div variants={staggerItemVariants} className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Max Retries</label>
              <input
                type="number"
                min={0}
                max={20}
                value={newParserRetries}
                onChange={(e) => setNewParserRetries(parseInt(e.target.value, 10) || 0)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Concurrent Quota <span className="font-normal text-gray-400 text-xs">(blank = ∞)</span>
              </label>
              <input
                type="number"
                min={1}
                value={newParserQuota}
                onChange={(e) => setNewParserQuota(e.target.value)}
                placeholder="unlimited"
                className={fieldClass}
              />
            </div>
          </motion.div>

          {/* Deduplication */}
          <motion.div variants={staggerItemVariants}>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={newParserDedup}
                onChange={(e) => setNewParserDedup(e.target.checked)}
                className="accent-emerald-600 w-4 h-4"
              />
              Deduplication (skip already-visited URLs)
            </label>
          </motion.div>

          {/* Browser Settings JSON (advanced) */}
          <motion.div variants={staggerItemVariants}>
            <details>
              <summary className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                Browser Settings (advanced)
              </summary>
              <div className="mt-2">
                <JsonEditor
                  value={newParserBrowserJson}
                  onChange={setNewParserBrowserJson}
                  placeholder={'{\n  "userAgent": "Mozilla/5.0 ...",\n  "contextOptions": { "locale": "en-US" }\n}'}
                />
              </div>
            </details>
          </motion.div>

          {/* Actions */}
          <motion.div variants={staggerItemVariants} className="flex gap-2 pt-1">
            <button
              onClick={onNavigateToParsers}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!newParserName || creating}
              onClick={handleCreate}
              className="flex-1 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create Parser'}
            </button>
          </motion.div>

        </motion.div>
      </div>
    )
  }

  if (loading) {
    return <div className="px-8 py-8 text-gray-400">Loading...</div>
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <p className="text-red-500">{error}</p>
        <button onClick={onNavigateToParsers} className="mt-4 text-sm text-emerald-600 hover:underline">← Back to parsers</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Parser header bar */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 flex items-center gap-4 flex-wrap">
        <button onClick={onNavigateToParsers} className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">←</button>
        <span className="font-semibold text-sm">{parser?.name}</span>

        <div className="flex items-center gap-2 ml-2">
          <label className="text-xs text-gray-500">Entry URL</label>
          <input
            defaultValue={parser?.entryUrl ?? ''}
            onBlur={(e) => saveParserSettings({ entryUrl: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-48"
            placeholder="https://..."
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Entry Step</label>
          <select
            value={parser?.entryStep ?? ''}
            onChange={(e) => saveParserSettings({ entryStep: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            {steps.length === 0 && <option value="">— none —</option>}
            {steps.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Browser</label>
          <select
            value={parser?.browserType ?? 'playwright'}
            onChange={(e) => saveParserSettings({ browserType: e.target.value })}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="playwright">Playwright</option>
            <option value="playwright-stealth">Playwright Stealth</option>
            <option value="puppeteer">Puppeteer</option>
          </select>
        </div>

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
            ⚙ Settings
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

      {/* Parser settings panel */}
      {showSettings && parser && (
        <ParserSettingsPanel parser={parser} onSave={saveParserSettings} />
      )}

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Step sidebar */}
        <div className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col overflow-y-auto">
          <div className="p-2 border-b border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setAddingStep(true)}
              className="w-full text-xs py-1.5 rounded border border-dashed border-gray-400 dark:border-gray-600 text-gray-500 hover:border-emerald-500 hover:text-emerald-600 transition-colors"
            >
              + Add Step
            </button>
          </div>

          {addingStep && (
            <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex flex-col gap-1.5">
              <input
                autoFocus
                value={newStepName}
                onChange={(e) => setNewStepName(e.target.value)}
                placeholder="step-name"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-transparent"
              />
              <select
                value={newStepType}
                onChange={(e) => setNewStepType(e.target.value as 'traverser' | 'extractor')}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="traverser">traverser</option>
                <option value="extractor">extractor</option>
              </select>
              <div className="flex gap-1">
                <button
                  onClick={() => { setAddingStep(false); setNewStepName('') }}
                  className="flex-1 text-xs py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500"
                >
                  Cancel
                </button>
                <button
                  disabled={!newStepName}
                  onClick={async () => {
                    const tmpl = newStepType === 'traverser' ? TRAVERSER_TEMPLATE : EXTRACTOR_TEMPLATE
                    // Pass template into addStep so it's saved atomically before
                    // selectedStepName state update is batched by React
                    await addStep(newStepName, newStepType, tmpl)
                    setAddingStep(false)
                    setNewStepName('')
                  }}
                  className="flex-1 text-xs py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {steps.map((s) => (
              <motion.div
                key={s.name}
                variants={staggerItemVariants}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
                onClick={() => selectStep(s.name)}
                className={[
                  'group relative flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-100 dark:border-gray-800',
                  selectedStepName === s.name
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                ].join(' ')}
              >
                {/* Active step sliding indicator */}
                {selectedStepName === s.name && (
                  <motion.span
                    layoutId="active-step-bar"
                    className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r bg-violet-500"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-gray-400 dark:text-gray-500">{s.type}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeStep(s.name) }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity text-base leading-none"
                  title="Delete step"
                >
                  ×
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Editor panel */}
        <div className="flex-1 flex flex-col">
          {selectedStep ? (
            <>
              {/* Step meta bar */}
              <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-1.5 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="font-medium text-gray-700 dark:text-gray-300">{selectedStep.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{selectedStep.type}</span>
                <div className="flex items-center gap-1.5">
                  <span>Entry URL:</span>
                  <input
                    key={selectedStep.name}
                    defaultValue={selectedStep.entryUrl}
                    onBlur={(e) => saveStepMeta(selectedStep.name, { entryUrl: e.target.value })}
                    className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-56"
                    placeholder="https://..."
                  />
                </div>
                {selectedStep.type === 'extractor' && (
                  <div className="flex items-center gap-1.5">
                    <span>Output:</span>
                    <input
                      key={`out-${selectedStep.name}`}
                      defaultValue={selectedStep.outputFile ?? ''}
                      onBlur={(e) => saveStepMeta(selectedStep.name, { outputFile: e.target.value })}
                      className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-transparent w-32"
                      placeholder="output.csv"
                    />
                  </div>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setShowStepSettings((v) => !v)}
                    className={[
                      'px-2 py-0.5 rounded text-xs transition-colors',
                      showStepSettings
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                        : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                    ].join(' ')}
                    title="Step settings"
                  >
                    ⚙
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

              {/* Step settings JSON */}
              {showStepSettings && (
                <StepSettingsBar
                  key={selectedStep.name}
                  step={selectedStep}
                  onSave={(settings) => saveStepMeta(selectedStep.name, { stepSettings: settings })}
                />
              )}
              <div className="relative flex flex-1 overflow-hidden min-h-0">
                <div className="flex-1 overflow-hidden min-w-0">
                  <Editor
                    key={selectedStepName ?? ''}
                    height="100%"
                    language="javascript"
                    theme={monacoTheme}
                    value={code}
                    onChange={(v) => handleCodeChange(v ?? '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                    }}
                  />
                </div>
                <AnimatePresence>
                  {showDebug && selectedStep && (
                    <motion.div
                      key="debug-panel"
                      initial={{ opacity: 0, x: '100%' }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: '100%' }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-0 h-full z-10 shadow-xl"
                    >
                      <StepDebugPanel
                        parserId={parserId}
                        stepName={selectedStep.name}
                        initialUrl={selectedStep.entryUrl}
                        onClose={() => setShowDebug(false)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Select a step or add one
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
