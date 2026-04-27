import { useEffect, useState, useCallback } from 'react'
import { getJob, getTask, getTaskResult, retryTask, abortTask } from '../api'
import type { RunInfo, TaskRow } from '../api'

const STATE_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 animate-pulse',
  retry:       'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
  success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:      'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  aborted:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const TERMINAL = new Set(['success', 'failed', 'aborted'])

interface Props {
  runId: string
  taskId: string
  onBack: () => void
}

export function TaskDetailPage({ runId, taskId, onBack }: Props) {
  const [run, setRun] = useState<RunInfo | null>(null)
  const [task, setTask] = useState<TaskRow | null>(null)
  const [taskResult, setTaskResult] = useState<Record<string, unknown>[] | null>(null)
  const [taskResultLoading, setTaskResultLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'retry' | 'abort' | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [runData, taskData] = await Promise.all([getJob(runId), getTask(runId, taskId)])
      setRun(runData)
      setTask(taskData)
      if (taskData.stepType === 'extractor' && taskData.state === 'success') {
        setTaskResultLoading(true)
        const r = await getTaskResult(runId, taskId).catch(() => ({ rows: [] }))
        setTaskResult(r.rows)
        setTaskResultLoading(false)
      }
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [runId, taskId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!task || TERMINAL.has(task.state)) return
    const id = setInterval(loadData, 3000)
    return () => clearInterval(id)
  }, [task, loadData])

  async function handleRetry() {
    setActionLoading('retry')
    setActionError(null)
    try {
      await retryTask(runId, taskId)
      await loadData()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleAbort() {
    setActionLoading('abort')
    setActionError(null)
    try {
      await abortTask(runId, taskId)
      await loadData()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  const canRetry = task && (task.state === 'failed' || task.state === 'aborted') && run?.isRunning
  const canAbort = task && (task.state === 'pending' || task.state === 'in_progress' || task.state === 'retry') && run?.isRunning

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold">
          ←
        </button>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Task Detail</h2>
          <p className="text-xs text-gray-500 font-mono">{taskId.slice(0, 8)}…</p>
        </div>
        <button onClick={loadData}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {loadError}
        </div>
      )}

      {!task ? (
        <p className="text-center text-gray-400 py-12">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">URL</p>
              <a href={task.url} target="_blank" rel="noopener noreferrer"
                className="text-sm font-mono text-blue-600 dark:text-blue-400 break-all hover:underline">
                {task.url}
              </a>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Status</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[task.state] ?? ''}`}>
                  {task.state}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Step</p>
                <p className="text-gray-800 dark:text-gray-200">
                  {task.stepName} <span className="text-gray-400 text-xs">({task.stepType})</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Attempts</p>
                <p className="text-gray-800 dark:text-gray-200 font-mono">{task.attempts} / {task.maxAttempts}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Task ID</p>
                <p className="text-gray-400 font-mono text-xs break-all">{task.id}</p>
              </div>
              {task.parentTaskId && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Parent Task</p>
                  <p className="text-gray-400 font-mono text-xs">{task.parentTaskId.slice(0, 8)}…</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Job</p>
                <p className="text-gray-500 text-xs">{run?.parserName ?? '…'}</p>
              </div>
            </div>

            {task.error && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Error</p>
                <pre className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-3 whitespace-pre-wrap break-all">
                  {task.error}
                </pre>
              </div>
            )}

            {task.parent_data && Object.keys(task.parent_data).length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Parent Data</p>
                <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-3 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {JSON.stringify(task.parent_data, null, 2)}
                </pre>
              </div>
            )}

            {task.stepType === 'extractor' && task.state === 'success' && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Extracted Data</p>
                {taskResultLoading ? (
                  <p className="text-xs text-gray-400">Loading…</p>
                ) : taskResult && taskResult.length > 0 ? (
                  <pre className="text-xs text-emerald-400 bg-gray-950 rounded p-3 whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                    {JSON.stringify(taskResult, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400">No data stored</p>
                )}
              </div>
            )}
          </div>

          {(canRetry || canAbort) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
              <p className="text-xs text-gray-500 font-medium mb-3 uppercase tracking-wider">Actions</p>
              {actionError && (
                <p className="text-xs text-red-500 mb-3">{actionError}</p>
              )}
              <div className="flex gap-2 flex-wrap">
                {canRetry && (
                  <button onClick={handleRetry} disabled={actionLoading !== null}
                    className="text-sm px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold disabled:opacity-50 transition-colors">
                    {actionLoading === 'retry' ? 'Retrying…' : 'Retry'}
                  </button>
                )}
                {canAbort && (
                  <button onClick={handleAbort} disabled={actionLoading !== null}
                    className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 transition-colors">
                    {actionLoading === 'abort' ? 'Aborting…' : 'Abort'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
