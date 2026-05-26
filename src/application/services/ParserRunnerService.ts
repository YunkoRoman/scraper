import { EventEmitter } from 'node:events'
import { RunParser } from '../use-cases/RunParser.js'
import type { ParserOrchestrator } from '../orchestrator/ParserOrchestrator.js'
import type { RunStats } from '../../domain/entities/ParserRun.js'
import type { PageTask } from '../../domain/entities/PageTask.js'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

export class ParserRunnerService extends EventEmitter {
  private activeRuns = new Map<string, ParserOrchestrator>()
  private lastStats = new Map<string, RunStats>()

  constructor(
    private readonly runParser: RunParser,
    private readonly runPersistence: RunPersistenceService,
  ) {
    super()
  }

  async run(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, await ref.orchestrator!.getAllTasks()).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.execute(
      parserName,
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      onComplete,
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(ref.orchestrator)
    await this.runPersistence.create({ parserName, runId: ref.orchestrator.runId }).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }

  async resume(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    const latest = await this.runPersistence.getLatestRunInfo(parserName)
    if (!latest || latest.status !== 'stopped') throw new Error(`No stopped run found for "${parserName}"`)

    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, await ref.orchestrator!.getAllTasks()).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.resume(
      parserName,
      latest.id,
      [],
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      onComplete,
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(ref.orchestrator)
    await this.runPersistence.markRunRunning(latest.id).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) {
      const runId = orchestrator.runId
      await orchestrator.stop()
      await this.runPersistence.markRunStopped(runId, await orchestrator.getAllTasks()).catch(console.error)
      this.activeRuns.delete(parserName)
      this.emit('stopped', parserName)
      return
    }
    // Orphaned: server restarted while run was active — clean up DB record
    const latest = await this.runPersistence.getLatestRunInfo(parserName)
    if (latest && latest.status === 'running') {
      await this.runPersistence.update(latest.id, { status: 'stopped', stoppedAt: new Date() })
      this.emit('stopped', parserName)
      return
    }
    throw new Error(`No active run for parser "${parserName}"`)
  }

  async forceRun(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) {
      await orchestrator.stop()
      await this.runPersistence.update(orchestrator.runId, { status: 'failed', stoppedAt: new Date() }).catch(console.error)
      this.activeRuns.delete(parserName)
    } else {
      const latest = await this.runPersistence.getLatestRunInfo(parserName)
      if (latest && latest.status === 'running') {
        await this.runPersistence.update(latest.id, { status: 'failed', stoppedAt: new Date() })
      }
    }
    await this.run(parserName)
  }

  async retryTask(parserName: string, taskId: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.retryTask(taskId)
  }

  async abortTask(parserName: string, taskId: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    await orchestrator.abortTask(taskId)
  }

  async retryFailed(runId: string): Promise<void> {
    const runInfo = await this.runPersistence.findById(runId)
    if (!runInfo) throw new Error(`Run "${runId}" not found`)
    const parserName = runInfo.parserName
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }

    await this.runPersistence.resetFailedTasks(runId)

    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, await ref.orchestrator!.getAllTasks()).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.resume(
      parserName,
      runId,
      [],
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      onComplete,
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(ref.orchestrator)
    await this.runPersistence.markRunRunning(runId).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }

  findParserByRunId(runId: string): string | undefined {
    for (const [parserName, orch] of this.activeRuns) {
      if (orch.runId === runId) return parserName
    }
    return undefined
  }

  getOrchestrator(parserName: string): ParserOrchestrator | undefined {
    return this.activeRuns.get(parserName)
  }

  getStats(parserName: string): RunStats | undefined {
    return this.lastStats.get(parserName)
  }

  isRunning(parserName: string): boolean {
    return this.activeRuns.has(parserName)
  }

  listRunning(): string[] {
    return [...this.activeRuns.keys()]
  }

  private _wireTaskEvents(orchestrator: ParserOrchestrator): void {
    orchestrator.on('task_done', (task: PageTask) => {
      // upsertTask removed — DbTaskStateStore writes through on every state mutation
      this.emit('task_done', orchestrator.runId, task)
    })
    orchestrator.on('data_extracted', ({ taskId, rows }: { taskId: string; rows: Record<string, unknown>[]; task: PageTask | undefined }) => {
      this.runPersistence.saveTaskResult(taskId, rows).catch((err) => {
        console.error(`[persistence] saveTaskResult failed for task ${taskId}:`, err)
      })
    })
    orchestrator.on('task_failed_html', (taskId: string, html: string) => {
      this.runPersistence.saveTaskHtml(taskId, html).catch((err) => {
        console.error(`[persistence] saveTaskHtml failed for task ${taskId}:`, err)
      })
    })
  }
}
