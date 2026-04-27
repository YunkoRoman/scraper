import express from 'express'
import type { ParserRunnerService } from '../../application/services/ParserRunnerService.js'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'
import { broadcast } from '../sse.js'

interface Deps {
  runner: ParserRunnerService
  runPersistence: RunPersistenceService
}

export function createJobsRouter({ runner, runPersistence }: Deps) {
  const router = express.Router()

  // ── Runs ─────────────────────────────────────────────────────────────────────

  router.get('/', async (req, res) => {
    const page  = Math.max(1,   parseInt(String(req.query.page  ?? '1'),  10))
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10))
    res.json(await runPersistence.getAllRuns(page, limit))
  })

  router.get('/:runId', async (req, res) => {
    const { runId } = req.params
    const run = await runPersistence.findById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    const isRunning = runner.isRunning(run.parserName) &&
      runner.getOrchestrator(run.parserName)?.runId === runId
    res.json({ ...run, isRunning })
  })

  router.post('/:runId/stop', async (req, res) => {
    const parserName = runner.findParserByRunId(req.params.runId)
    if (!parserName) { res.status(404).json({ error: 'No active run with this runId' }); return }
    try {
      await runner.stop(parserName)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post('/:runId/resume', async (req, res) => {
    const { runId } = req.params
    const run = await runPersistence.findById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    if (runner.isRunning(run.parserName)) { res.status(409).json({ error: 'Parser already running' }); return }
    runner.resume(run.parserName).catch((err: Error) =>
      broadcast(run.parserName, { type: 'error', message: err.message }),
    )
    res.json({ ok: true })
  })

  router.post('/:runId/retry-failed', async (req, res) => {
    const { runId } = req.params
    const run = await runPersistence.findById(runId)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }
    if (runner.isRunning(run.parserName)) { res.status(409).json({ error: 'Parser already running' }); return }
    runner.retryFailed(runId).catch((err: Error) =>
      broadcast(run.parserName, { type: 'error', message: err.message }),
    )
    res.json({ ok: true })
  })

  // ── Tasks ────────────────────────────────────────────────────────────────────

  router.get('/:runId/tasks', async (req, res) => {
    const { runId } = req.params
    const page   = Math.max(1,   parseInt(String(req.query.page   ?? '1'),   10))
    const limit  = Math.min(500, parseInt(String(req.query.limit  ?? '100'), 10))
    const status = req.query.status as string | undefined

    const parserName = runner.findParserByRunId(runId)
    const orch = parserName ? runner.getOrchestrator(parserName) : undefined
    if (orch) {
      const allTasks = orch.getAllTasks()
      const filtered = status ? allTasks.filter((t) => t.state === status) : allTasks
      res.json({ tasks: filtered.slice((page - 1) * limit, page * limit), total: filtered.length })
      return
    }
    res.json(await runPersistence.getRunTasks(runId, page, limit, status))
  })

  router.get('/:runId/tasks/:taskId', async (req, res) => {
    const { runId, taskId } = req.params
    const parserName = runner.findParserByRunId(runId)
    if (parserName) {
      const task = runner.getOrchestrator(parserName)?.getAllTasks().find((t) => t.id === taskId)
      if (task) { res.json(task); return }
    }
    const task = await runPersistence.getTask(runId, taskId)
    if (!task) { res.status(404).json({ error: 'Task not found' }); return }
    res.json(task)
  })

  router.get('/:runId/tasks/:taskId/result', async (req, res) => {
    const { runId, taskId } = req.params
    const rows = await runPersistence.getTaskResult(runId, taskId)
    res.json({ rows: rows ?? [] })
  })

  router.post('/:runId/tasks/:taskId/retry', (req, res) => {
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

  router.post('/:runId/tasks/:taskId/abort', (req, res) => {
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

  return router
}
