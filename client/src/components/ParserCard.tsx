// client/src/components/ParserCard.tsx
import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StatsPanel } from './StatsPanel'
import { startParser, stopParser, resumeParser, listFiles, downloadFile, getStatus, type RunStats } from '../api'
import type { OutputFile } from '../api'
import { PARSER_STATUS, UNKNOWN_STATUS } from '../design/status'
import { StatusDot } from './motion/StatusDot'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { MotionCard } from './motion/MotionCard'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Props {
  name: string
  onEdit: () => void
  onViewJob: () => void
}

export function ParserCard({ name, onEdit, onViewJob }: Props) {
  const [status, setStatus] = useState<'idle'|'running'|'stopped'|'complete'|'error'>('idle')
  const [stats, setStats] = useState<RunStats | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<OutputFile[]>([])
  const reduced = useReducedMotion()

  const refreshStatus = async () => {
    try {
      const data = await getStatus(name)
      const newStatus = data.running ? 'running' : (data.stats ? 'complete' : 'idle')
      if (status === 'running' && newStatus !== 'running') {
        listFiles(name).then(setFiles).catch(() => {})
      }
      setStatus(newStatus)
      setStats(data.stats)
    } catch (err) {
      console.error('Failed to get status:', err)
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    refreshStatus()
    listFiles(name).then(setFiles).catch(() => setFiles([]))
    const interval = setInterval(() => { refreshStatus() }, 2000)
    return () => clearInterval(interval)
  }, [name])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function handleRun() {
    setLoading(true); setErrorMessage(null)
    try { await startParser(name); setStatus('running') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  async function handleStop() {
    setLoading(true); setErrorMessage(null)
    try { await stopParser(name); setStatus('stopped') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  async function handleResume() {
    setLoading(true); setErrorMessage(null)
    try { await resumeParser(name); setStatus('running') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  const isRunning = status === 'running'
  const isStopped = status === 'stopped'
  const statusConfig = PARSER_STATUS[status] ?? UNKNOWN_STATUS

  return (
    <MotionCard className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot dotClass={statusConfig.dot} pulse={statusConfig.pulse} />
          <h2 className="text-gray-900 dark:text-white font-semibold text-base tracking-wide m-0 truncate">{name}</h2>
        </div>
        <StatusBadge badgeClass={statusConfig.badge} label={statusConfig.label} />
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onViewJob} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-600 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors" title="View Jobs">
            Jobs
          </button>
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            Edit
          </button>
        </div>
      </div>

      {/* Error message — animated */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded px-3 py-2"
          >
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {stats && <StatsPanel stats={stats} />}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {isRunning ? (
          <SpringButton variant="danger" onClick={handleStop} loading={loading} className="flex-1 text-sm py-2.5 px-4">
            {loading ? 'Stopping…' : 'Stop'}
          </SpringButton>
        ) : isStopped ? (
          <>
            <SpringButton variant="warning" onClick={handleResume} loading={loading} className="flex-1 text-sm py-2.5 px-4">
              {loading ? 'Resuming…' : 'Resume'}
            </SpringButton>
            <SpringButton variant="ghost" onClick={handleRun} disabled={loading} className="px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              Run Fresh
            </SpringButton>
          </>
        ) : (
          <SpringButton variant="success" onClick={handleRun} loading={loading} className="flex-1 text-sm py-2.5 px-4">
            {loading ? 'Starting…' : 'Run'}
          </SpringButton>
        )}
      </div>

      {/* Output files — stagger in */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28 }}
            className="border-t border-gray-100 dark:border-gray-700 pt-3 overflow-hidden"
          >
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-wider">Output files</p>
            <motion.div
              className="space-y-1"
              variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.05 } } }}
              initial="hidden"
              animate="show"
            >
              {files.map((f) => (
                <motion.button
                  key={f.name}
                  variants={staggerItemVariants}
                  onClick={() => downloadFile(name, f.name)}
                  className="w-full flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 transition-colors group"
                >
                  <span className="text-gray-700 dark:text-gray-300 font-mono truncate">{f.name}</span>
                  <span className="text-gray-400 dark:text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 ml-2 shrink-0 flex items-center gap-1">
                    {formatBytes(f.size)}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionCard>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
