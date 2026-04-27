import express from 'express'
import { resolve } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import type { ParserRunnerService } from '../../application/services/ParserRunnerService.js'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'
import type { DbParserLoader } from '../../infrastructure/loader/DbParserLoader.js'
import {
  ParserPersistenceService,
  ParserAlreadyExistsError,
  StepAlreadyExistsError,
  type ParserRow,
} from '../../infrastructure/db/ParserPersistenceService.js'
import { DebugStepRunner } from '../../application/use-cases/DebugStepRunner.js'
import { broadcast, getClients, initSSE, writeSSE } from '../sse.js'

interface Deps {
  runner: ParserRunnerService
  runPersistence: RunPersistenceService
  parserService: ParserPersistenceService
  dbLoader: DbParserLoader
  outputDir: string
}

export function createParsersRouter({ runner, runPersistence, parserService, dbLoader, outputDir }: Deps) {
  const router = express.Router()

  router.param('name', async (_req, res, next, name: string) => {
    const parser = await parserService.getParserByName(name)
    if (!parser) { res.status(404).json({ error: `Parser "${name}" not found` }); return }
    res.locals.parser = parser
    next()
  })

  // ── Parser CRUD ─────────────────────────────────────────────────────────────

  router.get('/', async (_req, res) => {
    try {
      res.json({ parsers: await parserService.listParserNames() })
    } catch {
      res.json({ parsers: [] })
    }
  })

  router.post('/', async (req, res) => {
    const {
      name, entryUrl, entryStep, browserType,
      browserSettings, retryConfig, deduplication, concurrentQuota,
    } = req.body as {
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
      const parser = await parserService.create({ name, entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota })
      res.status(201).json({ parser })
    } catch (err) {
      if (err instanceof ParserAlreadyExistsError) { res.status(409).json({ error: err.message }); return }
      throw err
    }
  })

  router.get('/:name', async (_req, res) => {
    const { id, name }: ParserRow = res.locals.parser
    const result = await parserService.getParserWithSteps(name)
    res.json(result ?? { parser: res.locals.parser, steps: await parserService.listSteps(id) })
  })

  router.put('/:name', async (req, res) => {
    const { id }: ParserRow = res.locals.parser
    const { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota } = req.body
    const parser = await parserService.update(id, { entryUrl, entryStep, browserType, browserSettings, retryConfig, deduplication, concurrentQuota })
    res.json({ parser })
  })

  router.delete('/:name', async (_req, res) => {
    await parserService.delete((res.locals.parser as ParserRow).id)
    res.json({ ok: true })
  })

  // ── Run control ──────────────────────────────────────────────────────────────

  router.post('/:name/start', (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    if (runner.isRunning(name)) { res.status(409).json({ error: 'Already running' }); return }
    runner.run(name).catch((err: Error) => broadcast(name, { type: 'error', message: err.message }))
    res.json({ ok: true })
  })

  router.post('/:name/stop', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    try {
      await runner.stop(name)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post('/:name/resume', (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    if (runner.isRunning(name)) { res.status(409).json({ error: 'Already running' }); return }
    runner.resume(name).catch((err: Error) => broadcast(name, { type: 'error', message: err.message }))
    res.json({ ok: true })
  })

  router.get('/:name/status', (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    res.json({ running: runner.isRunning(name), stats: runner.getStats(name) ?? null })
  })

  // ── SSE event stream ─────────────────────────────────────────────────────────

  router.get('/:name/events', async (req, res) => {
    const { name }: ParserRow = res.locals.parser
    initSSE(res)

    const isRunning = runner.isRunning(name)
    let stoppedRunExists = false
    if (!isRunning) {
      const info = await runPersistence.getLatestRunInfo(name).catch(() => null)
      stoppedRunExists = info?.status === 'stopped'
    }

    writeSSE(res, { type: 'init', running: isRunning, stats: runner.getStats(name) ?? null, stoppedRunExists })
    getClients(name).add(res)
    req.on('close', () => getClients(name).delete(res))
  })

  // ── Output files ─────────────────────────────────────────────────────────────

  router.get('/:name/files', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
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

  router.get('/:name/files/:file', (req, res) => {
    const { name }: ParserRow = res.locals.parser
    const { file } = req.params
    const filePath = resolve(outputDir, name, file)
    if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return }
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
    createReadStream(filePath).pipe(res)
  })

  // ── Steps CRUD ───────────────────────────────────────────────────────────────

  router.post('/:name/steps', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const { name: stepName, type, entryUrl, outputFile, code, position } = req.body as {
      name: string
      type: 'traverser' | 'extractor'
      entryUrl?: string
      outputFile?: string
      code?: string
      position?: number
    }
    if (!stepName) { res.status(400).json({ error: 'name is required' }); return }
    if (type !== 'traverser' && type !== 'extractor') { res.status(400).json({ error: 'type must be traverser or extractor' }); return }
    try {
      const step = await parserService.createStep({ parserId, name: stepName, type, entryUrl, outputFile, code, position })
      res.status(201).json({ step })
    } catch (err) {
      if (err instanceof StepAlreadyExistsError) { res.status(409).json({ error: err.message }); return }
      throw err
    }
  })

  router.get('/:name/steps', async (_req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    res.json({ steps: await parserService.listSteps(parserId) })
  })

  router.get('/:name/steps/:step', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) { res.status(404).json({ error: `Step "${req.params.step}" not found` }); return }
    res.json({ step })
  })

  router.put('/:name/steps/:step', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) { res.status(404).json({ error: `Step "${req.params.step}" not found` }); return }
    const { name: newName, type, entryUrl, outputFile, code, stepSettings, position } = req.body
    try {
      const updated = await parserService.updateStep(step.id, { name: newName, type, entryUrl, outputFile, code, stepSettings, position })
      res.json({ step: updated })
    } catch (err) {
      if (err instanceof StepAlreadyExistsError) { res.status(409).json({ error: err.message }); return }
      throw err
    }
  })

  router.delete('/:name/steps/:step', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const deleted = await parserService.deleteStep(parserId, req.params.step)
    if (!deleted) { res.status(404).json({ error: `Step "${req.params.step}" not found` }); return }
    res.json({ ok: true })
  })

  // ── Step debug (SSE) ─────────────────────────────────────────────────────────

  router.post('/:name/steps/:step/debug', async (req, res) => {
    const { name }: ParserRow = res.locals.parser
    const { step } = req.params
    const { url, parent_data } = req.body as { url: string; parent_data?: Record<string, unknown> }

    if (!url) { res.status(400).json({ error: 'url is required' }); return }
    if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: 'url must start with http:// or https://' }); return }

    initSSE(res)

    const debugRunner = new DebugStepRunner(dbLoader)
    debugRunner.on('log',    (log)    => writeSSE(res, { type: 'log', ...log }))
    debugRunner.on('result', (result) => writeSSE(res, { type: 'result', result }))

    let cancelled = false
    req.on('close', () => { cancelled = true; debugRunner.stop() })

    try {
      await debugRunner.run(name, step, url, parent_data)
      if (!cancelled) writeSSE(res, { type: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!(err instanceof Error && err.message === 'aborted')) writeSSE(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  })

  return router
}
