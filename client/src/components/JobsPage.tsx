// client/src/components/JobsPage.tsx
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { listJobs } from '../api'
import type { RunInfo } from '../api'
import { JOB_STATUS, UNKNOWN_STATUS } from '../design/status'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { FadeIn } from './motion/FadeIn'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Props {
  onViewJob: (runId: string) => void
}

export function JobsPage({ onViewJob }: Props) {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshSpin, setRefreshSpin] = useState(false)
  const reduced = useReducedMotion()
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

  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => load(page), 3000)
    return () => clearInterval(id)
  }, [runs, load, page])

  function handleRefresh() {
    setRefreshSpin(true)
    load(page).then(() => setRefreshSpin(false))
  }

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
      <FadeIn>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Jobs <span className="text-sm font-normal text-gray-500 ml-1">({total})</span>
          </h2>
          <SpringButton
            variant="ghost"
            onClick={handleRefresh}
            className="text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <motion.svg
              animate={refreshSpin && !reduced ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              onAnimationComplete={() => setRefreshSpin(false)}
              className="w-3.5 h-3.5"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </motion.svg>
            Refresh
          </SpringButton>
        </div>
      </FadeIn>

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
            <motion.tbody
              className="divide-y divide-gray-100 dark:divide-gray-700/50"
              variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.025 } } }}
              initial="hidden"
              animate="show"
            >
              {runs.map((run) => {
                const sc = JOB_STATUS[run.status as keyof typeof JOB_STATUS] ?? UNKNOWN_STATUS
                return (
                  <motion.tr
                    key={run.id}
                    variants={staggerItemVariants}
                    className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{run.parserName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge badgeClass={sc.badge} label={sc.label} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(run.startedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDuration(run)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">
                      {run.stats ? `${run.stats.success}/${run.stats.total}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {(run.stats?.failed ?? 0) > 0 ? (
                        <span className="text-xs text-rose-500 font-medium">{run.stats!.failed}</span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SpringButton
                        variant="ghost"
                        onClick={() => onViewJob(run.id)}
                        className="text-xs px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 hover:text-emerald-700 dark:hover:text-emerald-300"
                      >
                        View
                      </SpringButton>
                    </td>
                  </motion.tr>
                )
              })}
            </motion.tbody>
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
            <SpringButton
              variant="ghost"
              onClick={() => goTo(page - 1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700"
            >
              ←
            </SpringButton>
            {pageNumbers().map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">…</span>
              ) : (
                <SpringButton
                  key={p}
                  variant={p === page ? 'success' : 'ghost'}
                  onClick={() => goTo(p as number)}
                  className="w-8 h-8 text-sm"
                >
                  {p}
                </SpringButton>
              )
            )}
            <SpringButton
              variant="ghost"
              onClick={() => goTo(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700"
            >
              →
            </SpringButton>
          </div>
        )
      })()}
    </div>
  )
}
