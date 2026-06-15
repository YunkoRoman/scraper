import { useEffect, useState } from 'react'
import { listStepVersions, restoreStepVersion, type StepVersion } from '../../api'

type Tab = 'all' | 'versions'

interface Props {
  parserId: string
  stepName: string
  refreshKey?: number
  onRestored: (code: string) => void
  onClose: () => void
}

export function StepVersionsPanel({ parserId, stepName, refreshKey, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<StepVersion[]>([])
  const [selected, setSelected] = useState<StepVersion | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('versions')

  useEffect(() => {
    setLoading(true)
    listStepVersions(parserId, stepName)
      .then((v) => {
        setVersions(v)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [parserId, stepName, refreshKey])

  const displayed = tab === 'versions' ? versions.filter((v) => v.versionNumber != null) : versions

  return (
    <div className="absolute right-0 top-0 h-full w-96 z-20 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col shadow-xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-sm font-semibold">History</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          ✕
        </button>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800">
        {(['versions', 'all'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setSelected(null)
            }}
            className={[
              'flex-1 py-2 text-xs font-medium transition-colors',
              tab === t
                ? 'border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            ].join(' ')}
          >
            {t === 'versions' ? 'Version History' : 'All Saves'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-3 text-xs text-gray-400">Loading…</p>}
        {!loading && displayed.length === 0 && (
          <p className="p-3 text-xs text-gray-400">
            {tab === 'versions'
              ? 'No saved versions yet. Click Save to create v1.'
              : 'No saves yet.'}
          </p>
        )}
        {displayed.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v)}
            className={`block w-full text-left px-3 py-2 text-xs border-b border-gray-100 dark:border-gray-800 ${selected?.id === v.id ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <div className="flex items-center gap-2">
              {v.versionNumber != null && (
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  v{v.versionNumber}
                </span>
              )}
              <span className="text-gray-400">{new Date(v.savedAt).toLocaleString()}</span>
            </div>
            <div className="text-gray-400 truncate mt-0.5">
              {v.code.slice(0, 60)}
              {v.code.length > 60 ? '…' : ''}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="border-t border-gray-200 dark:border-gray-800 p-2">
          <pre className="max-h-40 overflow-auto text-[10px] font-mono bg-gray-50 dark:bg-gray-950 p-2 rounded mb-2">
            {selected.code}
          </pre>
          <button
            onClick={async () => {
              setRestoreError(null)
              try {
                const step = await restoreStepVersion(parserId, stepName, selected.id)
                onRestored(step.code)
                onClose()
              } catch (e) {
                setRestoreError((e as Error).message)
              }
            }}
            className="w-full text-xs py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Restore this version
          </button>
          {restoreError && <p className="text-xs text-red-500 mt-1">{restoreError}</p>}
        </div>
      )}
    </div>
  )
}
