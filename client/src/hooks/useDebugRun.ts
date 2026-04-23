// client/src/hooks/useDebugRun.ts
import { useEffect, useRef, useState } from 'react'
import type { TraverserResult } from '../api'

export interface LogLine {
  level: 'log' | 'error'
  stepName: string
  args: string[]
}

export type DebugResult =
  | { type: 'links'; items: TraverserResult[] }
  | { type: 'data'; rows: Record<string, unknown>[]; outputFile: string }

export interface DebugRunState {
  status: 'idle' | 'running' | 'done' | 'error'
  logs: LogLine[]
  result: DebugResult | null
  error: string | null
}

export function useDebugRun() {
  const [state, setState] = useState<DebugRunState>({
    status: 'idle',
    logs: [],
    result: null,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function run(
    parserName: string,
    stepName: string,
    url: string,
    parentData?: Record<string, unknown>,
  ) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'running', logs: [], result: null, error: null })

    try {
      const res = await fetch(`/api/parsers/${parserName}/steps/${stepName}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, parentData }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => 'Unknown error')
        setState((prev) => ({ ...prev, status: 'error', error: text }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE events are separated by double newline
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          const msg = JSON.parse(dataLine.slice(6)) as {
            type: string
            level?: 'log' | 'error'
            stepName?: string
            args?: string[]
            result?: DebugResult
            error?: string
          }
          switch (msg.type) {
            case 'log':
              setState((prev) => ({
                ...prev,
                logs: [
                  ...prev.logs,
                  { level: msg.level!, stepName: msg.stepName!, args: msg.args! },
                ],
              }))
              break
            case 'result':
              setState((prev) => ({ ...prev, result: msg.result! }))
              break
            case 'done':
              setState((prev) => ({ ...prev, status: 'done' }))
              break
            case 'error':
              setState((prev) => ({ ...prev, status: 'error', error: msg.error! }))
              break
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState((prev) => ({ ...prev, status: 'error', error: (err as Error).message }))
    }
  }

  function reset() {
    abortRef.current?.abort()
    setState({ status: 'idle', logs: [], result: null, error: null })
  }

  return { ...state, run, reset }
}
