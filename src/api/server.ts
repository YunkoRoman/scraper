import express from 'express'
import cors from 'cors'
import { resolve } from 'node:path'
import type { RunStats } from '../domain/entities/ParserRun.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { RunPersistenceService } from '../infrastructure/db/RunPersistenceService.js'
import { ParserPersistenceService } from '../infrastructure/db/ParserPersistenceService.js'
import { SchedulePersistenceService } from '../infrastructure/db/SchedulePersistenceService.js'
import { StepVersionPersistenceService } from '../infrastructure/db/StepVersionPersistenceService.js'
import { SchedulerService } from '../application/services/SchedulerService.js'
import { broadcast } from './sse.js'
import { WebhookService } from '../infrastructure/webhook/WebhookService.js'
import { createParsersRouter } from './routes/parsers.js'
import { createJobsRouter } from './routes/jobs.js'
import { createDashboardRouter } from './routes/dashboard.js'

// ── Services ──────────────────────────────────────────────────────────────────
const outputDir      = resolve(process.cwd(), 'output')
const dbLoader       = new DbParserLoader()
const runPersistence = new RunPersistenceService()
const parserService  = new ParserPersistenceService()
const stepVersionService = new StepVersionPersistenceService()
parserService.setVersionService(stepVersionService)
const runner         = new ParserRunnerService(new RunParser(dbLoader, outputDir), runPersistence)
const webhookService = new WebhookService()
const schedulePersistence = new SchedulePersistenceService()
const scheduler           = new SchedulerService(schedulePersistence, parserService, runner)
scheduler.start()

// ── Wire runner events to SSE broadcast ───────────────────────────────────────
runner.on('stats',       (name: string, stats: RunStats) => broadcast(name, { type: 'stats', stats }))
runner.on('complete',    async (name: string, stats: RunStats) => {
  broadcast(name, { type: 'complete', stats })
  const parser = await parserService.getParserByName(name).catch(() => null)
  if (parser?.webhookUrl) {
    void webhookService.fire(parser.webhookUrl, {
      event: 'complete', parserName: name, runId: null, stats, timestamp: new Date().toISOString(),
    })
  }
})
runner.on('stopped',     async (name: string) => {
  broadcast(name, { type: 'stopped' })
  const parser = await parserService.getParserByName(name).catch(() => null)
  if (parser?.webhookUrl) {
    void webhookService.fire(parser.webhookUrl, {
      event: 'stopped', parserName: name, runId: null, stats: runner.getStats(name) ?? null, timestamp: new Date().toISOString(),
    })
  }
})
runner.on('postprocess', (name: string, filePath: string) => broadcast(name, { type: 'postprocess', filePath }))

// ── App ───────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim())
const app = express()
app.use(cors({ origin: (origin, cb) => {
  if (!origin || allowedOrigins.includes(origin)) cb(null, true)
  else cb(new Error(`CORS: origin ${origin} not allowed`))
}}))
app.use(express.json({ limit: '1mb' }))
app.use('/api/parsers', createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir, schedulePersistence, stepVersionService }))
app.use('/api/jobs',    createJobsRouter({ runner, runPersistence }))
app.use('/api/dashboard', createDashboardRouter({ runPersistence }))

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => console.log(`API server →  http://localhost:${PORT}`))

async function shutdown() {
  scheduler.stop()
  await Promise.allSettled(runner.listRunning().map((name) => runner.stop(name)))
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
