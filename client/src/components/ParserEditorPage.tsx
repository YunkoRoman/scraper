// client/src/components/ParserEditorPage.tsx
import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { useParserEditor } from '../hooks/useParserEditor'
import { createParser, type CreateParserInput } from '../api'
import { useTheme } from '../hooks/useTheme'

const TRAVERSER_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const items = await page.$$eval('a', els => els.map(el => el.href))
return items.map(link => ({ link, page_type: 'nextStep', parent_data: {} }))`

const EXTRACTOR_TEMPLATE = `// page: Playwright/Puppeteer Page
// task: { url: string, parentData?: Record<string, unknown> }
const title = await page.$eval('h1', el => el.textContent?.trim() ?? '').catch(() => '')
return [{ title, __url: task.url }]`

interface Props {
  parserName: string
  onNavigateToParsers: () => void
  onParserSelect: (name: string) => void
}

export function ParserEditorPage({ parserName, onNavigateToParsers, onParserSelect }: Props) {
  const { theme } = useTheme()
  const monacoTheme = theme === 'dark' ? 'vs-dark' : 'light'

  const {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings, saveStepMeta,
  } = useParserEditor(parserName)

  const [newParserName, setNewParserName] = useState('')
  const [newParserBrowser, setNewParserBrowser] = useState('playwright')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [addingStep, setAddingStep] = useState(false)
  const [newStepName, setNewStepName] = useState('')
  const [newStepType, setNewStepType] = useState<'traverser' | 'extractor'>('traverser')

  const saveStatusLabel = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed' : ''

  // New parser creation form
  if (!parserName) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-md">
        <h2 className="text-lg font-semibold mb-4">New Parser</h2>
        {createError && <p className="text-red-500 text-sm mb-3">{createError}</p>}
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              value={newParserName}
              onChange={(e) => setNewParserName(e.target.value)}
              placeholder="my-parser"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Lowercase, hyphens allowed</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Browser</label>
            <select
              value={newParserBrowser}
              onChange={(e) => setNewParserBrowser(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            >
              <option value="playwright">Playwright</option>
              <option value="playwright-stealth">Playwright Stealth</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onNavigateToParsers}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!newParserName || creating}
              onClick={async () => {
                setCreating(true)
                setCreateError(null)
                try {
                  const p = await createParser({ name: newParserName, browserType: newParserBrowser } as CreateParserInput)
                  onParserSelect(p.name)
                } catch (e) {
                  setCreateError((e as Error).message)
                } finally {
                  setCreating(false)
                }
              }}
              className="flex-1 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create Parser'}
            </button>
          </div>
        </div>
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
    <div className="flex flex-col h-[calc(100vh-57px)]">
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

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">{saveStatusLabel}</span>
          <button
            onClick={saveNow}
            disabled={saveStatus === 'saving'}
            className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>

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

          {steps.map((s) => (
            <div
              key={s.name}
              onClick={() => selectStep(s.name)}
              className={[
                'group flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-100 dark:border-gray-800',
                selectedStepName === s.name
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
              ].join(' ')}
            >
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
            </div>
          ))}
        </div>

        {/* Editor panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
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
              </div>
              <div className="flex-1 overflow-hidden">
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
