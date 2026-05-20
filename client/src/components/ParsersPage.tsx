import { useCallback, useEffect, useRef, useState } from 'react'
import { listParsersSummary, startParser, stopParser, resumeParser, rerunParser, type ParserSummary } from '../api'
import { useSettings } from '../hooks/useSettings'
import { StatusDot } from './motion/StatusDot'
import { SpringButton } from './motion/SpringButton'
import { PARSER_STATUS, UNKNOWN_STATUS } from '../design/status'

interface Props {
  onEdit: (id: string) => void
  onViewParser: (id: string) => void
}

type SortCol = 'name' | 'successRate' | 'lastRunDate'
type SortDir = 'asc' | 'desc'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function SuccessRateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-400 dark:text-gray-600">—</span>
  const cls =
    rate >= 90 ? 'text-emerald-600 dark:text-emerald-400'
    : rate >= 70 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400'
  return <span className={cls}>{rate}%</span>
}

function ChevronIcon({ dir }: { dir: SortDir }) {
  return dir === 'asc'
    ? <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
    : <svg className="w-3 h-3 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
}

function SortableHeader({
  col: _col, label, active, dir, onClick,
}: { col: SortCol; label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
      onClick={onClick}
    >
      {label}
      {active && <ChevronIcon dir={dir} />}
    </th>
  )
}

export function ParsersPage({ onEdit, onViewParser }: Props) {
  const { settings } = useSettings()
  const [page, setPage] = useState(1)
  const limit = settings.pageLimit
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'idle' | 'running' | 'stopped'>('all')
  const [sort, setSort] = useState<SortCol>('name')
  const [dir, setDir] = useState<SortDir>('asc')
  const [data, setData] = useState<ParserSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const result = await listParsersSummary({
        page,
        limit,
        search: debouncedSearch,
        status: statusFilter,
        sort,
        dir,
      })
      setData(result.parsers)
      setTotal(result.total)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, statusFilter, sort, dir])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const interval = setInterval(() => { fetchData() }, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  function handleSort(col: SortCol) {
    if (sort === col) setDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSort(col); setDir('asc') }
    setPage(1)
  }

  function handleStatusFilter(s: typeof statusFilter) {
    setStatusFilter(s)
    setPage(1)
  }

  async function handleRun(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await startParser(id); await fetchData() }
    catch { /* error visible on next poll */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  async function handleStop(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await stopParser(id); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  async function handleResume(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await resumeParser(id); await fetchData() }
    catch { /* ignore */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  async function handleRerun(id: string) {
    setRowLoading((prev) => ({ ...prev, [id]: true }))
    try { await rerunParser(id); await fetchData() }
    catch { /* error visible on next poll */ }
    finally { setRowLoading((prev) => ({ ...prev, [id]: false })) }
  }

  const totalPages = Math.ceil(total / limit)
  const fromItem = total === 0 ? 0 : (page - 1) * limit + 1
  const toItem   = Math.min(page * limit, total)

  return (
    <div className="px-6 py-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0">
          {total} parser{total !== 1 ? 's' : ''}
        </span>

        <div className="flex items-center gap-2 flex-1 justify-center max-w-lg">
          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All</option>
            <option value="idle">Idle</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>

        <SpringButton
          variant="primary"
          onClick={() => onEdit('')}
          className="px-3 py-1.5 text-sm shrink-0"
        >
          + New Parser
        </SpringButton>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
          <button onClick={fetchData} className="ml-3 underline">Retry</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-28">Status</th>
              <SortableHeader col="name"          label="Name"          active={sort === 'name'}          dir={dir} onClick={() => handleSort('name')} />
              <SortableHeader col="successRate"   label="Success Rate"  active={sort === 'successRate'}   dir={dir} onClick={() => handleSort('successRate')} />
              <SortableHeader col="lastRunDate"   label="Last Run Date" active={sort === 'lastRunDate'}   dir={dir} onClick={() => handleSort('lastRunDate')} />
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td>
              </tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  {search || statusFilter !== 'all' ? 'No parsers match this filter.' : 'No parsers yet.'}
                </td>
              </tr>
            )}
            {data.map((parser) => {
              const statusConfig = PARSER_STATUS[parser.status] ?? UNKNOWN_STATUS
              const busy = rowLoading[parser.id] ?? false
              return (
                <tr key={parser.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot dotClass={statusConfig.dot} pulse={statusConfig.pulse} />
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusConfig.badge}`}>
                        {statusConfig.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onViewParser(parser.id)}
                      className="text-sm font-medium text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors text-left"
                    >
                      {parser.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <SuccessRateCell rate={parser.successRate} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(parser.lastRunDate)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {parser.status === 'running' ? (
                        <>
                          <SpringButton variant="danger" onClick={() => handleStop(parser.id)} loading={busy} className="text-xs py-1 px-3">
                            Stop
                          </SpringButton>
                          <SpringButton variant="warning" onClick={() => handleRerun(parser.id)} loading={busy} className="text-xs py-1 px-3">
                            Rerun
                          </SpringButton>
                        </>
                      ) : parser.status === 'stopped' ? (
                        <SpringButton variant="success" onClick={() => handleRun(parser.id)} loading={busy} className="text-xs py-1 px-3">
                          Run
                        </SpringButton>
                      ) : (
                        <SpringButton variant="success" onClick={() => handleRun(parser.id)} loading={busy} className="text-xs py-1 px-3">
                          Run
                        </SpringButton>
                      )}
                      <button
                        onClick={() => onEdit(parser.id)}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {fromItem}–{toItem} of {total} parsers
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = i + 1
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={[
                    'w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors',
                    p === page
                      ? 'bg-emerald-500 text-white font-medium'
                      : 'border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300',
                  ].join(' ')}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
