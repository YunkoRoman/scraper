// client/src/components/ParserCard.tsx
import { useState, useEffect } from 'react'
import { useParserSSE } from '../hooks/useParserSSE'
import { StatsPanel } from './StatsPanel'
import { startParser, stopParser, resumeParser, listFiles, downloadFile } from '../api'
import type { OutputFile } from '../api'

interface Props {
  name: string
  onEdit: () => void
  onViewJob: () => void
}

const STATUS_BADGE: Record<string, string> = {
  idle:     'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  running:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 animate-pulse',
  stopped:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  error:    'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  idle:     'Idle',
  running:  'Running',
  stopped:  'Stopped',
  complete: 'Complete',
  error:    'Error',
}

export function ParserCard({ name, onEdit, onViewJob }: Props) {
  const { status, stats, errorMessage } = useParserSSE(name)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<OutputFile[]>([])

  useEffect(() => {
    if (status === 'complete' || status === 'idle' || status === 'stopped') {
      listFiles(name).then(setFiles).catch(() => setFiles([]))
    }
  }, [status, name])

  async function handleRun() {
    setLoading(true)
    try { await startParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  async function handleStop() {
    setLoading(true)
    try { await stopParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  async function handleResume() {
    setLoading(true)
    try { await resumeParser(name) } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const isRunning = status === 'running'
  const isStopped = status === 'stopped'

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-sm dark:shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-yellow-400 animate-ping' : isStopped ? 'bg-amber-400' : status === 'complete' ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-500'}`} />
          <h2 className="text-gray-900 dark:text-white font-semibold text-base tracking-wide m-0 truncate">{name}</h2>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onViewJob} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-600 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors" title="View Jobs">
            Jobs
          </button>
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            Edit
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded px-3 py-2">
          {errorMessage}
        </div>
      )}

      {stats && <StatsPanel stats={stats} />}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {isRunning ? (
          <button onClick={handleStop} disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
            {loading ? 'Stopping…' : 'Stop'}
          </button>
        ) : isStopped ? (
          <>
            <button onClick={handleResume} disabled={loading}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
              {loading ? 'Resuming…' : 'Resume'}
            </button>
            <button onClick={handleRun} disabled={loading}
              className="px-3 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
              Run Fresh
            </button>
          </>
        ) : (
          <button onClick={handleRun} disabled={loading}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors active:scale-95">
            {loading ? 'Starting…' : 'Run'}
          </button>
        )}
      </div>

      {/* Output files */}
      {files.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-wider">Output files</p>
          <div className="space-y-1">
            {files.map((f) => (
              <button key={f.name} onClick={() => downloadFile(name, f.name)}
                className="w-full flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 transition-colors group">
                <span className="text-gray-700 dark:text-gray-300 font-mono truncate">{f.name}</span>
                <span className="text-gray-400 dark:text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 ml-2 shrink-0 flex items-center gap-1">
                  {formatBytes(f.size)}
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
