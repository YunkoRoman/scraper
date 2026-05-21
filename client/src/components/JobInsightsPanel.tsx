import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { RunStats, StepStat } from '../api'

interface Props {
  stats:     RunStats
  stepStats: StepStat[]
}

const PIE_COLORS = { success: '#10b981', failed: '#f43f5e', pending: '#f59e0b' }

export function JobInsightsPanel({ stats, stepStats }: Props) {
  const donutData = [
    { name: 'Success', value: stats.success, color: PIE_COLORS.success },
    { name: 'Failed',  value: stats.failed,  color: PIE_COLORS.failed },
    {
      name: 'Pending',
      value: stats.pending + stats.retry + stats.inProgress,
      color: PIE_COLORS.pending,
    },
  ].filter((d) => d.value > 0)

  const sorted   = [...stepStats].sort((a, b) => b.total - a.total)
  const topSteps = sorted.slice(0, 5)
  const rest     = sorted.slice(5)
  const barData  = [
    ...topSteps.map((s) => ({ name: s.stepName, value: s.total })),
    ...(rest.length > 0
      ? [{ name: 'Other Step', value: rest.reduce((acc, s) => acc + s.total, 0) }]
      : []),
  ]

  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Visual Insights</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Task Status Distribution
            </span>
            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none select-none">
              ···
            </button>
          </div>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%" cy="50%"
                  innerRadius={38} outerRadius={64}
                  dataKey="value"
                  strokeWidth={2}
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 text-xs">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-gray-600 dark:text-gray-400">
                    {d.name} ({d.value})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Tasks per Step
            </span>
            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none select-none">
              ···
            </button>
          </div>
          {barData.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">No step data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={barData} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={(v: string) => v.length > 10 ? v.slice(0, 9) + '…' : v}
                />
                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    background: 'var(--tw-prose-body, #fff)',
                    borderColor: '#e5e7eb',
                  }}
                />
                <Bar dataKey="value" name="Tasks" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  )
}
