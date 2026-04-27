import type { Response } from 'express'

const sseClients = new Map<string, Set<Response>>()

export function getClients(name: string): Set<Response> {
  if (!sseClients.has(name)) sseClients.set(name, new Set())
  return sseClients.get(name)!
}

export function broadcast(name: string, payload: object): void {
  const clients = sseClients.get(name)
  if (!clients?.size) return
  const line = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) res.write(line)
}

export function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
}

export function writeSSE(res: Response, payload: object): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}
