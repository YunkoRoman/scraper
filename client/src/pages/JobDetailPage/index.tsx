import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { getJob, getJobTasks, getJobStepStats, stopJob, resumeJob, retryTask, retryAllFailed } from '../../api'
import type { RunInfo, TaskRow, StepStat } from '../../api'
import { TASK_STATE, UNKNOWN_STATUS } from '../../design/status'
import { StatusBadge } from '../../components/motion/StatusBadge'
import { SpringButton } from '../../components/motion/SpringButton'
import { FadeIn } from '../../components/motion/FadeIn'
import { staggerItemVariants } from '../../components/motion/StaggerList'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { JobInsightsPanel } from './JobInsightsPanel'

export function JobDetailPage() {
  const navigate = useNavigate()
  const { runId: runIdParam } = useParams<{ runId: string }>()
  const runId = runIdParam!
  const [run, setRun] = useState<RunInfo | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [stepStats, setStepStats] = useState<StepStat[]>([])
  const [stepFilter, setStepFilter] = useState<string>('')
  const [urlSearch, setUrlSearch] = useState<string>('')
  const LIMIT = 50
  const reduced = useReducedMotion()

  const loadTasks = useCallback(async (p: number, filter: string, step: string) => {
    setLoading(true)
    try {
      const result = await getJobTasks(
        runId, p, LIMIT,
        filter === 'all' ? undefined : filter,
        step || undefined,
      )
      setTasks(result.tasks)
      setTotal(result.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [runId])

  const loadRun = useCallback(async () => {
    try {
      const r = await getJob(runId)
      setRun(r)
    } catch { /* ignore */ }
  }, [runId])

  const loadStepStats = useCallback(async () => {
    try {
      const r = await getJobStepStats(runId)
      setStepStats(r.steps)
    } catch { /* ignore */ }
  }, [runId])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadRun()
    loadStepStats()
    loadTasks(1, 'all', '')
  }, [loadRun, loadStepStats, loadTasks])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!run?.isRunning) return
    const id = setInterval(() => {
      loadRun()
      loadStepStats()
      loadTasks(page, statusFilter, stepFilter)
    }, 3000)
    return () => clearInterval(id)
  }, [run?.isRunning, loadRun, loadStepStats, loadTasks, page, statusFilter, stepFilter])

  function goTo(newPage: number) {
    setPage(newPage)
    loadTasks(newPage, statusFilter, stepFilter)
  }

  async function handleStop() {
    setActionLoading(true)
    setActionError(null)
    try { await stopJob(runId); await loadRun() } catch (e) {
      setActionError((e as Error).message)
    } finally { setActionLoading(false) }
  }

  async function handleResume() {
    setActionLoading(true)
    setActionError(null)
    try { await resumeJob(runId); await loadRun() } catch (e) {
      setActionError((e as Error).message)
    } finally { setActionLoading(false) }
  }

  async function handleRetryAllFailed() {
    setActionLoading(true)
    setActionError(null)
    try { await retryAllFailed(runId); await loadRun() } catch (e) {
      setActionError((e as Error).message)
    } finally { setActionLoading(false) }
  }

  async function handleRetry(task: TaskRow) {
    await retryTask(runId, task.id).catch(console.error)
    loadTasks(page, statusFilter, stepFilter)
  }

  const stats = run?.stats

  return (
    <div className="flex flex-col h-screen">
      <FadeIn as="div" className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <motion.button
              onClick={() => navigate('/jobs')}
              whileHover={{ x: -3 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold"
            >
              ←
            </motion.button>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {run?.parserName ?? '…'}
              </h2>
              <p className="text-xs text-gray-400 font-mono">Job ID: {runId.slice(0, 8)}…</p>
            </div>
          </div>

          {stats && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="text-center">
                <p className="text-xs text-gray-500">Total Tasks:</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{stats.total}</p>
              </div>
              <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
              <div className="text-center">
                <p className="text-xs text-gray-500">Success:</p>
                <p className="text-lg font-bold text-emerald-600 leading-tight">{stats.success}</p>
              </div>
              <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
              <div className="text-center">
                <p className="text-xs text-gray-500">Failed:</p>
                <p className={`text-lg font-bold leading-tight ${stats.failed > 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                  {stats.failed}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {run?.isRunning ? (
              <SpringButton variant="danger" onClick={handleStop} loading={actionLoading} className="text-xs px-3 py-1.5">
                {actionLoading ? 'Stopping…' : 'Stop Job'}
              </SpringButton>
            ) : run?.status === 'stopped' ? (
              <SpringButton variant="warning" onClick={handleResume} loading={actionLoading} className="text-xs px-3 py-1.5">
                {actionLoading ? 'Resuming…' : 'Resume Job'}
              </SpringButton>
            ) : (run?.status === 'failed' || run?.status === 'completed') && (stats?.failed ?? 0) > 0 ? (
              <SpringButton variant="warning" onClick={handleRetryAllFailed} loading={actionLoading} className="text-xs px-3 py-1.5">
                {actionLoading ? 'Starting…' : `Retry Failed (${stats!.failed})`}
              </SpringButton>
            ) : null}
            <SpringButton
              variant="ghost"
              onClick={() => { loadRun(); loadStepStats(); loadTasks(page, statusFilter, stepFilter) }}
              className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-700"
            >
              Refresh
            </SpringButton>
          </div>
        </div>
        {actionError && <p className="text-xs text-red-500 mt-2">{actionError}</p>}
      </FadeIn>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">

        {stats && (
          <JobInsightsPanel stats={stats} stepStats={stepStats} />
        )}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={urlSearch}
              onChange={(e) => setUrlSearch(e.target.value)}
              placeholder="Search by URL"
              className="pl-9 pr-4 py-2 w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <select
            value={stepFilter}
            onChange={(e) => {
              setStepFilter(e.target.value)
              setPage(1)
              loadTasks(1, statusFilter, e.target.value)
            }}
            className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Steps</option>
            {stepStats.map((s) => (
              <option key={s.stepName} value={s.stepName}>
                {s.stepName} ({s.total})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
              loadTasks(1, e.target.value, stepFilter)
            }}
            className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="aborted">Aborted</option>
            <option value="retry">Retry</option>
          </select>

          <span className="ml-auto text-xs text-gray-400">{total} tasks</span>
        </div>

        {loading && tasks.length === 0 ? (
          <p className="text-center text-gray-400 py-12">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No tasks match the filter.</p>
        ) : (() => {
          const displayTasks = urlSearch
            ? tasks.filter((t) => t.url.toLowerCase().includes(urlSearch.toLowerCase()))
            : tasks
          return (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">URL</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Step</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Attempts</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Error</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <motion.tbody
                  className="divide-y divide-gray-100 dark:divide-gray-700/50"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.02 } } }}
                  initial="hidden"
                  animate="show"
                >
                  {displayTasks.map((task) => {
                    const sc = TASK_STATE[task.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS
                    return (
                      <motion.tr
                        key={task.id}
                        variants={staggerItemVariants}
                        className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <td className="px-4 py-2 max-w-xs">
                          <a href={task.url} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block" title={task.url}>
                            {task.url.replace(/^https?:\/\//, '').slice(0, 60)}{task.url.length > 67 ? '…' : ''}
                          </a>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-gray-600 dark:text-gray-400">{task.stepName}</span>
                          <span className="ml-1 text-xs text-gray-400 dark:text-gray-600">({task.stepType[0]})</span>
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge badgeClass={sc.badge} label={sc.label} />
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {task.attempts}/{task.maxAttempts}
                        </td>
                        <td className="px-4 py-2 max-w-xs">
                          {task.error && (
                            <span className="text-xs text-red-500 truncate block" title={task.error}>
                              {task.error.slice(0, 50)}{task.error.length > 50 ? '…' : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5 justify-end">
                            {(task.state === 'failed' || task.state === 'aborted') && run?.isRunning && (
                              <button
                                onClick={() => handleRetry(task)}
                                className="text-xs px-2.5 py-1 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 font-medium transition-colors"
                              >
                                Retry
                              </button>
                            )}
                            <button
                              onClick={() => navigate(`/jobs/${runId}/tasks/${task.id}`)}
                              className="text-xs px-3 py-1 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium transition-colors"
                            >
                              View Details
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </motion.tbody>
              </table>
            </div>
          )
        })()}

        {total > LIMIT && (() => {
          const totalPages = Math.ceil(total / LIMIT)
          return (
            <div className="flex items-center justify-between px-0 py-3 mt-2">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => goTo(1)} disabled={page === 1}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
                  «
                </button>
                <button onClick={() => goTo(page - 1)} disabled={page === 1}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
                  ‹
                </button>
                <button onClick={() => goTo(page + 1)} disabled={page >= totalPages}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
                  ›
                </button>
                <button onClick={() => goTo(totalPages)} disabled={page >= totalPages}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors">
                  »
                </button>
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
