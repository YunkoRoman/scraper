import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebhookService } from '../infrastructure/webhook/WebhookService.js'

describe('WebhookService', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('posts JSON payload to the URL', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const svc = new WebhookService()
    await svc.fire('https://hooks.example.com/x', {
      event: 'complete',
      parserName: 'demo',
      runId: 'r1',
      stats: null,
      timestamp: '2026-05-21T00:00:00Z',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hooks.example.com/x')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.event).toBe('complete')
  })

  it('does not throw when the request fails', async () => {
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const svc = new WebhookService()
    await expect(
      svc.fire('https://nope', { event: 'error', parserName: 'demo', runId: 'r', stats: null, timestamp: '' })
    ).resolves.toBeUndefined()
  })
})
