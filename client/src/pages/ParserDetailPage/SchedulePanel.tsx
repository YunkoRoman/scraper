import { useEffect, useState } from 'react'
import { getSchedule, setSchedule, deleteSchedule, type Schedule } from '../../api'

interface Props { parserId: string }

export function SchedulePanel({ parserId }: Props) {
  const [schedule, setS] = useState<Schedule | null>(null)
  const [cron, setCron] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSchedule(parserId)
      .then((s) => {
        setS(s)
        if (s) { setCron(s.cronExpression); setEnabled(s.enabled) }
      })
      .catch((e: Error) => setError(e.message))
  }, [parserId])

  async function save() {
    setSaving(true); setError(null)
    try {
      const s = await setSchedule(parserId, cron, enabled)
      setS(s)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function clear() {
    try {
      await deleteSchedule(parserId)
      setS(null); setCron(''); setEnabled(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
      <h3 className="text-sm font-semibold mb-2">Schedule</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Cron expression</label>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 */6 * * *"
            className="text-xs px-2 py-1 w-40 rounded border border-gray-300 dark:border-gray-700 bg-transparent"
          />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <button onClick={save} disabled={saving || !cron.trim()} className="text-xs px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {schedule && (
          <button onClick={clear} className="text-xs px-3 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      {schedule?.nextRunAt && <p className="text-xs text-gray-400 mt-2">Next run: {new Date(schedule.nextRunAt).toLocaleString()}</p>}
    </div>
  )
}
