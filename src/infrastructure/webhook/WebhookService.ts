import type { RunStats } from '../../domain/entities/ParserRun.js'

export interface WebhookPayload {
  event:      'complete' | 'stopped' | 'error'
  parserName: string
  runId:      string | null
  stats:      RunStats | null
  timestamp:  string
}

export class WebhookService {
  async fire(url: string, payload: WebhookPayload): Promise<void> {
    try {
      await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
    } catch (err) {
      console.error(`[webhook] POST ${url} failed:`, (err as Error).message)
    }
  }
}
