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
import type { SchedulePersistenceService } from '../../infrastructure/db/SchedulePersistenceService.js'
import { SchedulerService } from '../../application/services/SchedulerService.js'
import type { StepVersionPersistenceService } from '../../infrastructure/db/StepVersionPersistenceService.js'
import type { ModulePersistenceService } from '../../infrastructure/db/ModulePersistenceService.js'
import { CsvRowReader } from '../../infrastructure/csv/CsvRowReader.js'
import { requireRole } from '../middleware/requireRole.js'
import { validatePublicUrl } from '../utils/validateUrl.js'

interface Deps {
  runner: ParserRunnerService
  runPersistence: RunPersistenceService
  parserService: ParserPersistenceService
  dbLoader: DbParserLoader
  outputDir: string
  schedulePersistence: SchedulePersistenceService
  stepVersionService: StepVersionPersistenceService
  moduleService: ModulePersistenceService
}

export function createParsersRouter({
  runner,
  runPersistence,
  parserService,
  dbLoader,
  outputDir,
  schedulePersistence,
  stepVersionService,
  moduleService,
}: Deps) {
  const router = express.Router()

  router.param('id', async (req, res, next, id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      res.status(404).json({ error: 'Parser not found' })
      return
    }
    const parser = await parserService.findById(id)
    if (!parser || parser.organizationId !== req.user!.organizationId) {
      res.status(404).json({ error: 'Parser not found' })
      return
    }
    res.locals.parser = parser
    next()
  })

  // ── Parser CRUD ─────────────────────────────────────────────────────────────

  router.post('/import', async (req, res) => {
    const {
      parser: incomingParser,
      steps: incomingSteps,
      newName,
    } = req.body as {
      parser: {
        name: string
        entryUrl?: string
        entryStep?: string
        browserType?: string
        browserSettings?: object
        retryConfig?: { maxRetries: number }
        deduplication?: boolean
        concurrentQuota?: number | null
      }
      steps: {
        name: string
        type: 'traverser' | 'extractor'
        entryUrl?: string
        outputFile?: string | null
        code?: string
        stepSettings?: object
        position?: number
      }[]
      newName?: string
    }
    if (!incomingParser?.name) {
      res.status(400).json({ error: 'parser.name is required' })
      return
    }
    const name = newName ?? incomingParser.name
    if (!/^[a-zA-Z0-9 _-]{1,100}$/.test(name)) {
      res.status(400).json({
        error:
          'name must contain only letters, digits, spaces, hyphens, and underscores (max 100 chars)',
      })
      return
    }
    try {
      const created = await parserService.create({
        organizationId: req.user!.organizationId,
        name,
        entryUrl: incomingParser.entryUrl,
        entryStep: incomingParser.entryStep,
        browserType: incomingParser.browserType,
        browserSettings: incomingParser.browserSettings,
        retryConfig: incomingParser.retryConfig,
        deduplication: incomingParser.deduplication,
        concurrentQuota: incomingParser.concurrentQuota ?? null,
      })
      for (const s of incomingSteps ?? []) {
        await parserService.createStep({
          parserId: created.id,
          name: s.name,
          type: s.type,
          entryUrl: s.entryUrl,
          outputFile: s.outputFile ?? null,
          code: s.code,
          position: s.position,
        })
        if (s.stepSettings) {
          const step = await parserService.getStep(created.id, s.name)
          if (step) await parserService.updateStep(step.id, { stepSettings: s.stepSettings })
        }
      }
      res.status(201).json({ parser: created })
    } catch (err) {
      if (err instanceof ParserAlreadyExistsError) {
        res.status(409).json({ error: err.message })
        return
      }
      throw err
    }
  })

  router.get('/', async (req, res) => {
    const page = Math.min(10000, Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1))
    const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit ?? '10'), 10) || 10))
    const search = String(req.query.search ?? '').slice(0, 200)
    const status = String(req.query.status ?? 'all')
    const sort = (['name', 'successRate', 'lastRunDate'] as const).includes(
      req.query.sort as 'name',
    )
      ? (req.query.sort as 'name' | 'successRate' | 'lastRunDate')
      : 'name'
    const dir = req.query.dir === 'desc' ? 'desc' : 'asc'

    const raw = await runPersistence.listParsersWithLatestRun(search, req.user!.organizationId)

    // Enrich status from in-memory runner (authoritative for running state)
    const enriched = raw.map((p) => ({
      ...p,
      status: (runner.isRunning(p.name) ? 'running' : p.dbStatus) as 'running' | 'stopped' | 'idle',
    }))

    // Filter by status
    const filtered = status === 'all' ? enriched : enriched.filter((p) => p.status === status)

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sort === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sort === 'successRate') {
        cmp = (a.successRate ?? -1) - (b.successRate ?? -1)
      } else if (sort === 'lastRunDate') {
        cmp = (a.lastRunDate ?? '').localeCompare(b.lastRunDate ?? '')
      }
      return dir === 'asc' ? cmp : -cmp
    })

    const total = sorted.length
    const page_items = sorted.slice((page - 1) * limit, page * limit)

    res.json({
      parsers: page_items.map(({ dbStatus: _db, ...rest }) => rest),
      total,
    })
  })

  router.post('/', requireRole('admin'), async (req, res) => {
    const {
      name,
      entryUrl,
      entryStep,
      browserType,
      browserSettings,
      retryConfig,
      deduplication,
      concurrentQuota,
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
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (!/^[a-zA-Z0-9 _-]{1,100}$/.test(name)) {
      res.status(400).json({
        error:
          'name must contain only letters, digits, spaces, hyphens, and underscores (max 100 chars)',
      })
      return
    }
    if (entryUrl) {
      const urlError = await validatePublicUrl(entryUrl)
      if (urlError) {
        res.status(400).json({ error: `entryUrl: ${urlError}` })
        return
      }
    }
    try {
      const parser = await parserService.create({
        organizationId: req.user!.organizationId,
        name,
        entryUrl,
        entryStep,
        browserType,
        browserSettings,
        retryConfig,
        deduplication,
        concurrentQuota,
      })
      res.status(201).json({ parser })
    } catch (err) {
      if (err instanceof ParserAlreadyExistsError) {
        res.status(409).json({ error: err.message })
        return
      }
      throw err
    }
  })

  router.get('/:id', async (_req, res) => {
    const { id, name }: ParserRow = res.locals.parser
    const result = await parserService.getParserWithSteps(name)
    res.json(result ?? { parser: res.locals.parser, steps: await parserService.listSteps(id) })
  })

  router.put('/:id', async (req, res) => {
    const { id }: ParserRow = res.locals.parser
    const {
      entryUrl,
      entryStep,
      browserType,
      browserSettings,
      retryConfig,
      deduplication,
      concurrentQuota,
      webhookUrl,
    } = req.body
    const parser = await parserService.update(id, {
      entryUrl,
      entryStep,
      browserType,
      browserSettings,
      retryConfig,
      deduplication,
      concurrentQuota,
      webhookUrl,
    })
    res.json({ parser })
  })

  router.delete('/:id', requireRole('admin'), async (_req, res) => {
    await parserService.delete((res.locals.parser as ParserRow).id)
    res.json({ ok: true })
  })

  // ── Export / Import ──────────────────────────────────────────────────────────

  router.get('/:id/export', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    const result = await parserService.getParserWithSteps(name)
    if (!result) {
      res.status(404).json({ error: 'Parser not found' })
      return
    }
    const { id: _i, createdAt: _c, updatedAt: _u, ...parserData } = result.parser
    const steps = result.steps.map(
      ({ id: _si, parserId: _pi, createdAt: _sc, updatedAt: _su, ...rest }) => rest,
    )
    const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '_')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.parser.json"`)
    res.json({ parser: parserData, steps })
  })

  // ── Run control ──────────────────────────────────────────────────────────────

  router.post('/:id/start', requireRole('admin'), (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    if (runner.isRunning(name)) {
      res.status(409).json({ error: 'Already running' })
      return
    }
    runner.run(name).catch((err: Error) => broadcast(name, { type: 'error', message: err.message }))
    res.json({ ok: true })
  })

  router.post('/:id/stop', requireRole('admin'), async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    try {
      await runner.stop(name)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post('/:id/rerun', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    try {
      await runner.forceRun(name)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  router.post('/:id/resume', requireRole('admin'), (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    if (runner.isRunning(name)) {
      res.status(409).json({ error: 'Already running' })
      return
    }
    runner
      .resume(name)
      .catch((err: Error) => broadcast(name, { type: 'error', message: err.message }))
    res.json({ ok: true })
  })

  router.get('/:id/stats', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    const stats = await runPersistence.getParserStats(name)
    res.json(stats)
  })

  router.get('/:id/status', (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    res.json({ running: runner.isRunning(name), stats: runner.getStats(name) ?? null })
  })

  // ── Schedule ─────────────────────────────────────────────────────────────────

  router.get('/:id/schedule', async (_req, res) => {
    const { id }: ParserRow = res.locals.parser
    const row = await schedulePersistence.findByParserId(id)
    res.json({ schedule: row ?? null })
  })

  router.put('/:id/schedule', async (req, res) => {
    const { id }: ParserRow = res.locals.parser
    const { cronExpression, enabled } = req.body as { cronExpression: string; enabled: boolean }
    if (typeof cronExpression !== 'string' || !cronExpression.trim()) {
      res.status(400).json({ error: 'cronExpression is required' })
      return
    }
    const nextRunAt = SchedulerService.nextFireAt(cronExpression)
    if (!nextRunAt) {
      res.status(400).json({ error: 'Invalid cron expression' })
      return
    }
    const row = await schedulePersistence.upsertForParser({
      parserId: id,
      cronExpression,
      enabled: Boolean(enabled),
      nextRunAt,
    })
    res.json({ schedule: row })
  })

  router.delete('/:id/schedule', async (_req, res) => {
    const { id }: ParserRow = res.locals.parser
    await schedulePersistence.deleteByParserId(id)
    res.json({ ok: true })
  })

  // ── SSE event stream ─────────────────────────────────────────────────────────

  router.get('/:id/events', async (req, res) => {
    const { name }: ParserRow = res.locals.parser
    initSSE(res)

    const isRunning = runner.isRunning(name)
    let stoppedRunExists = false
    if (!isRunning) {
      const info = await runPersistence.getLatestRunInfo(name).catch(() => null)
      stoppedRunExists = info?.status === 'stopped'
    }

    writeSSE(res, {
      type: 'init',
      running: isRunning,
      stats: runner.getStats(name) ?? null,
      stoppedRunExists,
    })
    getClients(name).add(res)
    req.on('close', () => getClients(name).delete(res))
  })

  // ── Output files ─────────────────────────────────────────────────────────────

  router.get('/:id/files', async (_req, res) => {
    const { name }: ParserRow = res.locals.parser
    const parserDir = resolve(outputDir, name)
    try {
      const subdirs = await readdir(parserDir)
      const files: { name: string; runId: string; size: number; mtime: string }[] = []
      await Promise.all(
        subdirs.map(async (sub) => {
          const subPath = resolve(parserDir, sub)
          try {
            const subStat = await stat(subPath)
            if (!subStat.isDirectory()) return
            const entries = await readdir(subPath)
            await Promise.all(
              entries
                .filter((f) => f.endsWith('.csv') || f.endsWith('.json') || f.endsWith('.xlsx'))
                .map(async (f) => {
                  const s = await stat(resolve(subPath, f))
                  files.push({ name: f, runId: sub, size: s.size, mtime: s.mtime.toISOString() })
                }),
            )
          } catch {
            /* skip unreadable subdirs */
          }
        }),
      )
      files.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
      res.json({ files })
    } catch {
      res.json({ files: [] })
    }
  })

  router.get('/:id/files/:runId/:file/rows', async (req, res) => {
    const { name }: ParserRow = res.locals.parser
    const { runId, file } = req.params

    if (!file.endsWith('.csv')) {
      res.status(400).json({ error: 'Row pagination is only supported for CSV files' })
      return
    }
    if (file.includes('/') || file.includes('..') || runId.includes('/') || runId.includes('..')) {
      res.status(400).json({ error: 'Invalid path' })
      return
    }

    const safeDir = resolve(outputDir, name)
    const filePath = resolve(safeDir, runId, file)
    if (!filePath.startsWith(safeDir + '/')) {
      res.status(400).json({ error: 'Invalid path' })
      return
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1
    const limit = Number.parseInt(String(req.query.limit ?? '20'), 10) || 20

    try {
      const reader = new CsvRowReader(filePath)
      const result = await reader.readPage(page, limit)
      res.json(result)
    } catch (err) {
      console.error('[parsers/rows] failed to read CSV page:', err)
      res.status(500).json({ error: 'Failed to read CSV rows' })
    }
  })

  router.get('/:id/files/:runId/:file', (req, res) => {
    const { name }: ParserRow = res.locals.parser
    const { runId, file } = req.params
    const allowed = file.endsWith('.csv') || file.endsWith('.json') || file.endsWith('.xlsx')
    if (
      !allowed ||
      file.includes('/') ||
      file.includes('..') ||
      runId.includes('/') ||
      runId.includes('..')
    ) {
      res.status(400).json({ error: 'Invalid path' })
      return
    }
    const safeDir = resolve(outputDir, name)
    const filePath = resolve(safeDir, runId, file)
    if (!filePath.startsWith(safeDir + '/')) {
      res.status(400).json({ error: 'Invalid path' })
      return
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`)
    createReadStream(filePath).pipe(res)
  })

  // ── Steps CRUD ───────────────────────────────────────────────────────────────

  router.post('/:id/steps', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const {
      name: stepName,
      type,
      entryUrl,
      outputFile,
      code,
      position,
    } = req.body as {
      name: string
      type: 'traverser' | 'extractor'
      entryUrl?: string
      outputFile?: string
      code?: string
      position?: number
    }
    if (!stepName) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (type !== 'traverser' && type !== 'extractor') {
      res.status(400).json({ error: 'type must be traverser or extractor' })
      return
    }
    try {
      const step = await parserService.createStep({
        parserId,
        name: stepName,
        type,
        entryUrl,
        outputFile,
        code,
        position,
      })
      res.status(201).json({ step })
    } catch (err) {
      if (err instanceof StepAlreadyExistsError) {
        res.status(409).json({ error: err.message })
        return
      }
      throw err
    }
  })

  router.get('/:id/steps', async (_req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    res.json({ steps: await parserService.listSteps(parserId) })
  })

  router.get('/:id/steps/:step', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) {
      res.status(404).json({ error: `Step "${req.params.step}" not found` })
      return
    }
    res.json({ step })
  })

  router.put('/:id/steps/:step', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step as string)
    if (!step) {
      res.status(404).json({ error: `Step "${req.params.step}" not found` })
      return
    }
    const { name: newName, type, entryUrl, outputFile, code, stepSettings, position } = req.body
    try {
      const updated = await parserService.updateStep(step.id, {
        name: newName,
        type,
        entryUrl,
        outputFile,
        code,
        stepSettings,
        position,
      })
      res.json({ step: updated })
    } catch (err) {
      if (err instanceof StepAlreadyExistsError) {
        res.status(409).json({ error: err.message })
        return
      }
      throw err
    }
  })

  router.delete('/:id/steps/:step', requireRole('admin'), async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const deleted = await parserService.deleteStep(parserId, req.params.step as string)
    if (!deleted) {
      res.status(404).json({ error: `Step "${req.params.step}" not found` })
      return
    }
    res.json({ ok: true })
  })

  router.get('/:id/steps/:step/versions', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) {
      res.status(404).json({ error: `Step "${req.params.step}" not found` })
      return
    }
    const rows = await stepVersionService.list(step.id, 20)
    res.json({ versions: rows })
  })

  router.post('/:id/steps/:step/versions/:versionId/restore', async (req, res) => {
    const { id: parserId }: ParserRow = res.locals.parser
    const step = await parserService.getStep(parserId, req.params.step)
    if (!step) {
      res.status(404).json({ error: `Step "${req.params.step}" not found` })
      return
    }
    const version = await stepVersionService.findById(req.params.versionId)
    if (!version || version.stepId !== step.id) {
      res.status(404).json({ error: 'Version not found' })
      return
    }
    const updated = await parserService.updateStep(step.id, { code: version.code })
    res.json({ step: updated })
  })

  // ── Step debug (SSE) ─────────────────────────────────────────────────────────

  router.post('/:id/steps/:step/debug', requireRole('admin'), async (req, res) => {
    const { name }: ParserRow = res.locals.parser
    const step = req.params.step as string
    const { url, parent_data } = req.body as { url: string; parent_data?: Record<string, unknown> }

    if (!url) {
      res.status(400).json({ error: 'url is required' })
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: 'url must start with http:// or https://' })
      return
    }

    initSSE(res)

    const debugRunner = new DebugStepRunner(dbLoader)
    debugRunner.on('log', (log) => writeSSE(res, { type: 'log', ...log }))
    debugRunner.on('result', (result) => writeSSE(res, { type: 'result', result }))

    let cancelled = false
    req.on('close', () => {
      cancelled = true
      debugRunner.stop()
    })

    try {
      await debugRunner.run(name, step, url, parent_data)
      if (!cancelled) writeSSE(res, { type: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!(err instanceof Error && err.message === 'aborted'))
        writeSSE(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  })

  // ── Helper modules ─────────────────────────────────────────────────────────────

  const PATH_RE = /^[A-Za-z_$][\w$]*$/

  router.get('/:id/modules', async (_req, res) => {
    const { id: parserId } = res.locals.parser as { id: string }
    const rows = await moduleService.findByParserId(parserId)
    res.json({ modules: rows.map(({ content: _c, ...rest }) => rest) })
  })

  router.post('/:id/modules', requireRole('admin'), async (req, res) => {
    const { id: parserId } = res.locals.parser as { id: string }
    const { path, content } = req.body as { path?: string; content?: string }
    if (!path || !PATH_RE.test(path)) {
      res.status(400).json({ error: 'path must be a valid identifier (no slashes, no extension)' })
      return
    }
    try {
      const module = await moduleService.create({ parserId, path, content })
      res.status(201).json({ module })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: `File "${path}" already exists` })
        return
      }
      throw err
    }
  })

  router.get('/:id/modules/:fileId', async (req, res) => {
    const { id: parserId } = res.locals.parser as { id: string }
    const module = await moduleService.findById(req.params.fileId as string)
    if (!module || module.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.json({ module })
  })

  router.put('/:id/modules/:fileId', requireRole('admin'), async (req, res) => {
    const { id: parserId } = res.locals.parser as { id: string }
    const existing = await moduleService.findById(req.params.fileId as string)
    if (!existing || existing.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    const { path, content } = req.body as { path?: string; content?: string }
    if (path !== undefined && !PATH_RE.test(path)) {
      res.status(400).json({ error: 'path must be a valid identifier (no slashes, no extension)' })
      return
    }
    try {
      const module = await moduleService.update(req.params.fileId as string, { path, content })
      res.json({ module })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: `File "${path}" already exists` })
        return
      }
      throw err
    }
  })

  router.delete('/:id/modules/:fileId', requireRole('admin'), async (req, res) => {
    const { id: parserId } = res.locals.parser as { id: string }
    const existing = await moduleService.findById(req.params.fileId as string)
    if (!existing || existing.parserId !== parserId) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    await moduleService.delete(req.params.fileId as string)
    res.json({ ok: true })
  })

  return router
}
