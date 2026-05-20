import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  listParsersSummary,
  getDashboardPerformance,
  listJobs,
  type DashboardPerformanceDay,
  type RunInfo,
} from '../api'

interface Props {
  onNavigate: (page: 'jobs' | 'parsers', param?: string) => void
}

function StatCard({
  label,
  value,
  icon,
  valueClass = 'text-gray-900 dark:text-white',
}: {
  label: string
  value: string | number
  icon?: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 flex items-center gap-4 shadow-sm">
      {icon && (
        <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0 text-white">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className={`text-3xl font-bold mt-0.5 ${valueClass}`}>{value}</p>
      </div>
    </div>
  )
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function isInitializing(run: RunInfo & { elapsed?: number }): boolean {
  const stats = run.stats
  if (!stats) return true
  return stats.inProgress > 0 && stats.success === 0
}

export function DashboardPage({ onNavigate }: Props) {
  const [totalParsers, setTotalParsers] = useState<number | null>(null)
  const [avgSuccessRate, setAvgSuccessRate] = useState<number | null>(null)
  const [perfDays, setPerfDays] = useState<DashboardPerformanceDay[]>([])
  const [activeRuns, setActiveRuns] = useState<(RunInfo & { elapsed?: number })[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)

  // One-time data fetch on mount
  useEffect(() => {
    async function load() {
      const [parsersRes, perfRes] = await Promise.allSettled([
        listParsersSummary({ limit: 500 }),
        getDashboardPerformance(),
      ])
      if (parsersRes.status === 'fulfilled') {
        setTotalParsers(parsersRes.value.total)
        const rates = parsersRes.value.parsers
          .map((p) => p.successRate)
          .filter((r): r is number => r !== null)
        setAvgSuccessRate(rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null)
      }
      if (perfRes.status === 'fulfilled') {
        setPerfDays(perfRes.value.days)
      }
      setLoadingInitial(false)
    }
    load()
  }, [])

  // Poll active runs every 3s
  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await listJobs(1, 20, 'running')
        setActiveRuns(res.runs)
      } catch { /* ignore */ }
    }
    fetchActive()
    const interval = setInterval(fetchActive, 3000)
    return () => clearInterval(interval)
  }, [])

  // Today's jobs count from performance data
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayData = perfDays.find((d) => d.date === todayStr)
  const totalJobsToday = todayData ? todayData.successful + todayData.failed : 0

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Parsers"
          value={loadingInitial ? '…' : (totalParsers ?? 0)}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          }
        />
        <StatCard
          label="Total Jobs (24h)"
          value={loadingInitial ? '…' : totalJobsToday}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <StatCard
          label="Average Success Rate"
          value={loadingInitial ? '…' : avgSuccessRate !== null ? `${avgSuccessRate}%` : '—'}
          valueClass="text-emerald-600 dark:text-emerald-400 text-3xl font-bold"
        />
        <StatCard
          label="Active Runs"
          value={activeRuns.length}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Chart + Current Runs */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        {/* Chart */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Job Performance (Last 30 Days)
          </h2>
          {perfDays.length === 0 && !loadingInitial ? (
            <p className="text-sm text-gray-400 text-center py-10">No run data in the last 30 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={perfDays} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--tw-prose-bg, #1f2937)', border: 'none', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="successful" name="Successful Runs" stroke="#10b981" fill="url(#colorSuccess)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="failed"     name="Failed Runs"     stroke="#ef4444" fill="url(#colorFailed)"  strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Current Runs */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4 shrink-0">
            Current Runs
          </h2>
          {activeRuns.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10 flex-1 flex items-center justify-center">
              No active runs
            </p>
          ) : (
            <div className="space-y-4 overflow-y-auto flex-1">
              {activeRuns.map((run) => {
                const initializing = isInitializing(run)
                const progress = run.stats && run.stats.total > 0
                  ? Math.round((run.stats.success / run.stats.total) * 100)
                  : 0
                return (
                  <button
                    key={run.id}
                    onClick={() => onNavigate('jobs', run.id)}
                    className="w-full text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded-lg p-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">
                        {run.parserName}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                        initializing
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {initializing ? 'Initializing' : 'Running'}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-1.5">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>{progress}%</span>
                      {run.elapsed !== undefined && <span>{formatElapsed(run.elapsed)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
