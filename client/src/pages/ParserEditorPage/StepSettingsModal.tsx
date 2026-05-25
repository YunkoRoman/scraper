// client/src/components/StepSettingsModal.tsx
import { useState } from 'react'
import type { StepRow } from '../../api'
import { JsonEditor } from '../../components/JsonEditor'
import { Modal } from '../../components/Modal'

interface Props {
  step: StepRow
  onSave: (meta: { entryUrl?: string; outputFile?: string; stepSettings?: Record<string, unknown> }) => void
  onClose: () => void
}

export function StepSettingsModal({ step, onSave, onClose }: Props) {
  const settings = step.stepSettings as Record<string, unknown>

  const [entryUrl, setEntryUrl] = useState(step.entryUrl)
  const [outputFile, setOutputFile] = useState(step.outputFile ?? '')
  const [delayMin, setDelayMin] = useState(settings.pageDelayMin != null ? String(settings.pageDelayMin) : '')
  const [delayMax, setDelayMax] = useState(settings.pageDelayMax != null ? String(settings.pageDelayMax) : '')
  const [maxPages, setMaxPages] = useState(settings.maxPagesPerContext != null ? String(settings.maxPagesPerContext) : '')
  const [outputFormat, setOutputFormat] = useState((settings.outputFormat as string) ?? 'csv')
  const [proxyPool, setProxyPool] = useState(
    Array.isArray(settings.proxyPool) ? (settings.proxyPool as string[]).join('\n') : ''
  )
  const [json, setJson] = useState(() => {
    const { pageDelayMin: _a, pageDelayMax: _b, maxPagesPerContext: _c, outputFormat: _d, proxyPool: _e, ...rest } = settings
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''
  })
  const [saveError, setSaveError] = useState<string | null>(null)

  function handleSave() {
    let extra: Record<string, unknown> = {}
    const jsonStr = json.trim()
    if (jsonStr) {
      try {
        extra = JSON.parse(jsonStr)
      } catch {
        setSaveError('Step Settings JSON is invalid')
        return
      }
    }

    const stepSettings: Record<string, unknown> = { ...extra }
    if (delayMin.trim() !== '') stepSettings.pageDelayMin = parseInt(delayMin, 10)
    if (delayMax.trim() !== '') stepSettings.pageDelayMax = parseInt(delayMax, 10)
    if (maxPages.trim() !== '') stepSettings.maxPagesPerContext = parseInt(maxPages, 10)
    if (outputFormat) stepSettings.outputFormat = outputFormat
    const proxyList = proxyPool.split('\n').map((s) => s.trim()).filter(Boolean)
    if (proxyList.length) stepSettings.proxyPool = proxyList

    setSaveError(null)
    onSave({
      entryUrl,
      ...(step.type === 'extractor' && { outputFile }),
      stepSettings,
    })
    onClose()
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
          value={entryUrl}
          onChange={(e) => setEntryUrl(e.target.value)}
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
            value={outputFile}
            onChange={(e) => setOutputFile(e.target.value)}
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
            value={delayMin}
            onChange={(e) => setDelayMin(e.target.value)}
            placeholder="0"
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>Delay Max <span className="font-normal text-gray-400">ms</span></label>
          <input
            type="number"
            min={0}
            step={500}
            value={delayMax}
            onChange={(e) => setDelayMax(e.target.value)}
            placeholder="0"
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
          value={maxPages}
          onChange={(e) => setMaxPages(e.target.value)}
          placeholder="0"
          className={`${inputClass} w-32`}
        />
      </div>

      {/* Output Format */}
      <div>
        <label className={labelClass}>Output Format</label>
        <select
          value={outputFormat}
          onChange={(e) => setOutputFormat(e.target.value)}
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
          value={proxyPool}
          onChange={(e) => setProxyPool(e.target.value)}
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
          rows={3}
          placeholder={'{\n  "concurrency": 3\n}'}
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
            className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
