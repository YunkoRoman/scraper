import express from 'express'
import cors from 'cors'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import type { RunStats } from '../domain/entities/ParserRun.js'
import type { Response } from 'express'
import { DebugStepRunner } from '../application/use-cases/DebugStepRunner.js'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { RunPersistenceService } from '../infrastructure/db/RunPersistenceService.js'
import { db } from '../infrastructure/db/client.js'
import { parsers as parsersTable, steps as stepsTable } from '../infrastructure/db/schema.js'
import { eq, and } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputDir = resolve(process.cwd(), 'output')

const dbLoader = new DbParserLoader()
const runPersistence = new RunPersistenceService()
const runParser = new RunParser(dbLoader, outputDir)
const runner = new ParserRunnerService(runParser, runPersistence)

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

// GET /api/parsers — list from DB
app.get('/api/parsers', async (_req, res) => {
  try {
    const rows = await db.select({ name: parsersTable.name }).from(parsersTable)
    res.json({ parsers: rows.map((r) => r.name) })
  } catch {
    res.json({ parsers: [] })
  }
})

// POST /api/parsers — create parser
app.post('/api/parsers', async (req, res) => {
  const { name, entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body as {
    name: string
    entryUrl?: string
    entryStep?: string
    browserType?: string
    browserSettings?: object
    retryConfig?: { maxRetries: number }
    deduplication?: boolean
    concurrentQuota?: number
  }
  if (!name) { res.status(400).json({ error: 'name is required' }); return }
  if (!/^[a-z0-9_-]+$/i.test(name)) { res.status(400).json({ error: 'name must be alphanumeric with hyphens/underscores' }); return }
  try {
    const [row] = await db.insert(parsersTable).values({
      name,
      entryUrl: entryUrl ?? '',
      entryStep: entryStep ?? '',
      browserType: browserType ?? 'playwright',
      browserSettings: browserSettings ?? {},
      retryConfig: retryConfig ?? { maxRetries: 5 },
      deduplication: deduplication ?? true,
      concurrentQuota: concurrentQuota ?? null,
    }).returning()
    res.status(201).json({ parser: row })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Parser "${name}" already exists` }); return }
    res.status(500).json({ error: msg })
  }
})

// GET /api/parsers/:name — get parser with steps metadata
app.get('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select().from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const stepRows = await db.select().from(stepsTable)
    .where(eq(stepsTable.parserId, parserRow.id))
    .orderBy(stepsTable.position)
  res.json({ parser: parserRow, steps: stepRows })
})

// PUT /api/parsers/:name — update parser metadata
app.put('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const [row] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!row) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body
  const [updated] = await db.update(parsersTable).set({
    ...(entryUrl !== undefined && { entryUrl }),
    ...(entryStep !== undefined && { entryStep }),
    ...(browserType !== undefined && { browserType }),
    ...(browserSettings !== undefined && { browserSettings }),
    ...(retryConfig !== undefined && { retryConfig }),
    ...(deduplication !== undefined && { deduplication }),
    ...(concurrentQuota !== undefined && { concurrentQuota }),
    updatedAt: new Date(),
  }).where(eq(parsersTable.name, name)).returning()
  res.json({ parser: updated })
})

// DELETE /api/parsers/:name
app.delete('/api/parsers/:name', async (req, res) => {
  const { name } = req.params
  const deleted = await db.delete(parsersTable).where(eq(parsersTable.name, name)).returning({ id: parsersTable.id })
  if (!deleted.length) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  res.json({ ok: true })
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

app.post('/api/parsers/:name/resume', (req, res) => {
  const { name } = req.params
  if (runner.isRunning(name)) {
    res.status(409).json({ error: 'Already running' })
    return
  }
  runner.resume(name).catch((err: Error) => {
    console.error(`[server] resume error:`, err)
    broadcast(name, { type: 'error', message: err.message })
  })
  res.json({ ok: true })
})

app.get('/api/parsers/:name/status', (req, res) => {
  const { name } = req.params
  res.json({ running: runner.isRunning(name), stats: runner.getStats(name) ?? null })
})

app.get('/api/parsers/:name/events', async (req, res) => {
  const { name } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const isRunning = runner.isRunning(name)
  let stoppedRunExists = false
  if (!isRunning) {
    const info = await runPersistence.getLatestRunInfo(name).catch(() => null)
    stoppedRunExists = info?.status === 'stopped'
  }

  res.write(
    `data: ${JSON.stringify({
      type: 'init',
      running: isRunning,
      stats: runner.getStats(name) ?? null,
      stoppedRunExists,
    })}\n\n`,
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

// POST /api/parsers/:name/steps — create step
app.post('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const { name: stepName, type, entryUrl, outputFile, code, position } = req.body as {
    name: string; type: 'traverser' | 'extractor'; entryUrl?: string; outputFile?: string; code?: string; position?: number
  }
  if (!stepName) { res.status(400).json({ error: 'name is required' }); return }
  if (type !== 'traverser' && type !== 'extractor') { res.status(400).json({ error: 'type must be traverser or extractor' }); return }
  try {
    const [row] = await db.insert(stepsTable).values({
      parserId: parserRow.id,
      name: stepName,
      type,
      entryUrl: entryUrl ?? '',
      outputFile: outputFile ?? (type === 'extractor' ? `${stepName}.csv` : null),
      code: code ?? '',
      position: position ?? 0,
    }).returning()
    res.status(201).json({ step: row })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Step "${stepName}" already exists` }); return }
    res.status(500).json({ error: msg })
  }
})

