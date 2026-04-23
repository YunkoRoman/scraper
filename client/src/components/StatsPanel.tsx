import type { RunStats } from '../api'

interface Props {
  stats: RunStats
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
      <div
        className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatRow({
  label,
  total,
  success,
  failed,
  extra,
}: {
  label: string
  total: number
  success: number
  failed: number
  extra?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-1">
        <span className="text-gray-500 dark:text-gray-400 font-medium w-20 shrink-0">{label}</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 justify-end text-gray-600 dark:text-gray-300">
          <span>
            <span className="text-gray-400 dark:text-gray-500">Total </span>
            <span className="font-mono font-semibold text-gray-900 dark:text-white">{total}</span>
          </span>
          <span>
            <span className="text-gray-400 dark:text-gray-500">OK </span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{success}</span>
          </span>
          {failed > 0 && (
            <span>
              <span className="text-gray-400 dark:text-gray-500">Fail </span>
              <span className="font-mono font-semibold text-red-600 dark:text-red-400">{failed}</span>
            </span>
          )}
          {extra}
        </div>
      </div>
      <ProgressBar value={success} total={total} />
    </div>
  )
}

export function StatsPanel({ stats }: Props) {
  return (
    <div className="space-y-3 mt-1 bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      <StatRow
        label="Pages"
        total={stats.total}
        success={stats.success}
        failed={stats.failed}
        extra={
          stats.inProgress > 0 ? (
            <span>
              <span className="text-gray-400 dark:text-gray-500">Active </span>
              <span className="font-mono font-semibold text-yellow-600 dark:text-yellow-400">{stats.inProgress}</span>
            </span>
          ) : null
        }
      />
      <StatRow
        label="Traversers"
        total={stats.traversers.total}
        success={stats.traversers.success}
        failed={stats.traversers.failed}
      />
      <StatRow
        label="Extractors"
        total={stats.extractors.total}
        success={stats.extractors.success}
        failed={stats.extractors.failed}
      />
    </div>
  )
}
