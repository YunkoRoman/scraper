// client/src/components/ParserSettingsPanel.tsx
import { useEffect, useState } from 'react'
import type { ParserRow, UpdateParserInput } from '../api'

interface Props {
  parser: ParserRow
  onSave: (input: UpdateParserInput) => Promise<void>
}

export function ParserSettingsPanel({ parser, onSave }: Props) {
  const [browserJson, setBrowserJson] = useState('')
  const [browserJsonError, setBrowserJsonError] = useState(false)

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
      const parsed = JSON.parse(s)
      setBrowserJsonError(false)
      onSave({ browserSettings: parsed })
    } catch {
      setBrowserJsonError(true)
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
          <label className="text-xs text-gray-500 font-medium">
            Browser Settings{' '}
            <span className="font-normal text-gray-400">
              (userAgent, contextOptions, initScripts, proxySettings…)
            </span>
          </label>
          <textarea
            value={browserJson}
            onChange={(e) => { setBrowserJson(e.target.value); setBrowserJsonError(false) }}
            onBlur={saveBrowserSettings}
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "userAgent": "Mozilla/5.0 ...",\n  "contextOptions": { "locale": "en-US" }\n}'}
            className={[
              'w-full rounded-lg border px-3 py-2 font-mono text-xs resize-y bg-white dark:bg-gray-900',
              'text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600',
              browserJsonError
                ? 'border-red-400 dark:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-400'
                : 'border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400',
            ].join(' ')}
          />
          {browserJsonError && (
            <p className="text-xs text-red-500">Invalid JSON</p>
          )}
        </div>

      </div>
    </div>
  )
}