// GET /api/parsers/:name/steps — list steps from DB
app.get('/api/parsers/:name/steps', async (req, res) => {
  const { name } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const stepRows = await db.select({
    name: stepsTable.name,
    type: stepsTable.type,
    position: stepsTable.position,
  }).from(stepsTable).where(eq(stepsTable.parserId, parserRow.id)).orderBy(stepsTable.position)
  res.json({ steps: stepRows })
})

// GET /api/parsers/:name/steps/:step — get step with code
app.get('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const [stepRow] = await db.select().from(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step)))
  if (!stepRow) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  res.json({ step: stepRow })
})

// PUT /api/parsers/:name/steps/:step — update step (autosave target)
app.put('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const [stepRow] = await db.select({ id: stepsTable.id }).from(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step)))
  if (!stepRow) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  const { name: newName, type, entryUrl, outputFile, code, stepSettings, position } = req.body
  try {
    const [updated] = await db.update(stepsTable).set({
      ...(newName !== undefined && { name: newName }),
      ...(type !== undefined && { type }),
      ...(entryUrl !== undefined && { entryUrl }),
      ...(outputFile !== undefined && { outputFile }),
      ...(code !== undefined && { code }),
      ...(stepSettings !== undefined && { stepSettings }),
      ...(position !== undefined && { position }),
      updatedAt: new Date(),
    }).where(eq(stepsTable.id, stepRow.id)).returning()
    res.json({ step: updated })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('unique')) { res.status(409).json({ error: `Step name already exists` }); return }
    res.status(500).json({ error: msg })
  }
})

