import { useEffect, useState, useCallback } from 'react'
import { listJobs } from '../api'
import type { RunInfo } from '../api'

const STATUS_BADGE: Record<string, string> = {
  running:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 animate-pulse',
  stopped:   'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:    'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
}

interface Props {
  onViewJob: (runId: string) => void
}

export function JobsPage({ onViewJob }: Props) {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const LIMIT = 50

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const result = await listJobs(p, LIMIT)
      setRuns(result.runs)
      setTotal(result.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(page) }, [load, page])

  // Poll for running jobs
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => load(page), 3000)
    return () => clearInterval(id)
  }, [runs, load, page])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString()
  }

  function formatDuration(run: RunInfo) {
    if (!run.stoppedAt) return '—'
    const ms = new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Jobs <span className="text-sm font-normal text-gray-500 ml-1">({total})</span>
        </h2>
        <button onClick={() => load(page)}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          Refresh
        </button>
      </div>

      {loading && runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No jobs yet. Run a parser to see jobs here.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parser</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Started</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Failed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {runs.map((run) => (
                <tr key={run.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{run.parserName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[run.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(run.startedAt)}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDuration(run)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">
                    {run.stats ? `${run.stats.success}/${run.stats.total}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(run.stats?.failed ?? 0) > 0 ? (
                      <span className="text-xs text-red-500 font-medium">{run.stats!.failed}</span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onViewJob(run.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (() => {
        const totalPages = Math.ceil(total / LIMIT)

        function goTo(p: number) {
          setPage(p)
          load(p)
        }

        function pageNumbers(): (number | '…')[] {
          if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
          const pages: (number | '…')[] = [1]
          if (page > 3) pages.push('…')
          for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) pages.push(p)
          if (page < totalPages - 2) pages.push('…')
          pages.push(totalPages)
          return pages
        }

        return (
          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => goTo(page - 1)} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm text-gray-500">
              ←
            </button>
            {pageNumbers().map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">…</span>
              ) : (
                <button key={p} onClick={() => goTo(p as number)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    p === page
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}>
                  {p}
                </button>
              )
            )}
            <button onClick={() => goTo(page + 1)} disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm text-gray-500">
              →
            </button>
          </div>
        )
      })()}
    </div>
  )
}
