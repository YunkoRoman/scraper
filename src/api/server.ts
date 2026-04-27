import express from 'express'
import cors from 'cors'
import { resolve } from 'node:path'
import type { RunStats } from '../domain/entities/ParserRun.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { RunPersistenceService } from '../infrastructure/db/RunPersistenceService.js'
import { ParserPersistenceService } from '../infrastructure/db/ParserPersistenceService.js'
import { broadcast } from './sse.js'
import { createParsersRouter } from './routes/parsers.js'
import { createJobsRouter } from './routes/jobs.js'

// ── Services ──────────────────────────────────────────────────────────────────
const outputDir      = resolve(process.cwd(), 'output')
const dbLoader       = new DbParserLoader()
const runPersistence = new RunPersistenceService()
const parserService  = new ParserPersistenceService()
const runner         = new ParserRunnerService(new RunParser(dbLoader, outputDir), runPersistence)

// ── Wire runner events to SSE broadcast ───────────────────────────────────────
runner.on('stats',       (name: string, stats: RunStats) => broadcast(name, { type: 'stats', stats }))
runner.on('complete',    (name: string, stats: RunStats) => broadcast(name, { type: 'complete', stats }))
runner.on('stopped',     (name: string)                  => broadcast(name, { type: 'stopped' }))
runner.on('postprocess', (name: string, filePath: string) => broadcast(name, { type: 'postprocess', filePath }))

// ── App ───────────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/parsers', createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir }))
app.use('/api/jobs',    createJobsRouter({ runner, runPersistence }))

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => console.log(`API server →  http://localhost:${PORT}`))

async function shutdown() {
  await Promise.allSettled(runner.listRunning().map((name) => runner.stop(name)))
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
