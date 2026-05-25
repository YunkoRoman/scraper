import { useEffect, useState } from 'react'
import { listStepVersions, restoreStepVersion, type StepVersion } from '../../api'

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
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEffect(() => {
    listStepVersions(parserId, stepName)
      .then((v) => { setVersions(v); setLoading(false) })
      .catch(() => setLoading(false))
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
