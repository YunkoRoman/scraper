export interface StepTypeStats {
  total: number
  success: number
  failed: number
}

export interface RunStats {
  total: number
  pending: number
  retry: number
  success: number
  failed: number
  aborted: number
  inProgress: number
  traversers: StepTypeStats
  extractors: StepTypeStats
}

export interface OutputFile {
  name: string
  runId: string
  size: number
  mtime: string
}

export interface ParserSummary {
  id: string
  name: string
  status: 'idle' | 'running' | 'stopped'
  successRate: number | null
  lastRunDate: string | null
  lastRunId: string | null
}

export interface ListParsersSummaryParams {
  page?: number
  limit?: number
  search?: string
  status?: 'all' | 'idle' | 'running' | 'stopped'
  sort?: 'name' | 'successRate' | 'lastRunDate'
  dir?: 'asc' | 'desc'
}

export const API_BASE = 'http://localhost:3001'

export async function listParsers(): Promise<string[]> {
  const data = await apiRequest<{ parsers: ParserSummary[]; total: number }>('/api/parsers?limit=500')
  return data.parsers.map((p) => p.name)
}

export async function listParsersSummary(
  params: ListParsersSummaryParams = {},
): Promise<{ parsers: ParserSummary[]; total: number }> {
  const q = new URLSearchParams()
  if (params.page)   q.set('page',   String(params.page))
  if (params.limit)  q.set('limit',  String(params.limit))
  if (params.search) q.set('search', params.search)
  if (params.status) q.set('status', params.status)
  if (params.sort)   q.set('sort',   params.sort)
  if (params.dir)    q.set('dir',    params.dir)
  return apiRequest(`/api/parsers?${q}`)
}

export async function startParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}/start`, { method: 'POST' })
}

export async function stopParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}/stop`, { method: 'POST' })
}

export async function getStatus(id: string): Promise<{ running: boolean; stats: RunStats | null }> {
  return apiRequest(`/api/parsers/${id}/status`)
}

export async function listFiles(id: string): Promise<OutputFile[]> {
  const data = await apiRequest<{ files: OutputFile[] }>(`/api/parsers/${id}/files`)
  return data.files
}

export function downloadFile(parserId: string, runId: string, fileName: string): void {
  window.open(`${API_BASE}/api/parsers/${parserId}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`, '_blank')
}

export interface StepInfo {
  name: string
  type: 'traverser' | 'extractor'
}

export interface TraverserResult {
  link: string
  page_type: string
  parent_data?: Record<string, unknown>
}

export async function listSteps(parserId: string): Promise<StepInfo[]> {
  const res = await fetch(`${API_BASE}/api/parsers/${parserId}/steps`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to load steps')
  }
  const data = await res.json()
  return data.steps as StepInfo[]
}

export interface DashboardPerformanceDay {
  date: string
  successful: number
  failed: number
}

export async function getDashboardPerformance(): Promise<{ days: DashboardPerformanceDay[] }> {
  return apiRequest('/api/dashboard/performance')
}

export interface ParserStats {
  totalRuns: number
  successRate: number | null
  avgDurationSeconds: number | null
}

export async function getParserStats(parserId: string): Promise<ParserStats> {
  return apiRequest(`/api/parsers/${parserId}/stats`)
}

export async function fetchFileContent(
  parserId: string,
  runId: string,
  fileName: string,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/parsers/${parserId}/files/${encodeURIComponent(runId)}/${encodeURIComponent(fileName)}`,
  )
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`)
  return res.text()
}

