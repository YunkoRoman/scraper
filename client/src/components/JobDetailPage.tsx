import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { getJob, getJobTasks, getTaskResult, stopJob, resumeJob, retryTask, retryAllFailed } from '../api'
import type { RunInfo, TaskRow } from '../api'
import { TASK_STATE, UNKNOWN_STATUS } from '../design/status'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { FadeIn } from './motion/FadeIn'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'

const FILTERS = ['all', 'pending', 'in_progress', 'retry', 'success', 'failed', 'aborted']

interface Props {
  runId: string
  onBack: () => void
  onViewTask: (taskId: string) => void
}

export function JobDetailPage({ runId, onBack, onViewTask }: Props) {
  const [run, setRun] = useState<RunInfo | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
  const [taskResult, setTaskResult] = useState<Record<string, unknown>[] | null>(null)
  const [taskResultLoading, setTaskResultLoading] = useState(false)
  const LIMIT = 50
  const reduced = useReducedMotion()

  const loadTasks = useCallback(async (p: number, filter: string) => {
    setLoading(true)
    try {
      const result = await getJobTasks(runId, p, LIMIT, filter === 'all' ? undefined : filter)
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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadRun()
    loadTasks(1, 'all')
  }, [loadRun, loadTasks])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!run?.isRunning) return
    const id = setInterval(() => {
      loadRun()
      loadTasks(page, statusFilter)
    }, 3000)
    return () => clearInterval(id)
  }, [run?.isRunning, loadRun, loadTasks, page, statusFilter])

  function handleFilterChange(f: string) {
    setStatusFilter(f)
    setPage(1)
    loadTasks(1, f)
  }

  function goTo(newPage: number) {
    setPage(newPage)
    loadTasks(newPage, statusFilter)
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
    loadTasks(page, statusFilter)
  }

  async function openTaskDetail(task: TaskRow) {
    setSelectedTask(task)
    setTaskResult(null)
    if (task.stepType === 'extractor' && task.state === 'success') {
      setTaskResultLoading(true)
      try {
        const r = await getTaskResult(runId, task.id)
        setTaskResult(r.rows)
      } catch { /* ignore */ } finally {
        setTaskResultLoading(false)
      }
    }
  }

  const stats = run?.stats

  return (
    <div className="flex flex-col h-screen">
      <FadeIn as="div" className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <motion.button
            onClick={onBack}
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
            <p className="text-xs text-gray-500 font-mono">{runId.slice(0, 8)}…</p>
          </div>

          {stats && (
            <div className="flex gap-3 text-xs ml-2">
              <span className="text-gray-500">Total: <b className="text-gray-800 dark:text-gray-200">{stats.total}</b></span>
              <span className="text-emerald-600">✓ {stats.success}</span>
              <span className="text-red-500">✗ {stats.failed}</span>
              {stats.pending > 0 && <span className="text-blue-500">⏳ {stats.pending}</span>}
              {stats.aborted > 0 && <span className="text-gray-400">⊘ {stats.aborted}</span>}
            </div>
          )}

          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
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
              <SpringButton variant="ghost" onClick={() => { loadRun(); loadTasks(page, statusFilter) }} className="text-xs px-3 py-1.5">
                Refresh
              </SpringButton>
            </div>
            {actionError && (
              <p className="text-xs text-red-500 mt-2">{actionError}</p>
            )}
          </div>
        </div>

        <div className="flex gap-1 mt-3 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => handleFilterChange(f)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              {f === 'in_progress' ? 'in progress' : f}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400 self-center">{total} tasks</span>
        </div>
      </FadeIn>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {loading && tasks.length === 0 ? (
            <p className="text-center text-gray-400 py-12">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No tasks match the filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 z-10">
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
                {tasks.map((task) => {
                  const sc = TASK_STATE[task.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS
                  return (
                  <motion.tr key={task.id}
                    variants={staggerItemVariants}
                    onClick={() => openTaskDetail(task)}
                    className={`cursor-pointer transition-colors ${
                      selectedTask?.id === task.id
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}>
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
                      <div className="flex items-center gap-1 justify-end">
                        {(task.state === 'failed' || task.state === 'aborted') && run?.isRunning && (
                          <button onClick={() => handleRetry(task)}
                            className="text-xs px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800/40 font-medium transition-colors">
                            Retry
                          </button>
                        )}
                        <button onClick={() => onViewTask(task.id)}
                          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors">
                          Details
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                  )
                })}
              </motion.tbody>
            </table>
          )}

          {total > LIMIT && (
            <div className="flex items-center justify-center px-4 py-3 border-t border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <button onClick={() => goTo(page - 1)} disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs">
                  ← Prev
                </button>
                <span className="text-xs text-gray-500 px-2">
                  {page} / {Math.ceil(total / LIMIT)}
                </span>
                <button onClick={() => goTo(page + 1)} disabled={page >= Math.ceil(total / LIMIT)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        <AnimatePresence>
          {selectedTask && (
            <motion.div
              className="w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto flex flex-col"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Task Detail</span>
              <button onClick={() => setSelectedTask(null)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1">URL</p>
                <a href={selectedTask.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-mono text-blue-600 dark:text-blue-400 break-all hover:underline">
                  {selectedTask.url}
                </a>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Step</p>
                  <p className="text-gray-800 dark:text-gray-200">{selectedTask.stepName} <span className="text-gray-400">({selectedTask.stepType})</span></p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Status</p>
                  {(() => {
                    const sc = TASK_STATE[selectedTask.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS
                    return <StatusBadge badgeClass={sc.badge} label={sc.label} />
                  })()}
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Attempts</p>
                  <p className="text-gray-800 dark:text-gray-200 font-mono">{selectedTask.attempts} / {selectedTask.maxAttempts}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">Task ID</p>
                  <p className="text-gray-400 font-mono text-xs">{selectedTask.id.slice(0, 8)}…</p>
                </div>
              </div>
              {selectedTask.error && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Error</p>
                  <pre className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2 whitespace-pre-wrap break-all">
                    {selectedTask.error}
                  </pre>
                </div>
              )}
              {selectedTask.parent_data && Object.keys(selectedTask.parent_data).length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Parent Data</p>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                    {JSON.stringify(selectedTask.parent_data, null, 2)}
                  </pre>
                </div>
              )}
              {selectedTask.stepType === 'extractor' && selectedTask.state === 'success' && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Extracted Data</p>
                  {taskResultLoading ? (
                    <p className="text-xs text-gray-400">Loading…</p>
                  ) : taskResult && taskResult.length > 0 ? (
                    <pre className="text-xs text-emerald-400 bg-gray-950 rounded p-2 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                      {JSON.stringify(taskResult, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-gray-400">No data stored (run before persistence was enabled)</p>
                  )}
                </div>
              )}
              {(selectedTask.state === 'failed' || selectedTask.state === 'aborted') && run?.isRunning && (
                <button onClick={() => handleRetry(selectedTask)}
                  className="w-full mt-2 text-sm px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold transition-colors">
                  Retry This Page
                </button>
              )}
            </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
