// client/src/hooks/useParserSSE.ts
import { useEffect, useState } from 'react'
import type { RunStats } from '../api'

export type ParserStatus = 'idle' | 'running' | 'stopped' | 'complete' | 'error'

export interface ParserState {
  status: ParserStatus
  stats: RunStats | null
  errorMessage: string | null
  stoppedRunExists: boolean
}

export function useParserSSE(parserName: string): ParserState {
  const [state, setState] = useState<ParserState>({
    status: 'idle',
    stats: null,
    errorMessage: null,
    stoppedRunExists: false,
  })

  useEffect(() => {
    const es = new EventSource(`/api/parsers/${parserName}/events`)

    es.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as {
        type: string
        running?: boolean
        stats?: RunStats | null
        stoppedRunExists?: boolean
        message?: string
      }

      switch (msg.type) {
        case 'init':
          setState({
            status: msg.running
              ? 'running'
              : msg.stoppedRunExists
                ? 'stopped'
                : msg.stats
                  ? 'complete'
                  : 'idle',
            stats: msg.stats ?? null,
            errorMessage: null,
            stoppedRunExists: msg.stoppedRunExists ?? false,
          })
          break
        case 'stats':
          setState({ status: 'running', stats: msg.stats ?? null, errorMessage: null, stoppedRunExists: false })
          break
        case 'complete':
          setState({ status: 'complete', stats: msg.stats ?? null, errorMessage: null, stoppedRunExists: false })
          break
        case 'stopped':
          setState((prev) => ({ ...prev, status: 'stopped', stoppedRunExists: true }))
          break
        case 'error':
          setState((prev) => ({ ...prev, status: 'error', errorMessage: msg.message ?? 'Unknown error' }))
          break
      }
    }

    es.onerror = () => {}
    return () => es.close()
  }, [parserName])

  return state
}