export interface ParserRow {
  id: string
  name: string
  entryUrl: string
  entryStep: string
  browserType: string
  browserSettings: Record<string, unknown>
  retryConfig: { maxRetries: number }
  deduplication: boolean
  concurrentQuota: number | null
  webhookUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface StepRow {
  id: string
  parserId: string
  name: string
  type: 'traverser' | 'extractor'
  entryUrl: string
  outputFile: string | null
  code: string
  stepSettings: Record<string, unknown>
  position: number
  createdAt: string
  updatedAt: string
}

export interface CreateParserInput {
  name: string
  entryUrl?: string
  entryStep?: string
  browserType?: string
  browserSettings?: Record<string, unknown>
  retryConfig?: { maxRetries: number }
  deduplication?: boolean
  concurrentQuota?: number | null
}

export interface UpdateParserInput {
  entryUrl?: string
  entryStep?: string
  browserType?: string
  browserSettings?: Record<string, unknown>
  retryConfig?: { maxRetries: number }
  deduplication?: boolean
  concurrentQuota?: number | null
  webhookUrl?: string | null
}

export interface CreateStepInput {
  name: string
  type: 'traverser' | 'extractor'
  entryUrl?: string
  outputFile?: string
}

export interface UpdateStepInput {
  name?: string
  type?: 'traverser' | 'extractor'
  entryUrl?: string
  outputFile?: string
  code?: string
  stepSettings?: Record<string, unknown>
  position?: number
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function createParser(input: CreateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>('/api/parsers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function getParser(id: string): Promise<{ parser: ParserRow; steps: StepRow[] }> {
  return apiRequest(`/api/parsers/${id}`)
}

export async function updateParser(id: string, input: UpdateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>(`/api/parsers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function deleteParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}`, { method: 'DELETE' })
}

export async function createStep(parserId: string, input: CreateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function getStep(parserId: string, stepName: string): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`)
  return data.step
}

export async function updateStep(parserId: string, stepName: string, input: UpdateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function deleteStep(parserId: string, stepName: string): Promise<void> {
  await apiRequest(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}`, { method: 'DELETE' })
}

export interface RunInfo {
  id: string
  parserName: string
  browserType: string
  status: 'running' | 'stopped' | 'completed' | 'failed'
  startedAt: string
  stoppedAt: string | null
  stats: RunStats | null
  isRunning?: boolean
}

export interface ActiveRun extends RunInfo {
  elapsed: number
}

export interface TaskRow {
  id: string
  runId: string
  url: string
  stepName: string
  stepType: 'traverser' | 'extractor'
  state: 'pending' | 'in_progress' | 'retry' | 'success' | 'failed' | 'aborted'
  attempts: number
  maxAttempts: number
  error?: string | null
  parentTaskId?: string | null
  parent_data?: Record<string, unknown> | null
}

export async function listJobs(
  page = 1,
  limit = 50,
  status?: string,
  parserName?: string,
): Promise<{ runs: (RunInfo & { elapsed?: number })[]; total: number }> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status)     q.set('status',     status)
  if (parserName) q.set('parserName', parserName)
  return apiRequest(`/api/jobs?${q}`)
}

export async function getJob(runId: string): Promise<RunInfo> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}`)
}

export async function getJobTasks(
  runId: string,
  page = 1,
  limit = 100,
  status?: string,
): Promise<{ tasks: TaskRow[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set('status', status)
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks?${params}`)
}

export async function getTaskResult(runId: string, taskId: string): Promise<{ rows: Record<string, unknown>[]; html: string | null }> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/result`)
}

export async function stopJob(runId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
}

export async function resumeJob(runId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/resume`, { method: 'POST' })
}

export async function getTask(runId: string, taskId: string): Promise<TaskRow> {
  return apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`)
}

export async function retryTask(runId: string, taskId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' })
}

export async function retryAllFailed(runId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/retry-failed`, { method: 'POST' })
}

export async function abortTask(runId: string, taskId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/abort`, { method: 'POST' })
}

export async function resumeParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}/resume`, { method: 'POST' })
}

export async function rerunParser(id: string): Promise<void> {
  await apiRequest(`/api/parsers/${id}/rerun`, { method: 'POST' })
}

export async function exportParser(id: string): Promise<{ parser: Record<string, unknown>; steps: Record<string, unknown>[] }> {
  return apiRequest(`/api/parsers/${id}/export`)
}

export async function importParser(data: { parser: Record<string, unknown>; steps: Record<string, unknown>[]; newName?: string }): Promise<{ id: string; name: string }> {
  const out = await apiRequest<{ parser: { id: string; name: string } }>('/api/parsers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return out.parser
}

export interface Schedule {
  id: string
  parserId: string
  cronExpression: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

export async function getSchedule(parserId: string): Promise<Schedule | null> {
  const r = await apiRequest<{ schedule: Schedule | null }>(`/api/parsers/${parserId}/schedule`)
  return r.schedule
}

export async function setSchedule(parserId: string, cronExpression: string, enabled: boolean): Promise<Schedule> {
  const r = await apiRequest<{ schedule: Schedule }>(`/api/parsers/${parserId}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cronExpression, enabled }),
  })
  return r.schedule
}

export async function deleteSchedule(parserId: string): Promise<void> {
  await apiRequest(`/api/parsers/${parserId}/schedule`, { method: 'DELETE' })
}

export interface StepVersion {
  id: string
  stepId: string
  code: string
  savedAt: string
}

export async function listStepVersions(parserId: string, stepName: string): Promise<StepVersion[]> {
  const r = await apiRequest<{ versions: StepVersion[] }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}/versions`)
  return r.versions
}

export async function restoreStepVersion(parserId: string, stepName: string, versionId: string): Promise<StepRow> {
  const r = await apiRequest<{ step: StepRow }>(`/api/parsers/${parserId}/steps/${encodeURIComponent(stepName)}/versions/${versionId}/restore`, { method: 'POST' })
  return r.step
}
