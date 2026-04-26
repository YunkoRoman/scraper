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
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, ref.orchestrator!.getAllTasks()).catch(console.error)
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
    await this.runPersistence.createRun(parserName, ref.orchestrator.runId).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }

  async resume(parserName: string): Promise<void> {
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }
    const snapshot = await this.runPersistence.loadLatestStoppedRunTasks(parserName)
    if (!snapshot) throw new Error(`No stopped run found for "${parserName}"`)

    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, ref.orchestrator!.getAllTasks()).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.resume(
      parserName,
      snapshot.runId,
      snapshot.tasks.map((t) => ({
        id:           t.id,
        url:          t.url,
        stepName:     t.stepName as any,
        stepType:     t.stepType,
        state:        t.state as any,
        attempts:     t.attempts,
        maxAttempts:  t.maxAttempts,
        error:        t.error ?? undefined,
        parentTaskId: t.parentTaskId ?? undefined,
        parentData:   (t.parentData as Record<string, unknown>) ?? undefined,
      })),
      (stats) => {
        const s = stats as RunStats
        this.lastStats.set(parserName, s)
        this.emit('stats', parserName, s)
      },
      onComplete,
      (filePath) => this.emit('postprocess', parserName, filePath),
    )
    this._wireTaskEvents(ref.orchestrator)
    await this.runPersistence.markRunRunning(snapshot.runId).catch(console.error)
    this.activeRuns.set(parserName, ref.orchestrator)
  }

  async stop(parserName: string): Promise<void> {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    const runId = orchestrator.runId
    await orchestrator.stop()
    await this.runPersistence.markRunStopped(runId, orchestrator.getAllTasks()).catch(console.error)
    this.activeRuns.delete(parserName)
    this.emit('stopped', parserName)
  }

  retryTask(parserName: string, taskId: string): void {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    orchestrator.retryTask(taskId)
  }

  abortTask(parserName: string, taskId: string): void {
    const orchestrator = this.activeRuns.get(parserName)
    if (!orchestrator) throw new Error(`No active run for parser "${parserName}"`)
    orchestrator.abortTask(taskId)
  }

  async retryFailed(runId: string): Promise<void> {
    const runInfo = await this.runPersistence.getRunById(runId)
    if (!runInfo) throw new Error(`Run "${runId}" not found`)
    const parserName = runInfo.parserName
    if (this.activeRuns.has(parserName)) {
      throw new Error(`Parser "${parserName}" is already running`)
    }

    await this.runPersistence.resetFailedTasks(runId)
    const { tasks } = await this.runPersistence.getRunTasks(runId, 1, 10_000)

    const ref = { orchestrator: null as ParserOrchestrator | null }
    const onComplete = async (stats: unknown) => {
      const s = stats as RunStats
      this.lastStats.set(parserName, s)
      await this.runPersistence.markRunCompleted(ref.orchestrator!.runId, ref.orchestrator!.getAllTasks()).catch(console.error)
      this.emit('complete', parserName, s)
      this.activeRuns.delete(parserName)
    }
    ref.orchestrator = await this.runParser.resume(
      parserName,
      runId,
      tasks.map((t) => ({
        id:           t.id,
        url:          t.url,
        stepName:     t.stepName as any,
        stepType:     t.stepType,
        state:        t.state as any,
        attempts:     t.attempts,
        maxAttempts:  t.maxAttempts,
        error:        t.error ?? undefined,
        parentTaskId: t.parentTaskId ?? undefined,
        parentData:   (t.parentData as Record<string, unknown>) ?? undefined,
      })),
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
    const orchestrator = this.activeRuns.get(parserName)
    if (orchestrator) return orchestrator.getStats()
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
      this.runPersistence.upsertTask(orchestrator.runId, task).catch(console.error)
      this.emit('task_done', orchestrator.runId, task)
    })
    orchestrator.on('data_extracted', ({ taskId, rows }: { taskId: string; rows: Record<string, unknown>[] }) => {
      this.runPersistence.saveTaskResult(taskId, rows).catch(console.error)
    })
  }
}
