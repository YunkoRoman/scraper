import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getParser,
  getParserStats,
  listJobs,
  listFiles,
  fetchCsvRows,
  downloadFile,
  startParser,
  stopParser,
  rerunParser,
  exportParser,
  type ParserStats,
  type RunInfo,
  type OutputFile,
  type CsvRowsResponse,
} from '../../api'
import { SpringButton } from '../../components/motion/SpringButton'
import { SchedulePanel } from './SchedulePanel'


function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function runDurationSeconds(run: RunInfo): number | null {
  if (!run.startedAt || !run.stoppedAt) return null
  return Math.round((new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
}


function RunStatusBadge({ status }: { status: RunInfo['status'] }) {
  const cls =
    status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : status === 'running'  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    : status === 'stopped'  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  const label =
    status === 'completed' ? 'Success'
    : status === 'running'  ? 'Running'
    : status === 'stopped'  ? 'Stopped'
    : 'Failed'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}

const RUNS_PER_PAGE = 5
const CSV_PER_PAGE = 20

export function ParserDetailPage() {
  const navigate = useNavigate()
  const { parserId: parserIdParam } = useParams<{ parserId: string }>()
  const parserId = parserIdParam!
  const [parserName, setParserName] = useState<string | null>(null)
  const [stats, setStats] = useState<ParserStats | null>(null)
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [runsTotal, setRunsTotal] = useState(0)
  const [runsPage, setRunsPage] = useState(1)
  const [isRunning, setIsRunning] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [files, setFiles] = useState<OutputFile[]>([])
  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null)
  const [csvData, setCsvData] = useState<CsvRowsResponse | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [csvPage, setCsvPage] = useState(1)

  // Reset page when parser changes
  useEffect(() => { setRunsPage(1) }, [parserId])

  // Resolve parser name once
  useEffect(() => {
    setParserName(null)
    getParser(parserId).then((r) => setParserName(r.parser.name)).catch(() => {})
  }, [parserId])

  // Poll stats + runs (reruns on page change)
  useEffect(() => {
    if (!parserName) return
    let active = true
    async function load() {
      const [statsRes, runsRes] = await Promise.allSettled([
        getParserStats(parserId),
        listJobs(runsPage, RUNS_PER_PAGE, undefined, parserName!),
      ])
      if (!active) return
      if (statsRes.status === 'fulfilled') setStats(statsRes.value)
      if (runsRes.status === 'fulfilled') {
        setRuns(runsRes.value.runs)
        setRunsTotal(runsRes.value.total)
        setIsRunning(runsRes.value.runs.some((r) => r.status === 'running'))
      }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { active = false; clearInterval(interval) }
  }, [parserId, parserName, runsPage])

  useEffect(() => {
    listFiles(parserId)
      .then((f) => {
        setFiles(f)
        if (f.length > 0) setSelectedFile(f[0])
      })
      .catch(() => {})
  }, [parserId])

  // When a file is selected, reset to page 1.
  useEffect(() => {
    setCsvPage(1)
    setCsvData(null)
  }, [selectedFile])

  // Whenever the file or page changes, fetch that page.
  useEffect(() => {
    if (!selectedFile) return
    if (!selectedFile.name.endsWith('.csv')) {
      setCsvData(null)
      return
    }
    let cancelled = false
    setCsvLoading(true)
    fetchCsvRows(parserId, selectedFile.runId, selectedFile.name, csvPage, CSV_PER_PAGE)
      .then((data) => { if (!cancelled) setCsvData(data) })
      .catch(() => { if (!cancelled) setCsvData(null) })
      .finally(() => { if (!cancelled) setCsvLoading(false) })
    return () => { cancelled = true }
  }, [parserId, selectedFile, csvPage])

  async function handleRunNow() {
    setActionLoading(true)
    try { await startParser(parserId); setIsRunning(true) }
    catch { /* poll will update */ }
    finally { setActionLoading(false) }
  }

  async function handleStop() {
    setActionLoading(true)
    try { await stopParser(parserId); setIsRunning(false) }
    catch { /* poll will update */ }
    finally { setActionLoading(false) }
  }

  async function handleRerun() {
    setActionLoading(true)
    try { await rerunParser(parserId); setIsRunning(true) }
    catch { /* poll will update */ }
    finally { setActionLoading(false) }
  }

  const displayName = parserName ?? parserId

  return (
    <div className="px-6 py-6">
      <button
        onClick={() => navigate('/parsers')}
        className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Parsers
      </button>

      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">{displayName}</h1>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
            isRunning
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
            {isRunning ? 'Active' : 'Idle'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <SpringButton variant="danger" onClick={handleStop} loading={actionLoading} className="px-4 py-2 text-sm">
              Stop
            </SpringButton>
          ) : (
            <SpringButton variant="success" onClick={handleRunNow} loading={actionLoading} className="px-4 py-2 text-sm flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Now
            </SpringButton>
          )}
          <button
            onClick={async () => {
              try {
                const data = await exportParser(parserId)
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${(data.parser as { name?: string }).name ?? 'parser'}.parser.json`
                a.click()
                URL.revokeObjectURL(url)
              } catch (e) {
                console.error('Export failed', e)
              }
            }}
            className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Export
          </button>
          <button
            onClick={() => navigate(`/editor/${parserId}`)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Parser
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[220px_1fr_320px] gap-4">

        <div className="flex flex-col gap-4">
          <StatCard
            label="Total Runs"
            value={stats ? stats.totalRuns : '…'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            }
          />
          <StatCard
            label="Success Rate"
            value={stats?.successRate !== null && stats?.successRate !== undefined ? `${stats.successRate}%` : '—'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            }
          />
          <StatCard
            label="Avg. Duration"
            value={stats ? formatDuration(stats.avgDurationSeconds) : '…'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Runs</h2>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Job ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Start Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">End Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">No runs yet.</td>
                  </tr>
                )}
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => navigate(`/jobs/${run.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {run.id.slice(0, 18)}…
                    </td>
                    <td className="px-4 py-3"><RunStatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(run.stoppedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDuration(runDurationSeconds(run))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {runsTotal > RUNS_PER_PAGE && (() => {
            const totalPages = Math.ceil(runsTotal / RUNS_PER_PAGE)
            return (
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Page {runsPage} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setRunsPage((p) => Math.max(1, p - 1))}
                    disabled={runsPage === 1}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setRunsPage((p) => Math.min(totalPages, p + 1))}
                    disabled={runsPage === totalPages}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })()}
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 shrink-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Data Preview</h2>
            {files.length > 0 && (
              <div className="flex items-center gap-2 min-w-0">
                <select
                  value={selectedFile?.name ?? ''}
                  onChange={(e) => {
                    const f = files.find((x) => x.name === e.target.value)
                    if (f) setSelectedFile(f)
                  }}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[120px] truncate"
                >
                  {files.map((f) => (
                    <option key={`${f.runId}/${f.name}`} value={f.name}>{f.name}</option>
                  ))}
                </select>
                {selectedFile && (
                  <button
                    onClick={() => downloadFile(parserId, selectedFile.runId, selectedFile.name)}
                    title="Download CSV"
                    className="shrink-0 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="overflow-auto flex-1">
            {files.length === 0 ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">No output files yet.</p>
            ) : csvLoading ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">Loading…</p>
            ) : !csvData || csvData.headers.length === 0 ? (
              <p className="px-5 py-10 text-sm text-gray-400 text-center">Could not parse file.</p>
            ) : (() => {
              const pageRows = csvData.rows
              const csvTotalPages = csvData.pages
              return (
                <>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                      <tr>
                        {csvData.headers.map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 dark:border-gray-700">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {pageRows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[120px] truncate" title={cell}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvTotalPages > 1 && (
                    <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 shrink-0 sticky bottom-0 bg-white dark:bg-gray-800">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {csvData.total === 0 ? 'No rows' : `${(csvData.page - 1) * csvData.limit + 1}–${Math.min(csvData.page * csvData.limit, csvData.total)} of ${csvData.total} rows`}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCsvPage((p) => Math.max(1, p - 1))}
                          disabled={csvData.page === 1}
                          className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setCsvPage((p) => Math.min(csvTotalPages, p + 1))}
                          disabled={csvData.page >= csvData.pages}
                          className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>

      </div>

      <div className="mt-4">
        <SchedulePanel parserId={parserId} />
      </div>
    </div>
  )
}