// DELETE /api/parsers/:name/steps/:step
app.delete('/api/parsers/:name/steps/:step', async (req, res) => {
  const { name, step } = req.params
  const [parserRow] = await db.select({ id: parsersTable.id }).from(parsersTable).where(eq(parsersTable.name, name))
  if (!parserRow) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
  const deleted = await db.delete(stepsTable).where(and(eq(stepsTable.parserId, parserRow.id), eq(stepsTable.name, step))).returning({ id: stepsTable.id })
  if (!deleted.length) { res.status(404).json({ error: `Step "${step}" not found` }); return }
  res.json({ ok: true })
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

  const debugRunner = new DebugStepRunner(dbLoader)
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

// GET /api/jobs — list all runs, paginated
app.get('/api/jobs', async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10))
  const limit = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10))
  try {
    const result = await runPersistence.getAllRuns(page, limit)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId/tasks/:taskId/result — extracted rows for a task
app.get('/api/jobs/:runId/tasks/:taskId/result', async (req, res) => {
  const { runId, taskId } = req.params
  try {
    const rows = await runPersistence.getTaskResult(runId, taskId)
    res.json({ rows: rows ?? [] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/tasks/:taskId/retry
app.post('/api/jobs/:runId/tasks/:taskId/retry', (req, res) => {
  const { runId, taskId } = req.params
  const parserName = runner.findParserByRunId(runId)
  if (!parserName) { res.status(404).json({ error: 'No active run with this runId — resume the job first' }); return }
  try {
    runner.retryTask(parserName, taskId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/tasks/:taskId/abort — abort a pending/in-progress task
app.post('/api/jobs/:runId/tasks/:taskId/abort', (req, res) => {
  const { runId, taskId } = req.params
  const parserName = runner.findParserByRunId(runId)
  if (!parserName) { res.status(404).json({ error: 'No active run with this runId — resume the job first' }); return }
  try {
    runner.abortTask(parserName, taskId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId/tasks/:taskId — single task metadata
app.get('/api/jobs/:runId/tasks/:taskId', async (req, res) => {
  const { runId, taskId } = req.params
  try {
    const parserName = runner.findParserByRunId(runId)
    if (parserName) {
      const orchestrator = runner.getOrchestrator(parserName)
      const task = orchestrator?.getAllTasks().find((t) => t.id === taskId)
      if (task) { res.json(task); return }
    }
    const task = await runPersistence.getTask(runId, taskId)
    if (!task) { res.status(404).json({ error: 'Task not found' }); return }
    res.json(task)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId/tasks — paginated task list
app.get('/api/jobs/:runId/tasks', async (req, res) => {
  const { runId } = req.params
  const page   = Math.max(1, parseInt(String(req.query.page   ?? '1'),   10))
  const limit  = Math.min(500, parseInt(String(req.query.limit ?? '100'), 10))
  const status = req.query.status as string | undefined

  try {
    const parserName = runner.findParserByRunId(runId)
    const orch = parserName ? runner.getOrchestrator(parserName) : undefined
    if (orch) {
      const allTasks = orch.getAllTasks()
      const filtered = status ? allTasks.filter((t) => t.state === status) : allTasks
      const total = filtered.length
      const tasks = filtered.slice((page - 1) * limit, page * limit)
      res.json({ tasks, total })
      return
    }
    const dbResult = await runPersistence.getRunTasks(runId, page, limit, status)
    res.json(dbResult)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/jobs/:runId — run info + stats
app.get('/api/jobs/:runId', async (req, res) => {
  const { runId } = req.params
  try {
    const run = await runPersistence.getRunById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    const isRunning = runner.isRunning(run.parserName) &&
      runner.getOrchestrator(run.parserName)?.runId === runId
    res.json({ ...run, isRunning })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/stop
app.post('/api/jobs/:runId/stop', async (req, res) => {
  const { runId } = req.params
  const parserName = runner.findParserByRunId(runId)
  if (!parserName) { res.status(404).json({ error: 'No active run with this runId' }); return }
  try {
    await runner.stop(parserName)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/resume
app.post('/api/jobs/:runId/resume', async (req, res) => {
  const { runId } = req.params
  try {
    const run = await runPersistence.getRunById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    if (runner.isRunning(run.parserName)) {
      res.status(409).json({ error: 'Parser already running' }); return
    }
    runner.resume(run.parserName).catch((err: Error) => {
      broadcast(run.parserName, { type: 'error', message: err.message })
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/jobs/:runId/retry-failed
app.post('/api/jobs/:runId/retry-failed', async (req, res) => {
  const { runId } = req.params
  try {
    const run = await runPersistence.getRunById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    if (runner.isRunning(run.parserName)) {
      res.status(409).json({ error: 'Parser already running' }); return
    }
    runner.retryFailed(runId).catch((err: Error) => {
      broadcast(run.parserName, { type: 'error', message: err.message })
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
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
