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
  size: number
  mtime: string
}

export async function listParsers(): Promise<string[]> {
  const res = await fetch('/api/parsers')
  const data = await res.json()
  return data.parsers as string[]
}

export async function startParser(name: string): Promise<void> {
  const res = await fetch(`/api/parsers/${name}/start`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to start')
  }
}

export async function stopParser(name: string): Promise<void> {
  const res = await fetch(`/api/parsers/${name}/stop`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Failed to stop')
  }
}

export async function getStatus(name: string): Promise<{ running: boolean; stats: RunStats | null }> {
  const res = await fetch(`/api/parsers/${name}/status`)
  return res.json()
}

export async function listFiles(name: string): Promise<OutputFile[]> {
  const res = await fetch(`/api/parsers/${name}/files`)
  const data = await res.json()
  return data.files as OutputFile[]
}

export function downloadFile(parserName: string, fileName: string): void {
  window.open(`/api/parsers/${parserName}/files/${fileName}`, '_blank')
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

export async function listSteps(parserName: string): Promise<StepInfo[]> {
  const res = await fetch(`/api/parsers/${parserName}/steps`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to load steps')
  }
  const data = await res.json()
  return data.steps as StepInfo[]
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
  const res = await fetch(url, options)
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

export async function getParser(name: string): Promise<{ parser: ParserRow; steps: StepRow[] }> {
  return apiRequest(`/api/parsers/${encodeURIComponent(name)}`)
}

export async function updateParser(name: string, input: UpdateParserInput): Promise<ParserRow> {
  const data = await apiRequest<{ parser: ParserRow }>(`/api/parsers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.parser
}

export async function deleteParser(name: string): Promise<void> {
  await apiRequest(`/api/parsers/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function createStep(parserName: string, input: CreateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function getStep(parserName: string, stepName: string): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`)
  return data.step
}

export async function updateStep(parserName: string, stepName: string, input: UpdateStepInput): Promise<StepRow> {
  const data = await apiRequest<{ step: StepRow }>(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.step
}

export async function deleteStep(parserName: string, stepName: string): Promise<void> {
  await apiRequest(`/api/parsers/${encodeURIComponent(parserName)}/steps/${encodeURIComponent(stepName)}`, { method: 'DELETE' })
}

export interface RunInfo {
  id: string
  parserName: string
  status: 'running' | 'stopped' | 'completed' | 'failed'
  startedAt: string
  stoppedAt: string | null
  stats: RunStats | null
  isRunning?: boolean
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
  parentData?: Record<string, unknown> | null
}

export async function listJobs(page = 1, limit = 50): Promise<{ runs: RunInfo[]; total: number }> {
  return apiRequest(`/api/jobs?page=${page}&limit=${limit}`)
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

export async function getTaskResult(runId: string, taskId: string): Promise<{ rows: Record<string, unknown>[] }> {
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

export async function abortTask(runId: string, taskId: string): Promise<void> {
  await apiRequest(`/api/jobs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/abort`, { method: 'POST' })
}

export async function resumeParser(name: string): Promise<void> {
  const res = await fetch(`/api/parsers/${encodeURIComponent(name)}/resume`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? 'Failed to resume')
  }
}
