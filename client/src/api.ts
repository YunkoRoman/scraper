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
