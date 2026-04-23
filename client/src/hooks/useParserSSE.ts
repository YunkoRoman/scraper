import { useEffect, useState } from 'react'
import type { RunStats } from '../api'

export type ParserStatus = 'idle' | 'running' | 'complete' | 'error'

export interface ParserState {
  status: ParserStatus
  stats: RunStats | null
  errorMessage: string | null
}

export function useParserSSE(parserName: string): ParserState {
  const [state, setState] = useState<ParserState>({
    status: 'idle',
    stats: null,
    errorMessage: null,
  })

  useEffect(() => {
    const es = new EventSource(`/api/parsers/${parserName}/events`)

    es.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as {
        type: string
        running?: boolean
        stats?: RunStats | null
        filePath?: string
        message?: string
      }

      switch (msg.type) {
        case 'init':
          setState({
            status: msg.running ? 'running' : msg.stats ? 'complete' : 'idle',
            stats: msg.stats ?? null,
            errorMessage: null,
          })
          break
        case 'stats':
          setState({ status: 'running', stats: msg.stats ?? null, errorMessage: null })
          break
        case 'complete':
          setState({ status: 'complete', stats: msg.stats ?? null, errorMessage: null })
          break
        case 'stopped':
          setState((prev) => ({ ...prev, status: 'idle' }))
          break
        case 'error':
          setState((prev) => ({ ...prev, status: 'error', errorMessage: msg.message ?? 'Unknown error' }))
          break
      }
    }

    es.onerror = () => {
      // SSE reconnects automatically — don't update state on transient errors
    }

    return () => es.close()
  }, [parserName])

  return state
}
