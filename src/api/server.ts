import express from 'express'
import cors from 'cors'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import type { RunStats } from '../domain/entities/ParserRun.js'
import type { Response } from 'express'
import { DebugStepRunner } from '../application/use-cases/DebugStepRunner.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const parsersDir = resolve(__dirname, '../../src/parsers')
const outputDir = resolve(process.cwd(), 'output')

const loader = new FileParserLoader(parsersDir)
const runParser = new RunParser(loader, outputDir)
const runner = new ParserRunnerService(runParser)

const sseClients = new Map<string, Set<Response>>()

function getClients(name: string): Set<Response> {
  if (!sseClients.has(name)) sseClients.set(name, new Set())
  return sseClients.get(name)!
}

function broadcast(name: string, payload: object) {
  const clients = sseClients.get(name)
  if (!clients?.size) return
  const line = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) res.write(line)
}

runner.on('stats', (name: string, stats: RunStats) => broadcast(name, { type: 'stats', stats }))
runner.on('complete', (name: string, stats: RunStats) => broadcast(name, { type: 'complete', stats }))
runner.on('stopped', (name: string) => broadcast(name, { type: 'stopped' }))
runner.on('postprocess', (name: string, filePath: string) =>
  broadcast(name, { type: 'postprocess', filePath }),
)

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/parsers', async (_req, res) => {
  try {
    const entries = await readdir(parsersDir, { withFileTypes: true })
    const parsers = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    res.json({ parsers })
  } catch {
    res.json({ parsers: [] })
  }
})

app.post('/api/parsers/:name/start', (req, res) => {
  const { name } = req.params
  process.stdout.write(`[server] start request: ${name}\n`)
  if (runner.isRunning(name)) {
    res.status(409).json({ error: 'Already running' })
    return
  }
  runner.run(name).catch((err: Error) => {
    console.error(`[server] runner error:`, err)
    broadcast(name, { type: 'error', message: err.message })
  })
  res.json({ ok: true })
})

app.post('/api/parsers/:name/stop', async (req, res) => {
  const { name } = req.params
  try {
    await runner.stop(name)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.get('/api/parsers/:name/status', (req, res) => {
  const { name } = req.params
  res.json({ running: runner.isRunning(name), stats: runner.getStats(name) ?? null })
})

app.get('/api/parsers/:name/events', (req, res) => {
  const { name } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  res.write(
    `data: ${JSON.stringify({ type: 'init', running: runner.isRunning(name), stats: runner.getStats(name) ?? null })}\n\n`,
  )

  getClients(name).add(res)
  req.on('close', () => getClients(name).delete(res))
})

app.get('/api/parsers/:name/files', async (req, res) => {
  const { name } = req.params
  const dir = resolve(outputDir, name)
  try {
    const entries = await readdir(dir)
    const files = await Promise.all(
      entries
        .filter((f) => f.endsWith('.csv'))
        .map(async (f) => {
          const s = await stat(resolve(dir, f))
          return { name: f, size: s.size, mtime: s.mtime.toISOString() }
        }),
    )
    files.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    res.json({ files })
  } catch {
    res.json({ files: [] })
  }
})

app.get('/api/parsers/:name/files/:file', (req, res) => {
  const { name, file } = req.params
  const filePath = resolve(outputDir, name, file)
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
  createReadStream(filePath).pipe(res)
})

app.get('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  try {
    const config = await loader.load(name)
    const steps = [...config.steps.entries()].map(([sName, step]) => ({
      name: sName,
      type: step.type,
    }))
    res.json({ steps })
  } catch (err) {
    const msg = (err as Error).message
    const status = msg.includes('ENOENT') || msg.includes('not found') ? 404 : 500
    res.status(status).json({ error: msg })
  }
})

app.post('/api/parsers/:name/steps/:step/debug', async (req, res) => {
  const { name, step } = req.params
  const { url, parentData } = req.body as { url: string; parentData?: Record<string, unknown> }

  if (!url) {
    res.status(400).json({ error: 'url is required' })
    return
  }
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'url must start with http:// or https://' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (payload: object) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

  const debugRunner = new DebugStepRunner(loader)
  debugRunner.on('log', (log) => send({ type: 'log', ...log }))
  debugRunner.on('result', (result) => send({ type: 'result', result }))
  let cancelled = false
  req.on('close', () => { cancelled = true; debugRunner.stop() })

  try {
    await debugRunner.run(name, step, url, parentData)
    if (!cancelled) send({ type: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!(err instanceof Error && err.message === 'aborted')) send({ type: 'error', error: message })
  } finally {
    res.end()
  }
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log(`API server →  http://localhost:${PORT}`)
})

async function shutdown() {
  await Promise.allSettled(runner.listRunning().map((name) => runner.stop(name)))
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
