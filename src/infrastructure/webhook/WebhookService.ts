import { type RunStats } from '../../domain/entities/ParserRun.js'
import { lookup } from 'node:dns/promises'

export interface WebhookPayload {
  event: 'complete' | 'stopped' | 'error'
  parserName: string
  runId: string | null
  stats: RunStats | null
  timestamp: string
}

const BLOCKED_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
]

async function isPrivateHost(hostname: string): Promise<boolean> {
  if (BLOCKED_PATTERNS.some((r) => r.test(hostname))) return true
  try {
    const addresses = await lookup(hostname, { all: true })
    return addresses.some(({ address }) => BLOCKED_PATTERNS.some((r) => r.test(address)))
  } catch {
    return false
  }
}

export class WebhookService {
  async fire(url: string, payload: WebhookPayload): Promise<void> {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        console.error(`[webhook] Blocked non-http(s) URL: ${url}`)
        return
      }
      if (await isPrivateHost(parsed.hostname)) {
        console.error(`[webhook] Blocked SSRF attempt to private host: ${parsed.hostname}`)
        return
      }
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      console.error(`[webhook] POST ${url} failed:`, (err as Error).message)
    }
  }
}
